// getOrSet is faked with the real contract (return a cached value, else run the loader and keep
// it) so the test can see exactly which keys the services build, and with what TTL.
jest.mock("../../commons/Cache/Cache.js", () => {
  const store = new Map<string, unknown>();
  const calls: Array<{ key: string; ttl: number }> = [];
  return {
    __store: store,
    __calls: calls,
    getOrSet: async (key: string, ttl: number, loader: () => Promise<unknown>) => {
      calls.push({ key, ttl });
      if (store.has(key)) return store.get(key);
      const value = await loader();
      store.set(key, value);
      return value;
    },
  };
});
jest.mock("../Clients/Commerce.Client.js", () => ({ CommerceClient: { getOrderSummary: jest.fn() } }));
jest.mock("../Queries/Cash.Query.js", () => ({ CashQuery: { summarise: jest.fn() } }));
jest.mock("../Queries/Expense.Query.js", () => ({ ExpenseQuery: { spendByStore: jest.fn(), spendByDay: jest.fn() } }));
jest.mock("../Queries/OperatingCost.Query.js", () => ({ OperatingCostQuery: { listActiveBetween: jest.fn() } }));

import { CustomException } from "../../commons/Exception/CustomException.js";
import { Actor } from "../Middleware/StoreScope.js";
import { clock } from "../Utils/Dates.js";
import { AnalyticsService } from "./Analytics.Service.js";
import { bucketStart, DashboardService } from "./Dashboard.Service.js";
import { INSIGHT_TTL_SECONDS } from "./Insights.js";

const cache = jest.requireMock("../../commons/Cache/Cache.js");
const { CommerceClient } = jest.requireMock("../Clients/Commerce.Client.js");
const { CashQuery } = jest.requireMock("../Queries/Cash.Query.js");
const { ExpenseQuery } = jest.requireMock("../Queries/Expense.Query.js");
const { OperatingCostQuery } = jest.requireMock("../Queries/OperatingCost.Query.js");

const A = "11111111-1111-4111-8111-111111111101";
const B = "11111111-1111-4111-8111-111111111102";
const admin: Actor = { id: "a1", role: "admin", name: null, storeId: null, scopeStoreId: null };
const superAdmin: Actor = { ...admin, id: "s1", role: "super_admin" };

const summary = (overrides: Record<string, unknown> = {}) => ({
  orders: 0,
  revenuePaise: 0,
  byStatus: {},
  byDay: [],
  byStore: [],
  ...overrides,
});

const cost = (type: string, amountPaise: number, storeId: string | null = null) => ({
  type,
  amountPaise,
  frequency: "monthly",
  storeId,
  dueDay: 5,
  startDate: "2026-01-01",
  endDate: null,
});

const failure = async (promise: Promise<unknown>): Promise<CustomException> => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a refusal");
};

beforeEach(() => {
  cache.__store.clear();
  cache.__calls.length = 0;
  jest.clearAllMocks();
  clock.now = () => new Date("2026-10-15T06:00:00Z");
  CommerceClient.getOrderSummary.mockResolvedValue(summary());
  CashQuery.summarise.mockResolvedValue({ expectedPaise: 0, countedPaise: 0, bankedPaise: 0 });
  ExpenseQuery.spendByStore.mockResolvedValue([]);
  ExpenseQuery.spendByDay.mockResolvedValue([]);
  OperatingCostQuery.listActiveBetween.mockResolvedValue([]);
});
afterAll(() => {
  clock.now = () => new Date();
});

