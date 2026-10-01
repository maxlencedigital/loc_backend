import type { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";

// Every Query module is replaced by an in-memory fake; the complaint rules, the state
// machine, the ownership checks and the account package's customer link are the real code.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../../commons/Http/ServiceClient.js", () => require("../Testing/InMemorySupport.js").serviceClientMock);
jest.mock("../Queries/Store.Query.js", () => ({ StoreQuery: require("../Testing/InMemoryCommerce.js").storeQuery }));
jest.mock("../Queries/Customer.Query.js", () => ({ CustomerQuery: require("../Testing/InMemoryCommerce.js").customerQuery }));
jest.mock("../Queries/Catalog.Query.js", () => ({ CatalogQuery: require("../Testing/InMemoryCommerce.js").catalogQuery }));
jest.mock("../Queries/Order.Query.js", () => ({ OrderQuery: require("../Testing/InMemoryCommerce.js").orderQuery }));
jest.mock("../Queries/CustomerProfile.Query.js", () => ({ CustomerProfileQuery: require("../Testing/InMemoryCustomerAccount.js").profileQuery }));
jest.mock("../Queries/OrderInternal.Query.js", () => ({ OrderInternalQuery: require("../Testing/InMemoryCustomerAccount.js").internalOrderQuery }));
jest.mock("../Queries/CustomerOrder.Query.js", () => ({ CustomerOrderQuery: require("../Testing/InMemoryCustomerAccount.js").customerOrderQuery }));
jest.mock("../Queries/Complaint.Query.js", () => ({ ComplaintQuery: require("../Testing/InMemorySupport.js").complaintQuery }));
jest.mock("../Queries/SupportOrder.Query.js", () => ({ SupportOrderQuery: require("../Testing/InMemorySupport.js").supportOrderQuery }));

import { gateway } from "../Testing/InMemoryCustomerAccount.js";
import { state } from "../Testing/InMemorySupport.js";
import { IShopper, addOrder, buildSupportWorld, refused, shopper, staffMember } from "../Testing/SupportWorld.js";
import { ComplaintService, MAX_THREAD_EVENTS } from "./Complaint.Service.js";
import { EscalationService } from "./Escalation.Service.js";
import { nextComplaintStatus } from "../Models/Complaint/ComplaintStatus.js";
import { CustomException } from "../../commons/Exception/CustomException.js";

const NOW = new Date("2026-10-05T04:00:00Z");
let world: any;
let ana: IShopper;
let bob: IShopper;
let order: any;
let orderB: any;
let staffA: RequestUser;
let managerA: RequestUser;
let managerB: RequestUser;
let admin: RequestUser;
let errorSpy: jest.SpyInstance;

const scopeOf = (user: RequestUser, scopeStoreId: string | null = null) =>
  resolveStoreScope({ user: { ...user, scopeStoreId } } as IdentifiedRequest);

const raise = (extra: Record<string, unknown> = {}, who = ana, key?: string) =>
  ComplaintService.raise(who.user, { orderId: order.id, type: "damaged_item", description: "Button missing", ...extra }, key);

const log = (user: RequestUser, extra: Record<string, unknown> = {}, scope = scopeOf(user), key?: string) =>
  ComplaintService.log(user, scope, { orderId: order.id, type: "damaged_item", description: "Walk-in complaint", ...extra }, key);

const raised = async (extra: Record<string, unknown> = {}) => (await raise(extra)).data.id as string;

const detail = async (id: string, user = managerA) => (await ComplaintService.get(scopeOf(user), id)) as any;

const advance = (ms: number) => jest.setSystemTime(new Date(Date.now() + ms));

beforeEach(async () => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["setImmediate", "nextTick", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  world = buildSupportWorld();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  ana = await shopper();
  bob = await shopper();
  order = addOrder(ana.customerId, world.storeA.id);
  orderB = addOrder(bob.customerId, world.storeB.id);
  staffA = staffMember("staff", world.storeA.id);
  managerA = staffMember("manager", world.storeA.id);
  managerB = staffMember("manager", world.storeB.id);
  admin = staffMember("admin", null);
});
afterEach(() => {
  jest.useRealTimers();
  errorSpy.mockRestore();
});

describe("the state machine", () => {
  it.each([
    ["assign", "open", "assigned"],
    ["assign", "assigned", "assigned"],
    ["assign", "in_progress", "in_progress"],
    ["staffReply", "open", "in_progress"],
    ["staffReply", "escalated", "escalated"],
    ["customerReply", "resolved", "in_progress"],
    ["escalate", "assigned", "escalated"],
    ["resolve", "in_progress", "resolved"],
    ["decide", "escalated", "resolved"],
    ["close", "resolved", "closed"],
  ] as const)("allows %s from %s to reach %s", (action, from, to) => {
    expect(nextComplaintStatus(from, action)).toBe(to);
  });

  it.each([
    ["assign", "escalated"],
    ["assign", "resolved"],
    ["escalate", "escalated"],
    ["escalate", "resolved"],
    ["resolve", "escalated"],
    ["resolve", "resolved"],
    ["resolve", "closed"],
    ["decide", "open"],
    ["decide", "resolved"],
    ["close", "open"],
    ["close", "escalated"],
    ["customerReply", "closed"],
    ["staffReply", "closed"],
    ["staffNote", "closed"],
    ["photos", "closed"],
  ] as const)("refuses %s from %s", (action, from) => {
    expect(nextComplaintStatus(from, action)).toBeNull();
  });
});

describe("a customer raises a complaint", () => {
  it("creates an open complaint on their own order, with a first thread entry", async () => {
    const outcome = await raise({ itemId: order.items[0].id });
    expect(outcome.created).toBe(true);
    expect(outcome.data).toEqual({ id: expect.any(String), status: "open", orderId: order.id });
    const row = state.complaints.get(outcome.data.id);
    expect(row).toMatchObject({
      storeId: world.storeA.id, customerId: ana.customerId, customerUserId: ana.user.id, source: "customer",
      orderRef: order.ref, severity: "medium", status: "open", activeKey: `${order.id}:damaged_item`,
    });
    expect(state.events.get(outcome.data.id)).toHaveLength(1);
  });

  it.each([
    ["no order", { orderId: undefined }, /orderId/],
    ["a malformed order id", { orderId: "nope" }, /orderId/],
    ["no type", { type: undefined }, /type/],
    ["an unknown type", { type: "rude" }, /type/],
    ["no description", { description: "" }, /description/],
    ["a blank description", { description: "   " }, /description/],
    ["a description over 2000 characters", { description: "x".repeat(2001) }, /2000/],
    ["a malformed item id", { itemId: "nope" }, /itemId/],
    ["an item that is not on the order", { itemId: "11111111-1111-4111-8111-111111111111" }, /item/],
  ])("refuses %s with a 400", async (_name, extra, message) => {
    await refused(raise(extra as any), 400, message);
    expect(state.complaints.size).toBe(0);
  });

  it("refuses a malformed Idempotency-Key", async () => {
    await refused(raise({}, ana, "has spaces!"), 400, /Idempotency-Key/);
    await refused(raise({}, ana, "x".repeat(129)), 400);
  });

  it("answers 404 for another customer's order, an unknown one, and never confirms it exists", async () => {
    await refused(raise({ orderId: orderB.id }), 404, /Order not found/);
    await refused(raise({ orderId: "11111111-1111-4111-8111-111111111111" }), 404, /Order not found/);
    expect(state.complaints.size).toBe(0);
  });

  it("is refused 403 for anyone who is not a customer", async () => {
    await refused(ComplaintService.raise(staffA, { orderId: order.id, type: "other", description: "x" }, undefined), 403);
    await refused(ComplaintService.listMine(managerA, {}), 403);
  });

  it("replays an Idempotency-Key: the same complaint comes back and nothing is added", async () => {
    const first = await raise({}, ana, "key-1");
    const again = await raise({}, ana, "key-1");
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.data.id).toBe(first.data.id);
    expect(state.complaints.size).toBe(1);
  });

  it("returns the live complaint instead of a second one of the same type on the same order", async () => {
    const first = await raise();
    const again = await raise({ description: "Still missing" });
    expect(again.created).toBe(false);
    expect(again.data.id).toBe(first.data.id);
    const other = await raise({ type: "late_delivery" });
    expect(other.created).toBe(true);
    expect(state.complaints.size).toBe(2);
  });

  it("lets one customer raise the same type again once the first is resolved", async () => {
    const id = await raised();
    await ComplaintService.resolve(managerA, scopeOf(managerA), id, { resolution: "Sorted" });
    const second = await raise();
    expect(second.created).toBe(true);
    expect(second.data.id).not.toBe(id);
  });

  it("tells the customer when a store already logged that complaint, and shows them nothing of it", async () => {
    const logged = await log(staffA);
    await refused(raise(), 409, /already have an open complaint/);
    const mine = (await ComplaintService.listMine(ana.user, {})) as any;
    expect(mine.total).toBe(0);
    await refused(ComplaintService.getMine(ana.user, logged.data.id), 404);
  });

  it("creates exactly one complaint when the same request is sent five times at once", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => raise({}, ana, "burst")));
    expect(new Set(results.map((r) => r.data.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(state.complaints.size).toBe(1);
  });

  it("creates exactly one complaint when five identical requests without a key race", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => raise()));
    expect(new Set(results.map((r) => r.data.id)).size).toBe(1);
    expect(state.complaints.size).toBe(1);
  });
});

