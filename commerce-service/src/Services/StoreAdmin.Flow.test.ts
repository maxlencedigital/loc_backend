import { CustomException } from "../../commons/Exception/CustomException.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { IPricingList } from "../Models/Catalog/Catalog.Interface.js";

// The Query modules are replaced by one in-memory fake (src/Testing/InMemoryStoreAdmin.ts);
// every service, the pricing ranking and the day-close rules below are the real code.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/Store.Query.js", () => ({ StoreQuery: require("../Testing/InMemoryStoreAdmin.js").storeQuery }));
jest.mock("../Queries/Order.Query.js", () => ({ OrderQuery: require("../Testing/InMemoryStoreAdmin.js").orderQuery }));
jest.mock("../Queries/StoreCash.Query.js", () => ({ StoreCashQuery: require("../Testing/InMemoryStoreAdmin.js").cashQuery }));
jest.mock("../Queries/StoreStock.Query.js", () => ({ StoreStockQuery: require("../Testing/InMemoryStoreAdmin.js").stockQuery }));
jest.mock("../Queries/StoreAdmin.Query.js", () => ({ StoreAdminQuery: require("../Testing/InMemoryStoreAdmin.js").areaQuery }));
jest.mock("../Queries/Pricing.Query.js", () => ({ PricingQuery: require("../Testing/InMemoryStoreAdmin.js").pricingQuery }));
jest.mock("../Queries/PricingOverlay.Query.js", () => ({
  GLOBAL_SCOPE_ID: "00000000-0000-0000-0000-000000000000",
  PricingOverlayQuery: require("../Testing/InMemoryStoreAdmin.js").overlayQuery,
}));
jest.mock("../Queries/Catalog.Query.js", () => ({ CatalogQuery: require("../Testing/InMemoryStoreAdmin.js").catalogQuery }));
jest.mock("../Queries/StoreSignals.Query.js", () => ({ StoreSignalsQuery: {} }));

import crypto from "crypto";
import { reset, seedStore, state } from "../Testing/InMemoryStoreAdmin.js";
import { garmentTypeIdOf } from "../Utils/GarmentTypeId.js";
import { AdminStoresService } from "./AdminStores.Service.js";
import { priceOrder, rankLists } from "./OrderPricing.js";
import { PricingService } from "./Pricing.Service.js";
import { StoreCashService } from "./StoreCash.Service.js";
import { StoreService } from "./Store.Service.js";
import { StoreStockService, stockLevel } from "./StoreStock.Service.js";

const NOW = new Date("2026-10-02T06:00:00Z"); // 11:30 in India, so the business day is 2026-10-02
const TODAY = "2026-10-02";

const user = (role: RequestUser["role"], storeId: string | null = null, name = "Meera"): RequestUser => ({
  id: `${role}-1`,
  role,
  storeId,
  scopeStoreId: null,
  name,
});

let storeA: any;
let storeB: any;
let managerA: RequestUser;
let admin: RequestUser;

