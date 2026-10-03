import { CustomException } from "../../commons/Exception/CustomException.js";
import type { RequestUser, UserRole } from "../Middleware/Identity.js";

jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/ItDevice.Query.js", () => ({ ItDeviceQuery: require("../Testing/InMemoryOpsAssets.js").itDeviceQuery }));
jest.mock("../Queries/ItLicence.Query.js", () => ({ ItLicenceQuery: require("../Testing/InMemoryOpsAssets.js").itLicenceQuery }));
jest.mock("../Queries/ItRequest.Query.js", () => ({ ItRequestQuery: require("../Testing/InMemoryOpsAssets.js").itRequestQuery }));
jest.mock("../../commons/Http/ServiceClient.js", () => ({ ServiceClient: { post: jest.fn() } }));

import { ServiceClient } from "../../commons/Http/ServiceClient.js";
import { db, reset } from "../Testing/InMemoryOpsAssets.js";
import { addDays, businessToday, formatDate } from "../Utils/AssetDates.js";
import { ItDeviceService } from "./ItDevice.Service.js";
import { ItLicenceService } from "./ItLicence.Service.js";
import { ItRequestService } from "./ItRequest.Service.js";

const gateway = ServiceClient as unknown as { post: jest.Mock };
const day = (n: number) => formatDate(addDays(businessToday(), n));
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const person = (role: UserRole, n: number): RequestUser => ({ id: uuid(n), role, storeId: null, scopeStoreId: null, name: null });
const admin = person("admin", 1);
const hr = person("hr", 2);
const staffAna = person("staff", 3);
const staffBo = person("staff", 4);
const driver = person("driver", 5);
const EMP1 = uuid(101);
const EMP2 = uuid(102);

const refused = async (promise: Promise<unknown>, status: number, message?: RegExp) => {
  try {
    await promise;
  } catch (error) {
    expect([(error as CustomException).errorCode, (error as CustomException).displayMessage]).toEqual([status, expect.any(String)]);
    if (message) expect((error as CustomException).displayMessage).toMatch(message);
    return;
  }
  throw new Error("expected the call to be rejected");
};

let n = 0;
const device = (body: Record<string, unknown> = {}) => ItDeviceService.create(admin, { assetTag: `LT-${++n}`, type: "laptop", ...body }) as Promise<any>;
const licence = (body: Record<string, unknown> = {}) => ItLicenceService.create({ software: "Office", seats: 2, ...body }) as Promise<any>;
const raise = (user: RequestUser, body: Record<string, unknown> = {}) =>
  ItRequestService.raise(user, { category: "device_problem", description: "Screen flickers", ...body }) as Promise<any>;