describe("a customer reads their own complaints", () => {
  it("lists only their own, newest first, with the status filter and paging", async () => {
    const first = await raised();
    advance(1000);
    const second = await raised({ type: "quality" });
    await raise({ orderId: orderB.id }, bob);
    const all = (await ComplaintService.listMine(ana.user, {})) as any;
    expect(all.items.map((i: any) => i.id)).toEqual([second, first]);
    expect(all).toMatchObject({ page: 1, limit: 20, total: 2 });
    await ComplaintService.resolve(managerA, scopeOf(managerA), second, { resolution: "ok" });
    const resolved = (await ComplaintService.listMine(ana.user, { status: "resolved" })) as any;
    expect(resolved.items.map((i: any) => i.id)).toEqual([second]);
    const paged = (await ComplaintService.listMine(ana.user, { page: "2", limit: "1" })) as any;
    expect(paged.items.map((i: any) => i.id)).toEqual([first]);
    expect(paged.total).toBe(2);
  });

  it("bounds the page size and refuses a nonsense page or status", async () => {
    expect(((await ComplaintService.listMine(ana.user, { limit: "5000" })) as any).limit).toBe(100);
    await refused(ComplaintService.listMine(ana.user, { page: "0" }), 400);
    await refused(ComplaintService.listMine(ana.user, { limit: "abc" }), 400);
    await refused(ComplaintService.listMine(ana.user, { status: "bogus" }), 400);
  });

  it("answers 404 for another customer's complaint and for a malformed id", async () => {
    const id = await raised();
    await refused(ComplaintService.getMine(bob.user, id), 404);
    await refused(ComplaintService.getMine(ana.user, "nope"), 404);
    await refused(ComplaintService.commentMine(bob.user, id, { message: "hi" }), 404);
    await refused(ComplaintService.addPhotos(bob.user, id, { photos: [{ url: "https://img.example.com/a.jpg" }] }), 404);
  });

  it("shows the decision and a timeline without staff-only notes or the reason for escalation", async () => {
    const id = await raised();
    await ComplaintService.comment(staffA, scopeOf(staffA), id, { message: "Checking with the plant" });
    await ComplaintService.comment(staffA, scopeOf(staffA), id, { message: "Customer is a regular", internal: true });
    await ComplaintService.escalate(staffA, scopeOf(staffA), id, { reason: "Possible fraud, handle carefully" });
    await EscalationService.decide(admin, scopeOf(admin), id, { decision: "goodwill", note: "A free wash next time" });
    const view = (await ComplaintService.getMine(ana.user, id)) as any;
    expect(view).toMatchObject({ status: "resolved", decision: "goodwill", resolution: "A free wash next time", orderRef: order.ref });
    const json = JSON.stringify(view);
    expect(json).not.toContain("regular");
    expect(json).not.toContain("fraud");
    expect(view.timeline.map((e: any) => e.event)).toEqual([
      "Complaint raised", "Message", "Escalated to management", "Resolved",
    ]);
    expect(view.timeline[1]).toMatchObject({ by: "LOC support", message: "Checking with the plant" });
    expect(view.timeline[0].by).toBe("You");
  });

  it("shows who it is assigned to by name", async () => {
    const id = await raised();
    await ComplaintService.assign(staffA, scopeOf(staffA), id, { assigneeId: staffA.id });
    expect(((await ComplaintService.getMine(ana.user, id)) as any).assignedTo).toBe(staffA.name);
  });
});

