// Check-in, care, process choice: the real services over in-memory Query fakes.
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

import { OrderService } from "./Order.Service.js";
import { CheckInService } from "./CheckIn.Service.js";
import { floor } from "../Testing/InMemoryStoreFloor.js";
import {
  book, bookSorted, buildWorld, checkIn, line, newBatch, orderRow, piecesOf, refused, scopeOf, w,
} from "../Testing/StoreFloorWorld.js";

beforeEach(buildWorld);

const statuses = (orderId: string) => orderRow(orderId).events.map((e: any) => e.status);

describe("check-in", () => {
  it("tags every garment with a code unique to its store and numbered from 1 per store", async () => {
    const a1 = await book();
    const a2 = await book([line(w.dryClean, "Saree", "women", 3)]);
    const first = await checkIn(a1);
    const second = await checkIn(a2, [{ garment: "Saree", quantity: 3 }]);
    expect(first.tagsToPrint).toEqual(["BLR-IND-000001", "BLR-IND-000002"]);
    expect(second.tagsToPrint).toEqual(["BLR-IND-000003", "BLR-IND-000004", "BLR-IND-000005"]);

    const b = await book([line(w.dryClean, "Shirt", "men", 1)], {}, w.managerB, w.bob);
    expect((await checkIn(b, [{ garment: "Shirt", quantity: 1 }], w.staffB)).tagsToPrint).toEqual(["BLR-KOR-000001"]);
  });

  it("creates one piece per unit and moves the order to received through each step, by the acting user", async () => {
    const order = await book();
    const result = await checkIn(order, [{ garment: "Shirt", quantity: 2, condition: "stain", fabric: "cotton", careFlags: ["Delicate"], note: "ink on cuff" }]);
    expect(result.orderStatus).toBe("received");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ garment: "Shirt", condition: "stain", fabric: "cotton", stage: "received", orderRef: order.ref, careFlags: ["Delicate"], note: "ink on cuff" });

    expect(statuses(order.id)).toEqual(["booked", "picked_up", "received"]);
    const last = orderRow(order.id).events.at(-1);
    expect(last.byName).toBe("Sanjay");
    expect(last.byUserId).toBe(w.staffA.id);
  });

  it("copies the booking's colour, soil, priority and promise onto each piece", async () => {
    const order = await book(undefined, { priority: "express", care: { colour: "dark", soilLevel: "heavy" } });
    await checkIn(order);
    const piece = piecesOf(order.id)[0];
    expect(piece).toMatchObject({ colour: "dark", soilLevel: "heavy", priority: "express", storeId: w.storeA.id });
    expect(piece.dueAt.toISOString()).toBe(order.promisedAt);
  });

  it("derives each piece's risk from its own fabric, and only an unidentified fabric inherits the booking's risk", async () => {
    const order = await book(undefined, { care: { riskClass: "high" } });
    await checkIn(order, [
      { garment: "Saree", quantity: 1, fabric: "silk" },
      { garment: "Shirt", quantity: 1, fabric: "cotton" },
      { garment: "Mystery", quantity: 1 },
    ]);
    const risk = Object.fromEntries(piecesOf(order.id).map((p) => [p.garment, p.riskClass]));
    expect(risk).toEqual({ Saree: "high", Shirt: "low", Mystery: "high" });
  });

  it("refuses a second check-in, a cancelled order and an order from another store", async () => {
    const order = await book();
    await checkIn(order);
    await refused(checkIn(order), 409, /already been checked in/);

    const cancelled = await book();
    await OrderService.cancel(cancelled.id, null, w.admin, { reason: "customer changed mind" });
    await refused(checkIn(cancelled), 409, /cancelled/);

    const other = await book();
    await refused(checkIn(other, undefined, w.staffB), 404, /Order not found/);
    expect(piecesOf(other.id)).toHaveLength(0);
  });

  it("a failed check-in leaves nothing behind: no pieces, no tags used, status unchanged", async () => {
    const order = await book([line(w.dryClean, "Shirt", "men", 1), line(w.washFold, "Shirt", "men", 1)]);
    await refused(checkIn(order, [{ garment: "Shirt", quantity: 2 }]), 400, /serviceId is required/);
    expect(floor.pieces.size).toBe(0);
    expect(floor.tags.size).toBe(0);
    expect(orderRow(order.id).status).toBe("booked");
  });

  it("needs a serviceId when the order has more than one service, and it must be one of them", async () => {
    const order = await book([line(w.dryClean, "Shirt", "men", 1), line(w.washFold, "Shirt", "men", 1)]);
    await refused(checkIn(order, [{ garment: "Shirt", quantity: 1, serviceId: "11111111-1111-4111-8111-111111111111" }]), 400, /not on this order/);
    const ok = await checkIn(order, [{ garment: "Shirt", quantity: 1, serviceId: w.washFold.id }]);
    expect(ok.items[0].serviceId).toBe(w.washFold.id);
  });

  it.each([
    ["no items", { receivedFrom: "customer" }, /items must list/],
    ["an empty list", { receivedFrom: "customer", items: [] }, /items must list/],
    ["no receivedFrom", { items: [{ garment: "Shirt", quantity: 1 }] }, /receivedFrom must be one of/],
    ["an unknown receivedFrom", { receivedFrom: "courier", items: [{ garment: "Shirt", quantity: 1 }] }, /receivedFrom/],
    ["a bad riderId", { receivedFrom: "rider", riderId: "nope", items: [{ garment: "Shirt", quantity: 1 }] }, /riderId/],
    ["a missing quantity", { receivedFrom: "customer", items: [{ garment: "Shirt" }] }, /quantity is required/],
    ["a zero quantity", { receivedFrom: "customer", items: [{ garment: "Shirt", quantity: 0 }] }, /quantity must be a whole number/],
    ["a fractional quantity", { receivedFrom: "customer", items: [{ garment: "Shirt", quantity: 1.5 }] }, /quantity must be a whole number/],
    ["too large a quantity", { receivedFrom: "customer", items: [{ garment: "Shirt", quantity: 51 }] }, /quantity must be a whole number/],
    ["a weight", { receivedFrom: "customer", items: [{ garment: "Shirt", quantity: 1, weightKg: 2 }] }, /counted, not weighed/],
    ["no garment name", { receivedFrom: "customer", items: [{ quantity: 1 }] }, /garment is required/],
    ["an unknown fabric", { receivedFrom: "customer", items: [{ garment: "Shirt", quantity: 1, fabric: "unobtainium" }] }, /fabric must be one of/],
    ["an unknown condition", { receivedFrom: "customer", items: [{ garment: "Shirt", quantity: 1, condition: "ruined" }] }, /condition must be one of/],
    ["too many care flags", { receivedFrom: "customer", items: [{ garment: "Shirt", quantity: 1, careFlags: Array(11).fill("x") }] }, /careFlags/],
    ["a bad garmentTypeId", { receivedFrom: "customer", items: [{ garment: "Shirt", quantity: 1, garmentTypeId: "x" }] }, /garmentTypeId/],
  ])("rejects %s", async (_label, body, message) => {
    const order = await book();
    await refused(CheckInService.checkIn(order.id, scopeOf(w.staffA), w.staffA, body), 400, message);
    expect(floor.pieces.size).toBe(0);
  });

  it("answers 404 for a malformed or unknown order id", async () => {
    await refused(CheckInService.checkIn("nope", scopeOf(w.staffA), w.staffA, { receivedFrom: "customer", items: [{ garment: "Shirt", quantity: 1 }] }), 404);
  });

  it("lets an admin who chose a store check in, and refuses one who chose another", async () => {
    const order = await book();
    await refused(
      CheckInService.checkIn(order.id, scopeOf(w.admin, w.storeB.id), w.admin, { receivedFrom: "customer", items: [{ garment: "Shirt", quantity: 1 }] }),
      404
    );
    const ok = await CheckInService.checkIn(order.id, scopeOf(w.admin, w.storeA.id), w.admin, { receivedFrom: "customer", items: [{ garment: "Shirt", quantity: 2 }] });
    expect(ok.tagsToPrint).toHaveLength(2);
  });

  it("two simultaneous check-ins of one order produce one set of pieces", async () => {
    const order = await book();
    const results = await Promise.allSettled([checkIn(order), checkIn(order)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(piecesOf(order.id)).toHaveLength(2);
  });
});

