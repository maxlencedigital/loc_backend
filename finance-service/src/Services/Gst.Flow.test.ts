jest.mock("../Queries/Gst.Query.js", () => {
  const reports = new Map<string, any>();
  let seq = 0;
  const clone = (r: any) => (r ? { ...r, lines: [...r.lines], storeIds: [...r.storeIds] } : null);
  return {
    __reports: reports,
    GstQuery: {
      findByMonth: async (month: string) => clone(reports.get(month)),
      findById: async (id: string) => clone([...reports.values()].find((r) => r.id === id)),
      lockByMonth: async (month: string) => clone(reports.get(month)),
      // Atomic like the unique index: the second creator of a month is refused.
      create: async (data: any) => {
        if (reports.has(data.month)) return false;
        reports.set(data.month, { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, createdAt: new Date(), updatedAt: new Date(), ...data });
        return true;
      },
      replaceUnfiled: async (id: string, data: any) => {
        const row = [...reports.values()].find((r) => r.id === id);
        if (!row || row.status === "filed") return false;
        Object.assign(row, data);
        return true;
      },
      search: jest.fn(async () => ({ items: [], total: 0 })),
    },
  };
});
jest.mock("../Queries/Transaction.Query.js", () => ({ TransactionQuery: { run: async (work: any) => work({}) } }));
jest.mock("../Queries/Refund.Query.js", () => ({ RefundQuery: { sumProcessedByStore: jest.fn(async () => []) } }));
jest.mock("../Clients/Commerce.Client.js", () => ({ CommerceClient: { getOrderSummary: jest.fn() } }));

import { CustomException } from "../../commons/Exception/CustomException.js";
import { Actor } from "../Middleware/StoreScope.js";
import { clock } from "../Utils/Dates.js";
import { GstService, gstRateBps, splitInclusive } from "./Gst.Service.js";

const { __reports: reports, GstQuery } = jest.requireMock("../Queries/Gst.Query.js");
const { CommerceClient } = jest.requireMock("../Clients/Commerce.Client.js");
const { RefundQuery } = jest.requireMock("../Queries/Refund.Query.js");

const admin: Actor = { id: "admin-1", role: "admin", name: "Admin", storeId: null, scopeStoreId: null };
const A = "11111111-1111-4111-8111-111111111101";
const B = "11111111-1111-4111-8111-111111111102";

