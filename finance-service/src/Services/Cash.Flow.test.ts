// In-memory cash book. lockClose holds a per-day lock until the transaction ends (like the row lock
// the real query takes), so the "deposits cannot exceed the count" check is genuinely serialised.
jest.mock("../Queries/Transaction.Query.js", () => ({
  TransactionQuery: {
    run: async (work: any) => {
      const tx = { releases: [] as Array<() => void> };
      try {
        return await work(tx);
      } finally {
        tx.releases.forEach((release) => release());
      }
    },
  },
}));
jest.mock("../Queries/Ledger.Query.js", () => ({ LedgerQuery: { post: async (posting: any) => (globalThis as any).__ledger.push(posting) } }));
jest.mock("../Queries/Cash.Query.js", () => {
  const closes = new Map<string, any>();
  const entries: any[] = [];
  const variances = new Map<string, any>();
  const queues = new Map<string, Promise<void>>();
  let seq = 0;
  const uuid = (p: string) => `${p}-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const k = (storeId: string, date: string) => `${storeId}|${date}`;
  const clone = (x: any) => (x ? { ...x } : null);
  const lag = () => new Promise((resolve) => setTimeout(resolve, 1));
  const scoped = (row: any, scope: string | null) => row && (!scope || row.storeId === scope);
  const totals = (date: string, storeId: string | null) => {
    const byStore = new Map<string, any>();
    for (const e of entries.filter((x) => x.date === date && (!storeId || x.storeId === storeId))) {
      const t = byStore.get(e.storeId) ?? { storeId: e.storeId, countedPaise: 0, bankedPaise: 0 };
      if (e.kind === "counted") t.countedPaise += e.amountPaise;
      else t.bankedPaise += e.amountPaise;
      byStore.set(e.storeId, t);
    }
    return [...byStore.values()];
  };
  return {
    __closes: closes,
    __entries: entries,
    __variances: variances,
    CashQuery: {
      insertClose: async (data: any) => {
        if (closes.has(k(data.storeId, data.date))) return false;
        closes.set(k(data.storeId, data.date), {
          id: uuid("d0000000"),
          storeId: data.storeId,
          storeName: data.storeName,
          date: data.date,
          expectedPaise: data.expectedPaise,
          closedByUserId: data.closedByUserId,
          closedByName: data.closedByName,
          status: "closed",
          approvedByUserId: null,
          approvedAt: null,
          approvalNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return true;
      },
      findClose: async (storeId: string, date: string) => clone(closes.get(k(storeId, date))),
      findCloseById: async (id: string, scope: string | null) => clone([...closes.values()].find((c) => c.id === id && scoped(c, scope))),
      searchCloses: jest.fn(async () => ({ items: [...closes.values()].map(clone), total: closes.size })),
      closesForDate: jest.fn(async (date: string, storeId: string | null) =>
        [...closes.values()].filter((c) => c.date === date && (!storeId || c.storeId === storeId)).map(clone)
      ),
      lockClose: async (storeId: string, date: string, tx: any) => {
        const key = k(storeId, date);
        const previous = queues.get(key) ?? Promise.resolve();
        let release!: () => void;
        queues.set(key, new Promise<void>((resolve) => (release = resolve)));
        await previous;
        tx.releases.push(release);
        return clone(closes.get(key));
      },
      approveClose: async (id: string, approver: string, note: string | null) => {
        const row = [...closes.values()].find((c) => c.id === id);
        if (!row || row.status !== "closed") return false;
        Object.assign(row, { status: "approved", approvedByUserId: approver, approvedAt: new Date(), approvalNote: note });
        return true;
      },
      addEntry: async (data: any) => {
        await lag();
        if (entries.some((e) => e.storeId === data.storeId && e.kind === data.kind && e.idempotencyKey === data.idempotencyKey)) return false;
        entries.push({ ...data });
        return true;
      },
      hasEntry: async (storeId: string, kind: string, key: string) =>
        entries.some((e) => e.storeId === storeId && e.kind === kind && e.idempotencyKey === key),
      totalsForDate: async (date: string, storeId: string | null) => {
        await lag();
        return totals(date, storeId);
      },
      openVariance: async (data: any) => {
        if (!variances.has(k(data.storeId, data.date))) {
          variances.set(k(data.storeId, data.date), { id: uuid("f0000000"), status: "open", resolution: null, note: null, resolvedByUserId: null, resolvedAt: null, createdAt: new Date(), ...data });
        }
      },
      findVariance: async (storeId: string, date: string) => clone(variances.get(k(storeId, date))),
      findVarianceById: async (id: string, scope: string | null) => clone([...variances.values()].find((v) => v.id === id && scoped(v, scope))),
      searchVariances: jest.fn(async () => ({ items: [...variances.values()].map(clone), total: variances.size })),
      resolveVariance: async (id: string, data: any) => {
        const row = [...variances.values()].find((v) => v.id === id);
        if (!row || row.status !== "open") return false;
        Object.assign(row, data, { status: "resolved", resolvedAt: new Date() });
        return true;
      },
    },
  };
});
const ledger: any[] = [];
(globalThis as any).__ledger = ledger;

import { CustomException } from "../../commons/Exception/CustomException.js";
import { Actor } from "../Middleware/StoreScope.js";
import { clock } from "../Utils/Dates.js";
import { CashService, dayStatus } from "./Cash.Service.js";

const { __closes: closes, __entries: entries, __variances: variances, CashQuery } = jest.requireMock("../Queries/Cash.Query.js");

const STORE_A = "11111111-1111-4111-8111-111111111101";
const STORE_B = "11111111-1111-4111-8111-111111111102";
const DAY = "2026-09-30";
const admin: Actor = { id: "admin-1", role: "admin", name: "Asha", storeId: null, scopeStoreId: null };
const managerA: Actor = { id: "m-1", role: "manager", name: "Meera", storeId: STORE_A, scopeStoreId: null };

const failure = async (promise: Promise<unknown>): Promise<CustomException> => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a refusal");
};

const close = (overrides: Record<string, unknown> = {}) =>
  CashService.registerDayClose({ storeId: STORE_A, storeName: "Indiranagar", date: DAY, expectedPaise: 100_000, countedPaise: 100_000, closedByName: "Meera Nair", ...overrides });
const deposit = (amountPaise: number, key = "dep-1", overrides: Record<string, unknown> = {}) =>
  CashService.registerDeposit({ storeId: STORE_A, date: DAY, amountPaise, ...overrides }, key);

beforeEach(() => {
  closes.clear();
  entries.length = 0;
  variances.clear();
  ledger.length = 0;
  jest.clearAllMocks();
  clock.now = () => new Date("2026-10-01T06:00:00Z");
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  clock.now = () => new Date();
});

describe("day close from commerce", () => {
  it("records the close and the count, with no variance when they agree", async () => {
    expect(await close()).toMatchObject({ created: true });
    expect(entries).toEqual([expect.objectContaining({ kind: "counted", amountPaise: 100_000, idempotencyKey: `close:${DAY}` })]);
    expect(variances.size).toBe(0);
  });

  it("opens a signed variance (counted minus expected) when the till is out", async () => {
    await close({ countedPaise: 98_500 });
    expect([...variances.values()][0]).toMatchObject({ storeId: STORE_A, date: DAY, amountPaise: -1500, status: "open" });
    await close({ storeId: STORE_B, countedPaise: 100_700 });
    expect(variances.get(`${STORE_B}|${DAY}`).amountPaise).toBe(700);
  });

  it("is idempotent for the same figures and refuses different ones", async () => {
    const first = await close();
    const again = await close();
    expect(again).toMatchObject({ id: first.id, created: false });
    expect(entries).toHaveLength(1);
    expect((await failure(close({ countedPaise: 5 }))).errorCode).toBe(409);
    expect((await failure(close({ expectedPaise: 5 }))).errorCode).toBe(409);
  });

  it("validates its input", async () => {
    for (const patch of [{ storeId: "x" }, { date: "2026-02-30" }, { date: "2099-01-01" }, { expectedPaise: -1 }, { countedPaise: 1.5 }, { closedByName: "" }, { storeName: "x".repeat(121) }]) {
      expect((await failure(close(patch))).errorCode).toBe(400);
    }
    expect(closes.size).toBe(0);
  });
});

describe("deposits", () => {
  it("needs a closed day, an idempotency key, and a valid amount", async () => {
    expect((await failure(deposit(1000))).errorCode).toBe(409);
    await close();
    expect((await failure(CashService.registerDeposit({ storeId: STORE_A, date: DAY, amountPaise: 1000 }, undefined))).errorCode).toBe(400);
    for (const amount of [0, -5, 1.5, "10"]) expect((await failure(deposit(amount as any))).errorCode).toBe(400);
    expect(entries.filter((e: any) => e.kind === "deposit")).toHaveLength(0);
  });

  it("banks cash against the count, journalling bank over cash, and replays a repeated key", async () => {
    await close();
    expect(await deposit(60_000, "dep-1", { reference: "slip 12" })).toMatchObject({ created: true, amount: 600 });
    expect(await deposit(60_000, "dep-1")).toMatchObject({ created: false });
    expect(entries.filter((e: any) => e.kind === "deposit")).toHaveLength(1);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ sourceType: "cash_deposit", date: DAY, storeId: STORE_A, reference: "slip 12" });
    expect(ledger[0].lines).toEqual([
      { account: "bank", debitPaise: 60_000, creditPaise: 0 },
      { account: "cash", debitPaise: 0, creditPaise: 60_000 },
    ]);
  });

  it("refuses deposits above the cash counted", async () => {
    await close({ countedPaise: 50_000 });
    await deposit(30_000, "a");
    expect((await failure(deposit(20_001, "b"))).errorCode).toBe(409);
    await expect(deposit(20_000, "c")).resolves.toMatchObject({ created: true });
  });

  it("two deposits that each fit alone but not together: exactly one is banked", async () => {
    await close({ countedPaise: 100_000 });
    const results = await Promise.allSettled([deposit(70_000, "x"), deposit(70_000, "y")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.errorCode).toBe(409);
    expect(entries.filter((e: any) => e.kind === "deposit").reduce((n: number, e: any) => n + e.amountPaise, 0)).toBe(70_000);
  });
});

describe("the daily view", () => {
  it("shows expected, counted, banked and variance (banked minus expected) with a status per store", async () => {
    await close();
    await deposit(100_000, "all");
    await close({ storeId: STORE_B, storeName: "Koramangala", expectedPaise: 80_000, countedPaise: 79_000 });
    await CashService.registerDeposit({ storeId: STORE_B, date: DAY, amountPaise: 79_000 }, "b1");
    const view = await CashService.getDailyCash({ date: DAY }, admin);
    expect(view.stores).toEqual([
      { storeId: STORE_A, name: "Indiranagar", expected: 1000, counted: 1000, banked: 1000, variance: 0, status: "agreed" },
      { storeId: STORE_B, name: "Koramangala", expected: 800, counted: 790, banked: 790, variance: -10, status: "variance" },
    ]);
    expect(view.total).toEqual({ expected: 1800, counted: 1790, banked: 1790, variance: -10 });
  });

  it("calls a closed but not yet banked day a variance, and an unclosed asked-for store missing", async () => {
    await close();
    const view = await CashService.getDailyCash({ date: DAY, storeId: STORE_A }, admin);
    expect(view.stores[0]).toMatchObject({ banked: 0, variance: -1000, status: "variance" });
    const missing = await CashService.getDailyCash({ date: "2026-09-29", storeId: STORE_A }, admin);
    expect(missing.stores).toEqual([{ storeId: STORE_A, name: null, expected: 0, counted: 0, banked: 0, variance: 0, status: "missing" }]);
  });

  it("limits a manager to their store and answers 404 when they ask for another", async () => {
    await close();
    await close({ storeId: STORE_B });
    const view = await CashService.getDailyCash({ date: DAY }, managerA);
    expect(view.stores.map((s: any) => s.storeId)).toEqual([STORE_A]);
    expect((await failure(CashService.getDailyCash({ date: DAY, storeId: STORE_B }, managerA))).errorCode).toBe(404);
  });

  it("needs a real date", async () => {
    for (const query of [{}, { date: "nope" }, { date: "2026-02-30" }]) {
      expect((await failure(CashService.getDailyCash(query as any, admin))).errorCode).toBe(400);
    }
  });

  it("dayStatus agrees only when the count matches and the bank matches the count", () => {
    expect(dayStatus(100, { countedPaise: 100, bankedPaise: 100 })).toBe("agreed");
    expect(dayStatus(100, { countedPaise: 100, bankedPaise: 90 })).toBe("variance");
    expect(dayStatus(100, { countedPaise: 90, bankedPaise: 90 })).toBe("variance");
  });
});

describe("variances", () => {
  it("lists them with the store scope and resolves one with a recorded explanation", async () => {
    await close({ countedPaise: 99_000 });
    const [variance] = [...variances.values()];
    await CashService.listCashVariances({ resolved: "false", from: "2026-09-01" }, managerA, { page: 1, limit: 20, offset: 0 });
    expect(CashQuery.searchVariances.mock.calls[0][0]).toEqual({ storeId: STORE_A, resolved: false, from: "2026-09-01", to: undefined });
    const resolved = await CashService.resolveCashVariance(variance.id, { resolution: "Float was paid out", note: "approved by Meera" }, admin);
    expect(resolved).toMatchObject({ status: "resolved", resolution: "Float was paid out", amount: -10 });
    expect(variances.get(`${STORE_A}|${DAY}`)).toMatchObject({ status: "resolved", resolvedByUserId: "admin-1" });
  });

  it("refuses to resolve twice, with no resolution text, or an unknown one", async () => {
    await close({ countedPaise: 99_000 });
    const [variance] = [...variances.values()];
    expect((await failure(CashService.resolveCashVariance(variance.id, {}, admin))).errorCode).toBe(400);
    await CashService.resolveCashVariance(variance.id, { resolution: "Counted again" }, admin);
    expect((await failure(CashService.resolveCashVariance(variance.id, { resolution: "again" }, admin))).errorCode).toBe(409);
    expect((await failure(CashService.resolveCashVariance("dddddddd-0000-4000-8000-000000000001", { resolution: "x" }, admin))).errorCode).toBe(404);
  });

  it("two admins resolving at once: one wins, the other is told it is already resolved", async () => {
    await close({ countedPaise: 99_000 });
    const [variance] = [...variances.values()];
    const results = await Promise.allSettled([
      CashService.resolveCashVariance(variance.id, { resolution: "one" }, admin),
      CashService.resolveCashVariance(variance.id, { resolution: "two" }, admin),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.errorCode).toBe(409);
  });
});

describe("daily closes", () => {
  it("lists and reads them, scoped, with banked and variance on the single view", async () => {
    await close();
    await close({ storeId: STORE_B });
    const one = [...closes.values()][0];
    await CashService.listDailyCloses({ date: DAY }, managerA, { page: 1, limit: 20, offset: 0 });
    expect(CashQuery.searchCloses.mock.calls[0][0]).toEqual({ date: DAY, storeId: STORE_A });
    const view = await CashService.getDailyClose(one.id, managerA);
    expect(view).toMatchObject({ status: "closed", cashStatus: "variance", expected: 1000, counted: 1000, banked: 0 });
    const other = [...closes.values()][1];
    expect((await failure(CashService.getDailyClose(other.id, managerA))).errorCode).toBe(404);
    expect((await failure(CashService.getDailyClose("nope", admin))).errorCode).toBe(404);
  });

  it("approves a day only once its variance is resolved, and approving twice is a no-op", async () => {
    await close({ countedPaise: 99_000 });
    const day = [...closes.values()][0];
    expect((await failure(CashService.approveDailyClose(day.id, {}, admin))).errorCode).toBe(409);
    await CashService.resolveCashVariance([...variances.values()][0].id, { resolution: "Explained" }, admin);
    expect(await CashService.approveDailyClose(day.id, { note: "ok" }, admin)).toMatchObject({ status: "approved" });
    expect(closes.get(`${STORE_A}|${DAY}`)).toMatchObject({ approvedByUserId: "admin-1", approvalNote: "ok" });
    expect(await CashService.approveDailyClose(day.id, {}, { ...admin, id: "admin-2" })).toMatchObject({ status: "approved" });
    expect(closes.get(`${STORE_A}|${DAY}`).approvedByUserId).toBe("admin-1");
  });

  it("approves a clean day straight away", async () => {
    await close();
    await expect(CashService.approveDailyClose([...closes.values()][0].id, {}, admin)).resolves.toMatchObject({ status: "approved" });
  });
});