describe("adding, editing and removing garments", () => {
  it("adds a garment between check-in and washing, with the next tag", async () => {
    const order = await book();
    await checkIn(order);
    const added = await CheckInService.addItem(order.id, scopeOf(w.staffA), w.staffA, { garment: "Scarf", fabric: "wool", quantity: 2 });
    expect(added.tagsToPrint).toEqual(["BLR-IND-000003", "BLR-IND-000004"]);
    expect(added.items[0]).toMatchObject({ garment: "Scarf", risk: "high", serviceId: w.dryClean.id });
  });

  it("sends a sorted order back to received when a new, unsorted garment arrives", async () => {
    const order = await bookSorted();
    expect(orderRow(order.id).status).toBe("sorted");
    await CheckInService.addItem(order.id, scopeOf(w.staffA), w.staffA, { garment: "Scarf" });
    expect(orderRow(order.id).status).toBe("received");
    const back = orderRow(order.id).events.at(-1);
    expect(back).toMatchObject({ status: "received", byName: "Sanjay" });
    expect(back.note).toMatch(/added after check-in/);
  });

  it("refuses to add once washing has started, before check-in, or for another store", async () => {
    const order = await book();
    await refused(CheckInService.addItem(order.id, scopeOf(w.staffA), w.staffA, { garment: "Scarf" }), 409, /between check-in and the start of washing/);
    await checkIn(order);
    await refused(CheckInService.addItem(order.id, scopeOf(w.staffB), w.staffB, { garment: "Scarf" }), 404);
    orderRow(order.id).status = "washing";
    await refused(CheckInService.addItem(order.id, scopeOf(w.staffA), w.staffA, { garment: "Scarf" }), 409, /new order/);
  });

  it("validates the added garment and refuses to price or weigh it", async () => {
    const order = await book();
    await checkIn(order);
    const add = (body: unknown) => CheckInService.addItem(order.id, scopeOf(w.staffA), w.staffA, body);
    await refused(add({}), 400, /garment is required/);
    await refused(add({ garment: "Scarf", weightKg: 1 }), 400, /counted, not weighed/);
    await refused(add({ garment: "Scarf", quantity: 0 }), 400, /quantity/);
  });

  it("edits only the whitelisted fields and recomputes risk when the fabric changes", async () => {
    const order = await book();
    await checkIn(order);
    const [piece] = piecesOf(order.id);
    const updated = await CheckInService.updateItem(order.id, piece.id, scopeOf(w.staffA), w.staffA, {
      fabric: "wool",
      condition: "tear",
      stage: "packed",
      tagCode: "HACK",
      riskClass: "low",
    });
    expect(updated).toMatchObject({ fabric: "wool", condition: "tear", risk: "high", stage: "received" });
    expect(updated.tagCode).toBe(piece.tagCode);
  });

  it("returns a sorted garment to received (and the order with it) when its care details change", async () => {
    const order = await bookSorted();
    const [piece] = piecesOf(order.id);
    const updated = await CheckInService.updateItem(order.id, piece.id, scopeOf(w.staffA), w.staffA, { careFlags: ["hand_wash"] });
    expect(updated).toMatchObject({ stage: "received", process: null });
    expect(orderRow(order.id).status).toBe("received");
    await refused(CheckInService.updateItem(order.id, piece.id, scopeOf(w.staffA), w.staffA, {}), 400, /at least one of/);
    await refused(CheckInService.updateItem(order.id, piece.id, scopeOf(w.staffA), w.staffA, { condition: "burnt" }), 400, /condition/);
  });

  it("refuses to edit or remove a garment that is in a batch or past sorting", async () => {
    const order = await bookSorted();
    const ids = piecesOf(order.id).map((p) => p.id);
    await newBatch(w.staffA, ids);
    await refused(CheckInService.updateItem(order.id, ids[0], scopeOf(w.staffA), w.staffA, { note: "x" }), 409, /Washing has started/);
    await refused(CheckInService.removeItem(order.id, ids[0], scopeOf(w.staffA), w.staffA), 409, /Washing has started/);
  });

  it("removes a garment and lets the order move on when the rest were already sorted", async () => {
    const order = await book();
    await checkIn(order);
    const [first, second] = piecesOf(order.id);
    const process = { wash: "Warm cotton 40°C", dry: "Medium tumble", overrideReason: "customer asked" };
    await CheckInService.setItemProcess(order.id, first.id, scopeOf(w.staffA), w.staffA, process);
    expect(orderRow(order.id).status).toBe("received");
    const removed = await CheckInService.removeItem(order.id, second.id, scopeOf(w.staffA), w.staffA);
    expect(removed).toMatchObject({ id: second.id, removed: true });
    expect(orderRow(order.id).status).toBe("sorted");
    expect(piecesOf(order.id)).toHaveLength(1);
  });

  it("answers 404 for a garment on another order or in another store", async () => {
    const one = await book();
    const two = await book();
    await checkIn(one);
    await checkIn(two);
    const [onTwo] = piecesOf(two.id);
    await refused(CheckInService.updateItem(one.id, onTwo.id, scopeOf(w.staffA), w.staffA, { note: "x" }), 404, /Item not found/);
    await refused(CheckInService.removeItem(two.id, onTwo.id, scopeOf(w.staffB), w.staffB), 404);
    await refused(CheckInService.getProcessSuggestion(two.id, onTwo.id, scopeOf(w.staffB)), 404);
  });
});

