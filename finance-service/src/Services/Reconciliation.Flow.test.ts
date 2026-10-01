jest.mock("../Queries/Payment.Query.js", () => ({ PaymentQuery: { listCapturedBetween: jest.fn() } }));
jest.mock("../Queries/Reconciliation.Query.js", () => ({
  ReconciliationQuery: {
    createRun: jest.fn(async (data: any) => ({ id: "run-1", ranAt: new Date(), ...data, exceptions: data.exceptionCount })),
    listBankLines: jest.fn(),
    createStatement: jest.fn(async (meta: any, lines: any[]) => ({ id: "st-1", ...meta, lineCount: lines.length, skippedCount: 0, createdAt: new Date() })),
  },
}));
jest.mock("../Clients/Payment.Client.js", () => ({ PaymentClient: { listPayments: jest.fn() } }));

import { CustomException } from "../../commons/Exception/CustomException.js";
import { Actor } from "../Middleware/StoreScope.js";
import { ReconciliationService, matchBank, matchGateway } from "./Reconciliation.Service.js";

const { PaymentQuery } = jest.requireMock("../Queries/Payment.Query.js");
const { ReconciliationQuery } = jest.requireMock("../Queries/Reconciliation.Query.js");
const { PaymentClient } = jest.requireMock("../Clients/Payment.Client.js");

const admin: Actor = { id: "admin-1", role: "admin", name: "Admin", storeId: null, scopeStoreId: null };
const mine = (id: string, orderRef: string, amountPaise: number, extra: Record<string, unknown> = {}) => ({
  id,
  orderRef,
  razorpayPaymentId: `pay_${id}`,
  amountPaise,
  gatewayAmountPaise: null,
  status: "captured",
  ...extra,
});
const gw = (id: string, amount: number, status = "captured") => ({ id: `pay_${id}`, orderId: "o", status, amount, method: null, errorDescription: null });

describe("matchGateway", () => {
  it("matches equal captured payments and reports each kind of difference once", () => {
    const outcome = matchGateway(
      [gw("1", 1000), gw("2", 2500), gw("9", 700), gw("3", 400, "failed")],
      [mine("1", "A", 1000), mine("2", "B", 2000), mine("4", "D", 600)]
    );
    expect(outcome.matched).toBe(1);
    expect(outcome.exceptions).toEqual(
      expect.arrayContaining([
        { reference: "B", expectedPaise: 2000, actualPaise: 2500, reason: "amount_differs" },
        { reference: "pay_9", expectedPaise: null, actualPaise: 700, reason: "missing_locally" },
        { reference: "D", expectedPaise: 600, actualPaise: null, reason: "missing_at_provider" },
      ])
    );
    expect(outcome.exceptions).toHaveLength(3);
  });

  it("compares against the amount the gateway reported when it differed from the request", () => {
    expect(matchGateway([gw("1", 1200)], [mine("1", "A", 1000, { gatewayAmountPaise: 1200 })]).matched).toBe(1);
  });
});

describe("matchBank", () => {
  const line = (id: string, amountPaise: number, reference: string | null, description = "NEFT credit") => ({ id, date: "2026-10-01", description, reference, amountPaise });

  it("matches a credit to a payment by its gateway id or order reference, once", () => {
    const outcome = matchBank(
      [line("l1", 1000, "pay_1"), line("l2", 2000, null, "UPI order-b settlement"), line("l3", 1000, "pay_1"), line("l4", 9999, "mystery")],
      [mine("1", "order-a", 1000), mine("2", "order-b", 2000), mine("3", "order-c", 300)]
    );
    expect(outcome.matched).toBe(2);
    const reasons = outcome.exceptions.map((e) => `${e.reason}:${e.reference}`).sort();
    expect(reasons).toEqual(["duplicate_bank_credit:order-a", "missing_in_bank:order-c", "unmatched_bank_credit:mystery"]);
  });

  it("flags an amount that differs and ignores debits", () => {
    const outcome = matchBank([line("l1", 900, "pay_1"), line("l2", -500, "pay_1")], [mine("1", "order-a", 1000)]);
    expect(outcome.exceptions).toEqual([{ reference: "order-a", expectedPaise: 1000, actualPaise: 900, reason: "amount_differs" }]);
    expect(outcome.matched).toBe(0);
  });
});

