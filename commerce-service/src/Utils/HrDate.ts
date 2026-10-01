import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";

// The business runs in one time zone (IST, no daylight saving), so "the day" of an
// attendance record is the IST calendar date. Calendar dates travel as UTC midnights.
export const IST_OFFSET_MINUTES = 330;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = 86_400_000;

// A tiny seam so tests can fix "now"; production always reads the real clock.
export const clock = { now: (): Date => new Date() };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

export const isDateString = (value: unknown): value is string => {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && formatDate(date) === value;
};

export const parseDate = (value: unknown, field: string): Date => {
  if (!isDateString(value)) throw new CustomException(`${field} must be a date like 2026-09-30.`, badRequest);
  return new Date(`${value}T00:00:00.000Z`);
};

export const parseOptionalDate = (value: unknown, field: string): Date | undefined =>
  value === undefined || value === null || value === "" ? undefined : parseDate(value, field);

export const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * MS_PER_DAY);

/** Whole days from `from` to `to`, both included. */
export const daysInclusive = (from: Date, to: Date): number => Math.round((to.getTime() - from.getTime()) / MS_PER_DAY) + 1;

export const maxDate = (a: Date, b: Date): Date => (a.getTime() >= b.getTime() ? a : b);
export const minDate = (a: Date, b: Date): Date => (a.getTime() <= b.getTime() ? a : b);

/** Today's calendar date in the business time zone. */
export const businessToday = (now: Date = clock.now()): Date => {
  const shifted = new Date(now.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
};

/** The instant a business day starts (00:00 IST). */
export const dayStart = (date: Date): Date => new Date(date.getTime() - IST_OFFSET_MINUTES * MS_PER_MINUTE);

export const minutesOfDay = (instant: Date): number => {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
};

/** "YYYY-MM" to the first and last calendar day of that month. */
export const parseMonth = (value: unknown, field: string): { from: Date; to: Date } => {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new CustomException(`${field} must be a month like 2026-09.`, badRequest);
  }
  const [year, month] = value.split("-").map(Number);
  return { from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 0)) };
};

export const parseTime = (value: unknown, field: string): number => {
  const match = typeof value === "string" ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value) : null;
  if (!match) throw new CustomException(`${field} must be a time like 09:30.`, badRequest);
  return Number(match[1]) * 60 + Number(match[2]);
};

export const formatTime = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const parseInstant = (value: unknown, field: string): Date => {
  const at = new Date(typeof value === "string" ? value : Number.NaN);
  if (typeof value !== "string" || Number.isNaN(at.getTime())) {
    throw new CustomException(`${field} must be an ISO date and time.`, badRequest);
  }
  return at;
};

/** A date range from query strings, bounded so a report can never scan unbounded history. */
export const parseRange = (
  fromRaw: unknown,
  toRaw: unknown,
  fallback: { from: Date; to: Date },
  maxDays: number
): { from: Date; to: Date } => {
  const from = parseOptionalDate(fromRaw, "from") ?? fallback.from;
  const to = parseOptionalDate(toRaw, "to") ?? fallback.to;
  if (to < from) throw new CustomException("from must not be after to.", badRequest);
  if (daysInclusive(from, to) > maxDays) {
    throw new CustomException(`The range can cover at most ${maxDays} days.`, badRequest);
  }
  return { from, to };
};
