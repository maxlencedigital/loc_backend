import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { Page, PageRequest, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import { ILedgerAccountTotal, ILedgerEntry, ILedgerFilter, ILedgerPosting } from "../Models/Ledger/Ledger.Interface.js";
import { LedgerQuery } from "../Queries/Ledger.Query.js";
import type { Db } from "../Queries/Db.js";
import { addDays, dayRange, istToday, optionalDay } from "../Utils/Dates.js";
import { queryString, queryUuid } from "../Utils/Input.js";
import { toRupees } from "../Utils/Money.js";

// The chart of accounts is small and fixed; expense accounts are per category.
export const ACCOUNTS = {
  cash: "cash",
  bank: "bank",
  razorpayClearing: "razorpay_clearing",
  salesOnline: "sales_online",
  receivables: "receivables",
  refunds: "refunds",
} as const;

export const expenseAccount = (categoryName: string): string => `expense:${categoryName.trim().toLowerCase()}`.slice(0, 100);

// Cash stays in the till; everything else lands in the bank.
export const accountForMode = (mode: string | null): string => (mode === "cash" ? ACCOUNTS.cash : ACCOUNTS.bank);

// Postings are written inside the transaction of the event that caused them, so a business
// event and its ledger lines commit or roll back together. The unique source key makes a
// repeated event post nothing.
const post = async (posting: ILedgerPosting, db: Db): Promise<void> => {
  const debit = posting.lines.reduce((sum, line) => sum + line.debitPaise, 0);
  const credit = posting.lines.reduce((sum, line) => sum + line.creditPaise, 0);
  if (debit !== credit || debit <= 0) throw new Error("Unbalanced ledger posting.");
  await LedgerQuery.post(posting, db);
};

const pair = (debitAccount: string, creditAccount: string, amountPaise: number) => [
  { account: debitAccount, debitPaise: amountPaise, creditPaise: 0 },
  { account: creditAccount, debitPaise: 0, creditPaise: amountPaise },
];

const postCapture = (
  payment: { id: string; orderRef: string; storeId: string | null },
  amountPaise: number,
  db: Db
) =>
  post(
    {
      sourceType: "payment_capture",
      sourceId: payment.id,
      date: istToday(),
      reference: payment.orderRef,
      storeId: payment.storeId,
      lines: pair(ACCOUNTS.razorpayClearing, ACCOUNTS.salesOnline, amountPaise),
    },
    db
  );

const postRefund = (
  refund: { sourceId: string; reference: string; storeId: string | null },
  amountPaise: number,
  db: Db
) =>
  post(
    {
      sourceType: "refund",
      sourceId: refund.sourceId,
      date: istToday(),
      reference: refund.reference,
      storeId: refund.storeId,
      lines: pair(ACCOUNTS.refunds, ACCOUNTS.razorpayClearing, amountPaise),
    },
    db
  );

const postExpensePaid = (
  expense: { id: string; storeId: string | null; paymentMode: string | null; amountPaise: number },
  categoryName: string,
  db: Db
) =>
  post(
    {
      sourceType: "expense_paid",
      sourceId: expense.id,
      date: istToday(),
      reference: `expense ${expense.id}`,
      storeId: expense.storeId,
      lines: pair(expenseAccount(categoryName), accountForMode(expense.paymentMode), expense.amountPaise),
    },
    db
  );

const postReceivablePayment = (
  payment: { id: string; storeId: string; mode: string; amountPaise: number },
  invoiceId: string,
  db: Db
) =>
  post(
    {
      sourceType: "receivable_payment",
      sourceId: payment.id,
      date: istToday(),
      reference: `invoice ${invoiceId}`,
      storeId: payment.storeId,
      lines: pair(accountForMode(payment.mode), ACCOUNTS.receivables, payment.amountPaise),
    },
    db
  );

const postDeposit = (
  deposit: { storeId: string; date: string; amountPaise: number; sourceId: string; reference: string | null },
  db: Db
) =>
  post(
    {
      sourceType: "cash_deposit",
      sourceId: deposit.sourceId,
      date: deposit.date,
      reference: deposit.reference ?? "cash deposit",
      storeId: deposit.storeId,
      lines: pair(ACCOUNTS.bank, ACCOUNTS.cash, deposit.amountPaise),
    },
    db
  );

const toEntry = (entry: ILedgerEntry) => ({
  id: entry.id,
  date: entry.date,
  account: entry.account,
  debit: toRupees(entry.debitPaise),
  credit: toRupees(entry.creditPaise),
  reference: entry.reference,
  storeId: entry.storeId,
});

const readFilter = (query: Record<string, unknown>, maxDays: number): ILedgerFilter => {
  const from = optionalDay(query.from, "from");
  const to = optionalDay(query.to, "to");
  if (from && to) dayRange({ from, to }, { defaultDays: 1, maxDays });
  const account = queryString(query.account, "account");
  if (account && account.length > 100) throw new CustomException("account is too long.", badRequest);
  return { from, to, storeId: queryUuid(query.storeId, "storeId"), account };
};

const MAX_LEDGER_DAYS = 366;

const listEntries = async (query: Record<string, unknown>, page: PageRequest): Promise<Page<ReturnType<typeof toEntry>>> => {
  try {
    const { items, total } = await LedgerQuery.search(readFilter(query, MAX_LEDGER_DAYS), page);
    return toPage(items.map(toEntry), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const summary = async (query: Record<string, unknown>) => {
  try {
    // Summaries default to the last 31 days so an open-ended call never sums the whole ledger.
    const given = readFilter(query, MAX_LEDGER_DAYS);
    const to = given.to ?? istToday();
    const filter: ILedgerFilter = { ...given, to, from: given.from ?? addDays(to, -30) };
    const totals: ILedgerAccountTotal[] = await LedgerQuery.totalsByAccount(filter);
    return {
      from: filter.from,
      to: filter.to,
      accounts: totals.map((t) => ({
        account: t.account,
        debit: toRupees(t.debitPaise),
        credit: toRupees(t.creditPaise),
        balance: toRupees(t.debitPaise - t.creditPaise),
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const LedgerService = {
  postCapture,
  postRefund,
  postExpensePaid,
  postReceivablePayment,
  postDeposit,
  listEntries,
  summary,
};