describe("a customer writes on their complaint", () => {
  it("adds a message and keeps the status", async () => {
    const id = await raised();
    const view = (await ComplaintService.commentMine(ana.user, id, { message: "Any news?" })) as any;
    expect(view.status).toBe("open");
    expect(view.timeline.at(-1)).toMatchObject({ event: "Message", by: "You", message: "Any news?" });
  });

  it("does not count a customer message as the first response", async () => {
    const id = await raised();
    await ComplaintService.commentMine(ana.user, id, { message: "Hello?" });
    expect((await detail(id)).sla.firstResponseAt).toBeNull();
  });

  it("reopens a resolved complaint and clears the old decision", async () => {
    const id = await raised();
    await ComplaintService.resolve(managerA, scopeOf(managerA), id, { resolution: "Refunded", refundAmount: 50 });
    const view = (await ComplaintService.commentMine(ana.user, id, { message: "It is still wrong" })) as any;
    expect(view).toMatchObject({ status: "in_progress", decision: null, resolution: null, refundAmount: null, resolvedAt: null });
    expect(view.timeline.map((e: any) => e.event).slice(-3)).toEqual(["Resolved", "Message", "Reopened"]);
    const row = state.complaints.get(id);
    expect(row.reopenCount).toBe(1);
    expect(row.activeKey).toBe(`${order.id}:damaged_item`);
  });

  it("refuses to reopen when a newer complaint of that type is already live", async () => {
    const id = await raised();
    await ComplaintService.resolve(managerA, scopeOf(managerA), id, { resolution: "ok" });
    await raise();
    await refused(ComplaintService.commentMine(ana.user, id, { message: "again" }), 409, /already open/);
    expect(state.complaints.get(id).status).toBe("resolved");
  });

  it("refuses a message on a closed complaint", async () => {
    const id = await raised();
    state.complaints.get(id).status = "closed";
    await refused(ComplaintService.commentMine(ana.user, id, { message: "hello" }), 409, /closed/);
  });

  it.each([["empty", ""], ["blank", "  "], ["missing", undefined], ["over 2000 characters", "x".repeat(2001)]])("refuses a message that is %s", async (_name, message) => {
    const id = await raised();
    await refused(ComplaintService.commentMine(ana.user, id, { message }), 400);
  });

  it("stops at the thread limit", async () => {
    const id = await raised();
    const events = state.events.get(id)!;
    while (events.length < MAX_THREAD_EVENTS) events.push({ ...events[0] });
    await refused(ComplaintService.commentMine(ana.user, id, { message: "one more" }), 409, /limit/);
  });
});

