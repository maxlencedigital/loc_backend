import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import { isBlank } from "./Input.js";

// The business runs on Indian calendar days: "today's jobs" means 00:00 to 24:00 IST,
// whatever timezone the server or the caller is in.
const IST_OFFSET_MINUTES = 330;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface DateRange {
  from: Date;
  /** Exclusive. */
  to: Date;
}

export const istDateOf = (instant: Date): string =>
  new Date(instant.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);

export const todayIst = (now: Date = new Date()): string => istDateOf(now);

const startOfIstDay = (date: string): Date => new Date(Date.parse(`${date}T00:00:00.000Z`) - IST_OFFSET_MINUTES * 60_000);

export const parseDate = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new CustomException(`${name} must be a date as YYYY-MM-DD.`, badRequest);
  }
  // 2026-02-31 parses in some engines by rolling over; the round trip catches it.
  if (new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new CustomException(`${name} must be a real calendar date.`, badRequest);
  }
  return value;
};

export const dayRange = (date: string): DateRange => {
  const from = startOfIstDay(date);
  return { from, to: new Date(from.getTime() + DAY_MS) };
};

/** A single day from an optional `date` query value, today by default. */
export const dayFromQuery = (value: unknown, now: Date = new Date()): { date: string; range: DateRange } => {
  const date = isBlank(value) ? todayIst(now) : parseDate(value, "date");
  return { date, range: dayRange(date) };
};

/** An inclusive from/to pair of dates, bounded so one request cannot scan years of rows. */
export const rangeFromQuery = (
  query: { from?: unknown; to?: unknown },
  options: { defaultDays: number; maxDays: number },
  now: Date = new Date()
): DateRange => {
  const toDate = isBlank(query.to) ? todayIst(now) : parseDate(query.to, "to");
  const fromDate = isBlank(query.from)
    ? istDateOf(new Date(startOfIstDay(toDate).getTime() - (options.defaultDays - 1) * DAY_MS))
    : parseDate(query.from, "from");
  const from = startOfIstDay(fromDate);
  const to = new Date(startOfIstDay(toDate).getTime() + DAY_MS);
  if (to.getTime() <= from.getTime()) throw new CustomException("from must not be after to.", badRequest);
  if ((to.getTime() - from.getTime()) / DAY_MS > options.maxDays) {
    throw new CustomException(`The date range can be at most ${options.maxDays} days.`, badRequest);
  }
  return { from, to };
};

export const dateTime = (value: unknown, name: string): Date => {
  const parsed = typeof value === "string" ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new CustomException(`${name} must be a date and time (ISO 8601).`, badRequest);
  }
  return parsed;
};

/** A date column value (no time): midnight UTC of that calendar date. */
export const toDateColumn = (date: string): Date => new Date(`${date}T00:00:00.000Z`);

export const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);
