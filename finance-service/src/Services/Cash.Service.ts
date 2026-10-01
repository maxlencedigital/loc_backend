import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { Page, PageRequest, toPage } from "../../commons/Utils/Pagination.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import { Actor, effectiveStore, scopeOf } from "../Middleware/StoreScope.js";
import { ICashTotals, IDailyClose } from "../Models/Cash/Cash.Interface.js";
import { CashQuery } from "../Queries/Cash.Query.js";
import { TransactionQuery } from "../Queries/Transaction.Query.js";
import { istToday, optionalDay, optionalDayBounds, parseDay } from "../Utils/Dates.js";
import {
  idempotencyKeyOf,
  optionalBoolean,
  optionalText,
  parseBody,
  pathId,
  queryUuid,
  text,
  uuidField,
} from "../Utils/Input.js";
import { toRupees, wholePaise } from "../Utils/Money.js";
import { LedgerService } from "./Ledger.Service.js";

type DayStatus = "agreed" | "variance" | "missing";

// Variance is banked minus expected: how far the cash that reached the bank is from the cash
// the system says was taken. "agreed" needs the till to match the count AND the bank to match
// the count; a day not yet banked is a variance until the deposit is recorded.
export const dayStatus = (expectedPaise: number, totals: { countedPaise: number; bankedPaise: number }): DayStatus =>
  totals.countedPaise === expectedPaise && totals.bankedPaise === totals.countedPaise ? "agreed" : "variance";

const futureCheck = (day: string) => {
  if (day > istToday()) throw new CustomException("date cannot be in the future.", badRequest);
  return day;
};

// ------------------------------------------------------------------ from commerce

