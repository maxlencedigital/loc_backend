import { IIncentiveRule, IncentivePeriod, PayCycle } from "../Models/Hr/Pay.Interface.js";
import { addDays, formatDate } from "../Utils/HrDate.js";
import { divideHalfUp } from "../Utils/PeopleInput.js";

// Pure pay arithmetic: no clock, no database, integer paise throughout.
//
// Pay for a month is built day by day. Each day the person was on the books and paid
// earns one cycle-day of the pay terms in force that day: a monthly salary is split over
// the calendar days of the month, a weekly one over 7 days, a per-job one earns nothing
// here (it is paid per job through incentives and payouts). The total of one set of terms
// is rounded once, half up, to the paise: round(amount x paidDays / cycleDays).

export interface PayTerms {
  effectiveFrom: Date;
  baseSalaryPaise: number;
  payCycle: PayCycle;
  /** Total of the allowances, paise per pay cycle. */
  allowancesPaise: number;
}

export interface PayDay {
  date: Date;
  payable: boolean;
}

export interface MonthPay {
  basePaise: number;
  allowancesPaise: number;
  payableDays: number;
  unpaidDays: number;
  daysInMonth: number;
}

const WEEK_DAYS = 7;

export const daysInMonthOf = (month: { from: Date; to: Date }): number =>
  Math.round((month.to.getTime() - month.from.getTime()) / 86_400_000) + 1;

/** The terms in force on a date: the latest whose effectiveFrom is not after it. */
export const termsInForce = (versions: PayTerms[], date: Date): PayTerms | null => {
  let found: PayTerms | null = null;
  for (const v of versions) {
    if (v.effectiveFrom <= date && (!found || v.effectiveFrom > found.effectiveFrom)) found = v;
  }
  return found;
};

export const calculateMonthPay = (month: { from: Date; to: Date }, versions: PayTerms[], days: PayDay[]): MonthPay => {
  const daysInMonth = daysInMonthOf(month);
  const paidByTerms = new Map<PayTerms, number>();
  let payableDays = 0;
  let unpaidDays = 0;
  for (const day of days) {
    const terms = termsInForce(versions, day.date);
    if (!terms) continue;
    if (!day.payable) {
      unpaidDays += 1;
      continue;
    }
    payableDays += 1;
    paidByTerms.set(terms, (paidByTerms.get(terms) ?? 0) + 1);
  }
  let basePaise = 0;
  let allowancesPaise = 0;
  for (const [terms, paid] of paidByTerms) {
    if (terms.payCycle === "per_job") continue;
    const cycleDays = terms.payCycle === "weekly" ? WEEK_DAYS : daysInMonth;
    basePaise += divideHalfUp(terms.baseSalaryPaise * paid, cycleDays);
    allowancesPaise += divideHalfUp(terms.allowancesPaise * paid, cycleDays);
  }
  return { basePaise, allowancesPaise, payableDays, unpaidDays, daysInMonth };
};

export type DayStatus = "present" | "late" | "absent" | "on_leave" | "off";

/**
 * The paid days of a month from the attendance days HR core derived (employment days up
 * to today). Absent days are unpaid, except today, which is not over. Days still to come
 * are projected as paid for someone who has not left, so a running month shows its full
 * figure and `provisional` says it may still move.
 */
export const payDaysOf = (input: {
  month: { from: Date; to: Date };
  attendance: { date: Date; status: DayStatus }[];
  today: Date;
  employeeExited: boolean;
  joinDate: Date;
}): { days: PayDay[]; provisional: boolean } => {
  const days: PayDay[] = input.attendance.map((d) => ({
    date: d.date,
    payable: d.status !== "absent" || d.date.getTime() >= input.today.getTime(),
  }));
  if (!input.employeeExited) {
    const firstFuture = addDays(input.today, 1);
    let cursor = firstFuture > input.month.from ? firstFuture : input.month.from;
    if (cursor < input.joinDate) cursor = input.joinDate;
    for (let date = cursor; date <= input.month.to; date = addDays(date, 1)) days.push({ date, payable: true });
  }
  return { days, provisional: input.month.to.getTime() >= input.today.getTime() };
};

// ------------------------------------------------------------------ incentives

/** The reward of the highest threshold reached (tiers do not add up); 0 below the first. */
export const rewardFor = (rules: IIncentiveRule[], valueMilli: number): number => {
  let reward = 0;
  let reached = -1;
  for (const rule of rules) {
    if (rule.thresholdMilli <= valueMilli && rule.thresholdMilli > reached) {
      reached = rule.thresholdMilli;
      reward = rule.rewardPaise;
    }
  }
  return reward;
};

/** ISO week key "2026-W40" of a date (weeks start on Monday). */
export const weekKeyOf = (date: Date): string => {
  const thursday = addDays(date, 3 - ((date.getUTCDay() + 6) % 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.floor((thursday.getTime() - yearStart.getTime()) / (7 * 86_400_000)) + 1;
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

export const periodKeyOf = (period: IncentivePeriod, date: Date): string =>
  period === "daily" ? formatDate(date) : period === "monthly" ? formatDate(date).slice(0, 7) : weekKeyOf(date);

/** First and last day of a period key of the given kind, or null when the key is not valid. */
export const periodRangeOf = (period: IncentivePeriod, key: string): { start: Date; end: Date } | null => {
  if (period === "daily") {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(key) ? new Date(`${key}T00:00:00.000Z`) : null;
    return d && !Number.isNaN(d.getTime()) && formatDate(d) === key ? { start: d, end: d } : null;
  }
  if (period === "monthly") {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
    return m ? { start: new Date(Date.UTC(+m[1], +m[2] - 1, 1)), end: new Date(Date.UTC(+m[1], +m[2], 0)) } : null;
  }
  const w = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!w) return null;
  const january4 = new Date(Date.UTC(+w[1], 0, 4));
  const monday = addDays(january4, -((january4.getUTCDay() + 6) % 7) + (+w[2] - 1) * 7);
  return weekKeyOf(monday) === key ? { start: monday, end: addDays(monday, 6) } : null;
};

/**
 * Which approved earnings a running total of incentive payouts has covered: oldest first,
 * each fully or not at all. A part-payment that does not reach the next earning leaves it approved.
 */
export const earningsCoveredBy = <T extends { rewardPaise: number }>(approvedOldestFirst: T[], paidTotalPaise: number): T[] => {
  const covered: T[] = [];
  let remaining = paidTotalPaise;
  for (const earning of approvedOldestFirst) {
    if (earning.rewardPaise > remaining) break;
    remaining -= earning.rewardPaise;
    covered.push(earning);
  }
  return covered;
};
