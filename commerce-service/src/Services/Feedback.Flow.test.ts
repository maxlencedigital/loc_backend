import type { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { CustomException } from "../../commons/Exception/CustomException.js";

// Queries are in-memory fakes; logistics and the gateway are faked services. Feedback and
// ticket rules, store scoping and the account package's customer link are the real code.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../../commons/Http/ServiceClient.js", () => require("../Testing/InMemorySupport.js").serviceClientMock);
jest.mock("../Queries/Store.Query.js", () => ({ StoreQuery: require("../Testing/InMemoryCommerce.js").storeQuery }));
jest.mock("../Queries/Customer.Query.js", () => ({ CustomerQuery: require("../Testing/InMemoryCommerce.js").customerQuery }));
jest.mock("../Queries/Catalog.Query.js", () => ({ CatalogQuery: require("../Testing/InMemoryCommerce.js").catalogQuery }));
jest.mock("../Queries/Order.Query.js", () => ({ OrderQuery: require("../Testing/InMemoryCommerce.js").orderQuery }));
jest.mock("../Queries/CustomerProfile.Query.js", () => ({ CustomerProfileQuery: require("../Testing/InMemoryCustomerAccount.js").profileQuery }));
jest.mock("../Queries/OrderInternal.Query.js", () => ({ OrderInternalQuery: require("../Testing/InMemoryCustomerAccount.js").internalOrderQuery }));
jest.mock("../Queries/CustomerOrder.Query.js", () => ({ CustomerOrderQuery: require("../Testing/InMemoryCustomerAccount.js").customerOrderQuery }));
jest.mock("../Queries/Feedback.Query.js", () => ({ FeedbackQuery: require("../Testing/InMemorySupport.js").feedbackQuery }));
jest.mock("../Queries/Ticket.Query.js", () => ({ TicketQuery: require("../Testing/InMemorySupport.js").ticketQuery }));
jest.mock("../Queries/SupportOrder.Query.js", () => ({ SupportOrderQuery: require("../Testing/InMemorySupport.js").supportOrderQuery }));

import { fake, state } from "../Testing/InMemorySupport.js";
import { IShopper, addOrder, buildSupportWorld, refused, shopper, staffMember } from "../Testing/SupportWorld.js";
import { FeedbackService, MAX_SUMMARY_DAYS } from "./Feedback.Service.js";
import { MAX_TICKET_MESSAGES, TicketService } from "./Ticket.Service.js";

const NOW = new Date("2026-10-05T04:00:00Z");
const RIDER = "22222222-2222-4222-8222-222222222222";
const RIDER_2 = "33333333-3333-4333-8333-333333333333";
let world: any;
let ana: IShopper;
let bob: IShopper;
let order: any;
let errorSpy: jest.SpyInstance;
let managerA: RequestUser;
let managerB: RequestUser;
let hr: RequestUser;
let admin: RequestUser;

const scopeOf = (user: RequestUser, scopeStoreId: string | null = null) =>
  resolveStoreScope({ user: { ...user, scopeStoreId } } as IdentifiedRequest);
const day = (n: number) => jest.setSystemTime(new Date(NOW.getTime() + n * 86_400_000));

const rate = (who = ana, orderId = order.id, body: Record<string, unknown> = { rating: 5 }) =>
  FeedbackService.submit(who.user, orderId, body) as Promise<any>;

beforeEach(async () => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["setImmediate", "nextTick", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  world = buildSupportWorld();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  ana = await shopper();
  bob = await shopper();
  order = addOrder(ana.customerId, world.storeA.id);
  managerA = staffMember("manager", world.storeA.id);
  managerB = staffMember("manager", world.storeB.id);
  hr = staffMember("hr", null);
  admin = staffMember("admin", null);
});
afterEach(() => {
  jest.useRealTimers();
  errorSpy.mockRestore();
});

describe("a customer rates a delivered order", () => {
  it("saves the rating with the order's store and returns it", async () => {
    const saved = await rate(ana, order.id, { rating: 4, comment: "Quick and clean", storeRating: 5 });
    expect(saved).toMatchObject({ orderId: order.id, rating: 4, comment: "Quick and clean", storeRating: 5, riderRating: null });
    expect([...state.feedback.values()][0]).toMatchObject({
      storeId: world.storeA.id, customerId: ana.customerId, customerUserId: ana.user.id, riderId: null,
      ratedOn: new Date("2026-10-05T00:00:00Z"),
    });
    expect(await FeedbackService.getMine(ana.user, order.id)).toEqual(saved);
  });

  it.each([
    ["no rating", {}],
    ["zero", { rating: 0 }],
    ["six", { rating: 6 }],
    ["a fraction", { rating: 3.5 }],
    ["a string", { rating: "5" }],
    ["a store rating out of range", { rating: 5, storeRating: 7 }],
    ["a rider rating out of range", { rating: 5, riderRating: 0 }],
    ["a comment over 1000 characters", { rating: 5, comment: "x".repeat(1001) }],
  ])("refuses %s", async (_name, body) => {
    await refused(rate(ana, order.id, body), 400);
    expect(state.feedback.size).toBe(0);
  });

  it("refuses an order that is not delivered yet", async () => {
    const pending = addOrder(ana.customerId, world.storeA.id, { status: "washing" });
    await refused(rate(ana, pending.id), 409, /delivered/);
    const cancelled = addOrder(ana.customerId, world.storeA.id, { status: "cancelled" });
    await refused(rate(ana, cancelled.id), 409);
  });

  it("answers 404 for someone else's order, an unknown one and a malformed id", async () => {
    await refused(rate(bob, order.id), 404, /Order not found/);
    await refused(rate(ana, "11111111-1111-4111-8111-111111111111"), 404);
    await refused(rate(ana, "nope"), 404);
    expect(state.feedback.size).toBe(0);
  });

  it("allows one rating per order: the second is a 409", async () => {
    await rate();
    await refused(rate(ana, order.id, { rating: 1 }), 409, /already left/);
    expect(state.feedback.size).toBe(1);
  });

  it("lets exactly one of five simultaneous submissions in", async () => {
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map(() => rate()));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x) => x.status === "rejected")) {
      expect(((r as PromiseRejectedResult).reason as CustomException).errorCode).toBe(409);
    }
    expect(state.feedback.size).toBe(1);
  });

  it("is refused for anyone who is not a customer", async () => {
    await refused(FeedbackService.submit({ ...ana.user, role: "staff" }, order.id, { rating: 5 }), 403);
  });

  it("asks logistics who delivered only when a rider rating is given, and stores the delivery rider", async () => {
    fake.logistics.jobs.set(order.id, [
      { type: "pickup", riderId: RIDER_2 },
      { type: "delivery", riderId: RIDER },
    ]);
    await rate(ana, order.id, { rating: 5 });
    expect(fake.logistics.calls).toBe(0);
    const second = addOrder(ana.customerId, world.storeA.id);
    fake.logistics.jobs.set(second.id, [{ type: "pickup", riderId: RIDER_2 }, { type: "delivery", riderId: RIDER }]);
    await rate(ana, second.id, { rating: 5, riderRating: 4 });
    expect(fake.logistics.calls).toBe(1);
    expect([...state.feedback.values()].find((f) => f.orderId === second.id)).toMatchObject({ riderId: RIDER, riderRating: 4 });
  });

  it("still saves the rating when logistics is down, with the rider unknown", async () => {
    fake.logistics.failWith = new Error("connect ECONNREFUSED");
    const saved = await rate(ana, order.id, { rating: 3, riderRating: 2 });
    expect(saved.riderRating).toBe(2);
    expect([...state.feedback.values()][0].riderId).toBeNull();
  });

  it("answers 404 when no feedback was left, and never shows another customer's", async () => {
    await refused(FeedbackService.getMine(ana.user, order.id), 404);
    await rate();
    await refused(FeedbackService.getMine(bob.user, order.id), 404);
    await refused(FeedbackService.getMine(ana.user, "nope"), 404);
  });
});