describe("process choice", () => {
  it("suggests from the fabric, colour and flags, and records the staff's choice as sorted", async () => {
    const order = await book(undefined, { care: { colour: "dark" } });
    await checkIn(order, [{ garment: "Shirt", quantity: 1, fabric: "cotton", careFlags: ["delicate"] }]);
    const [piece] = piecesOf(order.id);
    const suggestion = await CheckInService.getProcessSuggestion(order.id, piece.id, scopeOf(w.staffA));
    expect(suggestion.recommended).toMatchObject({ temperatureC: 30, cycle: "delicate", wash: "Warm cotton 30°C" });

    const set = await CheckInService.setItemProcess(order.id, piece.id, scopeOf(w.staffA), w.staffA, {
      wash: suggestion.recommended.wash,
      dry: suggestion.recommended.dry,
      temperatureC: 30,
      cycle: "delicate",
    });
    expect(set.stage).toBe("sorted");
    expect(set.process).toMatchObject({ wash: "Warm cotton 30°C", overridden: false, overrideReason: null, setBy: "Sanjay" });
  });

  it("moves the order to sorted only when every garment has its process", async () => {
    const order = await book();
    await checkIn(order);
    const [first, second] = piecesOf(order.id);
    const choose = (id: string) => CheckInService.setItemProcess(order.id, id, scopeOf(w.staffA), w.staffA, { wash: "Warm cotton 40°C", dry: "Medium tumble", overrideReason: "x" });
    await choose(first.id);
    expect(orderRow(order.id).status).toBe("received");
    await choose(second.id);
    expect(orderRow(order.id).status).toBe("sorted");
    expect(orderRow(order.id).events.at(-1)).toMatchObject({ status: "sorted", byName: "Sanjay" });
  });

  it("requires a reason to depart from the suggestion, and stores it with the suggestion it overrode", async () => {
    const order = await book();
    await checkIn(order, [{ garment: "Shirt", quantity: 1, fabric: "cotton" }]);
    const [piece] = piecesOf(order.id);
    const choose = (body: object) => CheckInService.setItemProcess(order.id, piece.id, scopeOf(w.staffA), w.staffA, body);

    await refused(choose({ wash: "Hot wash 60°C", dry: "Medium tumble" }), 400, /overrideReason is required/);
    expect(piecesOf(order.id)[0].stage).toBe("received");

    const done = await choose({ wash: "Hot wash 60°C", dry: "Medium tumble", temperatureC: 60, overrideReason: "oil stains" });
    expect(done.process).toMatchObject({ wash: "Hot wash 60°C", overridden: true, overrideReason: "oil stains" });
    expect(piecesOf(order.id)[0]).toMatchObject({ suggestedWash: "Warm cotton 40°C", suggestedDry: "Medium tumble" });
  });

  it("does not store a reason when the choice matches the suggestion", async () => {
    const order = await book();
    await checkIn(order, [{ garment: "Shirt", quantity: 1, fabric: "cotton" }]);
    const [piece] = piecesOf(order.id);
    const done = await CheckInService.setItemProcess(order.id, piece.id, scopeOf(w.staffA), w.staffA, { wash: "Warm cotton 40°C", dry: "Medium tumble", overrideReason: "not needed" });
    expect(done.process).toMatchObject({ overridden: false, overrideReason: null });
  });

  it.each([
    ["no wash", { dry: "Flat dry" }, /wash is required/],
    ["no dry", { wash: "Warm" }, /dry is required/],
    ["a negative temperature", { wash: "x", dry: "y", temperatureC: -1 }, /temperatureC/],
    ["a boiling temperature", { wash: "x", dry: "y", temperatureC: 120 }, /temperatureC/],
    ["a fractional temperature", { wash: "x", dry: "y", temperatureC: 30.5 }, /temperatureC/],
    ["an over-long reason", { wash: "x", dry: "y", overrideReason: "r".repeat(301) }, /overrideReason/],
  ])("rejects %s", async (_label, body, message) => {
    const order = await book();
    await checkIn(order);
    const [piece] = piecesOf(order.id);
    await refused(CheckInService.setItemProcess(order.id, piece.id, scopeOf(w.staffA), w.staffA, body), 400, message);
  });

  it("locks the process once the garment is in a batch", async () => {
    const order = await bookSorted();
    const [piece, other] = piecesOf(order.id);
    await newBatch(w.staffA, [piece.id, other.id]);
    await refused(
      CheckInService.setItemProcess(order.id, piece.id, scopeOf(w.staffA), w.staffA, { wash: "Warm cotton 40°C", dry: "Medium tumble" }),
      409,
      /Washing has started/
    );
  });

  it("keeps a store's garments private: another store's staff cannot read or set their process", async () => {
    const order = await bookSorted();
    const [piece] = piecesOf(order.id);
    await refused(CheckInService.setItemProcess(order.id, piece.id, scopeOf(w.staffB), w.staffB, { wash: "a", dry: "b", overrideReason: "x" }), 404);
  });
});

