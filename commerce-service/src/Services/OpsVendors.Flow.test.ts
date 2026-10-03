import { CustomException } from "../../commons/Exception/CustomException.js";
import type { IdentifiedRequest, RequestUser, UserRole } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";

// The Query modules are replaced by one in-memory database; services, validation, the purchase
// order state machine, store scoping and the reports are the real code.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/Store.Query.js", () => ({ StoreQuery: require("../Testing/InMemoryOps.js").storeQuery }));
jest.mock("../Queries/OpsVendor.Query.js", () => ({ OpsVendorQuery: require("../Testing/InMemoryOps.js").vendorQuery }));
jest.mock("../Queries/OpsMaterial.Query.js", () => ({ OpsMaterialQuery: require("../Testing/InMemoryOps.js").materialQuery }));
jest.mock("../Queries/OpsPurchaseOrder.Query.js", () => ({ OpsPurchaseOrderQuery: require("../Testing/InMemoryOps.js").purchaseOrderQuery }));

import { reset, seed, state } from "../Testing/InMemoryOps.js";
import { OpsPurchaseOrderService as PO } from "./OpsPurchaseOrder.Service.js";
import { OpsVendorService as Vendors } from "./OpsVendor.Service.js";
import { addDays, todayIst } from "../Utils/OpsDates.js";

const actor = (role: UserRole, storeId: string | null = null): RequestUser => ({ id: `${role}-${storeId ?? "all"}`, role, storeId, scopeStoreId: null, name: null });
const scopeOf = (user: RequestUser, scopeStoreId: string | null = null) => resolveStoreScope({ user: { ...user, scopeStoreId } } as IdentifiedRequest);

let storeA: any;
let storeB: any;
let admin: RequestUser;
let hr: RequestUser;
let managerA: RequestUser;
let managerB: RequestUser;
let vendor: any;
let soap: any;
let softener: any;

const rejection = async (promise: Promise<unknown>): Promise<CustomException> => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected the call to be rejected");
};
const refused = async (promise: Promise<unknown>, status: number, message?: RegExp) => {
  const error = await rejection(promise);
  expect(error.errorCode).toBe(status);
  if (message) expect(error.displayMessage).toMatch(message);
};

let errorSpy: jest.SpyInstance;
beforeEach(async () => {
  reset();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  storeA = seed.store();
  storeB = seed.store();
  admin = actor("admin");
  hr = actor("hr");
  managerA = actor("manager", storeA.id);
  managerB = actor("manager", storeB.id);
  vendor = await seed.vendor();
  soap = await seed.material({ name: "Soap", unit: "kg", reorderLevelMilli: 10_000 });
  softener = await seed.material({ name: "Softener", unit: "litre" });
});
afterEach(() => errorSpy.mockRestore());

const line = (material: any, quantity: number, unitPrice?: number) => ({ materialId: material.id, quantity, ...(unitPrice === undefined ? {} : { unitPrice }) });
const raise = (items: unknown[], extra: Record<string, unknown> = {}, store = storeA, user = admin, key?: string) =>
  PO.create(scopeOf(user), user, { vendorId: vendor.id, storeId: store.id, items, ...extra }, key);
const sent = async (items = [line(soap, 10, 50), line(softener, 4, 12.5)], extra: Record<string, unknown> = {}, store = storeA) => {
  const order = await raise(items, extra, store);
  return PO.send(order.id, scopeOf(admin), admin);
};
const receive = (order: any, items: { materialId: string; receivedQty: number }[], user = admin, extra = {}) =>
  PO.receive(order.id, scopeOf(user), user, { items, ...extra });

