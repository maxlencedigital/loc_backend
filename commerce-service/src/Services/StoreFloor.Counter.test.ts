// Quality, ready, collection, counter orders and capacity: the real services over in-memory fakes.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/Store.Query.js", () => ({ StoreQuery: require("../Testing/InMemoryCommerce.js").storeQuery }));
jest.mock("../Queries/Customer.Query.js", () => ({ CustomerQuery: require("../Testing/InMemoryCommerce.js").customerQuery }));
jest.mock("../Queries/Catalog.Query.js", () => ({ CatalogQuery: require("../Testing/InMemoryCommerce.js").catalogQuery }));
jest.mock("../Queries/Order.Query.js", () => ({ OrderQuery: require("../Testing/InMemoryCommerce.js").orderQuery }));
jest.mock("../Queries/Floor.Transaction.js", () => ({ FloorTransaction: require("../Testing/InMemoryStoreFloor.js").floorTransaction }));
jest.mock("../Queries/Piece.Query.js", () => ({ PieceQuery: require("../Testing/InMemoryStoreFloor.js").pieceQuery }));
jest.mock("../Queries/Batch.Query.js", () => ({ BatchQuery: require("../Testing/InMemoryStoreFloor.js").batchQuery }));
jest.mock("../Queries/Machine.Query.js", () => ({ MachineQuery: require("../Testing/InMemoryStoreFloor.js").machineQuery }));
jest.mock("../Queries/Quality.Query.js", () => ({ QualityQuery: require("../Testing/InMemoryStoreFloor.js").qualityQuery }));
jest.mock("../Queries/FabricRule.Query.js", () => ({ FabricRuleQuery: require("../Testing/InMemoryStoreFloor.js").fabricRuleQuery }));
jest.mock("../Queries/StoreOrder.Query.js", () => ({ StoreOrderQuery: require("../Testing/InMemoryStoreFloor.js").storeOrderQuery }));
jest.mock("../Queries/Capacity.Query.js", () => ({ CapacityQuery: require("../Testing/InMemoryStoreFloor.js").capacityQuery }));
jest.mock("../Clients/Dispatch.Client.js", () => ({ DispatchClient: { createDeliveryJob: jest.fn() } }));

import { DispatchClient } from "../Clients/Dispatch.Client.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { floor } from "../Testing/InMemoryStoreFloor.js";
import { seed, state } from "../Testing/InMemoryCommerce.js";
import {
  actor, addMachine, book, bookSorted, buildWorld, checkIn, line, newBatch, orderRow, passAll, piecesOf, refused, scopeOf, w, washAndDry,
} from "../Testing/StoreFloorWorld.js";
import {
  CapacityService, HIGH_RISK_PCT, MEDIUM_RISK_PCT, buildForecast, judgeExpress, parkBottleneck, projectFinish, riskForUtilisation,
} from "./Capacity.Service.js";
import { localDate } from "./FloorSupport.js";
import { MachinesService } from "./Machines.Service.js";
import { OrderService } from "./Order.Service.js";
import { ProcessingService } from "./Processing.Service.js";
import { QualityService } from "./Quality.Service.js";
import { StoreOrdersService } from "./StoreOrders.Service.js";

const createJob = DispatchClient.createDeliveryJob as jest.Mock;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  buildWorld();
  createJob.mockReset();
  createJob.mockResolvedValue("job-1");
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

const status = (orderId: string) => orderRow(orderId).status;
const ready = (orderId: string, body: object = {}, user = w.staffA) => QualityService.markOrderReady(orderId, scopeOf(user), user, body);
const collect = (orderId: string, body: object = { collectedBy: "Ana Rao" }, user = w.staffA) => QualityService.collect(orderId, scopeOf(user), user, body);
const qc = (orderId: string, results: object[], user = w.staffA, extra: object = {}) =>
  QualityService.recordQualityCheck(orderId, scopeOf(user), user, { results, ...extra });

/** An order at quality check with every garment still to be checked. */
const atQualityCheck = async (extra: Record<string, unknown> = {}) => {
  const order = await bookSorted(undefined, undefined, extra);
  await washAndDry(order.id);
  return order;
};
const packed = async (extra: Record<string, unknown> = {}) => {
  const order = await atQualityCheck(extra);
  await passAll(order.id);
  await ready(order.id);
  return order;
};

