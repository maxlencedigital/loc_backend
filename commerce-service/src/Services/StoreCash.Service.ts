import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import type { ICashCount, ICashDeposit, ICashVariance, IStoreDay } from "../Models/StoreAdmin/StoreAdmin.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { StoreCashQuery } from "../Queries/StoreCash.Query.js";
import { optionalText, parseBody, queryString, text } from "../Utils/Input.js";
import { rupeesToPaise, toRupees } from "../Utils/Money.js";
import {
  parseBusinessDate,
  parseDateRange,
  parseRecentDate,
  rupeesToPaiseOrZero,
  todayIst,
} from "../Utils/StoreAdminInput.js";
import { actorNameOf, requireStore } from "./StoreAccess.js";

// ₹1 crore of cash in one till is far past any store; this only stops a typo.
const MAX_CASH_PAISE = 1_000_000_000;
const DEFAULT_TOLERANCE_RUPEES = 100;
const DENOMINATIONS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 2000];
const MAX_NOTE = 500;
const MS_PER_MINUTE = 60_000;
const FUTURE_SKEW_MINUTES = 5;

/** The largest cash difference a manager may close a day with and no note. Configurable per environment. */
export const varianceTolerancePaise = (): number => {
  const rupees = Number(process.env.CASH_VARIANCE_TOLERANCE_RUPEES);
  const valid = process.env.CASH_VARIANCE_TOLERANCE_RUPEES !== undefined && Number.isFinite(rupees) && rupees >= 0;
  return Math.round((valid ? rupees : DEFAULT_TOLERANCE_RUPEES) * 100);
};

const toCountView = (count: ICashCount) => ({
  id: count.id,
  date: count.date,
  expected: toRupees(count.expectedPaise),
  counted: toRupees(count.countedPaise),
  variance: toRupees(count.variancePaise),
  note: count.note,
  countedBy: count.countedByName,
  createdAt: count.createdAt.toISOString(),
});

const toDepositView = (deposit: ICashDeposit) => ({
  id: deposit.id,
  date: deposit.date,
  amount: toRupees(deposit.amountPaise),
  bankReference: deposit.bankReference,
  depositedAt: deposit.depositedAt.toISOString(),
  recordedBy: deposit.byName,
});

const toVarianceView = (variance: ICashVariance) => ({
  id: variance.id,
  date: variance.date,
  amount: toRupees(variance.amountPaise),
  status: variance.status,
  note: variance.note,
});

// { "500": 12, "100": 40 }: real notes and coins only, and their value must be the counted total.
const parseDenominations = (value: unknown, countedPaise: number): Record<string, number> | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new CustomException("denominations must be an object like { \"500\": 12 }.", badRequest);
  }
  let totalRupees = 0;
  const clean: Record<string, number> = {};
  for (const [key, qty] of Object.entries(value as Record<string, unknown>)) {
    const face = Number(key);
    if (!DENOMINATIONS.includes(face)) {
      throw new CustomException(`${key} is not a denomination (use ${DENOMINATIONS.join(", ")}).`, badRequest);
    }
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 0 || qty > 100_000) {
      throw new CustomException(`The count of ${key} must be a whole number from 0 to 100000.`, badRequest);
    }
    totalRupees += face * qty;
    clean[key] = qty;
  }
  if (totalRupees * 100 !== countedPaise) {
    throw new CustomException("The denominations do not add up to countedAmount.", badRequest);
  }
  return clean;
};

const closedMessage = "This day is closed. No more counts or deposits can be added.";

