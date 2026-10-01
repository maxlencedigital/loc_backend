jest.mock("../Queries/Ledger.Query.js", () => ({
  LedgerQuery: { post: jest.fn(async () => true), search: jest.fn(), totalsByAccount: jest.fn() },
}));

import { CustomException } from "../../commons/Exception/CustomException.js";
import { clock } from "../Utils/Dates.js";
import { accountForMode, expenseAccount, LedgerService } from "./Ledger.Service.js";

const { LedgerQuery } = jest.requireMock("../Queries/Ledger.Query.js");
const page = { page: 1, limit: 20, offset: 0 };

const failure = async (promise: Promise<unknown>): Promise<CustomException> => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a refusal");
};

beforeEach(() => {
  jest.clearAllMocks();
  clock.now = () => new Date("2026-10-15T06:00:00Z");
});
afterAll(() => {
  clock.now = () => new Date();
});

describe("postings", () => {
  it("every posting is two balanced lines with a stable source key", async () => {
    await LedgerService.postCapture({ id: "p1", orderRef: "LOC-1", storeId: "s1" }, 50_000, {} as any);
    await LedgerService.postExpensePaid({ id: "e1", storeId: null, paymentMode: "upi", amountPaise: 700 }, "Rent", {} as any);
    for (const [posting] of LedgerQuery.post.mock.calls) {
      const debit = posting.lines.reduce((n: number, l: any) => n + l.debitPaise, 0);
      const credit = posting.lines.reduce((n: number, l: any) => n + l.creditPaise, 0);
      expect(debit).toBe(credit);
      expect(debit).toBeGreaterThan(0);
    }
    expect(LedgerQuery.post.mock.calls[0][0]).toMatchObject({ sourceType: "payment_capture", sourceId: "p1", date: "2026-10-15", storeId: "s1" });
    expect(LedgerQuery.post.mock.calls[1][0].lines.map((l: any) => l.account)).toEqual(["expense:rent", "bank"]);
  });

  it("refuses a zero or unbalanced posting rather than writing half a journal", async () => {
    await expect(LedgerService.postCapture({ id: "p1", orderRef: "x", storeId: null }, 0, {} as any)).rejects.toThrow(/Unbalanced/);
    expect(LedgerQuery.post).not.toHaveBeenCalled();
  });

  it("puts cash in the till and every other mode in the bank; expense accounts are per category", () => {
    expect(accountForMode("cash")).toBe("cash");
    for (const mode of ["bank", "upi", "card", null]) expect(accountForMode(mode)).toBe("bank");
    expect(expenseAccount("  Detergent ")).toBe("expense:detergent");
  });
});

describe("reading the ledger", () => {
  it("lists in rupees with filters and a bounded window", async () => {
    LedgerQuery.search.mockResolvedValue({
      items: [{ id: "1", date: "2026-10-01", account: "cash", debitPaise: 12_345, creditPaise: 0, reference: "r", storeId: null }],
      total: 1,
    });
    const result = await LedgerService.listEntries({ from: "2026-10-01", to: "2026-10-31", account: "cash", storeId: "11111111-1111-4111-8111-111111111101" }, page);
    expect(result.items[0]).toEqual({ id: "1", date: "2026-10-01", account: "cash", debit: 123.45, credit: 0, reference: "r", storeId: null });
    expect(LedgerQuery.search.mock.calls[0][0]).toMatchObject({ account: "cash", from: "2026-10-01" });
    for (const query of [{ from: "2025-01-01", to: "2026-10-31" }, { from: "x" }, { storeId: "x" }, { account: "a".repeat(101) }]) {
      expect((await failure(LedgerService.listEntries(query, page))).errorCode).toBe(400);
    }
  });

  it("summarises by account with debit minus credit as the balance, defaulting to the last 31 days", async () => {
    LedgerQuery.totalsByAccount.mockResolvedValue([
      { account: "bank", debitPaise: 100_000, creditPaise: 25_050 },
      { account: "sales_online", debitPaise: 0, creditPaise: 100_000 },
    ]);
    const summary = await LedgerService.summary({});
    expect(summary).toMatchObject({ from: "2026-09-15", to: "2026-10-15" });
    expect(summary.accounts).toEqual([
      { account: "bank", debit: 1000, credit: 250.5, balance: 749.5 },
      { account: "sales_online", debit: 0, credit: 1000, balance: -1000 },
    ]);
    expect(LedgerQuery.totalsByAccount.mock.calls[0][0]).toMatchObject({ from: "2026-09-15", to: "2026-10-15" });
  });
});