describe("quality check", () => {
  it("records a pass per garment; the order waits at quality check until it is packed", async () => {
    const order = await atQualityCheck();
    const [first, second] = piecesOf(order.id);
    const done = await qc(order.id, [{ itemId: first.id, passed: true, comparedWithPickupNotes: true }]);
    expect(done).toMatchObject({ outcome: "pass", passedCount: 1, reworkCount: 0, orderStatus: "quality_check" });
    await qc(order.id, [{ itemId: second.id, passed: true, note: "spotless" }]);

    const latest = await QualityService.getQualityCheck(order.id, scopeOf(w.staffA));
    expect(latest).toMatchObject({ outcome: "pass", checkedBy: "Sanjay" });
    expect(latest.results).toEqual([{ itemId: second.id, tagCode: second.tagCode, passed: true, note: "spotless", comparedWithPickupNotes: false }]);
    expect(piecesOf(order.id).every((p) => p.qcPassedAt)).toBe(true);
  });

  it("a failure needs a reason, and sends the garment back to the sorted queue, taking the order with it", async () => {
    const order = await atQualityCheck();
    const [first, second] = piecesOf(order.id);
    await refused(qc(order.id, [{ itemId: first.id, passed: false }]), 400, /note \(the reason it failed\)/);
    expect(floor.qcs).toHaveLength(0);

    const done = await qc(order.id, [{ itemId: first.id, passed: false, note: "stain remains" }, { itemId: second.id, passed: true }]);
    expect(done).toMatchObject({ outcome: "fail", passedCount: 1, reworkCount: 1, orderStatus: "sorted" });
    expect(piecesOf(order.id).map((p) => [p.stage, p.reworkCount, p.qcPassedAt !== null])).toEqual([
      ["sorted", 1, false],
      ["quality_check", 0, true],
    ]);
    const back = orderRow(order.id).events.slice(-3);
    expect(back.map((e: any) => e.status)).toEqual(["drying", "washing", "sorted"]);
    expect(back.every((e: any) => e.byName === "Sanjay" && /Quality check failed on .*: stain remains/.test(e.note))).toBe(true);
  });

  it("after rework the order returns to quality check, and the garment that passed need not be checked again", async () => {
    const order = await atQualityCheck();
    const [first, second] = piecesOf(order.id);
    await qc(order.id, [{ itemId: first.id, passed: false, note: "stain" }, { itemId: second.id, passed: true }]);

    const washer = await addMachine(w.storeA.id, "washer");
    const dryer = await addMachine(w.storeA.id, "dryer");
    const wash = await newBatch(w.staffA, [first.id], w.dryClean, { machineId: washer.id });
    await ProcessingService.startBatch(wash.id, scopeOf(w.staffA), w.staffA);
    await ProcessingService.completeBatch(wash.id, scopeOf(w.staffA), w.staffA, {});
    const dry = await newBatch(w.staffA, [first.id], w.dryClean, { machineId: dryer.id });
    await ProcessingService.startBatch(dry.id, scopeOf(w.staffA), w.staffA);
    await ProcessingService.completeBatch(dry.id, scopeOf(w.staffA), w.staffA, {});
    expect(status(order.id)).toBe("quality_check");

    await refused(ready(order.id), 409, /1 of 2 garments have not passed quality check/);
    await qc(order.id, [{ itemId: first.id, passed: true }]);
    expect((await ready(order.id)).status).toBe("packed");
  });

  it("only checks garments that are at quality check, once each, on this order", async () => {
    const order = await bookSorted();
    const [piece] = piecesOf(order.id);
    await refused(qc(order.id, [{ itemId: piece.id, passed: true }]), 409, /not at quality check yet \(sorted\)/);
    const done = await atQualityCheck();
    const ids = piecesOf(done.id).map((p) => p.id);
    await refused(qc(done.id, [{ itemId: ids[0], passed: true }, { itemId: ids[0], passed: true }]), 400, /same item twice/);
    await refused(qc(done.id, [{ itemId: piece.id, passed: true }]), 404, /Item not found on this order/);
    await refused(qc(done.id, [{ itemId: "11111111-1111-4111-8111-111111111111", passed: true }]), 404);
  });

  it.each([
    ["no results", [], /results must list/],
    ["a malformed item id", [{ itemId: "x", passed: true }], /itemId must be a valid id/],
    ["a missing verdict", [{ itemId: "11111111-1111-4111-8111-111111111111" }], /passed must be true or false/],
    ["a non-boolean comparedWithPickupNotes", [{ itemId: "11111111-1111-4111-8111-111111111111", passed: true, comparedWithPickupNotes: "yes" }], /comparedWithPickupNotes/],
  ])("rejects %s", async (_label, results, message) => {
    const order = await atQualityCheck();
    await refused(qc(order.id, results as object[]), 400, message);
  });

  it("checks the stated overall result against the item results", async () => {
    const order = await atQualityCheck();
    const [first, second] = piecesOf(order.id);
    await refused(qc(order.id, [{ itemId: first.id, passed: false, note: "x" }], w.staffA, { overall: "pass" }), 400, /overall says pass but/);
    await refused(qc(order.id, [{ itemId: first.id, passed: true }], w.staffA, { overall: "fail" }), 400, /overall says fail but/);
    await refused(qc(order.id, [{ itemId: first.id, passed: true }], w.staffA, { overall: "great" }), 400, /overall must be one of/);
    expect((await qc(order.id, [{ itemId: first.id, passed: false, note: "x" }], w.staffA, { overall: "rework" })).outcome).toBe("fail");
    expect((await qc(order.id, [{ itemId: second.id, passed: true }], w.staffA, { overall: "pass" })).outcome).toBe("pass");
  });

  it("keeps quality checks inside the store and off cancelled orders", async () => {
    const order = await atQualityCheck();
    const [piece] = piecesOf(order.id);
    await refused(qc(order.id, [{ itemId: piece.id, passed: true }], w.staffB), 404);
    await refused(QualityService.getQualityCheck(order.id, scopeOf(w.staffB)), 404);
    await refused(QualityService.getQualityCheck(order.id, scopeOf(w.staffA)), 404, /No quality check has been recorded/);
    await OrderService.cancel(order.id, null, w.admin, { reason: "gone" });
    await refused(qc(order.id, [{ itemId: piece.id, passed: true }]), 409, /cancelled/);
  });
});