describe("createRun", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("reconciles against the provider, paging until it runs dry, and stores the run", async () => {
    PaymentQuery.listCapturedBetween.mockResolvedValue([mine("1", "A", 1000)]);
    PaymentClient.listPayments
      .mockResolvedValueOnce({ items: Array.from({ length: 100 }, (_, i) => gw(`x${i}`, 5)), ignored: 0, fetched: 100 })
      .mockResolvedValueOnce({ items: [gw("1", 1000)], ignored: 0, fetched: 1 });
    const run = await ReconciliationService.createRun({ from: "2026-10-01", to: "2026-10-02", source: "razorpay" }, admin);
    expect(PaymentClient.listPayments).toHaveBeenCalledTimes(2);
    expect(PaymentClient.listPayments.mock.calls[1][0].skip).toBe(100);
    expect(run).toMatchObject({ matched: 1, exceptions: 100, truncated: false, source: "razorpay" });
  });

  it("caps the stored exceptions but reports the true count", async () => {
    PaymentQuery.listCapturedBetween.mockResolvedValue([]);
    PaymentClient.listPayments.mockResolvedValue({ items: Array.from({ length: 100 }, (_, i) => gw(`y${i}`, 5)), ignored: 0, fetched: 99 });
    await ReconciliationService.createRun({ from: "2026-10-01", to: "2026-10-01" }, admin);
    const stored = ReconciliationQuery.createRun.mock.calls[0][0];
    expect(stored.exceptionCount).toBe(100);
    expect(stored.exceptions.length).toBeLessThanOrEqual(500);
  });

  it("refuses a bank run with no statement lines, an over-long window and a bad source", async () => {
    PaymentQuery.listCapturedBetween.mockResolvedValue([]);
    ReconciliationQuery.listBankLines.mockResolvedValue([]);
    const failure = async (input: unknown) => {
      try {
        await ReconciliationService.createRun(input, admin);
      } catch (error) {
        return error as CustomException;
      }
      throw new Error("expected a refusal");
    };
    expect((await failure({ from: "2026-10-01", to: "2026-10-02", source: "bank" })).errorCode).toBe(400);
    expect((await failure({ from: "2026-01-01", to: "2026-10-02" })).errorCode).toBe(400);
    expect((await failure({ from: "2026-10-01", to: "2026-10-02", source: "cheque" })).errorCode).toBe(400);
  });

  it("surfaces a provider failure and stores nothing", async () => {
    PaymentQuery.listCapturedBetween.mockResolvedValue([]);
    PaymentClient.listPayments.mockRejectedValue(new CustomException("Payments are unavailable right now. Please try again.", 503));
    await expect(ReconciliationService.createRun({ from: "2026-10-01", to: "2026-10-01" }, admin)).rejects.toMatchObject({ errorCode: 503 });
    expect(ReconciliationQuery.createRun).not.toHaveBeenCalled();
  });
});

describe("uploadStatement", () => {
  const file = (text: string) => ({ field: "file", fileName: "stmt.csv", contentType: "text/csv", content: Buffer.from(text) });

  it("stores a valid statement and refuses a missing, empty or malformed file", async () => {
    const ok = await ReconciliationService.uploadStatement(file("date,description,amount\n2026-10-01,Deposit,10.00\n"), { bank: "HDFC" }, admin);
    expect(ok).toMatchObject({ lines: 1, bank: "HDFC", fileName: "stmt.csv" });
    for (const bad of [undefined, file(""), file("date,description,amount\nnope,x,1\n")]) {
      await expect(ReconciliationService.uploadStatement(bad, {}, admin)).rejects.toMatchObject({ errorCode: 400 });
    }
    await expect(
      ReconciliationService.uploadStatement({ ...file("x"), content: Buffer.alloc(1024 * 1024 + 1) }, {}, admin)
    ).rejects.toMatchObject({ errorCode: 413 });
  });
});