/** Commerce reports a store's day close. Idempotent per store and day; a different repeat is a 409. */
const registerDayClose = async (input: unknown) => {
  try {
    const body = parseBody(input);
    requireFields(body, ["storeId", "date", "expectedPaise", "countedPaise", "closedByName"]);
    const data = {
      storeId: uuidField(body.storeId, "storeId"),
      storeName: optionalText(body.storeName, "storeName", 120) ?? null,
      date: futureCheck(parseDay(body.date, "date")),
      expectedPaise: wholePaise(body.expectedPaise, "expectedPaise", { allowZero: true }),
      countedPaise: wholePaise(body.countedPaise, "countedPaise", { allowZero: true }),
      closedByUserId: optionalText(body.closedByUserId, "closedByUserId", 64) ?? null,
      closedByName: text(body.closedByName, "closedByName", 120),
    };
    return await TransactionQuery.run(async (tx) => {
      const created = await CashQuery.insertClose(data, tx);
      const close = (await CashQuery.findClose(data.storeId, data.date, tx)) as IDailyClose;
      if (!created) {
        const [totals] = await CashQuery.totalsForDate(data.date, data.storeId, tx);
        if (close.expectedPaise !== data.expectedPaise || (totals?.countedPaise ?? 0) !== data.countedPaise) {
          throw new CustomException("This store and day were already closed with different figures.", conflict);
        }
        return { id: close.id, created: false };
      }
      await CashQuery.addEntry(
        { storeId: data.storeId, date: data.date, kind: "counted", amountPaise: data.countedPaise, reference: null, idempotencyKey: `close:${data.date}` },
        tx
      );
      if (data.countedPaise !== data.expectedPaise) {
        await CashQuery.openVariance(
          { storeId: data.storeId, date: data.date, amountPaise: data.countedPaise - data.expectedPaise },
          tx
        );
      }
      return { id: close.id, created: true };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

/** Commerce reports cash taken to the bank. The idempotency key is required: a retry must not bank twice. */
const registerDeposit = async (input: unknown, headerKey: string | undefined) => {
  try {
    const body = parseBody(input);
    requireFields(body, ["storeId", "date", "amountPaise"]);
    const storeId = uuidField(body.storeId, "storeId");
    const date = parseDay(body.date, "date");
    const amountPaise = wholePaise(body.amountPaise, "amountPaise");
    const reference = optionalText(body.reference, "reference", 120) ?? null;
    const key = idempotencyKeyOf(headerKey || body.idempotencyKey);
    if (!key) throw new CustomException("An Idempotency-Key is required for a deposit.", badRequest);

    return await TransactionQuery.run(async (tx) => {
      // The lock makes "is there room in what was counted?" and the insert one step per day.
      const close = await CashQuery.lockClose(storeId, date, tx);
      if (!close) throw new CustomException("That store's day has not been closed yet.", conflict);
      // A retry of a deposit already banked answers with that deposit; it is not checked against the cap again.
      if (await CashQuery.hasEntry(storeId, "deposit", key, tx)) return { storeId, date, amount: toRupees(amountPaise), created: false };
      const [totals] = await CashQuery.totalsForDate(date, storeId, tx);
      if ((totals?.bankedPaise ?? 0) + amountPaise > (totals?.countedPaise ?? 0)) {
        throw new CustomException("The deposits would be more than the cash counted for that day.", conflict);
      }
      const created = await CashQuery.addEntry({ storeId, date, kind: "deposit", amountPaise, reference, idempotencyKey: key }, tx);
      if (created) {
        await LedgerService.postDeposit({ storeId, date, amountPaise, reference, sourceId: `${storeId}:${key}` }, tx);
      }
      return { storeId, date, amount: toRupees(amountPaise), created };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------ the daily view

const rowOf = (close: IDailyClose | null, storeId: string, totals: ICashTotals | undefined) => {
  if (!close) {
    return { storeId, name: null, expected: 0, counted: 0, banked: 0, variance: 0, status: "missing" as DayStatus };
  }
  const counted = totals?.countedPaise ?? 0;
  const banked = totals?.bankedPaise ?? 0;
  return {
    storeId,
    name: close.storeName,
    expected: toRupees(close.expectedPaise),
    counted: toRupees(counted),
    banked: toRupees(banked),
    variance: toRupees(banked - close.expectedPaise),
    status: dayStatus(close.expectedPaise, { countedPaise: counted, bankedPaise: banked }),
  };
};

const getDailyCash = async (query: Record<string, unknown>, actor: Actor) => {
  try {
    const date = parseDay(typeof query.date === "string" ? query.date : undefined, "date");
    const store = effectiveStore(actor, queryUuid(query.storeId, "storeId"));
    const [closes, totals] = await Promise.all([CashQuery.closesForDate(date, store), CashQuery.totalsForDate(date, store)]);
    const totalsByStore = new Map(totals.map((t) => [t.storeId, t]));
    const stores = closes.map((close) => rowOf(close, close.storeId, totalsByStore.get(close.storeId)));
    // A store that was asked for by name and has not closed is shown as missing, not left out.
    if (store && closes.length === 0) stores.push(rowOf(null, store, undefined));

    const sumOf = (pick: (row: (typeof stores)[number]) => number) =>
      toRupees(stores.reduce((total, row) => total + Math.round(pick(row) * 100), 0));
    return {
      date,
      stores,
      total: {
        expected: sumOf((r) => r.expected),
        counted: sumOf((r) => r.counted),
        banked: sumOf((r) => r.banked),
        variance: sumOf((r) => r.variance),
      },
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------ variances

const toVariance = (v: { id: string; storeId: string; date: string; amountPaise: number; status: string }) => ({
  id: v.id,
  storeId: v.storeId,
  date: v.date,
  amount: toRupees(v.amountPaise),
  status: v.status,
});

const listCashVariances = async (
  query: Record<string, unknown>,
  actor: Actor,
  page: PageRequest
): Promise<Page<ReturnType<typeof toVariance>>> => {
  try {
    const { from, to } = optionalDayBounds(query);
    const { items, total } = await CashQuery.searchVariances(
      {
        storeId: effectiveStore(actor, queryUuid(query.storeId, "storeId")),
        resolved: optionalBoolean(typeof query.resolved === "string" ? query.resolved : undefined, "resolved"),
        from,
        to,
      },
      page
    );
    return toPage(items.map(toVariance), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const resolveCashVariance = async (rawId: string, input: unknown, actor: Actor) => {
  try {
    const id = pathId(rawId, "Cash variance");
    const body = parseBody(input);
    requireFields(body, ["resolution"]);
    const resolution = text(body.resolution, "resolution", 300);
    const note = optionalText(body.note, "note", 500) ?? null;
    const variance = await CashQuery.findVarianceById(id, scopeOf(actor));
    if (!variance) throw new CustomException("Cash variance not found.", notFound);
    // Guarded on status "open": of two admins resolving at once, the second is told it is done.
    if (!(await CashQuery.resolveVariance(id, { resolution, note, resolvedByUserId: actor.id }))) {
      throw new CustomException("This cash variance has already been resolved.", conflict);
    }
    return { ...toVariance({ ...variance, status: "resolved" }), resolution, note };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------ daily closes

const toClose = (close: IDailyClose) => ({
  id: close.id,
  storeId: close.storeId,
  date: close.date,
  closedBy: close.closedByName,
  status: close.status,
});

const listDailyCloses = async (
  query: Record<string, unknown>,
  actor: Actor,
  page: PageRequest
): Promise<Page<ReturnType<typeof toClose>>> => {
  try {
    const { items, total } = await CashQuery.searchCloses(
      {
        date: optionalDay(query.date, "date"),
        storeId: effectiveStore(actor, queryUuid(query.storeId, "storeId")),
      },
      page
    );
    return toPage(items.map(toClose), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getDailyClose = async (rawId: string, actor: Actor) => {
  try {
    const close = await CashQuery.findCloseById(pathId(rawId, "Daily close"), scopeOf(actor));
    if (!close) throw new CustomException("Daily close not found.", notFound);
    const [[totals], variance] = await Promise.all([
      CashQuery.totalsForDate(close.date, close.storeId),
      CashQuery.findVariance(close.storeId, close.date),
    ]);
    const { status: cashStatus, ...figures } = rowOf(close, close.storeId, totals);
    return {
      ...figures,
      ...toClose(close),
      cashStatus,
      varianceStatus: variance ? variance.status : null,
      approvedAt: close.approvedAt,
      approvalNote: close.approvalNote,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const approveDailyClose = async (rawId: string, input: unknown, actor: Actor) => {
  try {
    const id = pathId(rawId, "Daily close");
    const note = optionalText(parseBody(input).note, "note", 500) ?? null;
    const close = await CashQuery.findCloseById(id, scopeOf(actor));
    if (!close) throw new CustomException("Daily close not found.", notFound);
    if (close.status === "approved") return toClose(close);

    const variance = await CashQuery.findVariance(close.storeId, close.date);
    if (variance?.status === "open") {
      throw new CustomException("Resolve this day's cash variance before approving it.", conflict);
    }
    // Guarded on status "closed", so two approvals leave exactly one approver on record.
    const won = await CashQuery.approveClose(id, actor.id, note);
    const after = (await CashQuery.findCloseById(id, null)) as IDailyClose;
    if (!won && after.status !== "approved") throw new CustomException("This day could not be approved.", conflict);
    return toClose(after);
  } catch (error) {
    throw toCustomException(error);
  }
};

export const CashService = {
  registerDayClose,
  registerDeposit,
  getDailyCash,
  listCashVariances,
  resolveCashVariance,
  listDailyCloses,
  getDailyClose,
  approveDailyClose,
};