describe("marking an order ready", () => {
  it("packs only when every garment passed quality check", async () => {
    const order = await atQualityCheck();
    const [first] = piecesOf(order.id);
    await refused(ready(order.id), 409, /2 of 2 garments have not passed quality check/);
    await qc(order.id, [{ itemId: first.id, passed: true }]);
    await refused(ready(order.id), 409, /1 of 2 garments have not passed/);
    expect(status(order.id)).toBe("quality_check");

    await passAll(order.id);
    const done = await ready(order.id, { packedCount: 2 });
    expect(done).toMatchObject({ status: "packed", orderNumber: order.ref });
    expect(status(order.id)).toBe("packed");
    expect(piecesOf(order.id).map((p) => p.stage)).toEqual(["packed", "packed"]);
    expect(orderRow(order.id).events.at(-1)).toMatchObject({ status: "packed", byName: "Sanjay" });
  });

  it("refuses a wrong packed count, an order not at quality check, one with no garments, a cancelled one and another store's", async () => {
    const order = await atQualityCheck();
    await passAll(order.id);
    await refused(ready(order.id, { packedCount: 3 }), 400, /does not match the 2 garments/);
    await refused(ready(order.id, { packedCount: -1 }), 400, /packedCount/);
    await refused(ready(order.id, {}, w.staffB), 404);

    const early = await bookSorted();
    await refused(ready(early.id), 409, /must reach quality check first/);
    const bare = await book();
    await refused(ready(bare.id), 409, /no garments checked in/);
    await OrderService.cancel(order.id, null, w.admin, { reason: "gone" });
    await refused(ready(order.id), 409, /cancelled/);
  });

  it("asks logistics for a delivery job for an app order with an address, once, and answers its id", async () => {
    const order = await atQualityCheck({ channel: "app" });
    await passAll(order.id);
    const done = await ready(order.id);
    expect(done.deliveryJobId).toBe("job-1");
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(createJob).toHaveBeenCalledWith({
      orderId: order.id,
      orderRef: order.ref,
      storeId: w.storeA.id,
      address: "12 MG Road",
      contactName: "Ana Rao",
      contactPhone: "+91 98450 12345",
      priority: "standard",
    });
  });

  it("does not create a delivery job for a counter order", async () => {
    const order = await atQualityCheck();
    await passAll(order.id);
    expect((await ready(order.id)).deliveryJobId).toBeNull();
    expect(createJob).not.toHaveBeenCalled();
  });

  it("when dispatch is down the order stays packed, the answer says so, and trying again finishes the job", async () => {
    const order = await atQualityCheck({ channel: "app" });
    await passAll(order.id);
    createJob.mockRejectedValueOnce(new Error("logistics unreachable"));
    const error = await ready(order.id).catch((e) => e);
    expect(error.errorCode).toBe(503);
    expect(error.displayMessage).toMatch(/packed, but dispatch could not be reached/);
    expect(error.displayMessage).not.toMatch(/unreachable/);
    expect(status(order.id)).toBe("packed");
    const eventsBefore = orderRow(order.id).events.length;

    const again = await ready(order.id);
    expect(again).toMatchObject({ status: "packed", deliveryJobId: "job-1" });
    expect(orderRow(order.id).events).toHaveLength(eventsBefore);
  });

  it("two simultaneous requests pack the order once", async () => {
    const order = await atQualityCheck();
    await passAll(order.id);
    await Promise.all([ready(order.id), ready(order.id, {}, w.managerA)]);
    expect(orderRow(order.id).events.filter((e: any) => e.status === "packed")).toHaveLength(1);
  });

  it("will not pack an order that already left the store", async () => {
    const order = await packed();
    orderRow(order.id).status = "out_for_delivery";
    await refused(ready(order.id), 409, /already left the store/);
    orderRow(order.id).status = "delivered";
    await refused(ready(order.id), 409, /already been collected/);
  });
});