describe("photos on a complaint", () => {
  const photo = (n: number) => ({ url: `https://img.example.com/p${n}.jpg`, caption: `photo ${n}`, contentType: "image/jpeg", sizeBytes: 1000 });

  it("attaches references, ignores a link it already has, and keeps the status", async () => {
    const id = await raised();
    const first = (await ComplaintService.addPhotos(ana.user, id, { photos: [photo(1), photo(2)] })) as any;
    expect(first.photos).toHaveLength(2);
    const again = (await ComplaintService.addPhotos(ana.user, id, { photos: [photo(1)] })) as any;
    expect(again.photos).toHaveLength(2);
    expect(state.complaints.get(id).status).toBe("open");
    expect(state.events.get(id)!.filter((e) => e.kind === "photos_added")).toHaveLength(1);
  });

  it.each([
    ["no photos", { photos: [] }],
    ["not a list", { photos: "https://img.example.com/a.jpg" }],
    ["six at once", { photos: [1, 2, 3, 4, 5, 6].map(photo) }],
    ["an http link", { photos: [{ url: "http://img.example.com/a.jpg" }] }],
    ["a local address", { photos: [{ url: "https://localhost/a.jpg" }] }],
    ["a numeric address", { photos: [{ url: "https://10.0.0.1/a.jpg" }] }],
    ["a link with credentials", { photos: [{ url: "https://u:p@img.example.com/a.jpg" }] }],
    ["an unknown content type", { photos: [{ url: "https://img.example.com/a.exe", contentType: "application/x-msdownload" }] }],
    ["an absurd size", { photos: [{ url: "https://img.example.com/a.jpg", sizeBytes: 999_999_999 }] }],
  ])("refuses %s", async (_name, body) => {
    const id = await raised();
    await refused(ComplaintService.addPhotos(ana.user, id, body), 400);
  });

  it("holds at most ten photos and refuses photos on a closed complaint", async () => {
    const id = await raised();
    await ComplaintService.addPhotos(ana.user, id, { photos: [1, 2, 3, 4, 5].map(photo) });
    await ComplaintService.addPhotos(ana.user, id, { photos: [6, 7, 8, 9, 10].map(photo) });
    await refused(ComplaintService.addPhotos(ana.user, id, { photos: [photo(11)] }), 409, /at most 10/);
    state.complaints.get(id).status = "closed";
    await refused(ComplaintService.addPhotos(ana.user, id, { photos: [photo(1)] }), 409);
  });
});