describe("vendors", () => {
  it("validates, normalises and de-duplicates by GSTIN", async () => {
    const v = await Vendors.createVendor(admin, { name: "Blue Packaging", category: "packaging", gstin: "29abcde1234f1z5", phone: "+919876543210", email: "a@b.in" });
    expect(v.gstin).toBe("29ABCDE1234F1Z5");
    await refused(Vendors.createVendor(admin, { name: "Dup", gstin: "29ABCDE1234F1Z5" }), 409, /GSTIN/);
    await refused(Vendors.createVendor(admin, { name: "Bad", gstin: "nope" }), 400);
    await refused(Vendors.createVendor(admin, { name: "Bad", phone: "98765" }), 400);
    await refused(Vendors.createVendor(admin, { name: "Bad", email: "x" }), 400);
    await refused(Vendors.createVendor(admin, { category: "detergent" }), 400);
    await refused(Vendors.createVendor(admin, { name: "Bad", category: "toys" }), 400);
    await refused(Vendors.updateVendor(vendor.id, admin, { gstin: "29ABCDE1234F1Z5" }), 409);
  });

  it("keeps only the last four digits of a bank account and shows them to back office only", async () => {
    const created = await Vendors.createVendor(hr, { name: "Banked", bankAccountNumber: "123456789012", bankIfsc: "hdfc0001234" });
    expect(created.bankAccountMasked).toBe("XXXXXX9012");
    expect(JSON.stringify(created)).not.toContain("123456789012");
    expect([...state.vendors.values()].some((v) => JSON.stringify(v).includes("123456789012"))).toBe(false);
    const asManager = await Vendors.getVendor(created.id, managerA);
    expect(asManager).not.toHaveProperty("bankAccountMasked");
    expect(asManager).not.toHaveProperty("bankIfsc");
    await refused(Vendors.createVendor(hr, { name: "X", bankAccountNumber: "12ab" }), 400);
  });

  it("deactivates once, keeps history, and blocks new orders and agreements", async () => {
    const result = await Vendors.deactivateVendor(vendor.id, admin, { reason: "Poor quality" });
    expect(result.isActive).toBe(false);
    expect(result.deactivationReason).toBe("Poor quality");
    await refused(Vendors.deactivateVendor(vendor.id, admin, {}), 409);
    await refused(raise([line(soap, 1, 1)]), 409, /deactivated/);
    await refused(Vendors.createAgreement(vendor.id, admin, { title: "MSA", startDate: "2026-01-01" }), 409);
    expect((await Vendors.updateVendor(vendor.id, admin, { isActive: true })).isActive).toBe(true);
    expect((await Vendors.listVendors(admin, { isActive: "false" })).total).toBe(0);
  });

  it("records agreements with derived status and bounded https document references", async () => {
    await refused(Vendors.createAgreement(vendor.id, admin, { title: "MSA", startDate: "2026-05-01", endDate: "2026-04-01" }), 400);
    await refused(Vendors.createAgreement(vendor.id, admin, { title: "MSA", startDate: "2026-02-31" }), 400);
    const past = await Vendors.createAgreement(vendor.id, admin, { title: "Old", startDate: "2020-01-01", endDate: "2020-12-31" });
    const live = await Vendors.createAgreement(vendor.id, admin, { title: "Live", startDate: "2020-01-01" });
    expect([past.status, live.status]).toEqual(["expired", "active"]);
    await refused(Vendors.attachAgreementDocument(vendor.id, live.id, admin, { url: "http://x.test/a.pdf" }), 400);
    await refused(Vendors.attachAgreementDocument(vendor.id, live.id, admin, { url: "https://u:p@x.test/a.pdf" }), 400);
    const withDoc = await Vendors.attachAgreementDocument(vendor.id, live.id, admin, { url: "https://files.test/msa.pdf", contentType: "application/pdf" });
    expect(withDoc.documentUrl).toBe("https://files.test/msa.pdf");
    for (let i = 1; i < 10; i++) await Vendors.attachAgreementDocument(vendor.id, live.id, admin, { url: `https://files.test/${i}.pdf` });
    await refused(Vendors.attachAgreementDocument(vendor.id, live.id, admin, { url: "https://files.test/11.pdf" }), 409);
    await refused(Vendors.attachAgreementDocument(vendor.id, past.id.replace(/^./, "0"), admin, { url: "https://files.test/x.pdf" }), 404);
    const listed = await Vendors.listAgreements(vendor.id, { limit: "500" });
    expect(listed.limit).toBe(100);
    expect(listed.total).toBe(2);
  });

  it("refuses a duplicate material name and a fourth decimal", async () => {
    await refused(Vendors.createMaterial({ name: "Soap", unit: "kg" }), 409);
    await refused(Vendors.createMaterial({ name: "Starch", unit: "kg", reorderLevel: 1.2345 }), 400);
    await refused(Vendors.createMaterial({ name: "Starch", unit: "kg", preferredVendorId: "00000000-0000-4000-8000-000000000000" }), 400);
    const ok = await Vendors.createMaterial({ name: "Starch", unit: "kg", reorderLevel: 2.5, preferredVendorId: vendor.id });
    expect(ok.reorderLevel).toBe(2.5);
  });
});

