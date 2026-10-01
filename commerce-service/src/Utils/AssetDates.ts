import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";

// The business runs in one time zone (IST, no daylight saving), so "today" for a due date
// is the IST calendar date. Calendar dates are stored and passed around as UTC midnights.
const IST_OFFSET_MS = 5.5 * 3_600_000;
export const MS_PER_DAY = 86_400_000;
export const MS_PER_MINUTE = 60_000;

// A seam so tests can fix "now"; production always reads the real clock.
export const clock = { now: (): Date => new Date() };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

export const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

export const isDateString = (value: unknown): value is string => {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  // Rejects 2026-02-31, which Date would silently roll into March.
  return !Number.isNaN(date.getTime()) && formatDate(date) === value && date.getUTCFullYear() >= MIN_YEAR && date.getUTCFullYear() <= MAX_YEAR;
};

export const parseDate = (value: unknown, field: string): Date => {
  if (!isDateString(value)) throw new CustomException(`${field} must be a date like 2026-10-31.`, badRequest);
  return new Date(`${value}T00:00:00.000Z`);
};

// Today's calendar date in India, as UTC midnight.
export const businessToday = (now: Date = clock.now()): Date => {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
};

export const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * MS_PER_DAY);

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export const daysBetween = (from: Date, to: Date): number => Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);

export const dateOut = (date: Date | null): string | null => (date ? formatDate(date) : null);
export const timeOut = (moment: Date | null): string | null => (moment ? moment.toISOString() : null);

// Something that already happened cannot be dated tomorrow.
export const notInFuture = (date: Date, field: string): Date => {
  if (date.getTime() > businessToday().getTime()) {
    throw new CustomException(`${field} cannot be in the future.`, badRequest);
  }
  return date;
};
