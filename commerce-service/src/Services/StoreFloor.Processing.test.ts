// Batches and machines: the real services over in-memory Query fakes.
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
jest.mock("../Clients/Dispatch.Client.js", () => ({ DispatchClient: { createDeliveryJob: jest.fn() } }));

import { floor } from "../Testing/InMemoryStoreFloor.js";
import {
  addMachine, book, bookSorted, buildWorld, checkIn, line, newBatch, orderRow, piecesOf, refused, scopeOf, sortAll, w, washAndDry,
} from "../Testing/StoreFloorWorld.js";
import { MachinesService, machineStatus } from "./Machines.Service.js";
import { OrderService } from "./Order.Service.js";
import { ProcessingService, buildSuggestions } from "./Processing.Service.js";

beforeEach(buildWorld);

const ids = (orderId: string) => piecesOf(orderId).map((p) => p.id);
const batchRow = (id: string) => floor.batches.get(id);
const machineRow = (id: string) => floor.machines.get(id);
const stages = (orderId: string) => piecesOf(orderId).map((p) => p.stage);
const start = (id: string, user = w.staffA) => ProcessingService.startBatch(id, scopeOf(user), user);
const complete = (id: string, body: object = {}, user = w.staffA) => ProcessingService.completeBatch(id, scopeOf(user), user, body);