describe("the feedback list for management", () => {
  const seedRatings = async () => {
    const orderB = addOrder(bob.customerId, world.storeB.id);
    const second = addOrder(ana.customerId, world.storeA.id);
    fake.logistics.jobs.set(second.id, [{ type: "delivery", riderId: RIDER }]);
    await rate(ana, order.id, { rating: 2, comment: "Late" });
    day(1);
    await rate(ana, second.id, { rating: 5, riderRating: 5 });
    day(2);
    await rate(bob, orderB.id, { rating: 4 });
    return { second, orderB };
  };

  it("shows a manager only their store, newest first, and 404s another store", async () => {
    await seedRatings();
    const a = (await FeedbackService.list(scopeOf(managerA), {})) as any;
    expect(a.total).toBe(2);
    expect(a.items.map((f: any) => f.rating)).toEqual([5, 2]);
    expect(a.items[1]).toMatchObject({ comment: "Late", storeId: world.storeA.id, riderId: null });
    expect(((await FeedbackService.list(scopeOf(managerB), {})) as any).total).toBe(1);
    await refused(FeedbackService.list(scopeOf(managerA), { storeId: world.storeB.id }), 404);
  });

  it("shows hr and admins every store, and filters by store, rider, rating and date", async () => {
    await seedRatings();
    const q = (query: Record<string, unknown>, who = hr) => FeedbackService.list(scopeOf(who), query).then((r: any) => r.items.map((f: any) => f.rating));
    expect(await q({})).toEqual([4, 5, 2]);
    expect(await q({}, admin)).toEqual([4, 5, 2]);
    expect(await q({ storeId: world.storeB.id })).toEqual([4]);
    expect(await q({ riderId: RIDER })).toEqual([5]);
    expect(await q({ rating: "2" })).toEqual([2]);
    expect(await q({ from: "2026-10-06", to: "2026-10-06" })).toEqual([5]);
    expect(await q({ limit: "1", page: "2" })).toEqual([5]);
  });

  it("refuses bad filters and caps the page size", async () => {
    await refused(FeedbackService.list(scopeOf(hr), { rating: "9" }), 400);
    await refused(FeedbackService.list(scopeOf(hr), { rating: "x" }), 400);
    await refused(FeedbackService.list(scopeOf(hr), { riderId: "nope" }), 400);
    await refused(FeedbackService.list(scopeOf(hr), { storeId: ["a", "b"] }), 400);
    expect(((await FeedbackService.list(scopeOf(hr), { limit: "1000" })) as any).limit).toBe(100);
  });

  it("does not show who the customer is", async () => {
    await rate();
    expect(JSON.stringify(await FeedbackService.list(scopeOf(hr), {}))).not.toContain(ana.user.id);
  });
});