beforeEach(() => {
  reset();
  n = 0;
  gateway.post.mockReset().mockImplementation(async (_service: string, _path: string, options: any) => ({
    users: options.body.ids.filter((x: string) => x === uuid(900)).map((x: string) => ({ id: x, name: "Ivan IT", isActive: true })),
  }));
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("devices", () => {
  it("registers in stock with a unique upper-cased tag, and refuses a duplicate or an invalid start", async () => {
    const d = await device({ assetTag: "lt-0001", condition: "new", warrantyUntil: day(300) });
    expect(d).toMatchObject({ assetTag: "LT-0001", status: "in_stock", condition: "new", assignedToEmployeeId: null });
    await refused(device({ assetTag: "LT-0001" }), 409, /asset tag/);
    await refused(device({ status: "assigned" }), 400, /assign/);
    await refused(device({ status: "retired" }), 400);
    await refused(device({ type: "toaster" }), 400);
    await refused(device({ assetTag: "" }), 400);
    await refused(device({ purchasedOn: day(2) }), 400, /future/);
  });

  it("assigns, returns and keeps a history row for each; a device cannot be assigned twice", async () => {
    const d = await device();
    const assigned = await ItDeviceService.assign(d.id, hr, { employeeId: EMP1, note: "New joiner" });
    expect(assigned).toMatchObject({ status: "assigned", assignedToEmployeeId: EMP1 });
    await refused(ItDeviceService.assign(d.id, hr, { employeeId: EMP2 }), 409, /already assigned/);
    await refused(ItDeviceService.update(d.id, hr, { status: "in_repair" }), 409, /return/);
    await refused(ItDeviceService.update(d.id, hr, { status: "assigned" }), 400);
    const back = await ItDeviceService.returnDevice(d.id, hr, { condition: "fair", note: "Scratched" });
    expect(back).toMatchObject({ status: "in_stock", assignedToEmployeeId: null, condition: "fair" });
    await refused(ItDeviceService.returnDevice(d.id, hr, {}), 409, /not assigned/);
    const detail = (await ItDeviceService.getById(d.id)) as any;
    expect(detail.history.map((h: any) => h.kind)).toEqual(["returned", "assigned", "registered"]);
    expect(detail.history[1]).toMatchObject({ employeeId: EMP1, note: "New joiner" });
  });

  it("only one of several simultaneous assignments wins", async () => {
    const d = await device();
    const results = await Promise.allSettled([EMP1, EMP2, uuid(103), uuid(104)].map((e) => ItDeviceService.assign(d.id, hr, { employeeId: e })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(db.deviceEvents.filter((e) => e.kind === "assigned")).toHaveLength(1);
  });

  it("validates assignment input and refuses devices that are not in stock", async () => {
    const d = await device();
    await refused(ItDeviceService.assign(d.id, hr, {}), 400, /employeeId/);
    await refused(ItDeviceService.assign(d.id, hr, { employeeId: "x" }), 400);
    await refused(ItDeviceService.assign("nope", hr, { employeeId: EMP1 }), 404);
    await ItDeviceService.update(d.id, hr, { status: "in_repair" });
    await refused(ItDeviceService.assign(d.id, hr, { employeeId: EMP1 }), 409, /in repair/);
  });

  it("follows the PATCH transitions, makes retired final, and whitelists fields", async () => {
    const d = await device();
    await ItDeviceService.update(d.id, hr, { status: "in_repair" });
    await ItDeviceService.update(d.id, hr, { status: "in_stock", model: "T14" });
    await refused(ItDeviceService.update(d.id, hr, { assignedToEmployeeId: EMP1, id: "x" }), 400, /Nothing to update/);
    await ItDeviceService.update(d.id, hr, { status: "retired" });
    await refused(ItDeviceService.update(d.id, hr, { model: "x" }), 409, /retired/);
    await refused(ItDeviceService.createRepair(d.id, hr, { issue: "x" }), 409);
    const other = await device();
    await refused(ItDeviceService.update(other.id, hr, { assetTag: "LT-1" }), 409, /asset tag/);
  });

  it("filters and pages the list, and records repairs in paise", async () => {
    const a = await device();
    await device({ type: "phone" });
    await ItDeviceService.assign(a.id, hr, { employeeId: EMP1 });
    expect(((await ItDeviceService.list({ status: "assigned" })) as any).items.map((i: any) => i.id)).toEqual([a.id]);
    expect(((await ItDeviceService.list({ assignedTo: EMP1 })) as any).total).toBe(1);
    expect(((await ItDeviceService.list({ type: "phone", limit: "1000" })) as any)).toMatchObject({ total: 1, limit: 100 });
    await refused(ItDeviceService.list({ status: "lost" }), 400);
    await refused(ItDeviceService.list({ assignedTo: "x" }), 400);
    await ItDeviceService.createRepair(a.id, hr, { issue: "Cracked screen", cost: 4500.5 });
    expect(db.deviceRepairs[0]).toMatchObject({ costPaise: 450050 });
    expect(((await ItDeviceService.listRepairs(a.id, {})) as any).items[0]).toMatchObject({ issue: "Cracked screen", cost: 4500.5, repairedOn: day(0) });
    await refused(ItDeviceService.listRepairs("nope", {}), 404);
  });
});

describe("licence seats", () => {
  it("never gives out more seats than the total, and says so with 409", async () => {
    const l = await licence({ seats: 2 });
    await ItLicenceService.assign(l.id, hr, { employeeId: EMP1 });
    const full = (await ItLicenceService.assign(l.id, hr, { employeeId: EMP2 })) as any;
    expect(full).toMatchObject({ seatsUsed: 2, seatsAvailable: 0 });
    await refused(ItLicenceService.assign(l.id, hr, { employeeId: uuid(103) }), 409, /No seats left/);
  });

  it("is race-safe: ten simultaneous requests for three seats give exactly three", async () => {
    const l = await licence({ seats: 3 });
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => ItLicenceService.assign(l.id, hr, { employeeId: uuid(200 + i) })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(db.seats).toHaveLength(3);
    expect(db.licences.get(l.id).seatsUsed).toBe(3);
  });

  it("refuses the same person twice, an expired licence, and revoking a seat nobody holds", async () => {
    const l = await licence();
    await ItLicenceService.assign(l.id, hr, { employeeId: EMP1 });
    await refused(ItLicenceService.assign(l.id, hr, { employeeId: EMP1 }), 409, /already has a seat/);
    await refused(ItLicenceService.revoke(l.id, hr, { employeeId: EMP2 }), 404, /does not hold/);
    const old = await licence({ validUntil: day(-1) });
    await refused(ItLicenceService.assign(old.id, hr, { employeeId: EMP1 }), 409, /expired/);
    await refused(ItLicenceService.assign(l.id, hr, { employeeId: "x" }), 400);
    await refused(ItLicenceService.assign("nope", hr, { employeeId: EMP1 }), 404);
  });

  it("revoking frees the seat and the history keeps both the grant and the revocation", async () => {
    const l = await licence({ seats: 1 });
    await ItLicenceService.assign(l.id, hr, { employeeId: EMP1 });
    expect(await ItLicenceService.revoke(l.id, admin, { employeeId: EMP1 })).toMatchObject({ seatsUsed: 0 });
    await ItLicenceService.assign(l.id, hr, { employeeId: EMP2 });
    const detail = (await ItLicenceService.getById(l.id)) as any;
    expect(detail.holders.map((h: any) => h.employeeId)).toEqual([EMP2]);
    expect(detail.history.map((h: any) => `${h.kind}:${h.employeeId}`)).toEqual([`assigned:${EMP2}`, `revoked:${EMP1}`, `assigned:${EMP1}`]);
  });

  it("cannot lower the total below the seats in use, and cannot delete a licence in use; delete hides it", async () => {
    const l = await licence({ seats: 3, cost: 999.99 });
    expect(db.licences.get(l.id).costPaise).toBe(99999);
    await ItLicenceService.assign(l.id, hr, { employeeId: EMP1 });
    await ItLicenceService.assign(l.id, hr, { employeeId: EMP2 });
    await refused(ItLicenceService.update(l.id, { seats: 1 }), 409, /in use/);
    expect(await ItLicenceService.update(l.id, { seats: 2, vendor: null })).toMatchObject({ seats: 2, vendor: null });
    await refused(ItLicenceService.remove(l.id), 409, /still in use/);
    await ItLicenceService.revoke(l.id, hr, { employeeId: EMP1 });
    await ItLicenceService.revoke(l.id, hr, { employeeId: EMP2 });
    await ItLicenceService.remove(l.id);
    await refused(ItLicenceService.getById(l.id), 404);
    await refused(ItLicenceService.assign(l.id, hr, { employeeId: EMP1 }), 404);
    expect(((await ItLicenceService.list({})) as any).total).toBe(0);
  });

  it("validates licences and pages the list alphabetically", async () => {
    await refused(licence({ seats: 0 }), 400);
    await refused(licence({ seats: 1.5 }), 400);
    await refused(licence({ software: "" }), 400);
    await refused(licence({ cost: 1.234 }), 400);
    await refused(ItLicenceService.update((await licence()).id, {}), 400, /Nothing/);
    await licence({ software: "Zoom" });
    await licence({ software: "Adobe" });
    expect(((await ItLicenceService.list({ limit: "2" })) as any).items.map((i: any) => i.software)).toEqual(["Adobe", "Office"]);
  });
});

describe("IT requests", () => {
  it("staff see and read only their own; another person's request is 404, not 403", async () => {
    const ana = await raise(staffAna);
    const bo = await raise(staffBo, { category: "access_request", priority: "high" });
    expect(((await ItRequestService.list(staffAna, {})) as any).items.map((r: any) => r.id)).toEqual([ana.id]);
    expect(((await ItRequestService.list(driver, {})) as any).total).toBe(0);
    expect(((await ItRequestService.list(hr, {})) as any).total).toBe(2);
    expect(((await ItRequestService.list(hr, { mine: "true" })) as any).total).toBe(0);
    await refused(ItRequestService.getById(bo.id, staffAna), 404);
    await refused(ItRequestService.comment(bo.id, staffAna, { message: "hi" }), 404);
    expect(((await ItRequestService.getById(bo.id, hr)) as any).raisedBy).toBe("Employee");
    expect(((await ItRequestService.list(hr, { category: "access_request" })) as any).total).toBe(1);
    await refused(ItRequestService.list(hr, { mine: "maybe" }), 400);
    await refused(ItRequestService.list(hr, { category: "x" }), 400);
  });

  it("validates a new request, including the device it names", async () => {
    await refused(raise(staffAna, { category: "magic" }), 400);
    await refused(raise(staffAna, { description: "" }), 400);
    await refused(raise(staffAna, { priority: "now" }), 400);
    await refused(raise(staffAna, { deviceId: uuid(999) }), 400, /device/);
    const d = await device();
    expect(await raise(staffAna, { deviceId: d.id })).toMatchObject({ deviceId: d.id, status: "open", priority: "normal" });
    await refused(raise({ ...staffAna, id: "not-a-uuid" }), 400);
  });

  it("assigning checks the gateway and starts the work; status moves follow the machine", async () => {
    const r = await raise(staffAna);
    await refused(ItRequestService.update(r.id, hr, { assigneeId: uuid(901) }), 400, /does not match a user/);
    const started = (await ItRequestService.update(r.id, hr, { assigneeId: uuid(900) })) as any;
    expect(started).toMatchObject({ status: "in_progress", assignee: "Ivan IT" });
    expect(gateway.post).toHaveBeenCalledWith("gateway", "/internal/users/lookup", expect.objectContaining({ body: { ids: [uuid(900)] } }));
    expect(await ItRequestService.update(r.id, hr, { status: "resolved", priority: "urgent" })).toMatchObject({ status: "resolved", priority: "urgent" });
    await refused(ItRequestService.update(r.id, hr, { status: "open" }), 409, /cannot move/);
    await refused(ItRequestService.update(r.id, hr, { status: "closed" }), 400, /close action/);
    await refused(ItRequestService.update(r.id, hr, {}), 400, /Nothing/);
    await refused(ItRequestService.update(r.id, hr, { status: "bogus" }), 400);
    const detail = (await ItRequestService.getById(r.id, hr)) as any;
    expect(detail.history.map((h: any) => h.kind)).toEqual(["raised", "status_changed", "assigned", "status_changed", "priority_changed"]);
  });

  it("refuses an inactive assignee and surfaces a gateway outage without writing anything", async () => {
    const r = await raise(staffAna);
    gateway.post.mockResolvedValueOnce({ users: [{ id: uuid(900), name: "Gone", isActive: false }] });
    await refused(ItRequestService.update(r.id, hr, { assigneeId: uuid(900) }), 400, /deactivated/);
    gateway.post.mockRejectedValueOnce(new CustomException("A connected service is unavailable right now. Please try again.", 503));
    await refused(ItRequestService.update(r.id, hr, { assigneeId: uuid(900) }), 503);
    expect(db.requests.get(r.id)).toMatchObject({ status: "open", assigneeUserId: null });
  });

  it("closing needs a resolution, is final, and locks the thread; comments belong to the owner and the desk", async () => {
    const r = await raise(staffAna);
    await ItRequestService.comment(r.id, staffAna, { message: "Still flickering" });
    await ItRequestService.comment(r.id, hr, { message: "Try a cable swap" });
    await refused(ItRequestService.comment(r.id, hr, { message: "" }), 400);
    await refused(ItRequestService.close(r.id, hr, {}), 400, /resolution/);
    expect(await ItRequestService.close(r.id, hr, { resolution: "Cable replaced" })).toMatchObject({ status: "closed", resolution: "Cable replaced" });
    await refused(ItRequestService.close(r.id, hr, { resolution: "again" }), 409);
    await refused(ItRequestService.update(r.id, hr, { priority: "low" }), 409, /closed/);
    await refused(ItRequestService.comment(r.id, staffAna, { message: "thanks" }), 409);
    const detail = (await ItRequestService.getById(r.id, staffAna)) as any;
    expect(detail.comments.map((c: any) => `${c.author}: ${c.message}`)).toEqual(["Employee: Still flickering", "HR: Try a cable swap"]);
    expect(detail.history.map((h: any) => h.kind)).toEqual(["raised", "closed"]);
  });

  it("two simultaneous closes close it once", async () => {
    const r = await raise(staffAna);
    const results = await Promise.allSettled([1, 2, 3].map(() => ItRequestService.close(r.id, hr, { resolution: "Done" })));
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(db.requestEvents.filter((e) => e.kind === "closed")).toHaveLength(1);
  });
});