describe("care summary and fabric rules", () => {
  it("is empty for a normal order", async () => {
    const order = await book();
    await checkIn(order, [{ garment: "Shirt", quantity: 2, fabric: "cotton" }]);
    const summary = await CheckInService.careSummary(order.id, scopeOf(w.staffA));
    expect(summary.flagged).toBe(false);
    expect(summary.items).toEqual([]);
  });

  it("lists only the flagged garments, with the booking's and rider's notes", async () => {
    const order = await book(undefined, { care: { riderNote: "button missing", flags: ["rider saw stain"] } });
    await checkIn(order, [
      { garment: "Saree", quantity: 1, fabric: "silk", careFlags: ["delicate"] },
      { garment: "Shirt", quantity: 1, fabric: "cotton" },
    ]);
    const summary = await CheckInService.careSummary(order.id, scopeOf(w.staffA));
    expect(summary.flagged).toBe(true);
    expect(summary.order).toMatchObject({ riderNotes: "button missing", flags: ["rider saw stain"] });
    expect(summary.items).toHaveLength(1);
    expect(summary.items[0]).toMatchObject({ name: "Saree", risk: "high", flags: ["delicate"], riderNotes: "button missing", photos: [] });
  });

  it("flags an order before check-in from its booked care profile, and hides it from other stores", async () => {
    const order = await book(undefined, { care: { riskClass: "high" } });
    expect((await CheckInService.careSummary(order.id, scopeOf(w.staffA))).flagged).toBe(true);
    await refused(CheckInService.careSummary(order.id, scopeOf(w.staffB)), 404);
    await refused(CheckInService.careSummary("nope", scopeOf(w.staffA)), 404);
  });

  it("lists the fabric rules paged, filtered by fabric", async () => {
    const all = await CheckInService.listFabricRules({});
    expect(all).toMatchObject({ page: 1, limit: 20, total: 9 });
    expect(all.items.map((r) => r.fabric)).toEqual(["blend", "cotton", "denim", "leather", "linen", "silk", "synthetic", "unknown", "wool"]);

    const second = await CheckInService.listFabricRules({ page: "2", limit: "4" });
    expect(second.items.map((r) => r.fabric)).toEqual(["linen", "silk", "synthetic", "unknown"]);
    expect(second.total).toBe(9);

    const wool = await CheckInService.listFabricRules({ fabric: "wool" });
    expect(wool.items).toHaveLength(1);
    expect(wool.items[0]).toMatchObject({ risk: "high", recommendedDry: "Flat dry" });
  });

  it("caps the page size and rejects bad paging and fabrics", async () => {
    expect((await CheckInService.listFabricRules({ limit: "500" })).limit).toBe(100);
    await refused(CheckInService.listFabricRules({ page: "0" }), 400, /page/);
    await refused(CheckInService.listFabricRules({ limit: "x" }), 400, /limit/);
    await refused(CheckInService.listFabricRules({ fabric: "tin" }), 400, /fabric/);
  });
});