jest.mock("../Queries/OperatingCost.Query.js", () => ({ OperatingCostQuery: { listActiveBetween: jest.fn() } }));

import { chargeDateIn, chargesBetween, operatingChargesBetween } from "./Costing.js";

const cost = (overrides: Record<string, unknown> = {}) => ({
  type: "rent" as const,
  amountPaise: 100_000,
  frequency: "monthly" as const,
  storeId: null,
  dueDay: null,
  startDate: "2026-01-10",
  endDate: null,
  ...overrides,
});

describe("chargeDateIn", () => {
  it("charges a monthly cost every month from the start month on its due day", () => {
    expect(chargeDateIn(cost({ dueDay: 5, startDate: "2026-01-01" }), "2026-03")).toBe("2026-03-05");
    expect(chargeDateIn(cost({ startDate: "2026-01-10" }), "2026-02")).toBe("2026-02-10");
  });

  it("falls back to the start day, capped at 28 so every month has it", () => {
    expect(chargeDateIn(cost({ startDate: "2026-01-31" }), "2026-02")).toBe("2026-02-28");
  });

  it("does not charge before the start, nor on a due day earlier than the start day in the first month", () => {
    expect(chargeDateIn(cost({ startDate: "2026-03-10" }), "2026-02")).toBeNull();
    expect(chargeDateIn(cost({ startDate: "2026-03-10", dueDay: 5 }), "2026-03")).toBeNull();
    expect(chargeDateIn(cost({ startDate: "2026-03-10", dueDay: 5 }), "2026-04")).toBe("2026-04-05");
  });

  it("stops after the end date", () => {
    expect(chargeDateIn(cost({ startDate: "2026-01-01", dueDay: 5, endDate: "2026-03-04" }), "2026-03")).toBeNull();
    expect(chargeDateIn(cost({ startDate: "2026-01-01", dueDay: 5, endDate: "2026-03-05" }), "2026-03")).toBe("2026-03-05");
  });

  it("charges a quarterly cost every third month and a yearly one once a year, in full", () => {
    const quarterly = cost({ frequency: "quarterly", startDate: "2026-01-15" });
    expect([1, 2, 3, 4, 5, 6, 7].map((m) => chargeDateIn(quarterly, `2026-0${m}`) !== null)).toEqual([true, false, false, true, false, false, true]);
    const yearly = cost({ frequency: "yearly", startDate: "2025-08-01" });
    expect(chargeDateIn(yearly, "2026-08")).toBe("2026-08-01");
    expect(chargeDateIn(yearly, "2026-09")).toBeNull();
    expect(chargeDateIn(yearly, "2027-08")).toBe("2027-08-01");
  });
});

describe("chargesBetween", () => {
  it("lists every charge falling inside the window, across a year boundary", () => {
    const charges = chargesBetween([cost({ dueDay: 5, startDate: "2025-01-01" })], "2025-11-10", "2026-02-20");
    expect(charges.map((c) => c.date)).toEqual(["2025-12-05", "2026-01-05", "2026-02-05"]);
  });

  it("keeps the store and type of each cost", () => {
    const [charge] = chargesBetween([cost({ type: "water", storeId: "s1", startDate: "2026-01-01", dueDay: 2 })], "2026-01-01", "2026-01-31");
    expect(charge).toEqual({ date: "2026-01-02", type: "water", storeId: "s1", amountPaise: 100_000 });
  });

  it("is a look-up: the same inputs always give the same charges (nothing is generated, so nothing duplicates)", () => {
    const rows = [cost({ startDate: "2026-01-01", dueDay: 1 })];
    expect(chargesBetween(rows, "2026-01-01", "2026-06-30")).toEqual(chargesBetween(rows, "2026-01-01", "2026-06-30"));
    expect(chargesBetween(rows, "2026-01-01", "2026-06-30")).toHaveLength(6);
  });
});

describe("operatingChargesBetween", () => {
  it("reads the active definitions for the window and expands them", async () => {
    const { OperatingCostQuery } = jest.requireMock("../Queries/OperatingCost.Query.js");
    OperatingCostQuery.listActiveBetween.mockResolvedValue([cost({ startDate: "2026-01-01", dueDay: 3 })]);
    const charges = await operatingChargesBetween("2026-02-01", "2026-03-31", "store-1");
    expect(OperatingCostQuery.listActiveBetween).toHaveBeenCalledWith("2026-02-01", "2026-03-31", "store-1");
    expect(charges.map((c) => c.date)).toEqual(["2026-02-03", "2026-03-03"]);
  });
});
