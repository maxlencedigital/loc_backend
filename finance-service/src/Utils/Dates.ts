import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";

// The business runs in IST (UTC+05:30, no daylight saving). A "day" is an IST calendar day and
// travels as "YYYY-MM-DD"; DATE columns hold it as a UTC midnight so no timezone moves it.
const IST_OFFSET_MS = 330 * 60_000;
const MS_PER_DAY = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// A seam so tests can fix "now"; production reads the real clock.
export const clock = { now: (): Date => new Date() };

const fail = (message: string): never => {
  throw new CustomException(message, badRequest);
};

/** A real calendar date as "YYYY-MM-DD" (2026-02-30 is refused, not rolled over). */
export const parseDay = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !DAY.test(value)) return fail(`${field} must be a date as YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? fail(`${field} is not a real date.`)
    : value;
};

export const optionalDay = (value: unknown, field: string): string | undefined =>
  value === undefined || value === null || value === "" ? undefined : parseDay(value, field);

export const dayToDate = (day: string): Date => new Date(`${day}T00:00:00Z`);
export const dateToDay = (date: Date): string => date.toISOString().slice(0, 10);

export const addDays = (day: string, days: number): string => dateToDay(new Date(dayToDate(day).getTime() + days * MS_PER_DAY));

export const daysBetween = (from: string, to: string): number =>
  Math.round((dayToDate(to).getTime() - dayToDate(from).getTime()) / MS_PER_DAY);

/** Today's date in IST. */
export const istToday = (now: Date = clock.now()): string => dateToDay(new Date(now.getTime() + IST_OFFSET_MS));

/** The instant an IST calendar day starts, for comparing against timestamp columns. */
export const istDayStart = (day: string): Date => new Date(dayToDate(day).getTime() - IST_OFFSET_MS);
/** The instant just after an IST day ends (exclusive upper bound). */
export const istDayEnd = (day: string): Date => new Date(istDayStart(day).getTime() + MS_PER_DAY);

export const parseMonth = (value: unknown, field: string): string =>
  typeof value === "string" && MONTH.test(value) ? value : fail(`${field} must be a month as YYYY-MM.`);

export const monthStart = (month: string): string => `${month}-01`;
export const monthEnd = (month: string): string => {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  return dateToDay(new Date(Date.UTC(year, mon, 0)));
};
export const monthOf = (day: string): string => day.slice(0, 7);
export const nextMonth = (month: string): string => {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  return mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, "0")}`;
};
export const monthIndex = (month: string): number => {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  return year * 12 + (mon - 1);
};

export interface DayRange {
  from: string;
  to: string;
}

/**
 * An inclusive from/to window. Both are optional; `defaultDays` fills a missing `from` back from
 * `to` (default today). A reversed or over-long window is refused so no query is unbounded.
 */
export const dayRange = (
  query: { from?: unknown; to?: unknown },
  options: { defaultDays: number; maxDays: number }
): DayRange => {
  const to = optionalDay(query.to, "to") ?? istToday();
  const from = optionalDay(query.from, "from") ?? addDays(to, -(options.defaultDays - 1));
  if (from > to) return fail("from must not be after to.");
  if (daysBetween(from, to) + 1 > options.maxDays) return fail(`The date range may span at most ${options.maxDays} days.`);
  return { from, to };
};

/** Optional bounds for a list filter: either side may be absent, and the window stays ordered. */
export const optionalDayBounds = (query: { from?: unknown; to?: unknown }): { from?: string; to?: string } => {
  const from = optionalDay(query.from, "from");
  const to = optionalDay(query.to, "to");
  if (from && to && from > to) return fail("from must not be after to.");
  return { from, to };
};
