import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { Page, PageRequest, toPage } from "../../commons/Utils/Pagination.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";
import { PaymentClient } from "../Clients/Payment.Client.js";
import { Actor } from "../Middleware/StoreScope.js";
import { IGatewayPayment } from "../Models/Payment/Payment.Interface.js";
import {
  IBankLine,
  IReconcilablePayment,
  IReconciliationException,
  IReconciliationRun,
  ReconciliationSource,
} from "../Models/Reconciliation/Reconciliation.Interface.js";
import { PaymentQuery } from "../Queries/Payment.Query.js";
import { ReconciliationQuery } from "../Queries/Reconciliation.Query.js";
import { dayRange, istDayEnd, istDayStart } from "../Utils/Dates.js";
import { optionalOneOf, optionalText, parseBody, pathId } from "../Utils/Input.js";
import { parseBankCsv } from "../Utils/BankCsv.js";
import { toRupees } from "../Utils/Money.js";
import { UploadedFile } from "../Utils/Multipart.js";

const SOURCES: readonly ReconciliationSource[] = ["bank", "razorpay"];
const MAX_RUN_DAYS = 31;
// A run looks at no more than this many rows on each side; past it the run says it was cut short.
export const RUN_ROW_CAP = 2000;
const GATEWAY_PAGE = 100;
const STORED_EXCEPTION_CAP = 500;
export const MAX_STATEMENT_BYTES = 1024 * 1024;

type Found = Omit<IReconciliationException, "id">;
interface Outcome {
  matched: number;
  exceptions: Found[];
}

/** Provider against our records. The provider's captured payments are the truth of what was paid. */
export const matchGateway = (gateway: IGatewayPayment[], ours: IReconcilablePayment[]): Outcome => {
  const byGatewayId = new Map(ours.filter((p) => p.razorpayPaymentId).map((p) => [p.razorpayPaymentId as string, p]));
  const seen = new Set<string>();
  const exceptions: Found[] = [];
  let matched = 0;
  for (const g of gateway) {
    if (g.status !== "captured") continue;
    const mine = byGatewayId.get(g.id);
    if (!mine) {
      exceptions.push({ reference: g.id, expectedPaise: null, actualPaise: g.amount, reason: "missing_locally" });
      continue;
    }
    seen.add(g.id);
    const recorded = mine.gatewayAmountPaise ?? mine.amountPaise;
    if (recorded !== g.amount) {
      exceptions.push({ reference: mine.orderRef, expectedPaise: recorded, actualPaise: g.amount, reason: "amount_differs" });
    } else matched += 1;
  }
  for (const mine of ours) {
    if (mine.razorpayPaymentId && !seen.has(mine.razorpayPaymentId)) {
      exceptions.push({
        reference: mine.orderRef,
        expectedPaise: mine.gatewayAmountPaise ?? mine.amountPaise,
        actualPaise: null,
        reason: "missing_at_provider",
      });
    }
  }
  return { matched, exceptions };
};

// Exact tokens only, never substrings, and at least 4 characters so a bare "1" cannot match an order.
const MIN_KEY = 4;
const tokensOf = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9_-]+/).filter((t) => t.length >= MIN_KEY);

/**
 * Bank credits against captured payments. A credit belongs to a payment when its reference or
 * description carries that payment's gateway id or order reference. Each payment is matched once.
 */
export const matchBank = (lines: IBankLine[], ours: IReconcilablePayment[]): Outcome => {
  const index = new Map<string, IReconcilablePayment>();
  for (const p of ours) {
    if (p.razorpayPaymentId) index.set(p.razorpayPaymentId.toLowerCase(), p);
    index.set(p.orderRef.toLowerCase(), p);
  }
  const claimed = new Set<string>();
  const exceptions: Found[] = [];
  let matched = 0;
  for (const line of lines) {
    if (line.amountPaise <= 0) continue;
    const payment = tokensOf(`${line.reference ?? ""} ${line.description}`)
      .map((t) => index.get(t))
      .find((p) => p !== undefined);
    if (!payment) {
      exceptions.push({
        reference: line.reference ?? line.description.slice(0, 120),
        expectedPaise: null,
        actualPaise: line.amountPaise,
        reason: "unmatched_bank_credit",
      });
      continue;
    }
    const expected = payment.gatewayAmountPaise ?? payment.amountPaise;
    if (expected !== line.amountPaise) {
      exceptions.push({ reference: payment.orderRef, expectedPaise: expected, actualPaise: line.amountPaise, reason: "amount_differs" });
    } else if (claimed.has(payment.id)) {
      exceptions.push({ reference: payment.orderRef, expectedPaise: null, actualPaise: line.amountPaise, reason: "duplicate_bank_credit" });
    } else matched += 1;
    claimed.add(payment.id);
  }
  for (const p of ours) {
    if (!claimed.has(p.id)) {
      exceptions.push({ reference: p.orderRef, expectedPaise: p.gatewayAmountPaise ?? p.amountPaise, actualPaise: null, reason: "missing_in_bank" });
    }
  }
  return { matched, exceptions };
};