describe("a store logs and works a complaint", () => {
  it("logs it against an order in the caller's store with the chosen severity", async () => {
    const outcome = await log(staffA, { severity: "high" });
    expect(outcome.created).toBe(true);
    expect(state.complaints.get(outcome.data.id)).toMatchObject({
      source: "store", customerUserId: null, customerId: ana.customerId, severity: "high", storeId: world.storeA.id,
    });
  });

  it("answers 404 for an order of another store, and 400 for bad fields", async () => {
    await refused(log(managerB), 404, /Order not found/);
    await refused(log(staffA, { severity: "urgent" }), 400, /severity/);
    await refused(log(staffA, { type: undefined }), 400);
    await refused(log(staffA, { itemId: "11111111-1111-4111-8111-111111111111" }), 400);
  });

  it("lets an admin without a store scope log against any order, filed under that order's store", async () => {
    const outcome = await ComplaintService.log(admin, scopeOf(admin), { orderId: orderB.id, type: "quality", description: "x" }, undefined);
    expect(state.complaints.get(outcome.data.id).storeId).toBe(world.storeB.id);
  });

  it("is idempotent by key and by live type, even when five requests race", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => log(staffA, {}, scopeOf(staffA), "k")));
    expect(new Set(results.map((r) => r.data.id)).size).toBe(1);
    expect(state.complaints.size).toBe(1);
  });

  it("shows each store only its own queue and answers 404 when another store is asked for", async () => {
    await raised();
    await raise({ orderId: orderB.id }, bob);
    const a = (await ComplaintService.list(scopeOf(managerA), {})) as any;
    const b = (await ComplaintService.list(scopeOf(managerB), {})) as any;
    expect(a.total).toBe(1);
    expect(a.items[0].storeId).toBe(world.storeA.id);
    expect(b.total).toBe(1);
    await refused(ComplaintService.list(scopeOf(managerA), { storeId: world.storeB.id }), 404);
    expect(((await ComplaintService.list(scopeOf(managerA), { storeId: world.storeA.id })) as any).total).toBe(1);
  });

  it("lets an admin see every store, or narrow to one", async () => {
    await raised();
    await raise({ orderId: orderB.id }, bob);
    expect(((await ComplaintService.list(scopeOf(admin), {})) as any).total).toBe(2);
    expect(((await ComplaintService.list(scopeOf(admin), { storeId: world.storeB.id })) as any).total).toBe(1);
    expect(((await ComplaintService.list(scopeOf(admin, world.storeA.id), {})) as any).total).toBe(1);
  });

  it("filters by status, type, assignee and date, and pages", async () => {
    const a = await raised();
    advance(86_400_000 * 3);
    const b = await raised({ type: "late_delivery" });
    await ComplaintService.assign(staffA, scopeOf(staffA), b, { assigneeId: staffA.id });
    const q = (query: Record<string, unknown>) => ComplaintService.list(scopeOf(managerA), query).then((r: any) => r.items.map((i: any) => i.id));
    expect(await q({ type: "late_delivery" })).toEqual([b]);
    expect(await q({ status: "assigned" })).toEqual([b]);
    expect(await q({ assigneeId: staffA.id })).toEqual([b]);
    expect(await q({ from: "2026-10-07" })).toEqual([b]);
    expect(await q({ to: "2026-10-05" })).toEqual([a]);
    expect(await q({ limit: "1" })).toEqual([b]);
    await refused(ComplaintService.list(scopeOf(managerA), { assigneeId: "x" }), 400);
    await refused(ComplaintService.list(scopeOf(managerA), { from: "yesterday" }), 400);
    await refused(ComplaintService.list(scopeOf(managerA), { type: "other_thing" }), 400);
  });

  it("shows the whole history, internal notes included, and answers 404 across stores", async () => {
    const id = await raised();
    await ComplaintService.comment(staffA, scopeOf(staffA), id, { message: "Note to self", internal: true });
    const view = await detail(id);
    expect(view.timeline.map((e: any) => [e.kind, e.internal])).toEqual([["created", false], ["comment", true]]);
    await refused(ComplaintService.get(scopeOf(managerB), id), 404);
    await refused(ComplaintService.get(scopeOf(managerA), "nope"), 404);
  });
});

describe("assigning", () => {
  it("lets staff take a complaint themselves: open becomes assigned", async () => {
    const id = await raised();
    const view = (await ComplaintService.assign(staffA, scopeOf(staffA), id, { assigneeId: staffA.id })) as any;
    expect(view).toMatchObject({ status: "assigned", assigneeId: staffA.id, assigneeName: staffA.name });
    expect(view.sla.assignedAt).not.toBeNull();
  });

  it("refuses staff assigning to someone else, but lets a manager", async () => {
    const id = await raised();
    const other = staffMember("staff", world.storeA.id);
    await refused(ComplaintService.assign(staffA, scopeOf(staffA), id, { assigneeId: other.id }), 403);
    const view = (await ComplaintService.assign(managerA, scopeOf(managerA), id, { assigneeId: other.id })) as any;
    expect(view.assigneeId).toBe(other.id);
  });

  it("accepts an admin as assignee", async () => {
    const id = await raised();
    expect(((await ComplaintService.assign(managerA, scopeOf(managerA), id, { assigneeId: admin.id })) as any).assigneeId).toBe(admin.id);
  });

  it.each([
    ["staff of another store", () => staffMember("staff", world.storeB.id)],
    ["a manager of another store", () => managerB],
    ["a deactivated account", () => staffMember("staff", world.storeA.id, { isActive: false })],
    ["a customer", () => ({ id: ana.user.id })],
    ["an hr account", () => staffMember("hr", null)],
    ["someone the gateway does not know", () => ({ id: "11111111-1111-4111-8111-111111111111" })],
  ])("refuses %s as assignee", async (_name, make) => {
    const id = await raised();
    await refused(ComplaintService.assign(managerA, scopeOf(managerA), id, { assigneeId: make().id }), 400, /team member/);
    expect(state.complaints.get(id).assigneeId).toBeNull();
  });

  it("refuses a missing or malformed assignee id", async () => {
    const id = await raised();
    await refused(ComplaintService.assign(managerA, scopeOf(managerA), id, {}), 400);
    await refused(ComplaintService.assign(managerA, scopeOf(managerA), id, { assigneeId: "x" }), 400);
  });

  it("reassigns without changing the stage, and refuses escalated, resolved and closed complaints", async () => {
    const id = await raised();
    await ComplaintService.comment(staffA, scopeOf(staffA), id, { message: "On it" });
    const other = staffMember("staff", world.storeA.id);
    const view = (await ComplaintService.assign(managerA, scopeOf(managerA), id, { assigneeId: other.id })) as any;
    expect(view.status).toBe("in_progress");
    await ComplaintService.escalate(staffA, scopeOf(staffA), id, { reason: "Too hard" });
    await refused(ComplaintService.assign(managerA, scopeOf(managerA), id, { assigneeId: other.id }), 409, /escalated/);
  });

  it("answers 404 across stores and passes a gateway outage on as 503", async () => {
    const id = await raised();
    await refused(ComplaintService.assign(managerB, scopeOf(managerB), id, { assigneeId: managerB.id }), 404);
    gateway.failWith = new CustomException("A connected service is unavailable right now. Please try again.", 503);
    await refused(ComplaintService.assign(managerA, scopeOf(managerA), id, { assigneeId: staffA.id }), 503);
    expect(state.complaints.get(id).assigneeId).toBeNull();
  });
});

