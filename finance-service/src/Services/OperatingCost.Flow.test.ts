jest.mock("../Queries/OperatingCost.Query.js", () => {
  const rows = new Map<string, any>();
  let seq = 0;
  const clone = (x: any) => (x ? { ...x } : null);
  return {
    __rows: rows,
    OperatingCostQuery: {
      create: async (data: any) => {
        const row = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.set(row.id, row);
        return clone(row);
      },
      findById: async (id: string) => clone(rows.get(id)),
      search: jest.fn(async () => ({ items: [...rows.values()].map(clone), total: rows.size })),
      update: async (id: string, data: any) => {
        if (!rows.has(id)) return null;
        Object.assign(rows.get(id), data);
        return clone(rows.get(id));
      },
      softDelete: async (id: string) => rows.delete(id),
      listActiveBetween: async (_from: string, _to: string, storeId?: string) =>
        [...rows.values()].filter((r) => !storeId || r.storeId === storeId).map(clone),
    },
  };
});

import { CustomException } from "../../commons/Exception/CustomException.js";
import { Actor } from "../Middleware/StoreScope.js";
import { OperatingCostService } from "./OperatingCost.Service.js";

const { __rows: rows, OperatingCostQuery } = jest.requireMock("../Queries/OperatingCost.Query.js");

const A = "11111111-1111-4111-8111-111111111101";
const B = "11111111-1111-4111-8111-111111111102";
const admin: Actor = { id: "a1", role: "admin", name: null, storeId: null, scopeStoreId: null };
const page = { page: 1, limit: 20, offset: 0 };

const failure = async (promise: Promise<unknown>): Promise<CustomException> => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a refusal");
};

const create = (overrides: Record<string, unknown> = {}) =>
  OperatingCostService.createOperatingCost({
    name: "Shop rent",
    type: "rent",
    amount: 45_000,
    frequency: "monthly",
    storeId: A,
    dueDay: 5,
    startDate: "2026-01-01",
    ...overrides,
  });

beforeEach(() => {
  rows.clear();
  jest.clearAllMocks();
});

describe("operating costs", () => {
  it("creates in paise and reads back in rupees", async () => {
    const cost = await create({ amount: 45_000.5 });
    expect(cost).toMatchObject({ name: "Shop rent", amount: 45_000.5, frequency: "monthly", dueDay: 5, endDate: null });
    expect([...rows.values()][0].amountPaise).toBe(4_500_050);
    expect((await OperatingCostService.getOperatingCost(cost.id)).id).toBe(cost.id);
  });

  it("validates every field, including dueDay 1 to 28 and end not before start", async () => {
    const bad: Array<Record<string, unknown>> = [
      { name: "" },
      { type: "gold" },
      { amount: 0 },
      { amount: 1.234 },
      { frequency: "weekly" },
      { dueDay: 0 },
      { dueDay: 29 },
      { dueDay: 1.5 },
      { startDate: "2026-02-30" },
      { endDate: "2025-12-31" },
      { storeId: "x" },
    ];
    for (const patch of bad) expect((await failure(create(patch))).errorCode).toBe(400);
    expect(rows.size).toBe(0);
  });

  it("updates only whitelisted fields and re-checks the date order against what is stored", async () => {
    const { id } = await create();
    const updated = await OperatingCostService.updateOperatingCost(id, { amount: 50_000, id: "other", deletedAt: "2020-01-01", createdAt: "2000-01-01" });
    expect(updated).toMatchObject({ amount: 50_000 });
    expect(rows.get(id).id).toBe(id);
    expect(rows.get(id).deletedAt).toBeUndefined();
    expect((await failure(OperatingCostService.updateOperatingCost(id, { endDate: "2025-01-01" }))).errorCode).toBe(400);
    expect((await failure(OperatingCostService.updateOperatingCost(id, { id: "x" }))).errorCode).toBe(400);
    await OperatingCostService.updateOperatingCost(id, { endDate: "2026-12-31", dueDay: null });
    expect(rows.get(id)).toMatchObject({ dueDay: null });
  });

  it("deletes, then answers 404", async () => {
    const { id } = await create();
    await expect(OperatingCostService.deleteOperatingCost(id)).resolves.toMatchObject({ deleted: true });
    expect((await failure(OperatingCostService.getOperatingCost(id))).errorCode).toBe(404);
    expect((await failure(OperatingCostService.deleteOperatingCost(id))).errorCode).toBe(404);
    expect((await failure(OperatingCostService.getOperatingCost("nope"))).errorCode).toBe(404);
  });

  it("passes the store and type filters, an admin's chosen store winning", async () => {
    await OperatingCostService.listOperatingCosts({ type: "rent", storeId: B }, { ...admin, scopeStoreId: A }, page);
    expect(OperatingCostQuery.search.mock.calls[0][0]).toEqual({ storeId: B, type: "rent" });
    expect((await failure(OperatingCostService.listOperatingCosts({ type: "gold" }, admin, page))).errorCode).toBe(400);
  });
});

describe("the monthly figure", () => {
  it("totals what falls due in the month by type and by store, as a look-up", async () => {
    await create({ amount: 45_000, storeId: A });
    await create({ name: "Power", type: "electricity", amount: 12_000.5, storeId: B, dueDay: 10 });
    await create({ name: "Insurance", type: "insurance", amount: 24_000, frequency: "yearly", storeId: null, startDate: "2025-10-01", dueDay: 1 });
    await create({ name: "Ended", type: "other", amount: 999, endDate: "2026-02-28" });
    const october = await OperatingCostService.getMonthlyOperatingCost({ month: "2026-10" }, admin);
    expect(october.total).toBe(45_000 + 12_000.5 + 24_000);
    expect(october.byType).toEqual([
      { type: "rent", amount: 45_000 },
      { type: "insurance", amount: 24_000 },
      { type: "electricity", amount: 12_000.5 },
    ]);
    expect(october.byStore).toEqual([
      { storeId: A, amount: 45_000 },
      { storeId: null, amount: 24_000 },
      { storeId: B, amount: 12_000.5 },
    ]);
    // The yearly premium does not fall due in November; asking twice gives the same answer.
    expect((await OperatingCostService.getMonthlyOperatingCost({ month: "2026-11" }, admin)).total).toBe(45_000 + 12_000.5);
    expect(await OperatingCostService.getMonthlyOperatingCost({ month: "2026-10" }, admin)).toEqual(october);
  });

  it("narrows to a store and refuses a missing or malformed month", async () => {
    await create({ storeId: A });
    await create({ storeId: B, amount: 100 });
    expect((await OperatingCostService.getMonthlyOperatingCost({ month: "2026-10", storeId: B }, admin)).total).toBe(100);
    for (const query of [{}, { month: "2026-13" }, { month: "October" }]) {
      expect((await failure(OperatingCostService.getMonthlyOperatingCost(query, admin))).errorCode).toBe(400);
    }
  });
});