const countCash = async (scope: StoreScope, user: RequestUser, storeId: string, input: unknown, now = new Date()) => {
  try {
    const body = parseBody(input);
    const date = parseRecentDate(body.date, "date", now);
    const countedPaise = rupeesToPaiseOrZero(body.countedAmount, "countedAmount", MAX_CASH_PAISE);
    const denominations = parseDenominations(body.denominations, countedPaise);
    const note = optionalText(body.note, "note", MAX_NOTE) ?? null;
    await requireStore(storeId, scope);

    const count = await StoreCashQuery.inTransaction(async (tx) => {
      const day = await StoreCashQuery.lockDay(storeId, date, tx);
      if (day.state === "closed") throw new CustomException(closedMessage, conflict);
      const expectedPaise = await StoreCashQuery.sumCashSales(storeId, date, tx);
      return await StoreCashQuery.createCount(
        { storeId, date, countedPaise, expectedPaise, denominations, note, countedByUserId: user.id, countedByName: actorNameOf(user) },
        tx
      );
    });
    return toCountView(count);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listCounts = async (scope: StoreScope, storeId: string, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const range = parseDateRange(query);
    await requireStore(storeId, scope);
    const result = await StoreCashQuery.listCounts(storeId, range.from, range.to, page);
    return { ...result, items: result.items.map(toCountView) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const parseDepositedAt = (value: unknown, now: Date): Date => {
  if (value === undefined || value === null || value === "") return now;
  const at = new Date(typeof value === "string" ? value : Number.NaN);
  if (Number.isNaN(at.getTime())) throw new CustomException("depositedAt must be an ISO date and time.", badRequest);
  if (at.getTime() > now.getTime() + FUTURE_SKEW_MINUTES * MS_PER_MINUTE) {
    throw new CustomException("depositedAt cannot be in the future.", badRequest);
  }
  return at;
};

const recordCashDeposit = async (scope: StoreScope, user: RequestUser, storeId: string, input: unknown, now = new Date()) => {
  try {
    const body = parseBody(input);
    const amountPaise = rupeesToPaise(body.amount, "amount", MAX_CASH_PAISE);
    const bankReference = text(body.bankReference, "bankReference", 60);
    const depositedAt = parseDepositedAt(body.depositedAt, now);
    const date =
      body.date === undefined || body.date === null ? todayIst(depositedAt) : parseRecentDate(body.date, "date", now);
    await requireStore(storeId, scope);

    try {
      const deposit = await StoreCashQuery.inTransaction(async (tx) => {
        const day = await StoreCashQuery.lockDay(storeId, date, tx);
        if (day.state === "closed") throw new CustomException(closedMessage, conflict);
        const totals = await StoreCashQuery.dayTotals(storeId, date, tx);
        if (!totals.latestCount) {
          throw new CustomException("Count the cash for this day before recording a deposit.", conflict);
        }
        if (totals.depositedPaise + amountPaise > totals.latestCount.countedPaise) {
          throw new CustomException("Deposits for this day would be more than the cash counted.", conflict);
        }
        return await StoreCashQuery.createDeposit(
          { storeId, date, amountPaise, bankReference, depositedAt, byUserId: user.id, byName: actorNameOf(user) },
          tx
        );
      });
      return toDepositView(deposit);
    } catch (error) {
      if (isUniqueViolation(error, "reference")) {
        throw new CustomException("A deposit with this bank reference is already recorded.", conflict);
      }
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const listCashDeposits = async (scope: StoreScope, storeId: string, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const range = parseDateRange(query);
    await requireStore(storeId, scope);
    const result = await StoreCashQuery.listDeposits(storeId, range.start, range.end, page);
    return { ...result, items: result.items.map(toDepositView) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const listStoreCashVariances = async (scope: StoreScope, storeId: string, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    await requireStore(storeId, scope);
    const result = await StoreCashQuery.listUnresolvedVariances(storeId, page);
    return { variances: result.items.map(toVarianceView), page: result.page, limit: result.limit, total: result.total };
  } catch (error) {
    throw toCustomException(error);
  }
};

const toClosedView = (day: IStoreDay, depositedPaise: number, alreadyClosed: boolean) => ({
  date: day.date,
  state: day.state,
  expected: toRupees(day.closedExpectedPaise ?? 0),
  counted: toRupees(day.closedCountedPaise ?? 0),
  variance: toRupees(day.closedVariancePaise ?? 0),
  deposited: toRupees(depositedPaise),
  closedAt: day.closedAt ? day.closedAt.toISOString() : null,
  closedBy: day.closedByName,
  notes: day.closeNote,
  alreadyClosed,
});

// One atomic, repeatable action. The day lock means two managers closing at once cannot both
// write, and the second sees the first's result instead of an error.
const closeStoreDay = async (scope: StoreScope, user: RequestUser, storeId: string, input: unknown, now = new Date()) => {
  try {
    const body = parseBody(input);
    const date = parseRecentDate(body.date, "date", now);
    const notes = optionalText(body.notes, "notes", MAX_NOTE) ?? null;
    await requireStore(storeId, scope);

    return await StoreCashQuery.inTransaction(async (tx) => {
      const day = await StoreCashQuery.lockDay(storeId, date, tx);
      const totals = await StoreCashQuery.dayTotals(storeId, date, tx);
      if (day.state === "closed") return toClosedView(day, totals.depositedPaise, true);

      const count = totals.latestCount;
      if (!count) throw new CustomException("The cash count for the day is still missing.", conflict);
      if ((await StoreCashQuery.sumCashSales(storeId, date, tx)) !== count.expectedPaise) {
        throw new CustomException("Sales were recorded after the last cash count. Count the cash again, then close the day.", conflict);
      }
      if (count.countedPaise > 0 && totals.depositCount === 0) {
        throw new CustomException("The bank deposit for the day is still missing.", conflict);
      }
      const tolerance = varianceTolerancePaise();
      if (Math.abs(count.variancePaise) > tolerance && !notes) {
        throw new CustomException(
          `The cash difference of Rs ${Math.abs(toRupees(count.variancePaise))} is above the Rs ${toRupees(tolerance)} allowed. Add notes explaining it to close the day.`,
          conflict
        );
      }

      const closedAt = now;
      await StoreCashQuery.closeDay(
        day.id,
        storeId,
        date,
        {
          closedAt,
          closedByUserId: user.id,
          closedByName: actorNameOf(user),
          closeNote: notes,
          expectedPaise: count.expectedPaise,
          countedPaise: count.countedPaise,
          variancePaise: count.variancePaise,
        },
        tx
      );
      const closed = (await StoreCashQuery.findDay(storeId, date, tx)) as IStoreDay;
      return toClosedView(closed, totals.depositedPaise, false);
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const getStoreDayStatus = async (scope: StoreScope, storeId: string, query: Record<string, unknown>, now = new Date()) => {
  try {
    const raw = queryString(query.date, "date");
    const today = todayIst(now);
    const date = raw === undefined ? today : parseBusinessDate(raw, "date");
    if (date > today) throw new CustomException("date cannot be in the future.", badRequest);
    await requireStore(storeId, scope);

    const [day, totals] = await Promise.all([
      StoreCashQuery.findDay(storeId, date),
      StoreCashQuery.dayTotals(storeId, date),
    ]);
    const closed = day?.state === "closed";
    const count = totals.latestCount;
    const expectedPaise = closed ? day?.closedExpectedPaise ?? 0 : await StoreCashQuery.sumCashSales(storeId, date);
    return {
      date,
      counted: count !== null,
      banked: totals.depositCount > 0,
      closed,
      state: day?.state ?? "open",
      expected: toRupees(expectedPaise),
      countedAmount: count ? toRupees(count.countedPaise) : null,
      deposited: toRupees(totals.depositedPaise),
      variance: count ? toRupees(count.variancePaise) : null,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const StoreCashService = {
  countCash,
  listCounts,
  recordCashDeposit,
  listCashDeposits,
  listStoreCashVariances,
  closeStoreDay,
  getStoreDayStatus,
};