describe("caching never mixes scopes", () => {
  it("keeps at most 30 seconds, and builds the key from the insight, role, store and range", async () => {
    await DashboardService.revenue({ from: "2026-10-01", to: "2026-10-10", storeId: A }, admin);
    expect(INSIGHT_TTL_SECONDS).toBeLessThanOrEqual(60);
    expect(cache.__calls[0].ttl).toBe(INSIGHT_TTL_SECONDS);
    expect(cache.__calls[0].key).toBe("insight:revenue:role=admin:store=" + A + ":from=2026-10-01,granularity=day,to=2026-10-10");
  });

  it("gives each store its own entry: store A's numbers are never served for store B or for all stores", async () => {
    CommerceClient.getOrderSummary.mockImplementation(async ({ storeId }: { storeId?: string }) =>
      summary({ orders: 1, revenuePaise: storeId === A ? 111_00 : storeId === B ? 222_00 : 333_00 })
    );
    const query = { from: "2026-10-01", to: "2026-10-10" };
    const forA = await DashboardService.revenue({ ...query, storeId: A }, admin);
    const forB = await DashboardService.revenue({ ...query, storeId: B }, admin);
    const forAll = await DashboardService.revenue(query, admin);
    expect([forA.total, forB.total, forAll.total]).toEqual([111, 222, 333]);
    expect(new Set(cache.__calls.map((c: any) => c.key)).size).toBe(3);
  });

  it("gives each role its own entry, and each range, and each insight", async () => {
    const query = { from: "2026-10-01", to: "2026-10-10" };
    await DashboardService.revenue(query, admin);
    await DashboardService.revenue(query, superAdmin);
    await DashboardService.revenue({ ...query, to: "2026-10-11" }, admin);
    await DashboardService.revenue({ ...query, granularity: "week" }, admin);
    await DashboardService.orders(query, admin);
    expect(new Set(cache.__calls.map((c: any) => c.key)).size).toBe(5);
  });

  it("uses an admin's header scope when no storeId is asked for, and the query when both are given", async () => {
    await DashboardService.orders({}, { ...admin, scopeStoreId: A });
    await DashboardService.orders({ storeId: B }, { ...admin, scopeStoreId: A });
    expect(cache.__calls[0].key).toContain(`store=${A}`);
    expect(cache.__calls[1].key).toContain(`store=${B}`);
    expect(CommerceClient.getOrderSummary.mock.calls.map((c: any) => c[0].storeId)).toEqual([A, B]);
  });

  it("serves a repeat of the same request from the cache without recomputing", async () => {
    await DashboardService.stores({ from: "2026-10-01", to: "2026-10-10" }, admin);
    await DashboardService.stores({ from: "2026-10-01", to: "2026-10-10" }, admin);
    expect(CommerceClient.getOrderSummary).toHaveBeenCalledTimes(1);
  });

  it("caches nothing when commerce is unavailable", async () => {
    CommerceClient.getOrderSummary.mockRejectedValue(new CustomException("A connected service is unavailable right now. Please try again.", 503));
    expect((await failure(DashboardService.orders({}, admin))).errorCode).toBe(503);
    expect(cache.__store.size).toBe(0);
  });
});