describe("commenting as staff", () => {
  it("a public comment shows to the customer, starts work and stamps the first response once", async () => {
    const id = await raised();
    const at = new Date(Date.now() + 5 * 60_000);
    jest.setSystemTime(at);
    const view = (await ComplaintService.comment(staffA, scopeOf(staffA), id, { message: "We are looking" })) as any;
    expect(view.status).toBe("in_progress");
    expect(view.sla.firstResponseAt).toBe(at.toISOString());
    advance(60_000);
    const second = (await ComplaintService.comment(staffA, scopeOf(staffA), id, { message: "Update" })) as any;
    expect(second.sla.firstResponseAt).toBe(at.toISOString());
  });

  it("an internal note changes neither the status nor the response clock", async () => {
    const id = await raised();
    const view = (await ComplaintService.comment(staffA, scopeOf(staffA), id, { message: "Hmm", internal: true })) as any;
    expect(view.status).toBe("open");
    expect(view.sla.firstResponseAt).toBeNull();
  });

  it("refuses a closed complaint, a bad message and a non-boolean internal flag", async () => {
    const id = await raised();
    await refused(ComplaintService.comment(staffA, scopeOf(staffA), id, { message: "" }), 400);
    await refused(ComplaintService.comment(staffA, scopeOf(staffA), id, { message: "x", internal: "yes" }), 400);
    state.complaints.get(id).status = "closed";
    await refused(ComplaintService.comment(staffA, scopeOf(staffA), id, { message: "x" }), 409);
    await refused(ComplaintService.comment(staffA, scopeOf(staffA), id, { message: "x", internal: true }), 409);
  });

  it("is a 404 for another store", async () => {
    const id = await raised();
    await refused(ComplaintService.comment(managerB, scopeOf(managerB), id, { message: "x" }), 404);
  });
});