describe("raising and editing purchase orders", () => {
  it("prices every line in whole paise and numbers the order", async () => {
    const order = await raise([line(soap, 2.5, 12.5), line(softener, 3)]);
    expect(order.number).toBe("PO-1001");
    expect(order.status).toBe("draft");
    expect(order.total).toBe(31.25);
    expect(order.items.map((i) => [i.materialName, i.quantity, i.unitPrice, i.amount])).toEqual([["Soap", 2.5, 12.5, 31.25], ["Softener", 3, null, 0]]);
    expect(order.timeline).toHaveLength(1);
  });

  it("refuses bad payloads", async () => {
    await refused(raise([]), 400);
    await refused(raise([line(soap, 0)]), 400);
    await refused(raise([line(soap, 1.0001)]), 400);
    await refused(raise([line(soap, 1, 0.001)]), 400);
    await refused(raise([line(soap, 1, 1), line(soap, 2, 1)]), 400, /only once/);
    await refused(raise([{ materialId: "x", quantity: 1 }]), 400);
    await refused(raise([line(soap, 1, 1)], { expectedOn: addDays(todayIst(), -1) }), 400);
    await refused(raise([line(soap, 1, 1)], { expectedOn: "tomorrow" }), 400);
    await refused(raise([{ materialId: "00000000-0000-4000-8000-000000000000", quantity: 1 }]), 404);
    await refused(raise([line(soap, 9999, 100000)]), 400, /too large/);
    await refused(PO.create(null, admin, { vendorId: vendor.id, items: [line(soap, 1, 1)] }), 400);
  });

  it("ignores any total, status or owner the client sends", async () => {
    const order = await raise([line(soap, 1, 10)], { totalPaise: 1, total: 1, status: "received", createdBy: "x" });
    expect(order.total).toBe(10);
    expect(order.status).toBe("draft");
  });

  it("edits only drafts, replacing the lines and recomputing the total", async () => {
    const order = await raise([line(soap, 1, 10)]);
    const edited = await PO.updateDraft(order.id, scopeOf(admin), { items: [line(softener, 2, 7)], notes: "rush", expectedOn: null });
    expect(edited.total).toBe(14);
    expect(edited.items.map((i) => i.materialName)).toEqual(["Softener"]);
    expect(edited.notes).toBe("rush");
    await PO.send(order.id, scopeOf(admin), admin);
    await refused(PO.updateDraft(order.id, scopeOf(admin), { notes: "late" }), 409, /draft/);
  });

  it("replays an Idempotency-Key and survives two simultaneous submissions", async () => {
    const key = "key-aaaaaaaa-1";
    const first = await raise([line(soap, 1, 10)], {}, storeA, admin, key);
    const again = await raise([line(soap, 1, 10)], {}, storeA, admin, key);
    expect(again.id).toBe(first.id);
    expect(state.orders.size).toBe(1);
    const [a, b] = await Promise.all([raise([line(soap, 1, 10)], {}, storeA, admin, "key-bbbbbbbb-2"), raise([line(soap, 1, 10)], {}, storeA, admin, "key-bbbbbbbb-2")]);
    expect(a.id).toBe(b.id);
    expect(state.orders.size).toBe(2);
    await refused(raise([line(soap, 1, 10)], {}, storeA, admin, "short"), 400);
  });
});