describe("dashboard", () => {
  it("buckets revenue by day, week (Monday start) or month and reports the trend against the previous window", async () => {
    CommerceClient.getOrderSummary
      .mockResolvedValueOnce(
        summary({
          orders: 6,
          revenuePaise: 60_000,
          byDay: [
            { date: "2026-10-05", orders: 1, revenuePaise: 10_000 },
            { date: "2026-10-07", orders: 2, revenuePaise: 20_000 },
            { date: "2026-10-12", orders: 3, revenuePaise: 30_000 },
          ],
        })
      )
      .mockResolvedValueOnce(summary({ orders: 4, revenuePaise: 40_000 }));
    const result = await DashboardService.revenue({ from: "2026-10-01", to: "2026-10-14", granularity: "week" }, admin);
    expect(result).toMatchObject({ total: 600, trendPct: 50 });
    expect(result.series).toEqual([
      { date: "2026-10-05", revenue: 300, orders: 3 },
      { date: "2026-10-12", revenue: 300, orders: 3 },
    ]);
    expect(CommerceClient.getOrderSummary.mock.calls[1][0]).toMatchObject({ from: "2026-09-17", to: "2026-09-30" });
    expect(bucketStart("2026-10-11", "week")).toBe("2026-10-05"); // a Sunday belongs to the week before
    expect(bucketStart("2026-10-20", "month")).toBe("2026-10-01");
  });

  it("gives no trend when there is nothing to compare with, and validates the window and granularity", async () => {
    expect((await DashboardService.revenue({}, admin)).trendPct).toBeNull();
    expect((await failure(DashboardService.revenue({ granularity: "hour" }, admin))).errorCode).toBe(400);
    expect((await failure(DashboardService.revenue({ from: "2025-01-01", to: "2026-10-01" }, admin))).errorCode).toBe(400);
    expect((await failure(DashboardService.revenue({ from: "2026-10-05", to: "2026-10-01" }, admin))).errorCode).toBe(400);
    expect((await failure(DashboardService.revenue({ storeId: "x" }, admin))).errorCode).toBe(400);
  });

  it("passes order counts through and marks what commerce cannot supply as unavailable", async () => {
    CommerceClient.getOrderSummary.mockResolvedValue(summary({ orders: 9, byStatus: { received: 3, delivered: 6 } }));
    const result = await DashboardService.orders({}, admin);
    expect(result).toMatchObject({ total: 9, byStatus: { received: 3, delivered: 6 }, avgTurnaroundHours: null, onTimePct: null });
  });

  it("lists stores side by side, best revenue first", async () => {
    CommerceClient.getOrderSummary.mockResolvedValue(
      summary({ byStore: [{ storeId: A, orders: 1, revenuePaise: 100 }, { storeId: B, orders: 4, revenuePaise: 900 }] })
    );
    const result = await DashboardService.stores({}, admin);
    expect(result.stores.map((s: any) => [s.storeId, s.revenue])).toEqual([[B, 9], [A, 1]]);
  });

  it("builds the overview as of a day: today, month to date, costs and cash", async () => {
    CommerceClient.getOrderSummary
      .mockResolvedValueOnce(
        summary({
          orders: 20,
          revenuePaise: 200_000,
          byStatus: { received: 2, washing: 3, delivered: 14, cancelled: 1 },
          byDay: [{ date: "2026-10-14", orders: 5, revenuePaise: 50_000 }, { date: "2026-10-15", orders: 4, revenuePaise: 40_000 }],
        })
      )
      .mockResolvedValueOnce(summary({ orders: 10, revenuePaise: 100_000 }));
    OperatingCostQuery.listActiveBetween.mockResolvedValue([cost("rent", 30_000)]);
    ExpenseQuery.spendByStore.mockResolvedValue([{ storeId: A, amountPaise: 10_000 }]);
    CashQuery.summarise.mockResolvedValue({ expectedPaise: 40_000, countedPaise: 39_000, bankedPaise: 39_000 });

    const overview = await DashboardService.overview({}, admin);
    expect(overview).toMatchObject({
      asOf: "2026-10-15",
      revenue: { today: 400, monthToDate: 2000, trendPct: 100 },
      orders: { today: 4, inProgress: 5, delayed: null },
      costs: { monthToDate: 400, perOrder: 20 },
      cash: { collected: 390, banked: 390, variance: -10 },
      capacity: null,
      people: null,
    });
    expect(overview.unavailable).toEqual(expect.arrayContaining(["people", "satisfaction", "risks", "capacity"]));
    expect(CommerceClient.getOrderSummary.mock.calls[0][0]).toMatchObject({ from: "2026-10-01", to: "2026-10-15" });
    expect(CommerceClient.getOrderSummary.mock.calls[1][0]).toMatchObject({ from: "2026-09-01", to: "2026-09-15" });
    expect(CashQuery.summarise).toHaveBeenCalledWith("2026-10-15", "2026-10-15", null);
  });

  it("never lets last month's comparison window spill past its end (31 March vs February)", async () => {
    await DashboardService.overview({ to: "2026-03-31" }, admin);
    expect(CommerceClient.getOrderSummary.mock.calls[1][0]).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("answers people, satisfaction and risks with an explicit unavailable, never zeros that look like data", async () => {
    const people = await DashboardService.people({}, admin);
    expect(people).toMatchObject({ headcount: null, openGrievances: null, unavailable: true });
    expect(await DashboardService.satisfaction({}, admin)).toMatchObject({ average: null, byStore: [], unavailable: true });
    expect(await DashboardService.risks({}, admin)).toMatchObject({ items: [], complete: false, unavailable: true });
    expect((await failure(DashboardService.people({ storeId: "x" }, admin))).errorCode).toBe(400);
  });
});

describe("analytics", () => {
  const range = { from: "2026-10-01", to: "2026-10-31" };

  it("splits what an order really costs and divides by orders, half up", async () => {
    CommerceClient.getOrderSummary.mockResolvedValue(
      summary({ orders: 3, byDay: [{ date: "2026-10-05", orders: 3, revenuePaise: 1 }, { date: "2026-10-06", orders: 0, revenuePaise: 0 }] })
    );
    OperatingCostQuery.listActiveBetween.mockResolvedValue([
      cost("water", 1000),
      cost("electricity", 2000),
      cost("salary", 5000),
      cost("rent", 10_000),
    ]);
    ExpenseQuery.spendByDay.mockImplementation(async (_f: string, _t: string, options: { categoryKey?: string }) =>
      options.categoryKey === "detergent" ? [{ date: "2026-10-05", amountPaise: 1500 }] : [{ date: "2026-10-05", amountPaise: 4000 }]
    );
    ExpenseQuery.spendByStore.mockResolvedValue([{ storeId: null, amountPaise: 4000 }]);

    const result = await AnalyticsService.orderCost(range, admin);
    // total = 18,000 operating + 4,000 expenses = 22,000 paise over 3 orders = 7,333.33 -> 73.33
    expect(result.averagePerOrder).toEqual({
      water: 3.33,
      electricity: 6.67,
      detergent: 5,
      labour: 16.67,
      other: 41.67, // rent 10,000 + (4,000 spend - 1,500 detergent) = 12,500 / 3
      total: 73.33,
    });
    // The series covers only days that had orders; 05 Oct carries the day's own charges (5th: due day) and spend.
    expect(result.series).toEqual([{ date: "2026-10-05", perOrder: 73.33 }]);
  });

  it("reports resource use as spend in rupees, and detergent from its expense category", async () => {
    CommerceClient.getOrderSummary.mockResolvedValue(summary({ orders: 4 }));
    OperatingCostQuery.listActiveBetween.mockResolvedValue([cost("water", 1000), cost("electricity", 3000)]);
    ExpenseQuery.spendByDay.mockResolvedValue([{ date: "2026-10-09", amountPaise: 2500 }]);
    const water = await AnalyticsService.resourceUsage({ ...range, resource: "water" }, admin);
    expect(water).toMatchObject({ unit: "INR", total: 10, perOrder: 2.5, series: [{ date: "2026-10-05", value: 10 }] });
    const detergent = await AnalyticsService.resourceUsage({ ...range, resource: "detergent" }, admin);
    expect(detergent).toMatchObject({ total: 25, perOrder: 6.25, series: [{ date: "2026-10-09", value: 25 }] });
    expect(ExpenseQuery.spendByDay.mock.calls.at(-1)[2].categoryKey).toBe("detergent");
    expect((await failure(AnalyticsService.resourceUsage({ ...range, resource: "gold" }, admin))).errorCode).toBe(400);
  });

  it("shows each store's revenue against its running cost, with company-wide costs on their own row", async () => {
    CommerceClient.getOrderSummary.mockResolvedValue(
      summary({ byStore: [{ storeId: A, orders: 10, revenuePaise: 100_000 }, { storeId: B, orders: 1, revenuePaise: 0 }] })
    );
    OperatingCostQuery.listActiveBetween.mockResolvedValue([cost("rent", 40_000, A), cost("internet", 5_000, null)]);
    ExpenseQuery.spendByStore.mockResolvedValue([{ storeId: A, amountPaise: 10_000 }, { storeId: B, amountPaise: 2_000 }]);
    const result = await AnalyticsService.storeEconomics(range, admin);
    const byId = Object.fromEntries(result.stores.map((s: any) => [String(s.storeId), s]));
    expect(byId[A]).toMatchObject({ revenue: 1000, runningCost: 500, margin: 500, marginPct: 50 });
    expect(byId[B]).toMatchObject({ revenue: 0, runningCost: 20, margin: -20, marginPct: null });
    expect(byId["null"]).toMatchObject({ name: "Company-wide", revenue: 0, runningCost: 50, margin: -50 });
  });

  it("is bounded: a window over a year or a bad store is refused", async () => {
    expect((await failure(AnalyticsService.orderCost({ from: "2025-01-01", to: "2026-10-01" }, admin))).errorCode).toBe(400);
    expect((await failure(AnalyticsService.storeEconomics({ storeId: "x" }, admin))).errorCode).toBe(400);
  });

  it("keeps analytics caches apart by store and resource", async () => {
    await AnalyticsService.resourceUsage({ ...range, resource: "water" }, admin);
    await AnalyticsService.resourceUsage({ ...range, resource: "detergent" }, admin);
    await AnalyticsService.resourceUsage({ ...range, resource: "water", storeId: A }, admin);
    expect(new Set(cache.__calls.map((c: any) => c.key)).size).toBe(3);
  });
});
