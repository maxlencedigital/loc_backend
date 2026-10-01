import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";

// Calendar dates are plain "YYYY-MM-DD" strings in India Standard Time, so a policy that
// ends on the 31st is valid through the whole of the 31st wherever the server runs.
const IST_OFFSET_MS = 5.5 * 3_600_000;
const MS_PER_DAY = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type DateString = string;

export const todayIst = (now: Date = new Date()): DateString =>
  new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

export const istDateOf = (moment: Date): DateString => todayIst(moment);

const asUtcMidnight = (date: DateString): number => Date.parse(`${date}T00:00:00.000Z`);

export const isDateString = (value: unknown): value is DateString => {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(asUtcMidnight(value));
  // Rejects 2026-02-31, which Date would silently roll into March.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const addDays = (date: DateString, days: number): DateString =>
  new Date(asUtcMidnight(date) + days * MS_PER_DAY).toISOString().slice(0, 10);

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export const daysBetween = (from: DateString, to: DateString): number =>
  Math.round((asUtcMidnight(to) - asUtcMidnight(from)) / MS_PER_DAY);

/** The instant an IST calendar day starts, for filtering timestamps by day. */
export const istDayStart = (date: DateString): Date => new Date(asUtcMidnight(date) - IST_OFFSET_MS);

/** The first instant after an IST calendar day, so a range is `>= start` and `< end`. */
export const istDayEnd = (date: DateString): Date => new Date(asUtcMidnight(date) + MS_PER_DAY - IST_OFFSET_MS);

export const parseDateInput = (value: unknown, field: string): DateString => {
  if (!isDateString(value)) throw new CustomException(`${field} must be a date like 2026-10-31.`, badRequest);
  return value;
};

export const optionalDateInput = (value: unknown, field: string): DateString | undefined =>
  value === undefined || value === null || value === "" ? undefined : parseDateInput(value, field);

// Storage: a DATE column is read and written as UTC midnight.
export const toDbDate = (date: DateString): Date => new Date(asUtcMidnight(date));
export const fromDbDate = (value: Date): DateString => value.toISOString().slice(0, 10);