beforeEach(() => {
  reset();
  storeA = seedStore({ code: "BLR-IND" });
  storeB = seedStore({ code: "BLR-KOR" });
  managerA = user("manager", storeA.id);
  admin = user("admin");
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const refused = async (promise: Promise<unknown>, status: number, message?: RegExp) => {
  try {
    await promise;
  } catch (error) {
    expect((error as CustomException).errorCode).toBe(status);
    if (message) expect((error as CustomException).displayMessage).toMatch(message);
    return;
  }
  throw new Error("expected the call to be refused");
};

// -------------------------------------------------------------------- cash
const sales = (storeId: string, date: string, paise: number) => state.cashSales.set(`${storeId}|${date}`, paise);
const count = (amount: number, extra: Record<string, unknown> = {}, who = managerA, store = storeA) =>
  StoreCashService.countCash(who.storeId, who, store.id, { date: TODAY, countedAmount: amount, ...extra }, NOW);
const deposit = (amount: number, ref: string, who = managerA) =>
  StoreCashService.recordCashDeposit(who.storeId, who, storeA.id, { amount, bankReference: ref }, NOW);
const close = (body: Record<string, unknown> = {}, who = managerA) =>
  StoreCashService.closeStoreDay(who.storeId, who, storeA.id, { date: TODAY, ...body }, NOW);

describe("counting the day's cash", () => {
  it("expects the paid counter sales of the day and reports the difference in rupees", async () => {
    sales(storeA.id, TODAY, 150_000);
    expect(await count(1480)).toMatchObject({ expected: 1500, counted: 1480, variance: -20, date: TODAY });
  });

  it("checks denominations add up to the counted amount", async () => {
    expect(await count(1100, { denominations: { 500: 2, 100: 1 } })).toMatchObject({ counted: 1100 });
    await refused(count(1100, { denominations: { 500: 2 } }), 400, /do not add up/);
    await refused(count(30, { denominations: { 30: 1 } }), 400, /not a denomination/);
  });

  it.each([
    [{ date: undefined }, /date must be/],
    [{ date: "2026-10-03" }, /future/],
    [{ date: "2026-08-01" }, /days ago/],
    [{ date: "2026-02-30" }, /real calendar date/],
    [{ countedAmount: -5 }, /zero or more/],
    [{ countedAmount: 10.123 }, /two decimals/],
    [{ countedAmount: "ten" }, /zero or more/],
  ])("refuses %j", async (override, message) => {
    await refused(
      StoreCashService.countCash(storeA.id, managerA, storeA.id, { date: TODAY, countedAmount: 10, ...override }, NOW),
      400,
      message
    );
  });

  it("a recount replaces the earlier difference instead of piling up", async () => {
    sales(storeA.id, TODAY, 100_000);
    await count(900);
    await count(1000);
    const open = state.variances.filter((v: any) => v.status === "open");
    expect(open).toHaveLength(0);
    expect(state.counts).toHaveLength(2); // counts themselves are never rewritten
    await count(950);
    expect(state.variances.filter((v: any) => v.status === "open").map((v: any) => v.amountPaise)).toEqual([-5000]);
  });

  it("answers 404 to a manager of another store, and for an unknown store", async () => {
    await refused(count(10, {}, user("manager", storeB.id), storeA), 404);
    await refused(StoreCashService.countCash(null, admin, crypto.randomUUID(), { date: TODAY, countedAmount: 1 }, NOW), 404);
  });
});

describe("bank deposits", () => {
  it("need a count first and can never exceed it", async () => {
    await refused(deposit(100, "R1"), 409, /Count the cash/);
    await count(1000);
    expect(await deposit(600, "R1")).toMatchObject({ amount: 600, bankReference: "R1" });
    await refused(deposit(500, "R2"), 409, /more than the cash counted/);
    await refused(deposit(100, "R1"), 409, /already recorded/);
  });
});

describe("closing the day", () => {
  it("is refused until counted, banked and settled", async () => {
    await refused(close(), 409, /count for the day is still missing/);
    sales(storeA.id, TODAY, 100_000);
    await count(1000);
    sales(storeA.id, TODAY, 120_000); // a sale rung up after the count
    await refused(close(), 409, /after the last cash count/);
    await count(1200);
    await refused(close(), 409, /bank deposit/);
  });

  it("needs a note when the difference is above the tolerance, and then explains the variance", async () => {
    sales(storeA.id, TODAY, 100_000);
    await count(850); // Rs 150 short, tolerance is Rs 100
    await deposit(850, "R1");
    await refused(close(), 409, /Add notes/);
    const closed = await close({ notes: "Refund paid from the till" });
    expect(closed).toMatchObject({ state: "closed", variance: -150, notes: "Refund paid from the till", alreadyClosed: false });
    expect(state.variances.map((v: any) => v.status)).toEqual(["explained"]);
  });

  it("closes without a note inside the tolerance", async () => {
    sales(storeA.id, TODAY, 100_000);
    await count(950);
    await deposit(950, "R1");
    expect(await close()).toMatchObject({ state: "closed", variance: -50 });
  });

  it("is repeatable and locks the day against more counts and deposits", async () => {
    await count(0);
    const first = await close({ notes: "first" });
    const again = await close({ notes: "second" }, user("manager", storeA.id, "Someone else"));
    expect(again).toMatchObject({ alreadyClosed: true, closedBy: first.closedBy, notes: "first" });
    await refused(count(5), 409, /day is closed/);
    await refused(deposit(5, "R9"), 409, /day is closed/);
  });

  it("closes once when two managers close at the same moment", async () => {
    await count(0);
    const results = await Promise.all([close(), close()]);
    expect(results.map((r) => r.alreadyClosed).sort()).toEqual([false, true]);
  });

  it("reports whether the day is counted, banked and closed", async () => {
    sales(storeA.id, TODAY, 100_000);
    await count(1000);
    await deposit(1000, "R1");
    expect(await StoreCashService.getStoreDayStatus(storeA.id, storeA.id, {}, NOW)).toMatchObject({
      date: TODAY, counted: true, banked: true, closed: false, expected: 1000, variance: 0,
    });
    await close();
    expect(await StoreCashService.getStoreDayStatus(storeA.id, storeA.id, { date: TODAY }, NOW)).toMatchObject({ closed: true });
  });
});

// ------------------------------------------------------------------- stock
describe("stock", () => {
  beforeEach(() => {
    state.materialId = crypto.randomUUID();
    state.stock.set(`${storeA.id}|${state.materialId}`, 10_000);
  });
  const move = (body: Record<string, unknown>) =>
    StoreStockService.recordMovement(storeA.id, state.materialId, { actor: { name: "Ops" }, ...body });

  it("grades the level from the reorder level", () => {
    expect([0, 400, 500, 1000, 1001].map((q) => stockLevel(q, 1000))).toEqual(["out", "critical", "critical", "low", "ok"]);
    expect(stockLevel(5, 0)).toBe("ok");
  });

  it("never takes more than is on hand, even for two simultaneous consumptions", async () => {
    const results = await Promise.allSettled([move({ kind: "consumption", quantity: 6 }), move({ kind: "consumption", quantity: 6 })]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(state.stock.get(`${storeA.id}|${state.materialId}`)).toBe(4000);
  });

  it("returns the first result when a movement is retried with the same key", async () => {
    const first = await move({ kind: "receipt", quantity: 2.5, idempotencyKey: "k1" });
    const replay = await move({ kind: "receipt", quantity: 2.5, idempotencyKey: "k1" });
    expect(replay.id).toBe(first.id);
    expect(state.stock.get(`${storeA.id}|${state.materialId}`)).toBe(12_500);
  });

  it("validates the movement and the items it names", async () => {
    await refused(move({ kind: "burn", quantity: 1 }), 400);
    await refused(move({ kind: "consumption", quantity: 0 }), 400);
    await refused(move({ kind: "correction", quantity: 1, direction: "increase" }), 400, /reason/);
    await refused(StoreStockService.recordMovement(storeA.id, crypto.randomUUID(), { kind: "receipt", quantity: 1, actor: { name: "x" } }), 404);
    await refused(move({ kind: "consumption", quantity: 99 }), 409, /more than the stock/);
  });

  it("lets the floor flag a material, and refuses another store's item or a bad level", async () => {
    state.stockRows = [{ id: state.materialId, name: "Detergent", category: "detergent", unit: "kg", quantityMilli: 9000, reorderLevelMilli: 1000, updatedAt: NOW, flagLevel: null }];
    const alert = await StoreStockService.flagLowStock(storeA.id, managerA, storeA.id, state.materialId, { level: "critical", note: "Last drum" });
    expect(alert).toMatchObject({ level: "critical", raisedBy: "Meera", note: "Last drum" });
    await refused(StoreStockService.flagLowStock(storeA.id, managerA, storeA.id, state.materialId, { level: "huge" }), 400);
    await refused(StoreStockService.flagLowStock(storeB.id, user("manager", storeB.id), storeA.id, state.materialId, { level: "low" }), 404);
  });
});

// ----------------------------------------------------------------- pricing
const SERVICE = crypto.randomUUID();
const SHIRT = garmentTypeIdOf("men", "Shirt");
const SAREE = garmentTypeIdOf("women", "Saree");

describe("price overrides", () => {
  beforeEach(() => {
    state.serviceId = SERVICE;
    state.garmentTypes = [
      { garmentTypeId: SHIRT, garment: "Shirt", category: "men" },
      { garmentTypeId: SAREE, garment: "Saree", category: "women" },
    ];
  });
  const setStore = (overrides: unknown[], who = admin) => PricingService.setStorePricing(null, who, storeA.id, { overrides });

  it("records who, when, old and new for each change, leaves unchanged rows alone, and clears the cache", async () => {
    await setStore([{ serviceId: SERVICE, garmentTypeId: SHIRT, price: 70 }]);
    expect(state.invalidations).toBe(1);
    expect(state.history).toMatchObject([{ scope: "store", fromPaise: null, toPaise: 7000, byName: "Meera" }]);

    const idBefore = state.overrides[0].id;
    await setStore([{ serviceId: SERVICE, garmentTypeId: SHIRT, price: 70 }, { serviceId: SERVICE, garmentTypeId: SAREE, price: 200 }]);
    expect(state.overrides.find((o: any) => o.garmentTypeId === SHIRT).id).toBe(idBefore);
    expect(state.history).toHaveLength(2); // only the new saree row was a change

    await setStore([{ serviceId: SERVICE, garmentTypeId: SHIRT, price: 65.5 }]);
    expect(state.history.slice(2).map((h: any) => [h.fromPaise, h.toPaise])).toEqual(expect.arrayContaining([[7000, 6550], [20000, null]]));
    expect(state.overrides).toHaveLength(1);
  });

  it("derives the express price unless one is given, and refuses bad prices and unknown items", async () => {
    await setStore([{ serviceId: SERVICE, garmentTypeId: SHIRT, price: 100 }]);
    expect(state.overrides[0].expressRatePaise).toBe(14_500);
    await refused(setStore([{ serviceId: SERVICE, garmentTypeId: SHIRT, price: 100, expressPrice: 90 }]), 400, /expressPrice/);
    await refused(setStore([{ serviceId: SERVICE, garmentTypeId: SHIRT, price: 0 }]), 400, /price/);
    await refused(setStore([{ serviceId: SERVICE, garmentTypeId: SHIRT, price: 1.234 }]), 400, /two decimals/);
    await refused(setStore([{ serviceId: crypto.randomUUID(), garmentTypeId: SHIRT, price: 5 }]), 400, /unknown service/);
    await refused(setStore([{ serviceId: SERVICE, garmentTypeId: crypto.randomUUID(), price: 5 }]), 400, /unknown garment/);
    await refused(setStore([{ serviceId: SERVICE, garmentTypeId: SHIRT, price: 5 }, { serviceId: SERVICE, garmentTypeId: SHIRT, price: 6 }]), 400, /twice/);
    await refused(PricingService.setStorePricing(null, admin, storeA.id, {}), 400);
  });

  it("answers 404 for a store outside the caller's scope and for an unknown override", async () => {
    await refused(PricingService.setStorePricing(storeB.id, admin, storeA.id, { overrides: [] }), 404);
    await refused(PricingService.removeStorePriceOverride(null, admin, storeA.id, crypto.randomUUID()), 404);
    await setStore([{ serviceId: SERVICE, garmentTypeId: SHIRT, price: 70 }]);
    const removed = await PricingService.removeStorePriceOverride(null, admin, storeA.id, state.overrides[0].id);
    expect(removed.removed).toBe(true);
    expect(state.history.at(-1)).toMatchObject({ fromPaise: 7000, toPaise: null });
  });

  it("refuses a start date in the future", async () => {
    await refused(PricingService.setGlobalPricing(admin, { items: [], effectiveFrom: "2026-10-09" }, NOW), 400, /later date/);
  });
});

describe("the price hierarchy in order pricing", () => {
  const service: any = { id: SERVICE, name: "Dry Clean", unit: "piece", active: true, expressAvailable: true };
  const list = (name: string, rows: [string, string, number][], extra: Partial<IPricingList> = {}): IPricingList => ({
    id: name,
    name,
    storeId: null,
    customerType: null,
    rows: rows.map(([garment, category, rate]) => ({ serviceId: SERVICE, garment, category: category as any, ratePaise: rate, expressRatePaise: Math.round(rate * 1.45) })),
    ...extra,
  });
  const price = (lists: IPricingList[], storeId: string, garment = "Shirt", type: "retail" | "corporate" = "retail") =>
    priceOrder(
      [{ serviceId: SERVICE, garment, category: "men", quantityMilli: 1000 }],
      new Map([[SERVICE, service]]),
      rankLists(lists, storeId, type),
      "standard"
    ).amountPaise;

  const lists = (): IPricingList[] => [
    list("Standard", [["Shirt", "men", 8000], ["Tie", "men", 3000]]),
    list("Corporate", [["Shirt", "men", 6800]], { customerType: "corporate" }),
    list("Global", [["Shirt", "men", 7000]], { rank: 1, overlay: true, source: "global" }),
    list("Area", [["Shirt", "men", 6500]], { rank: 5, overlay: true, source: "area", storeId: storeA.id }),
    list("Store", [["Shirt", "men", 6000]], { rank: 25, overlay: true, source: "store", storeId: storeA.id }),
  ];

  it("charges store over area over global over the plain list, per store", () => {
    expect(price(lists(), storeA.id)).toBe(6000);
    expect(price(lists().filter((l) => l.source !== "store"), storeA.id)).toBe(6500);
    expect(price(lists().filter((l) => l.source !== "store"), storeB.id)).toBe(7000); // not in the area
    expect(price(lists().filter((l) => !l.overlay), storeB.id)).toBe(8000);
  });

  it("keeps a corporate contract above global and area prices but below a store override", () => {
    expect(price(lists().filter((l) => l.source !== "store"), storeB.id, "Shirt", "corporate")).toBe(6800);
    expect(price(lists(), storeA.id, "Shirt", "corporate")).toBe(6000);
  });

  it("never lets an override price a coarse booking or another garment", () => {
    // "Men's garments" has no exact row: it is priced from the plain list, not the Shirt override.
    expect(price(lists(), storeA.id, "Men's garments")).toBe(3000);
  });
});

// ------------------------------------------------------------------- areas
describe("areas", () => {
  it("rejects a duplicate name and a store that is already in another area", async () => {
    const north = await AdminStoresService.createArea({ name: "North", storeIds: [storeA.id], pincodes: ["560001", "560001"] });
    expect(north).toMatchObject({ name: "North", storeIds: [storeA.id], pincodes: ["560001"] });
    await refused(AdminStoresService.createArea({ name: "North" }), 409, /already exists/);
    await refused(AdminStoresService.createArea({ name: "South", storeIds: [storeA.id] }), 409, /already in another area/);
    await refused(AdminStoresService.createArea({ name: "East", storeIds: [crypto.randomUUID()] }), 400, /existing stores/);
    await refused(AdminStoresService.createArea({ name: "West", pincodes: ["12"] }), 400, /6 digits/);
    expect(state.invalidations).toBe(1); // only the membership change touched prices
  });

  it("shows a store-bound manager only their own area, and 404 for any other", async () => {
    const north = await AdminStoresService.createArea({ name: "North", storeIds: [storeA.id] });
    const south = await AdminStoresService.createArea({ name: "South", storeIds: [storeB.id] });
    expect(await AdminStoresService.getArea(storeA.id, managerA, north.id)).toMatchObject({ id: north.id });
    await refused(AdminStoresService.getArea(storeA.id, managerA, south.id), 404);
  });

  it("will not delete an area that still has stores", async () => {
    const north = await AdminStoresService.createArea({ name: "North", storeIds: [storeA.id] });
    await refused(AdminStoresService.deleteArea(north.id), 409, /Move this area/);
    await AdminStoresService.updateArea(north.id, { storeIds: [] });
    expect(await AdminStoresService.deleteArea(north.id)).toMatchObject({ deleted: true });
  });
});

describe("closing a store", () => {
  it("is refused while it has open orders, and allowed once they are done", async () => {
    state.openOrders.set(storeA.id, 3);
    await refused(StoreService.deactivate(storeA.id), 409, /3 open orders/);
    state.openOrders.set(storeA.id, 0);
    expect(await StoreService.deactivate(storeA.id)).toMatchObject({ status: "closed" });
  });
});