describe("escalating and resolving", () => {
  it("escalates an in-progress complaint with the reason and the time", async () => {
    const id = await raised();
    await ComplaintService.comment(staffA, scopeOf(staffA), id, { message: "x" });
    const view = (await ComplaintService.escalate(staffA, scopeOf(staffA), id, { reason: "Customer demands compensation" })) as any;
    expect(view).toMatchObject({ status: "escalated", escalationReason: "Customer demands compensation", escalatedAt: NOW.toISOString() });
    expect(state.complaints.get(id).activeKey).not.toBeNull();
  });

  it("refuses escalating twice, escalating a resolved complaint, or without a reason", async () => {
    const id = await raised();
    await refused(ComplaintService.escalate(staffA, scopeOf(staffA), id, {}), 400);
    await ComplaintService.escalate(staffA, scopeOf(staffA), id, { reason: "r" });
    await refused(ComplaintService.escalate(staffA, scopeOf(staffA), id, { reason: "r" }), 409);
    const other = await raised({ type: "quality" });
    await ComplaintService.resolve(staffA, scopeOf(staffA), other, { resolution: "fixed" });
    await refused(ComplaintService.escalate(staffA, scopeOf(staffA), other, { reason: "r" }), 409);
  });

  it("resolves with a resolution, stops the live key and stamps the SLA times", async () => {
    const id = await raised();
    const view = (await ComplaintService.resolve(staffA, scopeOf(staffA), id, { resolution: "Re-washed free", goodwill: "10% off" })) as any;
    expect(view).toMatchObject({ status: "resolved", resolution: "Re-washed free", goodwill: "10% off", decision: "goodwill" });
    expect(view.sla.resolvedAt).toBe(NOW.toISOString());
    expect(view.sla.firstResponseAt).toBe(NOW.toISOString());
    expect(state.complaints.get(id).activeKey).toBeNull();
  });

  it("lets staff resolve without money, but a refund needs a manager and may not exceed the order", async () => {
    const id = await raised();
    await refused(ComplaintService.resolve(staffA, scopeOf(staffA), id, { resolution: "ok", refundAmount: 50 }), 403, /manager/);
    await refused(ComplaintService.resolve(managerA, scopeOf(managerA), id, { resolution: "ok", refundAmount: 201 }), 400, /too large/);
    await refused(ComplaintService.resolve(managerA, scopeOf(managerA), id, { resolution: "ok", refundAmount: 0 }), 400);
    await refused(ComplaintService.resolve(managerA, scopeOf(managerA), id, { resolution: "ok", refundAmount: 10.123 }), 400);
    await refused(ComplaintService.resolve(managerA, scopeOf(managerA), id, { resolution: "ok", refundAmount: "50" }), 400);
    expect(state.complaints.get(id).status).toBe("open");
    const view = (await ComplaintService.resolve(managerA, scopeOf(managerA), id, { resolution: "Refunded", refundAmount: 150.5 })) as any;
    expect(view).toMatchObject({ status: "resolved", decision: "refund", refundAmount: 150.5 });
    expect(state.complaints.get(id).refundAmountPaise).toBe(15050);
  });

  it("requires a resolution", async () => {
    const id = await raised();
    await refused(ComplaintService.resolve(managerA, scopeOf(managerA), id, {}), 400, /resolution/);
  });

  it("leaves an escalated complaint to the admin decision, and refuses resolving twice", async () => {
    const id = await raised();
    await ComplaintService.escalate(staffA, scopeOf(staffA), id, { reason: "r" });
    await refused(ComplaintService.resolve(managerA, scopeOf(managerA), id, { resolution: "x" }), 409, /escalated/);
    const other = await raised({ type: "quality" });
    await ComplaintService.resolve(managerA, scopeOf(managerA), other, { resolution: "x" });
    await refused(ComplaintService.resolve(managerA, scopeOf(managerA), other, { resolution: "y" }), 409);
  });

  it("lets only one of two simultaneous resolutions through", async () => {
    const id = await raised();
    const results = await Promise.allSettled([
      ComplaintService.resolve(managerA, scopeOf(managerA), id, { resolution: "first" }),
      ComplaintService.resolve(staffA, scopeOf(staffA), id, { resolution: "second" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as CustomException).errorCode).toBe(409);
    expect(state.events.get(id)!.filter((e) => e.kind === "resolved")).toHaveLength(1);
  });

  it("is a 404 for another store", async () => {
    const id = await raised();
    await refused(ComplaintService.resolve(managerB, scopeOf(managerB), id, { resolution: "x" }), 404);
    await refused(ComplaintService.escalate(managerB, scopeOf(managerB), id, { reason: "x" }), 404);
  });
});

describe("management decisions on escalations", () => {
  const escalated = async (extra: Record<string, unknown> = {}) => {
    const id = await raised(extra);
    await ComplaintService.escalate(staffA, scopeOf(staffA), id, { reason: "Store cannot settle" });
    return id;
  };

  it("lists the waiting escalations by default, newest escalation first, and the decided ones on request", async () => {
    const first = await escalated();
    advance(60_000);
    const second = await escalated({ type: "quality" });
    await raised({ type: "late_delivery" });
    const waiting = (await EscalationService.list(scopeOf(admin), {})) as any;
    expect(waiting.items.map((i: any) => i.id)).toEqual([second, first]);
    expect(waiting.items[0]).toMatchObject({ reason: "Store cannot settle", orderRef: order.ref, storeId: world.storeA.id });
    await EscalationService.decide(admin, scopeOf(admin), first, { decision: "reject", note: "Policy" });
    expect(((await EscalationService.list(scopeOf(admin), {})) as any).items.map((i: any) => i.id)).toEqual([second]);
    const decided = (await EscalationService.list(scopeOf(admin), { status: "resolved" })) as any;
    expect(decided.items.map((i: any) => i.id)).toEqual([first]);
  });

  it("filters by store and type, and respects an admin's chosen store", async () => {
    await escalated();
    const idB = await ComplaintService.raise(bob.user, { orderId: orderB.id, type: "quality", description: "x" }, undefined);
    await ComplaintService.escalate(managerB, scopeOf(managerB), idB.data.id, { reason: "r" });
    expect(((await EscalationService.list(scopeOf(admin), {})) as any).total).toBe(2);
    expect(((await EscalationService.list(scopeOf(admin), { storeId: world.storeB.id })) as any).total).toBe(1);
    expect(((await EscalationService.list(scopeOf(admin), { type: "quality" })) as any).total).toBe(1);
    expect(((await EscalationService.list(scopeOf(admin, world.storeA.id), {})) as any).total).toBe(1);
    await refused(EscalationService.list(scopeOf(admin, world.storeA.id), { storeId: world.storeB.id }), 404);
  });

  it("opens an escalation with its history, and 404s a complaint that was never escalated", async () => {
    const id = await escalated();
    const plain = await raised({ type: "late_delivery" });
    expect(((await EscalationService.get(scopeOf(admin), id)) as any).escalationReason).toBe("Store cannot settle");
    await refused(EscalationService.get(scopeOf(admin), plain), 404);
    await refused(EscalationService.get(scopeOf(admin), "nope"), 404);
    await refused(EscalationService.get(scopeOf(admin, world.storeB.id), id), 404);
  });

  it("decides a refund: resolved, the amount recorded, the customer told", async () => {
    const id = await escalated();
    const view = (await EscalationService.decide(admin, scopeOf(admin), id, { decision: "refund", amount: 120, note: "Full refund" })) as any;
    expect(view).toMatchObject({ status: "resolved", decision: "refund", refundAmount: 120, resolution: "Full refund" });
    expect(state.complaints.get(id).activeKey).toBeNull();
    const mine = (await ComplaintService.getMine(ana.user, id)) as any;
    expect(mine).toMatchObject({ decision: "refund", refundAmount: 120, status: "resolved" });
  });

  it("takes an optional amount for goodwill and none for reject or a policy exception", async () => {
    const id = await escalated();
    await EscalationService.decide(admin, scopeOf(admin), id, { decision: "goodwill", amount: 25, note: "Voucher" });
    expect(state.complaints.get(id)).toMatchObject({ decision: "goodwill", refundAmountPaise: 2500, goodwill: "Voucher" });
    const other = await escalated({ type: "quality" });
    await refused(EscalationService.decide(admin, scopeOf(admin), other, { decision: "reject", amount: 10, note: "no" }), 400, /amount/);
    await refused(EscalationService.decide(admin, scopeOf(admin), other, { decision: "policy_exception", amount: 10, note: "no" }), 400);
    const view = (await EscalationService.decide(admin, scopeOf(admin), other, { decision: "policy_exception", note: "Exception granted" })) as any;
    expect(view).toMatchObject({ decision: "policy_exception", refundAmount: null });
  });

  it.each([
    ["no decision", { note: "x" }],
    ["an unknown decision", { decision: "ignore", note: "x" }],
    ["no note", { decision: "reject" }],
    ["a refund without an amount", { decision: "refund", note: "x" }],
    ["a refund above the order amount", { decision: "refund", amount: 5000, note: "x" }],
    ["a negative amount", { decision: "refund", amount: -5, note: "x" }],
  ])("refuses %s", async (_name, body) => {
    const id = await escalated();
    await refused(EscalationService.decide(admin, scopeOf(admin), id, body), 400);
    expect(state.complaints.get(id).status).toBe("escalated");
  });

  it("refuses a decision on a complaint that is not waiting for one, and decides once under a race", async () => {
    const plain = await raised({ type: "late_delivery" });
    await ComplaintService.escalate(staffA, scopeOf(staffA), plain, { reason: "r" });
    state.complaints.get(plain).status = "open";
    await refused(EscalationService.decide(admin, scopeOf(admin), plain, { decision: "reject", note: "x" }), 409);
    const id = await escalated();
    const results = await Promise.allSettled([
      EscalationService.decide(admin, scopeOf(admin), id, { decision: "reject", note: "a" }),
      EscalationService.decide(admin, scopeOf(admin), id, { decision: "refund", amount: 10, note: "b" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("closing resolved complaints", () => {
  it("closes only those resolved longer ago than the cutoff, and a second run closes nothing more", async () => {
    const old = await raised();
    await ComplaintService.resolve(managerA, scopeOf(managerA), old, { resolution: "x" });
    advance(8 * 86_400_000);
    const recent = await raised({ type: "quality" });
    await ComplaintService.resolve(managerA, scopeOf(managerA), recent, { resolution: "x" });
    const open = await raised({ type: "late_delivery" });
    expect(await ComplaintService.closeResolved({})).toEqual({ closed: 1 });
    expect(state.complaints.get(old)).toMatchObject({ status: "closed" });
    expect(state.complaints.get(recent).status).toBe("resolved");
    expect(state.complaints.get(open).status).toBe("open");
    expect(await ComplaintService.closeResolved({})).toEqual({ closed: 0 });
    expect(((await ComplaintService.getMine(ana.user, old)) as any).timeline.at(-1).event).toBe("Closed");
  });

  it("honours olderThanDays and limit, and validates them", async () => {
    for (const type of ["damaged_item", "quality", "late_delivery"]) {
      const id = await raised({ type });
      await ComplaintService.resolve(managerA, scopeOf(managerA), id, { resolution: "x" });
    }
    advance(2 * 86_400_000);
    expect(await ComplaintService.closeResolved({ olderThanDays: 1, limit: 2 })).toEqual({ closed: 2 });
    await refused(ComplaintService.closeResolved({ olderThanDays: 0 }), 400);
    await refused(ComplaintService.closeResolved({ limit: 501 }), 400);
    await refused(ComplaintService.closeResolved({ limit: "5" }), 400);
  });

  it("a closed complaint accepts nothing more from the customer", async () => {
    const id = await raised();
    await ComplaintService.resolve(managerA, scopeOf(managerA), id, { resolution: "x" });
    advance(8 * 86_400_000);
    await ComplaintService.closeResolved({});
    await refused(ComplaintService.commentMine(ana.user, id, { message: "hello" }), 409);
  });
});