const summary = (stores: Array<[string, number, number]>) => ({
  orders: stores.reduce((n, s) => n + s[1], 0),
  revenuePaise: stores.reduce((n, s) => n + s[2], 0),
  byStatus: {},
  byDay: [],
  byStore: stores.map(([storeId, orders, revenuePaise]) => ({ storeId, orders, revenuePaise })),
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
  reports.clear();
  jest.clearAllMocks();
  delete process.env.GST_RATE_BPS;
  clock.now = () => new Date("2026-10-15T06:00:00Z");
  CommerceClient.getOrderSummary.mockResolvedValue(summary([[A, 10, 118_000], [B, 5, 59_000]]));
  RefundQuery.sumProcessedByStore.mockResolvedValue([]);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterAll(() => {
  clock.now = () => new Date();
});

describe("splitInclusive", () => {
  it("separates 18% GST from an inclusive amount", () => {
    expect(splitInclusive(118_000, 1800)).toEqual({ taxablePaise: 100_000, taxPaise: 18_000 });
  });

  it("rounds the taxable value half up and gives the remainder to tax, so the two always add back", () => {
    // 1000 / 1.18 = 847.457... -> 847
    expect(splitInclusive(1000, 1800)).toEqual({ taxablePaise: 847, taxPaise: 153 });
    // 59 / 1.18 = 50.0 exactly; 6 / 1.18 = 5.08 -> 5; 7 / 1.18 = 5.93 -> 6
    expect(splitInclusive(6, 1800)).toEqual({ taxablePaise: 5, taxPaise: 1 });
    expect(splitInclusive(7, 1800)).toEqual({ taxablePaise: 6, taxPaise: 1 });
    for (let amount = 0; amount < 2000; amount += 7) {
      const { taxablePaise, taxPaise } = splitInclusive(amount, 1800);
      expect(taxablePaise + taxPaise).toBe(amount);
    }
  });

  it("mirrors a negative net (refunds above sales) as a credit note", () => {
    expect(splitInclusive(-118_000, 1800)).toEqual({ taxablePaise: -100_000, taxPaise: -18_000 });
  });

  it("handles a zero rate", () => {
    expect(splitInclusive(500, 0)).toEqual({ taxablePaise: 500, taxPaise: 0 });
  });
});

describe("gstRateBps", () => {
  it("defaults to 18% and refuses a nonsense setting", () => {
    expect(gstRateBps()).toBe(1800);
    process.env.GST_RATE_BPS = "500";
    expect(gstRateBps()).toBe(500);
    process.env.GST_RATE_BPS = "12.5";
    expect(() => gstRateBps()).toThrow();
    process.env.GST_RATE_BPS = "99999";
    expect(() => gstRateBps()).toThrow();
  });
});

describe("generateReport", () => {
  it("builds the month from commerce's figures, per store, with CGST and SGST summing to the tax", async () => {
    const report = await GstService.generateReport({ month: "2026-09" }, admin);
    expect(CommerceClient.getOrderSummary).toHaveBeenCalledWith({ from: "2026-09-01", to: "2026-09-30" });
    expect(report).toMatchObject({ month: "2026-09", status: "draft", gross: 1770, taxable: 1500, tax: 270, cgst: 135, sgst: 135, orderCount: 15, rateBps: 1800 });
    expect(report.stores).toHaveLength(2);
    expect(report.stores.reduce((n: number, s: any) => n + s.tax, 0)).toBeCloseTo(report.tax, 2);
  });

  it("gives the odd paisa of an uneven tax to SGST", async () => {
    CommerceClient.getOrderSummary.mockResolvedValue(summary([[A, 1, 1000]]));
    const report = await GstService.generateReport({ month: "2026-09" }, admin);
    expect(report).toMatchObject({ tax: 1.53, cgst: 0.76, sgst: 0.77 });
  });

  it("nets confirmed refunds of the month off the taxable value", async () => {
    RefundQuery.sumProcessedByStore.mockResolvedValue([{ storeId: A, amountPaise: 11_800 }, { storeId: null, amountPaise: 1_180 }]);
    const report = await GstService.generateReport({ month: "2026-09" }, admin);
    expect(report.refunds).toBe(129.8);
    expect(report.taxable).toBe(1500 - 100 - 10);
    expect(report.stores.find((s: any) => s.storeId === null)).toMatchObject({ gross: 0, refunds: 11.8 });
  });

  it("limits the figures to the stores asked for", async () => {
    RefundQuery.sumProcessedByStore.mockResolvedValue([{ storeId: B, amountPaise: 5_900 }, { storeId: null, amountPaise: 100 }]);
    const report = await GstService.generateReport({ month: "2026-09", storeIds: [A] }, admin);
    expect(report.stores.map((s: any) => s.storeId)).toEqual([A]);
    expect(report.gross).toBe(1180);
    expect(report.refunds).toBe(0);
  });

  it("stores the rate used, so a later rate change cannot rewrite a generated month", async () => {
    process.env.GST_RATE_BPS = "500";
    await GstService.generateReport({ month: "2026-08" }, admin);
    process.env.GST_RATE_BPS = "1800";
    expect(reports.get("2026-08").rateBps).toBe(500);
  });

  it("validates the month, the store list and the target status", async () => {
    for (const body of [{}, { month: "2026-13" }, { month: "2026-11" }, { month: "2026-09", storeIds: ["x"] }, { month: "2026-09", targetStatus: "paid" }]) {
      expect((await failure(GstService.generateReport(body, admin))).errorCode).toBe(400);
    }
    expect(reports.size).toBe(0);
  });

  it("stores nothing when commerce is unavailable", async () => {
    CommerceClient.getOrderSummary.mockRejectedValue(new CustomException("A connected service is unavailable right now. Please try again.", 503));
    expect((await failure(GstService.generateReport({ month: "2026-09" }, admin))).errorCode).toBe(503);
    expect(reports.size).toBe(0);
  });

  it("refreshing an unfiled month rewrites the one row instead of adding another", async () => {
    await GstService.generateReport({ month: "2026-09" }, admin);
    CommerceClient.getOrderSummary.mockResolvedValue(summary([[A, 20, 236_000]]));
    const again = await GstService.generateReport({ month: "2026-09" }, admin);
    expect(reports.size).toBe(1);
    expect(again.gross).toBe(2360);
  });

  it("two simultaneous first generations make one report: the loser is told, not duplicated", async () => {
    const results = await Promise.allSettled([
      GstService.generateReport({ month: "2026-09" }, admin),
      GstService.generateReport({ month: "2026-09" }, admin),
    ]);
    expect(reports.size).toBe(1);
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.errorCode).toBe(409);
  });
});

describe("filing workflow", () => {
  const ready = () => GstService.generateReport({ month: "2026-09", targetStatus: "ready" }, admin);
  const file = (ack = "ACK-1") => GstService.generateReport({ month: "2026-09", targetStatus: "filed", acknowledgement: ack }, admin);

  it("moves draft -> ready -> filed, and only forward", async () => {
    await GstService.generateReport({ month: "2026-09" }, admin);
    expect((await ready()).status).toBe("ready");
    expect((await failure(GstService.generateReport({ month: "2026-09", targetStatus: "draft" }, admin))).errorCode).toBe(409);
    const filed = await file();
    expect(filed).toMatchObject({ status: "filed", acknowledgement: "ACK-1" });
    expect(filed.filedAt).toBeInstanceOf(Date);
  });

  it("will not file a report that is not ready, without an acknowledgement, or for a month that has not ended", async () => {
    await GstService.generateReport({ month: "2026-09" }, admin);
    expect((await failure(file())).errorCode).toBe(409);
    await ready();
    expect((await failure(GstService.generateReport({ month: "2026-09", targetStatus: "filed" }, admin))).errorCode).toBe(400);
    expect((await failure(GstService.generateReport({ month: "2026-10", targetStatus: "filed", acknowledgement: "A" }, admin))).errorCode).toBe(409);
  });

  it("freezes the reviewed figures when filing (no recompute) and then refuses every change", async () => {
    await ready();
    CommerceClient.getOrderSummary.mockResolvedValue(summary([[A, 99, 9_999_900]]));
    const filed = await file();
    expect(filed.gross).toBe(1770);
    CommerceClient.getOrderSummary.mockClear();
    expect((await failure(GstService.generateReport({ month: "2026-09" }, admin))).errorCode).toBe(409);
    expect((await failure(GstService.generateReport({ month: "2026-09", targetStatus: "ready" }, admin))).errorCode).toBe(409);
    expect(reports.get("2026-09").grossPaise).toBe(177_000);
    expect(CommerceClient.getOrderSummary).not.toHaveBeenCalled();
  });

  it("answers an identical filing request again with the same filed report, a different acknowledgement with 409", async () => {
    await ready();
    const first = await file("ACK-9");
    const replay = await file("ACK-9");
    expect(replay.id).toBe(first.id);
    expect((await failure(file("ACK-OTHER"))).errorCode).toBe(409);
  });

  it("two simultaneous filings leave one filed report", async () => {
    await ready();
    const results = await Promise.allSettled([file("ACK-A"), file("ACK-B")]);
    expect(reports.get("2026-09").status).toBe("filed");
    const winner = reports.get("2026-09").acknowledgement;
    expect(["ACK-A", "ACK-B"]).toContain(winner);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    // Whatever the interleaving, nothing changes the acknowledgement afterwards.
    await failure(file(winner === "ACK-A" ? "ACK-B" : "ACK-A"));
    expect(reports.get("2026-09").acknowledgement).toBe(winner);
  });
});

describe("reads and export", () => {
  it("lists with a year filter, gets one, and answers 404 for an unknown or malformed id", async () => {
    await GstService.listReports({ year: "2026" }, { page: 1, limit: 20, offset: 0 });
    expect(GstQuery.search).toHaveBeenCalledWith("2026", expect.anything());
    const made = await GstService.generateReport({ month: "2026-09" }, admin);
    expect((await GstService.getReport(made.id)).month).toBe("2026-09");
    expect((await failure(GstService.getReport("22222222-2222-4222-8222-222222222222"))).errorCode).toBe(404);
    expect((await failure(GstService.getReport("nope"))).errorCode).toBe(404);
    expect((await failure(GstService.listReports({ year: "1900" }, { page: 1, limit: 20, offset: 0 }))).errorCode).toBe(400);
  });

  it("exports csv with a totals row and json, and refuses xlsx", async () => {
    const made = await GstService.generateReport({ month: "2026-09" }, admin);
    const csv = await GstService.exportReport(made.id, { format: "csv" });
    expect(csv.contentType).toMatch(/text\/csv/);
    expect(csv.fileName).toBe("gst-2026-09.csv");
    const lines = csv.body.trim().split("\n");
    expect(lines[0]).toBe("month,2026-09");
    expect(lines[lines.length - 1]).toBe("TOTAL,15,1770.00,0.00,1500.00,270.00,135.00,135.00");
    expect(JSON.parse((await GstService.exportReport(made.id, {})).body).month).toBe("2026-09");
    expect((await failure(GstService.exportReport(made.id, { format: "xlsx" }))).errorCode).toBe(400);
  });
});