describe("the feedback summary", () => {
  const seedMany = async () => {
    const rows: Array<[IShopper, string, number, Record<string, unknown>, number]> = [];
    const place = async (who: IShopper, storeId: string, rating: number, extra: Record<string, unknown>, dayOffset: number) => {
      const o = addOrder(who.customerId, storeId);
      fake.logistics.jobs.set(o.id, [{ type: "delivery", riderId: RIDER }]);
      day(dayOffset);
      await rate(who, o.id, { rating, ...extra });
      rows.push([who, storeId, rating, extra, dayOffset]);
    };
    await place(ana, world.storeA.id, 5, { riderRating: 5 }, 0);
    await place(ana, world.storeA.id, 4, { riderRating: 3 }, 0);
    await place(ana, world.storeA.id, 1, {}, 1);
    await place(bob, world.storeB.id, 3, {}, 2);
  };

  it("gives the average, count, distribution, per store, per rider and per day", async () => {
    await seedMany();
    const s = (await FeedbackService.summary(scopeOf(hr), {})) as any;
    expect(s.average).toBe(3.25);
    expect(s.count).toBe(4);
    expect(s.distribution).toEqual({ 1: 1, 2: 0, 3: 1, 4: 1, 5: 1 });
    expect(s.byStore).toEqual(expect.arrayContaining([
      { storeId: world.storeA.id, average: 3.33, count: 3 },
      { storeId: world.storeB.id, average: 3, count: 1 },
    ]));
    expect(s.byRider).toEqual([{ riderId: RIDER, average: 4, count: 2 }]);
    expect(s.trend).toEqual([
      { date: "2026-10-05", average: 4.5, count: 2 },
      { date: "2026-10-06", average: 1, count: 1 },
      { date: "2026-10-07", average: 3, count: 1 },
    ]);
  });

  it("scopes a manager to their own store and 404s another", async () => {
    await seedMany();
    const s = (await FeedbackService.summary(scopeOf(managerB), {})) as any;
    expect(s).toMatchObject({ average: 3, count: 1 });
    expect(s.byStore).toHaveLength(1);
    await refused(FeedbackService.summary(scopeOf(managerB), { storeId: world.storeA.id }), 404);
  });

  it("narrows by store, rider and date", async () => {
    await seedMany();
    expect(((await FeedbackService.summary(scopeOf(admin), { storeId: world.storeA.id })) as any).count).toBe(3);
    expect(((await FeedbackService.summary(scopeOf(admin), { riderId: RIDER })) as any).count).toBe(2);
    expect(((await FeedbackService.summary(scopeOf(admin), { from: "2026-10-06" })) as any).count).toBe(2);
  });

  it("answers with an empty summary when there is nothing", async () => {
    expect(await FeedbackService.summary(scopeOf(hr), {})).toEqual({
      average: null, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, byStore: [], byRider: [], trend: [],
    });
  });

  it("refuses a range wider than a year and bad dates", async () => {
    await refused(FeedbackService.summary(scopeOf(hr), { from: "2024-01-01", to: "2026-01-01" }), 400, new RegExp(String(MAX_SUMMARY_DAYS)));
    await refused(FeedbackService.summary(scopeOf(hr), { from: "later" }), 400);
    await FeedbackService.summary(scopeOf(hr), { from: "2025-10-05", to: "2026-10-05" });
  });
});