describe("handing an order over at the counter", () => {
  it("collects a packed, paid order: out the door and delivered, recorded once", async () => {
    const order = await packed({ paymentStatus: "paid" });
    const done = await collect(order.id, { collectedBy: "Ana Rao", signature: "data:image/png;base64,iVBORw0KGgo=" });
    expect(done).toMatchObject({ status: "delivered", collectedBy: "Ana Rao", paymentOutstanding: false });
    expect(done).not.toHaveProperty("warning");
    expect(orderRow(order.id).events.slice(-2).map((e: any) => e.status)).toEqual(["out_for_delivery", "delivered"]);
    expect(orderRow(order.id).events.at(-1)).toMatchObject({ byName: "Sanjay", byUserId: w.staffA.id });
    expect(floor.collections.get(order.id)).toMatchObject({ collectedBy: "Ana Rao", paymentOutstanding: false, signature: "data:image/png;base64,iVBORw0KGgo=" });
  });

  it("allows collecting an unpaid or part-paid order but flags it in the answer and on the timeline", async () => {
    const unpaid = await packed();
    const done = await collect(unpaid.id);
    expect(done).toMatchObject({ paymentOutstanding: true, paymentStatus: "unpaid" });
    expect(done.warning).toMatch(/payment outstanding/);
    expect(orderRow(unpaid.id).events.at(-1).note).toMatch(/payment outstanding/);

    const part = await packed({ paymentStatus: "part_paid" });
    await collect(part.id);
    expect(orderRow(part.id).events.at(-1).note).toMatch(/partly paid/);
    expect(floor.collections.get(part.id).paymentOutstanding).toBe(true);
  });

  it("refuses an order already collected, however it is asked", async () => {
    const order = await packed();
    await collect(order.id);
    await refused(collect(order.id), 409, /already been collected/);
    await refused(collect(order.id, { collectedBy: "Someone else" }, w.managerA), 409, /already been collected/);
    expect(orderRow(order.id).events.filter((e: any) => e.status === "delivered")).toHaveLength(1);
  });

  it("two simultaneous collections: one succeeds", async () => {
    const order = await packed();
    const results = await Promise.allSettled([collect(order.id), collect(order.id, { collectedBy: "Other" }, w.managerA)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(orderRow(order.id).events.filter((e: any) => e.status === "delivered")).toHaveLength(1);
  });

  it("refuses an order that is not packed, a cancelled order and another store's order", async () => {
    const early = await atQualityCheck();
    await refused(collect(early.id), 409, /quality check; only a packed order/);
    const order = await packed();
    await refused(collect(order.id, { collectedBy: "x" }, w.staffB), 404);
    await OrderService.cancel(order.id, null, w.admin, { reason: "refund" });
    await refused(collect(order.id), 409, /cancelled/);
    await refused(collect("nope"), 404);
  });

  it.each([
    ["no collector", {}, /collectedBy is required/],
    ["a very long name", { collectedBy: "n".repeat(81) }, /collectedBy/],
    ["a signature that is not an image", { collectedBy: "x", signature: "<script>alert(1)</script>" }, /signature/],
    ["a huge signature", { collectedBy: "x", signature: "A".repeat(100_001) }, /signature/],
    ["a non-string signature", { collectedBy: "x", signature: 12 }, /signature/],
  ])("rejects %s", async (_label, body, message) => {
    const order = await packed();
    await refused(collect(order.id, body), 400, message);
    expect(status(order.id)).toBe("packed");
  });
});

describe("order notes, timeline and routing", () => {
  it("adds internal notes and shows them with the status events", async () => {
    const order = await book();
    const note = await StoreOrdersService.addOrderNote(order.id, scopeOf(w.staffA), w.staffA, { note: "  Call before delivery " });
    expect(note).toMatchObject({ note: "Call before delivery", by: "Sanjay" });
    const timeline = await StoreOrdersService.getOrderTimeline(order.id, scopeOf(w.staffA));
    expect(timeline.events.map((e) => e.status)).toEqual(["booked"]);
    expect(timeline.events[0].by).toBe("Meera Nair");
    expect(timeline.notes).toHaveLength(1);
  });

  it("validates notes and keeps them inside the store", async () => {
    const order = await book();
    await refused(StoreOrdersService.addOrderNote(order.id, scopeOf(w.staffA), w.staffA, {}), 400, /note is required/);
    await refused(StoreOrdersService.addOrderNote(order.id, scopeOf(w.staffA), w.staffA, { note: "n".repeat(1001) }), 400, /note/);
    await refused(StoreOrdersService.addOrderNote(order.id, scopeOf(w.staffB), w.staffB, { note: "hi" }), 404);
    await refused(StoreOrdersService.getOrderTimeline(order.id, scopeOf(w.staffB)), 404);
    await refused(StoreOrdersService.getOrderTimeline("nope", scopeOf(w.staffA)), 404);
  });

  it("sends an order that has not reached the floor to another live store, with an event, and the first store loses sight of it", async () => {
    const order = await book();
    const moved = await StoreOrdersService.routeOrderToStore(order.id, scopeOf(w.managerA), w.managerA, { storeId: w.storeB.id, reason: "washer down" });
    expect(moved.storeId).toBe(w.storeB.id);
    expect(moved.status).toBe("booked");
    const event = orderRow(order.id).events.at(-1);
    expect(event).toMatchObject({ status: "booked", byName: "Meera Nair" });
    expect(event.note).toBe("Sent from BLR-IND to BLR-KOR: washer down");
    await refused(StoreOrdersService.getOrderTimeline(order.id, scopeOf(w.managerA)), 404);
    expect((await StoreOrdersService.getOrderTimeline(order.id, scopeOf(w.managerB))).events).toHaveLength(2);
  });

  it("refuses to route to the same, an unknown or a closed store, or an order already on the floor", async () => {
    const order = await book();
    const closed = seed.store({ code: "HYD-GAC", status: "closed" });
    const route = (id: string, storeId: string, user = w.managerA) => StoreOrdersService.routeOrderToStore(id, scopeOf(user), user, { storeId });
    await refused(route(order.id, w.storeA.id), 400, /already at that store/);
    await refused(route(order.id, "11111111-1111-4111-8111-111111111111"), 404, /Store not found/);
    await refused(route(order.id, closed.id), 400, /not taking orders/);
    await refused(StoreOrdersService.routeOrderToStore(order.id, scopeOf(w.managerA), w.managerA, { storeId: "x" }), 400, /storeId/);
    await refused(route(order.id, w.storeB.id, w.managerB), 404);

    await checkIn(order);
    await refused(route(order.id, w.storeB.id), 409, /already reached the floor/);
    expect(orderRow(order.id).storeId).toBe(w.storeA.id);
  });

  it("lets an admin route any order", async () => {
    const order = await book();
    const moved = await StoreOrdersService.routeOrderToStore(order.id, scopeOf(w.admin), w.admin, { storeId: w.storeB.id });
    expect(moved.storeId).toBe(w.storeB.id);
  });
});

describe("counter (walk-in) orders", () => {
  const walkIn = (body: Record<string, unknown>, user = w.staffA, key?: string, scope = scopeOf(user)) =>
    StoreOrdersService.createWalkInOrder(scope, user, { storeId: user.storeId, ...body }, key);
  const item = (extra: Record<string, unknown> = {}) => ({ serviceId: w.dryClean.id, garment: "Shirt", category: "men", quantity: 2, ...extra });

  it("books through the order service with prices from the price list only", async () => {
    const result = await walkIn({ customerId: w.ana.id, items: [item({ rate: 1, amount: 1, price: 1 })] });
    expect(result).toMatchObject({ orderNumber: expect.stringMatching(/^LOC-/), amountDue: 240, paymentStatus: "unpaid" });
    expect(result.order).toMatchObject({ status: "booked", channel: "walk_in", storeId: w.storeA.id, priority: "standard", amount: 240 });
    expect(result.order.items[0]).toMatchObject({ rate: 120, qty: 2 });
  });

  it("takes weighed items, express, due date, care answers and notes, and rates risk from the fabric", async () => {
    const dueAt = new Date(Date.now() + 5 * 3_600_000).toISOString();
    const result = await walkIn({
      customerId: w.ana.id,
      express: true,
      dueAt,
      items: [{ serviceId: w.washFold.id, garment: "Shirt", category: "men", weightKg: 2.5, fabric: "cotton" }, item({ fabric: "silk" })],
      careAnswers: [{ questionId: "stains", answer: "yes" }],
      careNotes: "gentle please",
    });
    expect(result.order.priority).toBe("express");
    expect(result.order.promisedAt).toBe(dueAt);
    expect(result.order.care).toMatchObject({ riskClass: "high", flags: ["stains: yes"], customerNote: "gentle please", fabric: "cotton" });
    expect(result.order.weightKg).toBe(2.5);
  });

  it("books a payment by cash, upi or card as paid and pay later as unpaid", async () => {
    const cash = await walkIn({ customerId: w.ana.id, items: [item()], paymentMethod: "cash" });
    expect(cash).toMatchObject({ paymentStatus: "paid", amountDue: 0 });
    const later = await walkIn({ customerId: w.ana.id, items: [item()], paymentMethod: "pay_later" });
    expect(later).toMatchObject({ paymentStatus: "unpaid", amountDue: 240 });
    await refused(walkIn({ customerId: w.ana.id, items: [item()], paymentMethod: "cheque" }), 400, /paymentMethod/);
  });

  it("creates a new customer in the store and books for them, refusing a phone already registered", async () => {
    const result = await walkIn({ newCustomer: { name: "Dev Menon", phone: "98450 77777", email: "dev@example.com" }, items: [item()] });
    const customer = state.customers.get(result.order.customerId);
    expect(customer).toMatchObject({ name: "Dev Menon", phone: "+91 98450 77777", storeId: w.storeA.id });

    const ordersBefore = state.orders.size;
    await refused(walkIn({ newCustomer: { name: "Dev Again", phone: "+919845077777" }, items: [item()] }), 409, /already exists/);
    expect(state.orders.size).toBe(ordersBefore);
  });

  it("needs exactly one of customerId and newCustomer", async () => {
    await refused(walkIn({ items: [item()] }), 400, /either customerId or newCustomer/);
    await refused(walkIn({ customerId: w.ana.id, newCustomer: { name: "x", phone: "9845012345" }, items: [item()] }), 400, /either customerId or newCustomer/);
  });

  it("keeps stores apart: a store-bound user cannot book for another store or another store's customer", async () => {
    await refused(walkIn({ customerId: w.ana.id, storeId: w.storeB.id, items: [item()] }), 404, /Store not found/);
    await refused(walkIn({ customerId: w.bob.id, items: [item()] }), 404, /Customer not found/);
  });

  it("makes an admin say which store", async () => {
    await refused(StoreOrdersService.createWalkInOrder(null, w.admin, { customerId: w.ana.id, items: [item()] }), 400, /Choose a store/);
    const result = await StoreOrdersService.createWalkInOrder(scopeOf(w.admin), w.admin, { storeId: w.storeA.id, customerId: w.ana.id, items: [item()] });
    expect(result.order.storeId).toBe(w.storeA.id);
  });

  it.each([
    ["no items", () => ({ items: [] }), /items must list/],
    ["both quantity and weight", () => ({ items: [item({ weightKg: 1 })] }), /quantity or weightKg, not both/],
    ["no quantity at all", () => ({ items: [{ serviceId: "x", garment: "Shirt", category: "men" }] }), /serviceId|qty/],
    ["an unknown fabric", () => ({ items: [item({ fabric: "tin" })] }), /fabric must be one of/],
    ["too many care answers", () => ({ items: [item()], careAnswers: Array(11).fill({ questionId: "q", answer: "a" }) }), /careAnswers/],
    ["a care answer without a question", () => ({ items: [item()], careAnswers: [{ answer: "a" }] }), /questionId/],
    ["a service with no price", () => ({ items: [item({ serviceId: "11111111-1111-4111-8111-111111111111" })] }), /unknown service|not a valid/],
  ])("rejects %s", async (_label, body: () => Record<string, unknown>, message) => {
    const ordersBefore = state.orders.size;
    await refused(walkIn({ customerId: w.ana.id, ...body() }), 400, message);
    expect(state.orders.size).toBe(ordersBefore);
  });

  it("answers a retry with the same Idempotency-Key with the first order, creating one", async () => {
    const first = await walkIn({ customerId: w.ana.id, items: [item()] }, w.staffA, "key-1");
    const again = await walkIn({ customerId: w.ana.id, items: [item()] }, w.staffA, "key-1");
    expect(again.orderId).toBe(first.orderId);
    expect(again.orderNumber).toBe(first.orderNumber);
    expect(state.orders.size).toBe(1);
    expect(state.customers.get(w.ana.id).orderCount).toBe(1);
  });

  it("scopes a key to its user, and lets a failed attempt be retried with the same key", async () => {
    const mine = await walkIn({ customerId: w.ana.id, items: [item()] }, w.staffA, "shared");
    const theirs = await walkIn({ customerId: w.ana.id, items: [item()] }, w.managerA, "shared");
    expect(theirs.orderId).not.toBe(mine.orderId);

    await refused(walkIn({ customerId: w.ana.id, items: [item({ serviceId: "11111111-1111-4111-8111-111111111111" })] }, w.staffA, "retry"), 400);
    expect(floor.requests.has(`${w.staffA.id}|retry`)).toBe(false);
    const fixed = await walkIn({ customerId: w.ana.id, items: [item()] }, w.staffA, "retry");
    expect(fixed.orderNumber).toMatch(/^LOC-/);
  });

  it("two simultaneous requests with one key create one order", async () => {
    const [a, b] = await Promise.allSettled([
      walkIn({ customerId: w.ana.id, items: [item()] }, w.staffA, "twin"),
      walkIn({ customerId: w.ana.id, items: [item()] }, w.staffA, "twin"),
    ]);
    expect(state.orders.size).toBe(1);
    const results = [a, b];
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    for (const r of results) if (r.status === "rejected") expect((r.reason as any).errorCode).toBe(409);
  });

  it("rejects an empty or over-long key", async () => {
    await refused(walkIn({ customerId: w.ana.id, items: [item()] }, w.staffA, "  "), 400, /Idempotency-Key/);
    await refused(walkIn({ customerId: w.ana.id, items: [item()] }, w.staffA, "k".repeat(81)), 400, /Idempotency-Key/);
  });
});

describe("capacity", () => {
  it("judges utilisation: low under 70%, medium under 90%, high from 90%", () => {
    expect([0, MEDIUM_RISK_PCT - 0.1, MEDIUM_RISK_PCT, HIGH_RISK_PCT - 0.1, HIGH_RISK_PCT, 140].map(riskForUtilisation)).toEqual([
      "low", "low", "medium", "medium", "high", "high",
    ]);
  });

  it("fills quiet days with zeros and treats no capacity as full when there is load", () => {
    const days = buildForecast([{ date: "2026-10-03", orders: 2, committedGrams: 50_000, expressGrams: 10_000 }], "2026-10-02", 3, 100, "washer");
    expect(days.map((d) => [d.date, d.expectedOrders, d.committedKg, d.utilisationPct, d.risk])).toEqual([
      ["2026-10-02", 0, 0, 0, "low"],
      ["2026-10-03", 2, 50, 50, "low"],
      ["2026-10-04", 0, 0, 0, "low"],
    ]);
    expect(days[1]).toMatchObject({ expressCommittedKg: 10, capacity: 100, bottleneck: "washer" });
    expect(buildForecast([{ date: "2026-10-02", orders: 1, committedGrams: 5000, expressGrams: 0 }], "2026-10-02", 1, 0, "none")[0]).toMatchObject({ utilisationPct: 100, risk: "high" });
  });

  it("names the machine type with the least usable capacity as the bottleneck, ignoring broken machines", () => {
    const agg = (type: any, state: any, capacityGrams: number) => ({ type, state, count: 1, capacityGrams });
    expect(parkBottleneck([])).toBe("none");
    expect(parkBottleneck([agg("washer", "idle", 20_000), agg("dryer", "idle", 10_000)])).toBe("dryer");
    expect(parkBottleneck([agg("washer", "idle", 20_000), agg("washer", "faulted", 20_000), agg("dryer", "idle", 30_000)])).toBe("washer");
    expect(parkBottleneck([agg("press", "idle", 1000)])).toBe("none");
  });

  it("forecasts per day from open orders, with late orders counted today, and respects store scope", async () => {
    const heavy = await book([line(w.washFold, "Shirt", "men", 40)]);
    await book([line(w.washFold, "Shirt", "men", 20)]);
    const late = await book([line(w.washFold, "Shirt", "men", 10)]);
    orderRow(late.id).promisedAt = new Date(Date.now() - 3_600_000);
    const done = await book([line(w.washFold, "Shirt", "men", 99)]);
    orderRow(done.id).status = "delivered";
    await book([line(w.dryClean, "Shirt", "men", 1)], {}, w.managerB, w.bob);

    const due = localDate(new Date(heavy.promisedAt));
    const { days } = await CapacityService.getCapacityForecast(scopeOf(w.managerA), {});
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ date: localDate(new Date()), committedKg: 10, expectedOrders: 1, capacity: 100 });
    const busy = days.find((d) => d.date === due) as (typeof days)[number];
    expect(busy).toMatchObject({ committedKg: 60, expectedOrders: 2, utilisationPct: 60, risk: "low" });

    const everyone = await CapacityService.getCapacityForecast(scopeOf(w.admin), {});
    expect(everyone.days[0]).toMatchObject({ capacity: 200 });
    const onlyB = await CapacityService.getCapacityForecast(scopeOf(w.admin), { storeId: w.storeB.id });
    expect(onlyB.days.reduce((n, d) => n + d.expectedOrders, 0)).toBe(1);
    await refused(CapacityService.getCapacityForecast(scopeOf(w.managerA), { storeId: w.storeB.id }), 404);
    await refused(CapacityService.getCapacityForecast(scopeOf(w.admin), { storeId: "11111111-1111-4111-8111-111111111111" }), 404);
  });

  it("uses a store's configured daily capacity instead of the store record's, and flags a full day high", async () => {
    const order = await book([line(w.washFold, "Shirt", "men", 95)]);
    const due = localDate(new Date(order.promisedAt));
    const row = async () => (await CapacityService.getCapacityForecast(scopeOf(w.managerA), {})).days.find((d) => d.date === due);
    expect(await row()).toMatchObject({ utilisationPct: 95, risk: "high" });
    await CapacityService.saveSetting(w.storeA.id, { dailyKg: 200 });
    expect(await row()).toMatchObject({ capacity: 200, utilisationPct: 47.5, risk: "low" });
  });

  it("bounds the window and rejects a bad one", async () => {
    expect((await CapacityService.getCapacityForecast(scopeOf(w.managerA), { days: "3" })).days).toHaveLength(3);
    expect((await CapacityService.getCapacityForecast(scopeOf(w.managerA), { days: "14" })).days).toHaveLength(14);
    for (const days of ["0", "15", "x", "2.5", "-1"]) await refused(CapacityService.getCapacityForecast(scopeOf(w.managerA), { days }), 400, /days must be/);
  });

  it("reports what the plant can take now, from machines and today's load, never inventing staff or riders", async () => {
    const now = new Date();
    const empty = await CapacityService.getCapacityNow(scopeOf(w.managerA), {}, now);
    expect(empty).toMatchObject({ machines: { total: 0, free: 0 }, bottleneck: "none", staff: null, riders: null, expressCanAccept: false });

    const order = await bookSorted();
    const washer = await addMachine(w.storeA.id, "washer", 10, "CW");
    await addMachine(w.storeA.id, "dryer", 6, "CD");
    await addMachine(w.storeA.id, "washer", 10, "CX");
    const batch = await newBatch(w.staffA, piecesOf(order.id).map((p) => p.id), w.dryClean, { machineId: washer.id });
    await ProcessingService.startBatch(batch.id, scopeOf(w.staffA), w.staffA);

    const snapshot = await CapacityService.getCapacityNow(scopeOf(w.managerA), {}, now);
    expect(snapshot.machines).toEqual({ total: 3, busy: 1, free: 2, outOfService: 0 });
    expect(snapshot.bottleneck).toBe("none");
    expect(snapshot.expressCanAccept).toBe(true);
    expect(snapshot.stages).toEqual([
      { key: "washing", name: "Washing", totalKg: 20, usedKg: 10, freeKg: 10 },
      { key: "drying", name: "Drying", totalKg: 6, usedKg: 0, freeKg: 6 },
    ]);
    expect(snapshot).toMatchObject({ bottleneckKey: "drying", acceptableKg: 6 });

    await MachinesService.reportMachineFault((await MachinesService.listMachines(scopeOf(w.staffA), { type: "dryer" })).items[0].id, scopeOf(w.staffA), w.staffA, { description: "x", severity: "stopped" });
    await addMachine(w.storeB.id, "washer");
    const afterFault = await CapacityService.getCapacityNow(scopeOf(w.managerA), {}, now);
    expect(afterFault.machines.outOfService).toBe(1);
    expect(afterFault.stages.map((s) => s.key)).toEqual(["washing"]);
    expect((await CapacityService.getCapacityNow(scopeOf(w.admin), {}, now)).machines.total).toBe(4);
  });

  it("says there is no room when no machine is free, and stops standard intake at the express reserve", async () => {
    const washer = await addMachine(w.storeA.id, "washer");
    const order = await bookSorted();
    const batch = await newBatch(w.staffA, piecesOf(order.id).map((p) => p.id), w.dryClean, { machineId: washer.id });
    expect(await CapacityService.getCapacityNow(scopeOf(w.managerA), {})).toMatchObject({ bottleneck: "machines", expressCanAccept: false, standardCanAccept: false });

    await MachinesService.releaseMachine(washer.id, scopeOf(w.staffA));
    expect(batch.id).toBeTruthy();
    await book([line(w.washFold, "Shirt", "men", 85)]);
    orderRow([...state.orders.keys()].at(-1) as string).promisedAt = new Date(Date.now() + 3_600_000);
    const crowded = await CapacityService.getCapacityNow(scopeOf(w.managerA), {});
    expect(crowded).toMatchObject({ standardCanAccept: false, expressCanAccept: true });
  });

  it("projects an express order's finish from its status and flags those near or past their promise", async () => {
    const now = new Date("2026-10-02T06:00:00Z");
    expect(projectFinish("washing", now).toISOString()).toBe("2026-10-02T18:00:00.000Z");
    expect(projectFinish("packed", now).toISOString()).toBe("2026-10-02T08:00:00.000Z");
    const make = (ref: string, status: string, hours: number) => ({ orderId: ref, ref, storeId: "s", status, promisedAt: new Date(now.getTime() + hours * 3_600_000) });
    const judged = judgeExpress(
      [make("LATE", "booked", 5), make("TIGHT", "washing", 12.5), make("SAFE", "drying", 24), make("PACKED", "packed", 4)],
      now
    );
    expect(judged.map((o) => o.orderNumber)).toEqual(["LATE", "TIGHT"]);
    expect(judged[0]).toMatchObject({ delayMinutes: 17 * 60, stage: "Booked" });
    expect(judged[1].delayMinutes).toBe(-30);
  });

  it("lists express orders at risk for the caller's store, most delayed first, never standard orders", async () => {
    const slow = await book(undefined, { priority: "express" });
    orderRow(slow.id).promisedAt = new Date(Date.now() + 5 * 3_600_000);
    const sorted = await bookSorted(undefined, undefined, { priority: "express" });
    orderRow(sorted.id).promisedAt = new Date(Date.now() + 15 * 3_600_000);
    const comfortable = await book(undefined, { priority: "express" });
    orderRow(comfortable.id).promisedAt = new Date(Date.now() + 60 * 3_600_000);
    const plain = await book();
    orderRow(plain.id).promisedAt = new Date(Date.now() + 3_600_000);
    const elsewhere = await book([line(w.dryClean, "Shirt", "men", 1)], { priority: "express" }, w.managerB, w.bob);
    orderRow(elsewhere.id).promisedAt = new Date(Date.now() + 3_600_000);

    const { orders } = await CapacityService.listExpressAtRisk(scopeOf(w.managerA), {});
    expect(orders.map((o) => o.orderNumber)).toEqual([slow.ref, sorted.ref]);
    expect(orders[0].delayMinutes).toBeGreaterThan(orders[1].delayMinutes);
    expect((await CapacityService.listExpressAtRisk(scopeOf(w.admin), {})).orders).toHaveLength(3);
    expect((await CapacityService.listExpressAtRisk(scopeOf(w.admin), { storeId: w.storeB.id })).orders).toHaveLength(1);
    await refused(CapacityService.listExpressAtRisk(scopeOf(w.managerA), { storeId: w.storeB.id }), 404);
  });

  it("sets a store's capacity for other modules, merging with what is already set", async () => {
    await CapacityService.saveSetting(w.storeA.id, { dailyKg: 300 });
    expect(await CapacityService.saveSetting(w.storeA.id, { expressReservePct: 30 })).toEqual({ storeId: w.storeA.id, dailyKg: 300, expressReservePct: 30 });
    expect(await CapacityService.saveSetting(w.storeA.id, { dailyKg: null })).toMatchObject({ dailyKg: null, expressReservePct: 30 });
    await refused(CapacityService.saveSetting(w.storeA.id, { dailyKg: 0 }), 400, /dailyKg/);
    await refused(CapacityService.saveSetting(w.storeA.id, { dailyKg: 1.5 }), 400, /dailyKg/);
    await refused(CapacityService.saveSetting(w.storeA.id, { expressReservePct: 95 }), 400, /expressReservePct/);
    await refused(CapacityService.saveSetting("11111111-1111-4111-8111-111111111111", { dailyKg: 5 }), 404);
  });
});

describe("who may act, and for which store", () => {
  it("pins store-bound roles to their store, lets admins choose, and gives hr every store", () => {
    expect(resolveStoreScope({ user: w.staffA } as any)).toBe(w.storeA.id);
    expect(resolveStoreScope({ user: { ...w.managerA, scopeStoreId: w.storeB.id } } as any)).toBe(w.storeA.id);
    expect(resolveStoreScope({ user: w.admin } as any)).toBeNull();
    expect(resolveStoreScope({ user: { ...w.admin, scopeStoreId: w.storeB.id } } as any)).toBe(w.storeB.id);
    expect(resolveStoreScope({ user: actor("hr") } as any)).toBeNull();
    expect(() => resolveStoreScope({ user: actor("staff", null) } as any)).toThrow(/not assigned to a store/);
    expect(() => resolveStoreScope({ user: actor("driver") } as any)).toThrow(/permission/);
  });

  it("an hr user sees capacity across stores, a manager only their own", async () => {
    const hr = actor("hr", null, "Hari");
    expect((await CapacityService.getCapacityForecast(scopeOf(hr), {})).days[0].capacity).toBe(200);
    expect((await CapacityService.getCapacityForecast(scopeOf(w.managerA), {})).days[0].capacity).toBe(100);
  });
});