const toRun = (run: IReconciliationRun) => ({
  id: run.id,
  from: run.from,
  to: run.to,
  source: run.source,
  matched: run.matched,
  exceptions: run.exceptions,
  truncated: run.truncated,
  ranAt: run.ranAt,
});

const fetchGateway = async (from: string, to: string): Promise<{ items: IGatewayPayment[]; truncated: boolean }> => {
  const fromUnix = Math.floor(istDayStart(from).getTime() / 1000);
  const toUnix = Math.floor(istDayEnd(to).getTime() / 1000) - 1;
  const items: IGatewayPayment[] = [];
  for (let skip = 0; skip < RUN_ROW_CAP; skip += GATEWAY_PAGE) {
    const page = await PaymentClient.listPayments({ fromUnix, toUnix, count: GATEWAY_PAGE, skip });
    items.push(...page.items);
    if (page.fetched < GATEWAY_PAGE) return { items, truncated: false };
  }
  return { items, truncated: true };
};

const createRun = async (input: unknown, actor: Actor) => {
  try {
    const body = parseBody(input);
    requireFields(body, ["from", "to"]);
    const { from, to } = dayRange({ from: body.from, to: body.to }, { defaultDays: 1, maxDays: MAX_RUN_DAYS });
    const source = optionalOneOf(body.source, SOURCES, "source") ?? "razorpay";

    const ours = await PaymentQuery.listCapturedBetween(istDayStart(from), istDayEnd(to), RUN_ROW_CAP + 1);
    let truncated = ours.length > RUN_ROW_CAP;
    const mine = ours.slice(0, RUN_ROW_CAP);
    let outcome: Outcome;
    if (source === "razorpay") {
      const gateway = await fetchGateway(from, to);
      truncated = truncated || gateway.truncated;
      outcome = matchGateway(gateway.items, mine);
    } else {
      const lines = await ReconciliationQuery.listBankLines(from, to, RUN_ROW_CAP + 1);
      truncated = truncated || lines.length > RUN_ROW_CAP;
      if (lines.length === 0) {
        throw new CustomException("There are no bank statement lines in that period. Upload a statement first.", badRequest);
      }
      outcome = matchBank(lines.slice(0, RUN_ROW_CAP), mine);
    }

    const run = await ReconciliationQuery.createRun({
      source,
      from,
      to,
      matched: outcome.matched,
      exceptionCount: outcome.exceptions.length,
      truncated,
      ranByUserId: actor.id,
      exceptions: outcome.exceptions.slice(0, STORED_EXCEPTION_CAP),
    });
    return toRun(run);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listRuns = async (page: PageRequest): Promise<Page<ReturnType<typeof toRun>>> => {
  try {
    const { items, total } = await ReconciliationQuery.searchRuns(page);
    return toPage(items.map(toRun), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getRun = async (rawId: string) => {
  try {
    const run = await ReconciliationQuery.findRun(pathId(rawId, "Reconciliation run"));
    if (!run) throw new CustomException("Reconciliation run not found.", notFound);
    return toRun(run);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listExceptions = async (rawId: string) => {
  try {
    const id = pathId(rawId, "Reconciliation run");
    const run = await ReconciliationQuery.findRun(id);
    if (!run) throw new CustomException("Reconciliation run not found.", notFound);
    const rows = await ReconciliationQuery.listExceptions(id, STORED_EXCEPTION_CAP);
    return {
      total: run.exceptions,
      // Only the first 500 are kept; the run's own count says how many there really were.
      exceptions: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        expected: row.expectedPaise === null ? null : toRupees(row.expectedPaise),
        actual: row.actualPaise === null ? null : toRupees(row.actualPaise),
        reason: row.reason,
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const uploadStatement = async (file: UploadedFile | undefined, fields: Record<string, string>, actor: Actor) => {
  try {
    if (!file) throw new CustomException("file is required.", badRequest);
    if (file.content.length === 0) throw new CustomException("The file is empty.", badRequest);
    if (file.content.length > MAX_STATEMENT_BYTES) throw new CustomException("The file is too large (1 MB at most).", 413);
    const bank = optionalText(fields.bank, "bank", 80) ?? null;
    const lines = parseBankCsv(file.content.toString("utf8"), bank);
    const statement = await ReconciliationQuery.createStatement({ bank, fileName: file.fileName, uploadedByUserId: actor.id }, lines);
    return {
      id: statement.id,
      bank: statement.bank,
      fileName: statement.fileName,
      lines: statement.lineCount,
      // Lines already stored by an earlier upload of the same statement.
      skipped: statement.skippedCount,
      uploadedAt: statement.createdAt,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const ReconciliationService = { createRun, listRuns, getRun, listExceptions, uploadStatement };