describe("support tickets", () => {
  const open = (who = ana, body: Record<string, unknown> = {}, key?: string) =>
    TicketService.open(who.user, { subject: "Where is my order?", message: "It was due yesterday", ...body }, key);

  it("opens a ticket with its first message, optionally about one of the customer's orders", async () => {
    const outcome = await open(ana, { orderId: order.id });
    expect(outcome.created).toBe(true);
    expect(outcome.data).toMatchObject({ subject: "Where is my order?", status: "open", orderId: order.id });
    expect(outcome.data.messages).toEqual([{ from: "customer", message: "It was due yesterday", at: expect.any(String) }]);
    expect([...state.tickets.values()][0]).toMatchObject({ storeId: world.storeA.id, customerUserId: ana.user.id, messageCount: 1 });
  });

  it.each([
    ["no subject", { subject: "" }],
    ["a subject over 120 characters", { subject: "s".repeat(121) }],
    ["no message", { message: "" }],
    ["a message over 2000 characters", { message: "m".repeat(2001) }],
    ["a malformed order id", { orderId: "nope" }],
  ])("refuses %s", async (_name, body) => {
    await refused(open(ana, body), 400);
    expect(state.tickets.size).toBe(0);
  });

  it("answers 404 when the order belongs to someone else", async () => {
    await refused(open(bob, { orderId: order.id }), 404);
    expect(state.tickets.size).toBe(0);
  });

  it("returns the original ticket for a repeated Idempotency-Key, even when five requests race", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => open(ana, {}, "t-1")));
    expect(new Set(results.map((r) => r.data.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(state.tickets.size).toBe(1);
  });

  it("lists only the customer's own tickets, most recently active first, with a status filter and paging", async () => {
    const first = (await open(ana, { subject: "one" })).data.id;
    day(1);
    const second = (await open(ana, { subject: "two" })).data.id;
    await open(bob);
    const list = (await TicketService.listMine(ana.user, {})) as any;
    expect(list.items.map((t: any) => t.id)).toEqual([second, first]);
    await TicketService.close(first);
    expect(((await TicketService.listMine(ana.user, { status: "closed" })) as any).items.map((t: any) => t.id)).toEqual([first]);
    expect(((await TicketService.listMine(ana.user, { limit: "1", page: "2" })) as any).items.map((t: any) => t.id)).toEqual([second]);
    await refused(TicketService.listMine(ana.user, { status: "pending" }), 400);
    await refused(TicketService.listMine(ana.user, { page: "0" }), 400);
    expect(((await TicketService.listMine(ana.user, { limit: "300" })) as any).limit).toBe(100);
  });

  it("answers 404 for another customer's ticket and a malformed id", async () => {
    const id = (await open()).data.id;
    await refused(TicketService.getMine(bob.user, id), 404);
    await refused(TicketService.getMine(ana.user, "nope"), 404);
    await refused(TicketService.replyMine(bob.user, id, { message: "hi" }), 404);
  });

  it("lets the customer reply, and an answered ticket goes back to open", async () => {
    const id = (await open()).data.id;
    const answered = await TicketService.supportReply(id, { message: "We are on it", authorUserId: admin.id, authorName: "Priya" });
    expect(answered.status).toBe("answered");
    const view = (await TicketService.replyMine(ana.user, id, { message: "Thanks" })) as any;
    expect(view.status).toBe("open");
    expect(view.messages.map((m: any) => [m.from, m.message])).toEqual([
      ["customer", "It was due yesterday"], ["support", "We are on it"], ["customer", "Thanks"],
    ]);
  });

  it("stamps the first response once, and only support replies stamp it", async () => {
    const id = (await open()).data.id;
    await TicketService.replyMine(ana.user, id, { message: "Hello?" });
    expect(state.tickets.get(id).firstResponseAt).toBeNull();
    day(1);
    const first = await TicketService.supportReply(id, { message: "Hi", authorUserId: admin.id, authorName: "Priya" });
    day(2);
    const second = await TicketService.supportReply(id, { message: "Hi again", authorUserId: admin.id, authorName: "Priya" });
    expect(first.firstResponseAt).toBe(new Date(NOW.getTime() + 86_400_000).toISOString());
    expect(second.firstResponseAt).toBe(first.firstResponseAt);
  });

  it("refuses messages on a closed ticket from both sides, and closing twice changes nothing", async () => {
    const id = (await open()).data.id;
    await TicketService.close(id);
    const closedAt = state.tickets.get(id).closedAt;
    await TicketService.close(id);
    expect(state.tickets.get(id).closedAt).toBe(closedAt);
    await refused(TicketService.replyMine(ana.user, id, { message: "hello?" }), 409, /closed/);
    await refused(TicketService.supportReply(id, { message: "x", authorUserId: admin.id, authorName: "P" }), 409);
  });

  it("stops at the message limit", async () => {
    const id = (await open()).data.id;
    state.tickets.get(id).messageCount = MAX_TICKET_MESSAGES;
    await refused(TicketService.replyMine(ana.user, id, { message: "one more" }), 409, /limit/);
  });

  it("validates the support reply and treats a malformed id on the internal calls as a 400", async () => {
    const id = (await open()).data.id;
    await refused(TicketService.supportReply(id, { message: "", authorUserId: admin.id, authorName: "P" }), 400);
    await refused(TicketService.supportReply(id, { message: "x", authorUserId: "nope", authorName: "P" }), 400);
    await refused(TicketService.supportReply(id, { message: "x", authorUserId: admin.id }), 400);
    await refused(TicketService.supportReply("x", { message: "x", authorUserId: admin.id, authorName: "P" }), 400);
    await refused(TicketService.close("x"), 400);
    await refused(TicketService.close("11111111-1111-4111-8111-111111111111"), 404);
  });

  it("serialises simultaneous replies so none is lost", async () => {
    const id = (await open()).data.id;
    await Promise.all([1, 2, 3, 4, 5].map((n) => TicketService.replyMine(ana.user, id, { message: `m${n}` })));
    expect(state.tickets.get(id).messageCount).toBe(6);
    expect(state.messages.get(id)).toHaveLength(6);
  });

  it("is refused for anyone who is not a customer", async () => {
    await refused(TicketService.open({ ...ana.user, role: "manager" }, { subject: "s", message: "m" }, undefined), 403);
  });
});
