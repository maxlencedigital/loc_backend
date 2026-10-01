import { AttendanceStatus, IAttendance } from "../Models/Hr/Attendance.Interface.js";
import { IHoliday } from "../Models/Hr/Leave.Interface.js";
import { addDays, daysInclusive, maxDate, minDate } from "../Utils/HrDate.js";

// Pure date arithmetic for attendance and leave. There is no weekly-off concept in the
// data, so every calendar day counts unless a holiday closes it (see the module note).

const sameDay = (a: Date, b: Date) => a.getTime() === b.getTime();

/** A holiday closes a store when it is public or company-wide, or names that store. */
export const holidayApplies = (holiday: IHoliday, storeId: string | null): boolean =>
  holiday.type !== "store" || (storeId !== null && holiday.storeIds.includes(storeId));

export const isHoliday = (holidays: IHoliday[], date: Date, storeId: string | null): boolean =>
  holidays.some((holiday) => sameDay(holiday.date, date) && holidayApplies(holiday, storeId));

/** Each calendar date of [from, to]. Callers bound the range first (at most a few hundred days). */
export const eachDate = (from: Date, to: Date): Date[] =>
  Array.from({ length: Math.max(0, daysInclusive(from, to)) }, (_, offset) => addDays(from, offset));

export interface LeaveSpan {
  fromDate: Date;
  toDate: Date;
  halfDay: boolean;
}

/** Chargeable half-days per calendar year for a leave span: holidays are free, a half-day is one half. */
export const chargeableByYear = (span: LeaveSpan, holidays: IHoliday[], storeId: string | null): Map<number, number> => {
  const byYear = new Map<number, number>();
  for (const date of eachDate(span.fromDate, span.toDate)) {
    if (isHoliday(holidays, date, storeId)) continue;
    const year = date.getUTCFullYear();
    byYear.set(year, (byYear.get(year) ?? 0) + (span.halfDay ? 1 : 2));
  }
  return byYear;
};

export const totalHalfDays = (byYear: Map<number, number>): number => [...byYear.values()].reduce((a, b) => a + b, 0);

/** Whole dates of [from, to] that approved leave covers and no holiday closes. */
export const countLeaveDays = (
  spans: LeaveSpan[],
  from: Date,
  to: Date,
  holidays: IHoliday[],
  storeId: string | null
): number => {
  const covered = new Set<number>();
  for (const span of spans) {
    const start = maxDate(span.fromDate, from);
    const end = minDate(span.toDate, to);
    for (const date of eachDate(start, end)) {
      if (!isHoliday(holidays, date, storeId)) covered.add(date.getTime());
    }
  }
  return covered.size;
};

export const leaveCovers = (spans: LeaveSpan[], date: Date): boolean =>
  spans.some((span) => span.fromDate <= date && span.toDate >= date);

/** The status of one person on one day: a recorded day wins, then leave, then a holiday, else absent. */
export const dayStatus = (
  record: IAttendance | undefined,
  spans: LeaveSpan[],
  holidays: IHoliday[],
  date: Date,
  storeId: string | null
): AttendanceStatus => {
  if (record) return record.status;
  if (leaveCovers(spans, date)) return "on_leave";
  if (isHoliday(holidays, date, storeId)) return "off";
  return "absent";
};