describe("the purchase order state machine", () => {
  it("send needs a price on every line and an active vendor", async () => {
    const order = await raise([line(soap, 1, 10), line(softener, 1)]);
    await refused(PO.send(order.id, scopeOf(admin), admin), 409, /unit price/);
    await PO.updateDraft(order.id, scopeOf(admin), { items: [line(soap, 1, 10)] });
    const sentOrder = await PO.send(order.id, scopeOf(admin), admin);
    expect(sentOrder.status).toBe("sent");
    expect(sentOrder.sentAt).not.toBeNull();
    await refused(PO.send(order.id, scopeOf(admin), admin), 409, /draft/);
  });

  it("cancels drafts and sent orders with a history row, never received or cancelled ones", async () => {
    const draft = await raise([line(soap, 1, 10)]);
    const cancelled = await PO.cancel(draft.id, scopeOf(admin), admin, { reason: "Not needed" });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.timeline.map((t) => [t.from, t.status, t.note])).toEqual([[null, "draft", undefined], ["draft", "cancelled", "Not needed"]]);
    await refused(PO.cancel(draft.id, scopeOf(admin), admin, {}), 409);
    await refused(PO.send(draft.id, scopeOf(admin), admin), 409);
    const done = await sent([line(soap, 1, 10)]);
    await receive(done, [{ materialId: soap.id, receivedQty: 1 }]);
    await refused(PO.cancel(done.id, scopeOf(admin), admin, {}), 409);
    const partial = await sent([line(soap, 2, 10)]);
    await receive(partial, [{ materialId: soap.id, receivedQty: 1 }]);
    await refused(PO.cancel(partial.id, scopeOf(admin), admin, {}), 409, /partially received/);
    expect((await PO.cancel((await sent([line(soap, 1, 10)])).id, scopeOf(admin), admin, {})).status).toBe("cancelled");
  });

  it("two simultaneous sends make one transition: the loser is refused and no second event is written", async () => {
    const order = await raise([line(soap, 1, 10)]);
    const results = await Promise.allSettled([PO.send(order.id, scopeOf(admin), admin), PO.send(order.id, scopeOf(admin), admin)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((lost.reason as CustomException).errorCode).toBe(409);
    expect(state.orders.get(order.id).events.filter((e: any) => e.toStatus === "sent")).toHaveLength(1);
  });

  it("send racing cancel ends in exactly one of the two states", async () => {
    const order = await raise([line(soap, 1, 10)]);
    const results = await Promise.allSettled([PO.send(order.id, scopeOf(admin), admin), PO.cancel(order.id, scopeOf(admin), admin, {})]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(state.orders.get(order.id).events).toHaveLength(2);
  });
});

describe("receiving goods", () => {
  it("handles partial deliveries, raises store stock, and finishes when everything has arrived", async () => {
    const order = await sent([line(soap, 10, 50), line(softener, 4, 12.5)], { expectedOn: addDays(todayIst(), 3) });
    const first = await receive(order, [{ materialId: soap.id, receivedQty: 4 }], admin, { invoiceRef: "INV-1" });
    expect(first.status).toBe("partially_received");
    expect(first.received).toBe(200);
    expect(first.outstanding).toBe(350);
    expect(state.stock.get(`${soap.id}:${storeA.id}`)).toBe(4000);
    const second = await receive(order, [{ materialId: soap.id, receivedQty: 6 }, { materialId: softener.id, receivedQty: 4 }]);
    expect(second.status).toBe("received");
    expect(second.received).toBe(550);
    expect(second.outstanding).toBe(0);
    expect(second.deliveredOnTime).toBe(true);
    expect(second.receipts).toHaveLength(2);
    expect(second.timeline.map((t) => t.status)).toEqual(["draft", "sent", "partially_received", "received"]);
    await refused(receive(order, [{ materialId: soap.id, receivedQty: 1 }]), 409, /sent/);
  });

  it("splits a fractional price over deliveries without drifting from the line total", async () => {
    const order = await sent([line(soap, 1, 0.01)]);
    await receive(order, [{ materialId: soap.id, receivedQty: 0.333 }]);
    await receive(order, [{ materialId: soap.id, receivedQty: 0.333 }]);
    const done = await receive(order, [{ materialId: soap.id, receivedQty: 0.334 }]);
    expect(done.received).toBe(done.total);
  });

  it("refuses over-receipt, unknown materials, duplicates and drafts", async () => {
    const draft = await raise([line(soap, 5, 10)]);
    await refused(receive(draft, [{ materialId: soap.id, receivedQty: 1 }]), 409);
    const order = await sent([line(soap, 5, 10)]);
    await refused(receive(order, [{ materialId: soap.id, receivedQty: 5.001 }]), 409, /outstanding/);
    await refused(receive(order, [{ materialId: softener.id, receivedQty: 1 }]), 400, /not on this/);
    await refused(receive(order, [{ materialId: soap.id, receivedQty: 1 }, { materialId: soap.id, receivedQty: 1 }]), 400);
    await refused(receive(order, []), 400);
    await refused(receive(order, [{ materialId: soap.id, receivedQty: -1 }]), 400);
    expect(state.stock.size).toBe(0);
  });

  it("two simultaneous deliveries cannot together exceed the ordered quantity", async () => {
    const order = await sent([line(soap, 10, 10)]);
    const results = await Promise.allSettled([
      receive(order, [{ materialId: soap.id, receivedQty: 6 }]),
      receive(order, [{ materialId: soap.id, receivedQty: 6 }]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as CustomException).errorCode).toBe(409);
    expect(state.stock.get(`${soap.id}:${storeA.id}`)).toBe(6000);
    expect(state.orders.get(order.id).items[0].receivedMilli).toBe(6000);
  });

  it("marks a late delivery", async () => {
    const order = await sent([line(soap, 1, 10)], { expectedOn: todayIst() });
    state.orders.get(order.id).expectedOn = addDays(todayIst(), -2);
    expect((await receive(order, [{ materialId: soap.id, receivedQty: 1 }])).deliveredOnTime).toBe(false);
  });
});

describe("store scope", () => {
  it("answers 404 for another store's order and for raising one outside the caller's scope", async () => {
    const orderB = await sent([line(soap, 1, 10)], {}, storeB);
    await refused(PO.getById(orderB.id, scopeOf(managerA)), 404);
    await refused(receive(orderB, [{ materialId: soap.id, receivedQty: 1 }], managerA), 404);
    await refused(PO.send(orderB.id, scopeOf(managerA), managerA), 404);
    expect((await PO.getById(orderB.id, scopeOf(managerB))).id).toBe(orderB.id);
    expect((await receive(orderB, [{ materialId: soap.id, receivedQty: 1 }], managerB)).status).toBe("received");
    await refused(PO.create(scopeOf(admin, storeA.id), admin, { vendorId: vendor.id, storeId: storeB.id, items: [line(soap, 1, 1)] }), 404);
  });

  it("lists only the caller's store and lets ?storeId= narrow but never widen", async () => {
    await sent([line(soap, 1, 10)], {}, storeA);
    await sent([line(soap, 2, 10)], {}, storeB);
    expect((await PO.list(scopeOf(managerA), {})).total).toBe(1);
    expect((await PO.list(scopeOf(managerA), { storeId: storeB.id })).total).toBe(0);
    expect((await PO.list(scopeOf(hr), {})).total).toBe(2);
    expect((await PO.list(scopeOf(hr), { storeId: storeB.id })).total).toBe(1);
    expect((await PO.list(scopeOf(admin, storeA.id), {})).total).toBe(1);
  });

  it("pages, filters by outstanding and status, and bounds the page size", async () => {
    await sent([line(soap, 1, 10)]);
    await raise([line(soap, 1, 10)]);
    const done = await sent([line(soap, 1, 10)]);
    await receive(done, [{ materialId: soap.id, receivedQty: 1 }]);
    expect((await PO.list(scopeOf(admin), { outstanding: "true" })).total).toBe(1);
    expect((await PO.list(scopeOf(admin), { status: "draft" })).total).toBe(1);
    expect((await PO.list(scopeOf(admin), { status: "draft", outstanding: "true" })).total).toBe(0);
    const page = await PO.list(scopeOf(admin), { limit: "2", page: "2" });
    expect([page.items.length, page.limit, page.page, page.total]).toEqual([1, 2, 2, 3]);
    expect((await PO.list(scopeOf(admin), { limit: "9999" })).limit).toBe(100);
    await refused(PO.list(scopeOf(admin), { page: "0" }), 400);
    await refused(PO.list(scopeOf(admin), { status: "bogus" }), 400);
    await refused(PO.list(scopeOf(admin), { outstanding: "maybe" }), 400);
    await refused(PO.list(scopeOf(admin), { vendorId: "x" }), 400);
  });
});

describe("reports", () => {
  it("suggests what to order from stock, reorder level and what is already on its way", async () => {
    expect((await PO.requirements(scopeOf(admin), {})).items.map((r) => [r.name, r.storeId === storeA.id ? "A" : "B", r.currentQty, r.suggestedQty]).sort()).toEqual([
      ["Soap", "A", 0, 20],
      ["Soap", "B", 0, 20],
    ]);
    await sent([line(soap, 12, 10)], {}, storeA);
    const afterOrder = await PO.requirements(scopeOf(admin), {});
    expect(afterOrder.items.find((r) => r.storeId === storeA.id)?.suggestedQty).toBe(8);
    const own = await PO.requirements(scopeOf(managerA), {});
    expect(own.items.map((r) => r.storeId)).toEqual([storeA.id]);
    await state.stock.set(`${soap.id}:${storeB.id}`, 10_001);
    expect((await PO.requirements(scopeOf(managerB), {})).total).toBe(0);
    expect((await PO.requirements(scopeOf(managerA), { storeId: storeB.id })).total).toBe(0);
    await refused(PO.requirements(scopeOf(admin), { storeId: "00000000-0000-4000-8000-000000000000" }), 404);
  });

  it("totals spend per vendor over a date range and answers vendor history", async () => {
    const other = await seed.vendor({ name: "Zed Supplies" });
    const a = await sent([line(soap, 10, 10)], { expectedOn: addDays(todayIst(), 5) });
    await receive(a, [{ materialId: soap.id, receivedQty: 10 }]);
    const b = await sent([line(soap, 10, 10)]);
    const draft = await raise([line(soap, 1, 999)]);
    await PO.create(scopeOf(admin), admin, { vendorId: other.id, storeId: storeB.id, items: [line(soap, 1, 40)] }).then((o) => PO.send(o.id, scopeOf(admin), admin));
    const spend = await PO.spend(scopeOf(admin), {});
    expect(spend.total).toBe(240);
    expect(spend.byVendor.map((v) => [v.name, v.spend])).toEqual([["Acme Chemicals", 200], ["Zed Supplies", 40]]);
    expect((await PO.spend(scopeOf(admin), { vendorId: other.id })).total).toBe(40);
    expect((await PO.spend(scopeOf(admin), { from: addDays(todayIst(), 1) })).total).toBe(0);
    expect((await PO.spend(scopeOf(admin, storeB.id), {})).total).toBe(40);
    const history = await Vendors.getVendorHistory(vendor.id, scopeOf(admin), {});
    expect(history).toEqual({ orders: 2, onTimeDeliveryPct: 100, totalSpend: 200, outstanding: 100 });
    expect(await Vendors.getVendorHistory(vendor.id, scopeOf(managerB), {})).toEqual({ orders: 0, onTimeDeliveryPct: null, totalSpend: 0, outstanding: 0 });
    await refused(Vendors.getVendorHistory("nope", scopeOf(admin), {}), 404);
    await refused(Vendors.getVendorHistory(vendor.id, scopeOf(admin), { from: "2026-02-01", to: "2026-01-01" }), 400);
    expect(draft.status).toBe("draft");
    expect(b.status).toBe("sent");
  });
});
