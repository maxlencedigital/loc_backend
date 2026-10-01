import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";

// Business days are calendar dates in India (UTC+05:30, no daylight saving).
const IST_OFFSET_MS = 330 * 60_000;
const MS_PER_DAY = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_BACKDATE_DAYS = 31;
export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 92;

const fail = (message: string): never => {
  throw new CustomException(message, badRequest);
};

export const todayIst = (now: Date = new Date()): string =>
  new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** A real calendar date written YYYY-MM-DD ("2026-02-30" is refused, not rolled over). */
export const parseBusinessDate = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return fail(`${field} must be a date like 2026-10-01.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return fail(`${field} must be a real calendar date.`);
  }
  return value;
};

/** Prisma's @db.Date column: midnight UTC of that calendar day. */
export const toDbDate = (date: string): Date => new Date(`${date}T00:00:00Z`);
export const fromDbDate = (date: Date): string => date.toISOString().slice(0, 10);

/** The instant a business day starts (midnight IST). */
export const istDayStart = (date: string): Date => new Date(`${date}T00:00:00+05:30`);
export const istNextDayStart = (date: string): Date => new Date(istDayStart(date).getTime() + MS_PER_DAY);

const daysBetween = (from: string, to: string): number =>
  Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / MS_PER_DAY);

export const addDays = (date: string, days: number): string =>
  new Date(toDbDate(date).getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);

/** A day a store may count, bank or read on: today or up to a month back, never the future. */
export const parseRecentDate = (value: unknown, field: string, now: Date = new Date()): string => {
  const date = parseBusinessDate(value, field);
  const today = todayIst(now);
  if (date > today) return fail(`${field} cannot be in the future.`);
  if (daysBetween(date, today) > MAX_BACKDATE_DAYS) return fail(`${field} cannot be more than ${MAX_BACKDATE_DAYS} days ago.`);
  return date;
};

export interface IDateRange {
  from: string;
  to: string;
  /** Inclusive start instant and exclusive end instant, for timestamp columns. */
  start: Date;
  end: Date;
}

/** ?from=&to= as business dates, default the last 30 days, never more than 92 days wide. */
export const parseDateRange = (query: { from?: unknown; to?: unknown }, now: Date = new Date()): IDateRange => {
  const today = todayIst(now);
  const rawTo = typeof query.to === "string" && query.to.trim() !== "" ? query.to.trim() : undefined;
  const rawFrom = typeof query.from === "string" && query.from.trim() !== "" ? query.from.trim() : undefined;
  if ((query.from !== undefined && typeof query.from !== "string") || (query.to !== undefined && typeof query.to !== "string")) {
    return fail("from and to must be single dates.");
  }
  const to = rawTo === undefined ? today : parseBusinessDate(rawTo, "to");
  const from = rawFrom === undefined ? addDays(to, -(DEFAULT_RANGE_DAYS - 1)) : parseBusinessDate(rawFrom, "from");
  if (from > to) return fail("from cannot be after to.");
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return fail(`The date range can be at most ${MAX_RANGE_DAYS} days.`);
  return { from, to, start: istDayStart(from), end: istNextDayStart(to) };
};

/** Rupees as a number with at most two decimals, zero allowed, as integer paise. */
export const rupeesToPaiseOrZero = (value: unknown, field: string, maxPaise: number): number => {
  const rupees = typeof value === "number" ? value : Number.NaN;
  const paise = Math.round(rupees * 100);
  if (!Number.isFinite(rupees) || rupees < 0 || Math.abs(rupees * 100 - paise) > 1e-6) {
    return fail(`${field} must be an amount of zero or more with at most two decimals.`);
  }
  if (paise > maxPaise) return fail(`${field} is too large.`);
  return paise;
};

/** A quantity with at most three decimals as integer thousandths. Zero is refused unless allowed. */
export const toMilli = (value: unknown, field: string, maxMilli: number, allowZero = false): number => {
  const qty = typeof value === "number" ? value : Number.NaN;
  const milli = Math.round(qty * 1000);
  if (!Number.isFinite(qty) || qty < 0 || (!allowZero && qty === 0) || Math.abs(qty * 1000 - milli) > 1e-6) {
    return fail(`${field} must be a number ${allowZero ? "of zero" : "above zero"} or more with at most three decimals.`);
  }
  if (milli > maxMilli) return fail(`${field} is too large.`);
  return milli;
};

export const milliToUnits = (milli: number): number => milli / 1000;

/** A ?ids=a&ids=b or ?ids=a,b list of at most `max` values. */
export const queryList = (value: unknown, field: string, max: number): string[] | undefined => {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value : [value];
  if (!raw.every((v) => typeof v === "string")) return fail(`${field} must be a list of ids.`);
  const items = (raw as string[]).flatMap((v) => v.split(",")).map((v) => v.trim()).filter((v) => v !== "");
  if (items.length === 0) return undefined;
  if (items.length > max) return fail(`${field} can list at most ${max} values.`);
  return [...new Set(items)];
};