describe("creating a batch", () => {
  it("groups sorted garments into a planned washing batch and claims them", async () => {
    const order = await bookSorted();
    const batch = await newBatch(w.staffA, ids(order.id));
    expect(batch).toMatchObject({ status: "planned", stage: "washing", storeId: w.storeA.id, serviceId: w.dryClean.id, itemCount: 2, machineId: null, createdBy: "Sanjay" });
    expect(batch.items).toHaveLength(2);
    expect(batch.dueAt).toBe(order.promisedAt);
    expect(piecesOf(order.id).every((p) => p.activeBatchId === batch.id)).toBe(true);
  });

  it("can reserve a machine in the same step", async () => {
    const order = await bookSorted();
    const washer = await addMachine(w.storeA.id, "washer");
    const batch = await newBatch(w.staffA, ids(order.id), w.dryClean, { machineId: washer.id });
    expect(batch.machineId).toBe(washer.id);
    expect(machineRow(washer.id)).toMatchObject({ state: "reserved", currentBatchId: batch.id });
  });

  it("refuses garments that are not sorted yet, or already washed", async () => {
    const order = await book();
    await checkIn(order);
    await refused(newBatch(w.staffA, ids(order.id)), 409, /received and cannot be batched/);
  });

  it("refuses a garment already in a batch and creates nothing", async () => {
    const order = await bookSorted();
    await newBatch(w.staffA, ids(order.id));
    const before = floor.batches.size;
    await refused(newBatch(w.staffA, ids(order.id)), 409, /already in a batch/);
    expect(floor.batches.size).toBe(before);
  });

  it("refuses garments of a cancelled order", async () => {
    const order = await bookSorted();
    await OrderService.cancel(order.id, null, w.admin, { reason: "customer left" });
    await refused(newBatch(w.staffA, ids(order.id)), 409, /cancelled/);
  });

  it("refuses garments that were booked for another service", async () => {
    const order = await bookSorted();
    await refused(newBatch(w.staffA, ids(order.id), w.washFold), 409, /not booked for Wash & Fold/);
  });

  it("refuses garments that should not share a load, naming the odd one out", async () => {
    const white = await bookSorted();
    const dark = await bookSorted(undefined, undefined, { care: { colour: "dark" } });
    await refused(newBatch(w.staffA, [...ids(white.id), ...ids(dark.id)]), 409, /colours should not be washed together/);
  });

  it("answers 404 for garments of another store and for an unknown garment", async () => {
    const order = await bookSorted();
    await refused(newBatch(w.staffB, ids(order.id), w.dryClean), 404, /not found/);
    await refused(newBatch(w.staffA, ["11111111-1111-4111-8111-111111111111"]), 404, /not found/);
  });

  it("keeps a store-bound caller to their own store, and makes an admin name one", async () => {
    const order = await bookSorted();
    await refused(ProcessingService.createBatch(scopeOf(w.staffA), w.staffA, { storeId: w.storeB.id, serviceId: w.dryClean.id, orderItemIds: ids(order.id) }), 404);
    await refused(ProcessingService.createBatch(null, w.admin, { serviceId: w.dryClean.id, orderItemIds: ids(order.id) }), 400, /storeId is required/);
    const batch = await ProcessingService.createBatch(scopeOf(w.admin, w.storeA.id), w.admin, { serviceId: w.dryClean.id, orderItemIds: ids(order.id) });
    expect(batch.storeId).toBe(w.storeA.id);
  });

  it.each([
    ["no items", { orderItemIds: [] }, /orderItemIds must list/],
    ["a malformed id", { orderItemIds: ["x"] }, /valid ids/],
    ["the same item twice", { dup: true }, /same item twice/],
    ["a bad serviceId", { serviceId: "x" }, /serviceId/],
    ["a bad machineId", { machineId: "x" }, /machineId/],
    ["a bad dueAt", { dueAt: "tomorrowish" }, /dueAt/],
    ["a service that does not exist", { serviceId: "11111111-1111-4111-8111-111111111111" }, /not offered/],
  ])("rejects %s", async (_label, change: any, message) => {
    const order = await bookSorted();
    const [first] = ids(order.id);
    const body: any = { storeId: w.storeA.id, serviceId: w.dryClean.id, orderItemIds: [first], ...change };
    if (change.dup) body.orderItemIds = [first, first];
    await refused(ProcessingService.createBatch(scopeOf(w.staffA), w.staffA, body), 400, message);
  });

  it("two simultaneous batches over the same garments: exactly one is created", async () => {
    const order = await bookSorted();
    const results = await Promise.allSettled([newBatch(w.staffA, ids(order.id)), newBatch(w.managerA, ids(order.id))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(floor.batches.size).toBe(1);
  });
});

describe("listing and reading batches", () => {
  it("pages, filters and keeps each store to its own", async () => {
    const o1 = await bookSorted();
    const o2 = await bookSorted();
    const b1 = await newBatch(w.staffA, ids(o1.id));
    await newBatch(w.staffA, ids(o2.id));
    const other = await book([line(w.dryClean, "Shirt", "men", 1)], {}, w.managerB, w.bob);
    await checkIn(other, [{ garment: "Shirt", quantity: 1, fabric: "cotton" }], w.staffB);
    await sortAll(other.id, w.staffB);
    await ProcessingService.createBatch(scopeOf(w.staffB), w.staffB, { storeId: w.storeB.id, serviceId: w.dryClean.id, orderItemIds: ids(other.id) });

    const asA = await ProcessingService.listBatches(scopeOf(w.staffA), {});
    expect(asA.total).toBe(2);
    const page = await ProcessingService.listBatches(scopeOf(w.staffA), { limit: "1", page: "2" });
    expect(page).toMatchObject({ page: 2, limit: 1, total: 2 });
    expect(page.items).toHaveLength(1);
    expect((await ProcessingService.listBatches(scopeOf(w.admin), {})).total).toBe(3);
    expect((await ProcessingService.listBatches(scopeOf(w.admin), { storeId: w.storeB.id })).total).toBe(1);
    await refused(ProcessingService.listBatches(scopeOf(w.staffA), { storeId: w.storeB.id }), 404);

    expect((await ProcessingService.listBatches(scopeOf(w.staffA), { status: "finished" })).total).toBe(0);
    expect((await ProcessingService.listBatches(scopeOf(w.staffA), { serviceId: w.washFold.id })).total).toBe(0);
    expect((await ProcessingService.listBatches(scopeOf(w.staffA), { serviceId: w.dryClean.id })).total).toBe(2);
    const earlier = new Date(Date.now() - 3_600_000).toISOString();
    expect((await ProcessingService.listBatches(scopeOf(w.staffA), { dueBefore: earlier })).total).toBe(0);
    expect((await ProcessingService.getBatch(b1.id, scopeOf(w.staffA))).items).toHaveLength(2);
  });

  it("rejects bad filters and caps the page size", async () => {
    await refused(ProcessingService.listBatches(scopeOf(w.staffA), { status: "weird" }), 400, /status/);
    await refused(ProcessingService.listBatches(scopeOf(w.staffA), { serviceId: "x" }), 400, /serviceId/);
    await refused(ProcessingService.listBatches(scopeOf(w.staffA), { dueBefore: "x" }), 400, /dueBefore/);
    await refused(ProcessingService.listBatches(scopeOf(w.staffA), { page: "0" }), 400, /page/);
    expect((await ProcessingService.listBatches(scopeOf(w.staffA), { limit: "1000" })).limit).toBe(100);
  });

  it("answers 404 for another store's batch and for a malformed id", async () => {
    const order = await bookSorted();
    const batch = await newBatch(w.staffA, ids(order.id));
    await refused(ProcessingService.getBatch(batch.id, scopeOf(w.staffB)), 404, /Batch not found/);
    await refused(ProcessingService.getBatch("nope", scopeOf(w.staffA)), 404);
  });
});

describe("batch suggestions", () => {
  it("groups waiting garments that can share a load and are due the same day", async () => {
    await bookSorted();
    await bookSorted();
    await bookSorted(undefined, undefined, { care: { colour: "dark" } });
    const { suggestions } = await ProcessingService.suggestBatches(scopeOf(w.staffA), {});
    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((s) => s.orderItemIds.length).sort()).toEqual([2, 4]);
    expect(suggestions[0]).toMatchObject({ stage: "washing", serviceId: w.dryClean.id });
    expect(suggestions[0].reason).toMatch(/garments for washing/);
  });

  it("leaves out garments already in a batch, and offers washed garments as a drying group", async () => {
    const taken = await bookSorted();
    await bookSorted();
    await newBatch(w.staffA, ids(taken.id));
    expect((await ProcessingService.suggestBatches(scopeOf(w.staffA), {})).suggestions).toHaveLength(1);

    const washed = await bookSorted();
    const washer = await addMachine(w.storeA.id, "washer");
    const batch = await newBatch(w.staffA, ids(washed.id), w.dryClean, { machineId: washer.id });
    await start(batch.id);
    await complete(batch.id);
    const drying = (await ProcessingService.suggestBatches(scopeOf(w.staffA), {})).suggestions.filter((s) => s.stage === "drying");
    expect(drying).toHaveLength(1);
    expect(drying[0].orderItemIds.sort()).toEqual(ids(washed.id).sort());
  });

  it("splits a group larger than a batch, so every suggestion can be created as it stands", () => {
    const base = { serviceId: "s", colour: "white", riskClass: "low", processWash: "w", dueAt: new Date("2026-10-05T10:00:00Z"), tagCode: "T", stage: "sorted" };
    const many = Array.from({ length: 450 }, (_, i) => ({ ...base, id: `p${i}` })) as any[];
    expect(buildSuggestions(many, "washing").map((s) => s.orderItemIds.length)).toEqual([200, 200, 50]);
  });

  it("needs a store for an admin, and keeps others out of other stores", async () => {
    await refused(ProcessingService.suggestBatches(null, {}), 400, /storeId is required/);
    await refused(ProcessingService.suggestBatches(scopeOf(w.staffA), { storeId: w.storeB.id }), 404);
    await refused(ProcessingService.suggestBatches(scopeOf(w.staffA), { storeId: "x" }), 400, /storeId/);
  });
});

describe("changing a planned batch", () => {
  it("adds compatible garments and refuses incompatible, unsorted or foreign ones", async () => {
    const o1 = await bookSorted();
    const o2 = await bookSorted();
    const dark = await bookSorted(undefined, undefined, { care: { colour: "dark" } });
    const raw = await book();
    await checkIn(raw);
    const batch = await newBatch(w.staffA, ids(o1.id));

    const grown = await ProcessingService.addItemsToBatch(batch.id, scopeOf(w.staffA), { orderItemIds: ids(o2.id) });
    expect(grown.itemCount).toBe(4);
    await refused(ProcessingService.addItemsToBatch(batch.id, scopeOf(w.staffA), { orderItemIds: ids(dark.id) }), 409, /colours/);
    await refused(ProcessingService.addItemsToBatch(batch.id, scopeOf(w.staffA), { orderItemIds: ids(raw.id) }), 409, /only takes garments that are sorted/);
    await refused(ProcessingService.addItemsToBatch(batch.id, scopeOf(w.staffA), { orderItemIds: ids(o2.id) }), 409, /already in a batch/);
    await refused(ProcessingService.addItemsToBatch(batch.id, scopeOf(w.staffB), { orderItemIds: ids(dark.id) }), 404);
    expect(piecesOf(dark.id).every((p) => p.activeBatchId === null)).toBe(true);
  });

  it("takes a garment out, and cancels the batch and frees its machine when the last one leaves", async () => {
    const order = await bookSorted();
    const washer = await addMachine(w.storeA.id, "washer");
    const batch = await newBatch(w.staffA, ids(order.id), w.dryClean, { machineId: washer.id });
    const [first, second] = ids(order.id);

    const smaller = await ProcessingService.removeItemFromBatch(batch.id, first, scopeOf(w.staffA));
    expect(smaller).toMatchObject({ itemCount: 1, status: "planned" });
    expect(piecesOf(order.id).find((p) => p.id === first)?.activeBatchId).toBeNull();
    await refused(ProcessingService.removeItemFromBatch(batch.id, first, scopeOf(w.staffA)), 404, /not in this batch/);

    const emptied = await ProcessingService.removeItemFromBatch(batch.id, second, scopeOf(w.staffA));
    expect(emptied).toMatchObject({ status: "cancelled", itemCount: 0, machineId: null });
    expect(machineRow(washer.id)).toMatchObject({ state: "idle", currentBatchId: null });
  });

  it("cannot be changed once started", async () => {
    const order = await bookSorted();
    const spare = await bookSorted();
    const washer = await addMachine(w.storeA.id, "washer");
    const batch = await newBatch(w.staffA, ids(order.id), w.dryClean, { machineId: washer.id });
    await start(batch.id);
    await refused(ProcessingService.addItemsToBatch(batch.id, scopeOf(w.staffA), { orderItemIds: ids(spare.id) }), 409, /in machine batch cannot be changed/);
    await refused(ProcessingService.removeItemFromBatch(batch.id, ids(order.id)[0], scopeOf(w.staffA)), 409, /cannot be changed/);
  });
});

describe("assigning machines", () => {
  it("assigns a free machine of the right kind and refuses the wrong kind", async () => {
    const order = await bookSorted();
    const batch = await newBatch(w.staffA, ids(order.id));
    const dryer = await addMachine(w.storeA.id, "dryer");
    const press = await addMachine(w.storeA.id, "press");
    const washer = await addMachine(w.storeA.id, "washer");
    await refused(ProcessingService.assignBatchMachine(batch.id, scopeOf(w.staffA), { machineId: dryer.id }), 409, /dryer cannot run a washing batch/);
    await refused(ProcessingService.assignBatchMachine(batch.id, scopeOf(w.staffA), { machineId: press.id }), 409, /press cannot run/);
    const done = await ProcessingService.assignBatchMachine(batch.id, scopeOf(w.staffA), { machineId: washer.id });
    expect(done.machineId).toBe(washer.id);
    expect(machineRow(washer.id).state).toBe("reserved");
  });

  it("gives a batch a different machine by releasing the first", async () => {
    const order = await bookSorted();
    const first = await addMachine(w.storeA.id, "washer");
    const second = await addMachine(w.storeA.id, "washer");
    const batch = await newBatch(w.staffA, ids(order.id), w.dryClean, { machineId: first.id });
    await ProcessingService.assignBatchMachine(batch.id, scopeOf(w.staffA), { machineId: second.id });
    expect(machineRow(first.id)).toMatchObject({ state: "idle", currentBatchId: null });
    expect(machineRow(second.id)).toMatchObject({ state: "reserved", currentBatchId: batch.id });
    expect(batchRow(batch.id).machineId).toBe(second.id);
    // Assigning the machine it already has changes nothing.
    await ProcessingService.assignBatchMachine(batch.id, scopeOf(w.staffA), { machineId: second.id });
    expect(machineRow(second.id).state).toBe("reserved");
  });

  it("refuses a machine that is reserved, running or out of service, and leaves the old one in place", async () => {
    const o1 = await bookSorted();
    const o2 = await bookSorted();
    const washer = await addMachine(w.storeA.id, "washer");
    const broken = await addMachine(w.storeA.id, "washer");
    const spare = await addMachine(w.storeA.id, "washer");
    await MachinesService.reportMachineFault(broken.id, scopeOf(w.staffA), w.staffA, { description: "drum jammed", severity: "stopped" });
    const first = await newBatch(w.staffA, ids(o1.id), w.dryClean, { machineId: washer.id });
    const second = await newBatch(w.staffA, ids(o2.id), w.dryClean, { machineId: spare.id });

    await refused(ProcessingService.assignBatchMachine(second.id, scopeOf(w.staffA), { machineId: washer.id }), 409, /already reserved/);
    await refused(ProcessingService.assignBatchMachine(second.id, scopeOf(w.staffA), { machineId: broken.id }), 409, /out of service/);
    expect(batchRow(second.id).machineId).toBe(spare.id);
    expect(machineRow(spare.id).state).toBe("reserved");

    await start(first.id);
    await refused(ProcessingService.assignBatchMachine(second.id, scopeOf(w.staffA), { machineId: washer.id }), 409, /running another batch/);
  });

  it("two staff asking for one machine: exactly one gets it", async () => {
    const o1 = await bookSorted();
    const o2 = await bookSorted();
    const washer = await addMachine(w.storeA.id, "washer");
    const b1 = await newBatch(w.staffA, ids(o1.id));
    const b2 = await newBatch(w.staffA, ids(o2.id));
    const results = await Promise.allSettled([
      ProcessingService.assignBatchMachine(b1.id, scopeOf(w.staffA), { machineId: washer.id }),
      MachinesService.reserveMachine(washer.id, scopeOf(w.staffA), { batchId: b2.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const owner = machineRow(washer.id).currentBatchId;
    expect([b1.id, b2.id]).toContain(owner);
    expect([batchRow(b1.id).machineId, batchRow(b2.id).machineId].filter(Boolean)).toEqual([washer.id]);
  });

  it("will not reach another store's machine or batch", async () => {
    const order = await bookSorted();
    const batch = await newBatch(w.staffA, ids(order.id));
    const foreign = await addMachine(w.storeB.id, "washer");
    await refused(ProcessingService.assignBatchMachine(batch.id, scopeOf(w.staffA), { machineId: foreign.id }), 404, /Machine not found/);
    await refused(ProcessingService.assignBatchMachine(batch.id, scopeOf(w.staffB), { machineId: foreign.id }), 404, /Batch not found/);
    await refused(ProcessingService.assignBatchMachine(batch.id, scopeOf(w.staffA), { machineId: "x" }), 400, /machineId/);
  });
});

describe("starting and completing a batch", () => {
  it("starts atomically: batch, machine, every garment and the order move together", async () => {
    const order = await bookSorted();
    const washer = await addMachine(w.storeA.id, "washer");
    const batch = await newBatch(w.staffA, ids(order.id), w.dryClean, { machineId: washer.id });
    const started = await start(batch.id);

    expect(started.status).toBe("in_machine");
    expect(started.startedAt).not.toBeNull();
    expect(machineRow(washer.id)).toMatchObject({ state: "running", currentBatchId: batch.id });
    expect(machineRow(washer.id).freeAt.getTime()).toBeGreaterThan(Date.now());
    expect(stages(order.id)).toEqual(["washing", "washing"]);
    expect(orderRow(order.id).status).toBe("washing");
    const event = orderRow(order.id).events.at(-1);
    expect(event).toMatchObject({ status: "washing", byName: "Sanjay", byUserId: w.staffA.id });
    expect(event.note).toMatch(/Washing started \(batch/);
  });

  it("refuses to start without a machine, without garments, twice, or after the machine broke", async () => {
    const order = await bookSorted();
    const batch = await newBatch(w.staffA, ids(order.id));
    await refused(start(batch.id), 409, /Assign a machine/);

    const washer = await addMachine(w.storeA.id, "washer");
    await ProcessingService.assignBatchMachine(batch.id, scopeOf(w.staffA), { machineId: washer.id });
    await MachinesService.setMachineState({ machineId: washer.id, state: "maintenance" });
    await refused(start(batch.id), 409, /Assign a machine/);
    await ProcessingService.assignBatchMachine(batch.id, scopeOf(w.staffA), { machineId: (await addMachine(w.storeA.id, "washer")).id });
    await start(batch.id);
    await refused(start(batch.id), 409, /already in machine/);
  });

  it("a start that fails halfway changes nothing", async () => {
    const order = await bookSorted();
    const washer = await addMachine(w.storeA.id, "washer");
    const batch = await newBatch(w.staffA, ids(order.id), w.dryClean, { machineId: washer.id });
    // The machine is taken out of service behind the batch's back: it is no longer reserved for it.
    machineRow(washer.id).state = "faulted";
    await refused(start(batch.id), 409, /no longer reserved/);
    expect(batchRow(batch.id).status).toBe("planned");
    expect(stages(order.id)).toEqual(["sorted", "sorted"]);
    expect(orderRow(order.id).status).toBe("sorted");
  });

  it("two simultaneous starts of one batch: one wins, the other is refused", async () => {
    const order = await bookSorted();
    const washer = await addMachine(w.storeA.id, "washer");
    const batch = await newBatch(w.staffA, ids(order.id), w.dryClean, { machineId: washer.id });
    const results = await Promise.allSettled([start(batch.id), start(batch.id, w.managerA)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(orderRow(order.id).events.filter((e: any) => e.status === "washing")).toHaveLength(1);
  });

  it("completes: garments move to drying, the machine frees, load and notes are kept", async () => {
    const order = await bookSorted();
    const washer = await addMachine(w.storeA.id, "washer", 10);
    const batch = await newBatch(w.staffA, ids(order.id), w.dryClean, { machineId: washer.id });
    await start(batch.id);
    const done = await complete(batch.id, { loadWeightKg: 6.5, notes: "  light load " });
    expect(done).toMatchObject({ status: "finished", loadWeightKg: 6.5, notes: "light load" });
    expect(done.finishedAt).not.toBeNull();
    expect(stages(order.id)).toEqual(["drying", "drying"]);
    expect(piecesOf(order.id).every((p) => p.activeBatchId === null)).toBe(true);
    expect(machineRow(washer.id)).toMatchObject({ state: "idle", currentBatchId: null, freeAt: null });
    expect(orderRow(order.id).status).toBe("drying");
  });

  it("sends garments that are not machine dried straight to quality check", async () => {
    const order = await book();
    await checkIn(order, [{ garment: "Jacket", quantity: 1, fabric: "leather" }]);
    await sortAll(order.id);
    expect(piecesOf(order.id)[0].processDry).toBe("none");
    const washer = await addMachine(w.storeA.id, "washer");
    const batch = await newBatch(w.staffA, ids(order.id), w.dryClean, { machineId: washer.id });
    await start(batch.id);
    await complete(batch.id);
    expect(stages(order.id)).toEqual(["quality_check"]);
    expect(orderRow(order.id).status).toBe("quality_check");
  });

  it("runs a whole order through washing and drying to quality check, one event per step with the actor", async () => {
    const order = await bookSorted();
    await washAndDry(order.id);
    expect(stages(order.id)).toEqual(["quality_check", "quality_check"]);
    expect(orderRow(order.id).events.map((e: any) => e.status)).toEqual(["booked", "picked_up", "received", "sorted", "washing", "drying", "quality_check"]);
    expect(orderRow(order.id).events.slice(3).every((e: any) => e.byName === "Sanjay")).toBe(true);
  });

  it("holds the order back until its slowest garment catches up", async () => {
    const order = await bookSorted();
    const [first, second] = ids(order.id);
    const washer = await addMachine(w.storeA.id, "washer");
    const one = await newBatch(w.staffA, [first], w.dryClean, { machineId: washer.id });
    await start(one.id);
    expect(orderRow(order.id).status).toBe("sorted");
    const two = await newBatch(w.staffA, [second], w.dryClean);
    await ProcessingService.assignBatchMachine(two.id, scopeOf(w.staffA), { machineId: (await addMachine(w.storeA.id, "washer")).id });
    await start(two.id);
    expect(orderRow(order.id).status).toBe("washing");
  });

  it("moves several orders in one batch together", async () => {
    const o1 = await bookSorted();
    const o2 = await bookSorted();
    const washer = await addMachine(w.storeA.id, "washer");
    const batch = await newBatch(w.staffA, [...ids(o1.id), ...ids(o2.id)], w.dryClean, { machineId: washer.id });
    await start(batch.id);
    await complete(batch.id);
    expect([orderRow(o1.id).status, orderRow(o2.id).status]).toEqual(["drying", "drying"]);
  });

  it("does not disturb an order that was cancelled while its batch ran", async () => {
    const order = await bookSorted();
    const washer = await addMachine(w.storeA.id, "washer");
    const batch = await newBatch(w.staffA, ids(order.id), w.dryClean, { machineId: washer.id });
    await start(batch.id);
    await OrderService.cancel(order.id, null, w.admin, { reason: "customer cancelled" });
    await complete(batch.id);
    expect(orderRow(order.id).status).toBe("cancelled");
    expect(batchRow(batch.id).status).toBe("finished");
  });

  it("refuses to complete a batch that is not running, twice, or with an impossible load", async () => {
    const order = await bookSorted();
    const washer = await addMachine(w.storeA.id, "washer", 8);
    const batch = await newBatch(w.staffA, ids(order.id), w.dryClean, { machineId: washer.id });
    await refused(complete(batch.id), 409, /Start the batch/);
    await start(batch.id);
    await refused(complete(batch.id, { loadWeightKg: 9 }), 400, /more than .* can take \(8 kg\)/);
    await refused(complete(batch.id, { loadWeightKg: 0 }), 400, /loadWeightKg/);
    await refused(complete(batch.id, { loadWeightKg: "heavy" }), 400, /loadWeightKg/);
    await refused(complete(batch.id, { notes: "n".repeat(301) }), 400, /notes/);
    await complete(batch.id);
    await refused(complete(batch.id), 409, /already finished/);
  });

  it("answers 404 to another store's staff and to a malformed id", async () => {
    const order = await bookSorted();
    const batch = await newBatch(w.staffA, ids(order.id));
    await refused(start(batch.id, w.staffB), 404);
    await refused(complete(batch.id, {}, w.staffB), 404);
    await refused(start("nope"), 404);
  });
});

describe("machines", () => {
  it("registers a machine once per store and code, refreshing its description but never its state", async () => {
    const washer = await addMachine(w.storeA.id, "washer", 10, "W-1");
    machineRow(washer.id).state = "running";
    const again = await MachinesService.registerMachine({ storeId: w.storeA.id, code: "W-1", name: "Big washer", type: "washer", capacityKg: 14 });
    expect(again).toMatchObject({ id: washer.id, name: "Big washer", capacityKg: 14, state: "running" });
    expect(floor.machines.size).toBe(1);
    await addMachine(w.storeB.id, "washer", 10, "W-1");
    expect(floor.machines.size).toBe(2);
  });

  it.each([
    ["no store", { storeId: undefined }, /storeId/],
    ["an unknown store", { storeId: "11111111-1111-4111-8111-111111111111" }, /Store not found/],
    ["no code", { code: "" }, /code is required/],
    ["a bad type", { type: "boiler" }, /type must be one of/],
    ["no capacity", { capacityKg: undefined }, /capacityKg/],
    ["a negative capacity", { capacityKg: -1 }, /capacityKg/],
    ["a silly cycle time", { cycleMinutes: 1 }, /cycleMinutes/],
  ])("refuses to register with %s", async (_label, change: any, message) => {
    const body = { storeId: w.storeA.id, code: "X", name: "X", type: "washer", capacityKg: 10, ...change };
    await refused(MachinesService.registerMachine(body), message.source.includes("Store not found") ? 404 : 400, message);
  });

  it("maps its state to the contract's status, with finishing for a nearly done run", () => {
    const base: any = { id: "m", storeId: "s", code: "c", name: "n", type: "washer", capacityGrams: 1000, cycleMinutes: 45, currentBatchId: null, reservedUntil: null };
    const now = new Date("2026-10-02T10:00:00Z");
    expect(machineStatus({ ...base, state: "idle", freeAt: null }, now)).toBe("free");
    expect(machineStatus({ ...base, state: "reserved", freeAt: null }, now)).toBe("reserved");
    expect(machineStatus({ ...base, state: "running", freeAt: new Date("2026-10-02T10:30:00Z") }, now)).toBe("running");
    expect(machineStatus({ ...base, state: "running", freeAt: new Date("2026-10-02T10:09:00Z") }, now)).toBe("finishing");
    expect(machineStatus({ ...base, state: "maintenance", freeAt: null }, now)).toBe("out_of_service");
    expect(machineStatus({ ...base, state: "faulted", freeAt: null }, now)).toBe("out_of_service");
  });

  it("lists with filters, paging and store scope, showing today's check and open faults", async () => {
    const w1 = await addMachine(w.storeA.id, "washer", 10, "A-W1");
    const d1 = await addMachine(w.storeA.id, "dryer", 10, "A-D1");
    await addMachine(w.storeB.id, "washer", 10, "B-W1");
    await MachinesService.recordMachineDailyCheck(w1.id, scopeOf(w.staffA), w.staffA, { status: "ok" });
    await MachinesService.reportMachineFault(d1.id, scopeOf(w.staffA), w.staffA, { description: "squeal", severity: "low" });

    const asA = await MachinesService.listMachines(scopeOf(w.staffA), {});
    expect(asA.items.map((m) => m.code)).toEqual(["A-D1", "A-W1"]);
    expect(asA.items.find((m) => m.code === "A-W1")).toMatchObject({ checkedToday: "ok", openFaults: 0, status: "free" });
    expect(asA.items.find((m) => m.code === "A-D1")).toMatchObject({ checkedToday: null, openFaults: 1 });
    expect((await MachinesService.listMachines(scopeOf(w.admin), {})).total).toBe(3);
    expect((await MachinesService.listMachines(scopeOf(w.admin), { storeId: w.storeB.id })).total).toBe(1);
    expect((await MachinesService.listMachines(scopeOf(w.staffA), { type: "dryer" })).total).toBe(1);
    expect((await MachinesService.listMachines(scopeOf(w.staffA), { status: "free", limit: "1", page: "2" })).items).toHaveLength(1);
    expect((await MachinesService.listMachines(scopeOf(w.staffA), { status: "out_of_service" })).total).toBe(0);
    await refused(MachinesService.listMachines(scopeOf(w.staffA), { storeId: w.storeB.id }), 404);
    await refused(MachinesService.listMachines(scopeOf(w.staffA), { status: "busy" }), 400, /status/);
    await refused(MachinesService.listMachines(scopeOf(w.staffA), { type: "boiler" }), 400, /type/);
  });

  it("filters running against finishing by when the run ends", async () => {
    const order = await bookSorted();
    const quick = await MachinesService.registerMachine({ storeId: w.storeA.id, code: "Q", name: "Quick", type: "washer", capacityKg: 10, cycleMinutes: 5 });
    const batch = await newBatch(w.staffA, ids(order.id), w.dryClean, { machineId: quick.id });
    await start(batch.id);
    expect((await MachinesService.listMachines(scopeOf(w.staffA), { status: "finishing" })).total).toBe(1);
    expect((await MachinesService.listMachines(scopeOf(w.staffA), { status: "running" })).total).toBe(0);
    expect((await MachinesService.getMachine(quick.id, scopeOf(w.staffA))).status).toBe("finishing");
  });

  it("lists the machines that are genuinely free, by kind, and those free by a later time", async () => {
    const order = await bookSorted();
    const free = await addMachine(w.storeA.id, "washer", 10, "FREE");
    const busy = await MachinesService.registerMachine({ storeId: w.storeA.id, code: "BUSY", name: "Busy", type: "washer", capacityKg: 10, cycleMinutes: 30 });
    await addMachine(w.storeA.id, "dryer", 10, "DRY");
    const batch = await newBatch(w.staffA, ids(order.id), w.dryClean, { machineId: busy.id });
    await start(batch.id);

    const now = await MachinesService.listAvailableMachines(scopeOf(w.staffA), {});
    expect(now.machines.map((m) => m.name.split(" ")[1])).toEqual(["DRY", "FREE"]);
    expect((await MachinesService.listAvailableMachines(scopeOf(w.staffA), { type: "washer" })).machines.map((m) => m.id)).toEqual([free.id]);
    const later = new Date(Date.now() + 40 * 60_000).toISOString();
    expect((await MachinesService.listAvailableMachines(scopeOf(w.staffA), { type: "washer", at: later })).machines).toHaveLength(2);
    await refused(MachinesService.listAvailableMachines(scopeOf(w.staffA), { at: "never" }), 400, /at must be/);
    await refused(MachinesService.listAvailableMachines(null, {}), 400, /storeId is required/);
    await refused(MachinesService.listAvailableMachines(scopeOf(w.staffA), { storeId: w.storeB.id }), 404);
    await refused(MachinesService.listAvailableMachines(scopeOf(w.admin), { storeId: "11111111-1111-4111-8111-111111111111" }), 404);
  });

  it("answers 404 for another store's machine", async () => {
    const machine = await addMachine(w.storeA.id, "washer");
    await refused(MachinesService.getMachine(machine.id, scopeOf(w.staffB)), 404, /Machine not found/);
    await refused(MachinesService.getMachine("nope", scopeOf(w.staffA)), 404);
    await refused(MachinesService.listMachineDailyChecks(machine.id, scopeOf(w.staffB), {}), 404);
    await refused(MachinesService.recordMachineDailyCheck(machine.id, scopeOf(w.staffB), w.staffB, { status: "ok" }), 404);
    await refused(MachinesService.reportMachineFault(machine.id, scopeOf(w.staffB), w.staffB, { description: "x" }), 404);
    await refused(MachinesService.releaseMachine(machine.id, scopeOf(w.staffB)), 404);
  });

  it("records one daily check per day (a repeat replaces it) and lists them newest first", async () => {
    const machine = await addMachine(w.storeA.id, "washer");
    const first = await MachinesService.recordMachineDailyCheck(machine.id, scopeOf(w.staffA), w.staffA, {
      status: "needs_attention",
      checklist: [{ item: "Door seal", ok: false, note: "torn" }, { item: "Drain", ok: true }],
    });
    expect(first).toMatchObject({ status: "needs_attention", checkedBy: "Sanjay" });
    const second = await MachinesService.recordMachineDailyCheck(machine.id, scopeOf(w.managerA), w.managerA, { status: "ok", note: "fixed" });
    expect(second).toMatchObject({ id: first.id, status: "ok", checkedBy: "Meera Nair" });

    floor.checks.push({ ...floor.checks[0], id: "older", checkDate: new Date("2026-09-01T00:00:00Z") });
    const all = await MachinesService.listMachineDailyChecks(machine.id, scopeOf(w.staffA), {});
    expect(all.total).toBe(2);
    expect(all.items[0].id).toBe(first.id);
    expect((await MachinesService.listMachineDailyChecks(machine.id, scopeOf(w.staffA), { to: "2026-09-30" })).total).toBe(1);
    expect((await MachinesService.listMachineDailyChecks(machine.id, scopeOf(w.staffA), { from: "2026-10-01" })).total).toBeLessThanOrEqual(1);
  });

  it.each([
    ["no status", {}, /status must be one of/],
    ["an unknown status", { status: "fine" }, /status must be one of/],
    ["ok with a failed checklist item", { status: "ok", checklist: [{ item: "Drain", ok: false }] }, /needs_attention/],
    ["a checklist that is not a list", { status: "ok", checklist: "yes" }, /checklist/],
    ["a checklist item without ok", { status: "ok", checklist: [{ item: "Drain" }] }, /ok must be true or false/],
    ["a long note", { status: "ok", note: "n".repeat(301) }, /note/],
  ])("rejects a daily check with %s", async (_label, body, message) => {
    const machine = await addMachine(w.storeA.id, "washer");
    await refused(MachinesService.recordMachineDailyCheck(machine.id, scopeOf(w.staffA), w.staffA, body), 400, message);
  });

  it("rejects bad dates when listing checks", async () => {
    const machine = await addMachine(w.storeA.id, "washer");
    await refused(MachinesService.listMachineDailyChecks(machine.id, scopeOf(w.staffA), { from: "yesterday" }), 400, /from must be a date/);
  });
});

describe("machine faults and reservations", () => {
  it("logs a minor fault and leaves the machine working", async () => {
    const machine = await addMachine(w.storeA.id, "washer");
    const done = await MachinesService.reportMachineFault(machine.id, scopeOf(w.staffA), w.staffA, { description: "slow drain", severity: "low" });
    expect(done.fault).toMatchObject({ severity: "low", status: "open", reportedBy: "Sanjay" });
    expect(done.machine.status).toBe("free");
    const defaulted = await MachinesService.reportMachineFault(machine.id, scopeOf(w.staffA), w.staffA, { description: "noise" });
    expect(defaulted.fault.severity).toBe("medium");
  });

  it.each(["high", "stopped"])("takes the machine out of service on a %s fault, and it cannot be reserved", async (severity) => {
    const order = await bookSorted();
    const machine = await addMachine(w.storeA.id, "washer");
    const batch = await newBatch(w.staffA, ids(order.id));
    const done = await MachinesService.reportMachineFault(machine.id, scopeOf(w.staffA), w.staffA, { description: "smoke", severity });
    expect(done.machine).toMatchObject({ status: "out_of_service", state: "faulted" });
    await refused(MachinesService.reserveMachine(machine.id, scopeOf(w.staffA), { batchId: batch.id }), 409, /out of service/);
    await refused(ProcessingService.assignBatchMachine(batch.id, scopeOf(w.staffA), { machineId: machine.id }), 409, /out of service/);
  });

  it("drops a reservation when the machine breaks, leaving the batch unassigned", async () => {
    const order = await bookSorted();
    const machine = await addMachine(w.storeA.id, "washer");
    const batch = await newBatch(w.staffA, ids(order.id), w.dryClean, { machineId: machine.id });
    await MachinesService.reportMachineFault(machine.id, scopeOf(w.staffA), w.staffA, { description: "dead", severity: "stopped" });
    expect(batchRow(batch.id).machineId).toBeNull();
    expect(machineRow(machine.id)).toMatchObject({ state: "faulted", currentBatchId: null });
  });

  it("keeps a running batch on its broken machine so it can still be completed, and the machine stays down", async () => {
    const order = await bookSorted();
    const machine = await addMachine(w.storeA.id, "washer");
    const batch = await newBatch(w.staffA, ids(order.id), w.dryClean, { machineId: machine.id });
    await start(batch.id);
    await MachinesService.reportMachineFault(machine.id, scopeOf(w.staffA), w.staffA, { description: "leak", severity: "stopped" });
    expect(machineRow(machine.id)).toMatchObject({ state: "faulted", currentBatchId: batch.id });
    await complete(batch.id);
    expect(machineRow(machine.id)).toMatchObject({ state: "faulted", currentBatchId: null });
    expect(stages(order.id)).toEqual(["drying", "drying"]);
  });

  it.each([
    ["no description", {}, /description is required/],
    ["a long description", { description: "d".repeat(501) }, /description/],
    ["an unknown severity", { description: "x", severity: "meh" }, /severity must be one of/],
  ])("rejects a fault with %s", async (_label, body, message) => {
    const machine = await addMachine(w.storeA.id, "washer");
    await refused(MachinesService.reportMachineFault(machine.id, scopeOf(w.staffA), w.staffA, body), 400, message);
  });

  it("reserves for a batch of the same store and releases it, freeing the batch too", async () => {
    const order = await bookSorted();
    const machine = await addMachine(w.storeA.id, "washer");
    const batch = await newBatch(w.staffA, ids(order.id));
    const reserved = await MachinesService.reserveMachine(machine.id, scopeOf(w.staffA), { batchId: batch.id });
    expect(reserved).toMatchObject({ status: "reserved", currentBatchId: batch.id });
    expect(batchRow(batch.id).machineId).toBe(machine.id);

    const released = await MachinesService.releaseMachine(machine.id, scopeOf(w.staffA));
    expect(released.status).toBe("free");
    expect(batchRow(batch.id).machineId).toBeNull();
    // Releasing a free machine is harmless.
    expect((await MachinesService.releaseMachine(machine.id, scopeOf(w.staffA))).status).toBe("free");
  });

  it("refuses to release a running machine, and to reserve for a started or foreign batch", async () => {
    const order = await bookSorted();
    const machine = await addMachine(w.storeA.id, "washer");
    const batch = await newBatch(w.staffA, ids(order.id), w.dryClean, { machineId: machine.id });
    await start(batch.id);
    await refused(MachinesService.releaseMachine(machine.id, scopeOf(w.staffA)), 409, /Complete the batch/);

    const other = await addMachine(w.storeA.id, "washer");
    await refused(MachinesService.reserveMachine(other.id, scopeOf(w.staffA), { batchId: batch.id }), 409, /Only a planned batch/);
    const foreign = await addMachine(w.storeB.id, "washer");
    await refused(MachinesService.reserveMachine(foreign.id, scopeOf(w.staffA), { batchId: batch.id }), 404);
    await refused(MachinesService.reserveMachine(other.id, scopeOf(w.staffA), { batchId: "x" }), 400, /batchId/);
    await refused(MachinesService.reserveMachine(other.id, scopeOf(w.staffA), { batchId: "11111111-1111-4111-8111-111111111111" }), 404, /Batch not found/);
  });

  it("validates the reservation window", async () => {
    const order = await bookSorted();
    const machine = await addMachine(w.storeA.id, "washer");
    const batch = await newBatch(w.staffA, ids(order.id));
    const reserve = (body: object) => MachinesService.reserveMachine(machine.id, scopeOf(w.staffA), { batchId: batch.id, ...body });
    await refused(reserve({ until: "soon" }), 400, /ISO/);
    await refused(reserve({ from: "2026-10-02T10:00:00Z", until: "2026-10-02T09:00:00Z" }), 400, /until must be after from/);
    await refused(reserve({ until: new Date(Date.now() + 30 * 3_600_000).toISOString() }), 400, /within 24 hours/);
    const ok = await reserve({ until: new Date(Date.now() + 3_600_000).toISOString() });
    expect(ok.freeAt).not.toBeNull();
  });

  it("an equipment-register call can take a machine into maintenance and return it, resolving its faults", async () => {
    const machine = await addMachine(w.storeA.id, "washer");
    await MachinesService.reportMachineFault(machine.id, scopeOf(w.staffA), w.staffA, { description: "dead", severity: "stopped" });
    const faults = await MachinesService.listOpenFaults({ storeId: w.storeA.id });
    expect(faults.total).toBe(1);
    expect(faults.items[0]).toMatchObject({ machineId: machine.id, severity: "stopped" });
    expect((await MachinesService.listOpenFaults({ storeId: w.storeB.id })).total).toBe(0);

    const back = await MachinesService.setMachineState({ machineId: machine.id, state: "idle" });
    expect(back.status).toBe("free");
    expect((await MachinesService.listOpenFaults({})).total).toBe(0);

    const down = await MachinesService.setMachineState({ machineId: machine.id, state: "maintenance" });
    expect(down.status).toBe("out_of_service");
    await refused(MachinesService.setMachineState({ machineId: machine.id, state: "running" }), 400, /state must be one of/);
    await refused(MachinesService.setMachineState({ machineId: "11111111-1111-4111-8111-111111111111", state: "idle" }), 404);
    await refused(MachinesService.listOpenFaults({ storeId: "x" }), 400, /storeId/);
  });
});
