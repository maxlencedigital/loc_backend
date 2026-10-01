import { IOperatingCost, CostFrequency, OperatingCostType } from "../Models/Expense/Expense.Interface.js";
import { OperatingCostQuery } from "../Queries/OperatingCost.Query.js";
import { monthEnd, monthIndex, monthOf, monthStart, nextMonth } from "../Utils/Dates.js";

// A recurring cost is charged in full on the months it falls due (every 1, 3 or 12 months from
// its start month), on its due day. This is a look-up of what falls due, not an estimate and
// not a spread: a yearly insurance premium shows up in the month it is paid.
const INTERVAL_MONTHS: Record<CostFrequency, number> = { monthly: 1, quarterly: 3, yearly: 12 };

export interface ICharge {
  date: string;
  type: OperatingCostType;
  storeId: string | null;
  amountPaise: number;
}

type Schedule = Pick<IOperatingCost, "type" | "amountPaise" | "frequency" | "storeId" | "dueDay" | "startDate" | "endDate">;

const pad = (n: number) => String(n).padStart(2, "0");

/** The date a cost is charged in `month`, or null when it does not fall due then. */
export const chargeDateIn = (cost: Schedule, month: string): string | null => {
  const sinceStart = monthIndex(month) - monthIndex(monthOf(cost.startDate));
  if (sinceStart < 0 || sinceStart % INTERVAL_MONTHS[cost.frequency] !== 0) return null;
  // Day 28 is the latest due day, so every month has it.
  const day = cost.dueDay ?? Math.min(Number(cost.startDate.slice(8, 10)), 28);
  const date = `${month}-${pad(day)}`;
  if (date < cost.startDate) return null;
  if (cost.endDate && date > cost.endDate) return null;
  return date;
};

/** Every charge falling in [from, to] (inclusive days). */
export const chargesBetween = (costs: Schedule[], from: string, to: string): ICharge[] => {
  const charges: ICharge[] = [];
  const last = monthOf(to);
  for (let month = monthOf(from); month <= last; month = nextMonth(month)) {
    for (const cost of costs) {
      const date = chargeDateIn(cost, month);
      if (date && date >= from && date <= to) {
        charges.push({ date, type: cost.type, storeId: cost.storeId, amountPaise: cost.amountPaise });
      }
    }
  }
  return charges;
};

/** Charges for a window, read from the cost rows (bounded set of definitions, not per-day rows). */
export const operatingChargesBetween = async (from: string, to: string, storeId?: string): Promise<ICharge[]> =>
  chargesBetween(await OperatingCostQuery.listActiveBetween(from, to, storeId), from, to);

export const chargesForMonth = (month: string, storeId?: string) =>
  operatingChargesBetween(monthStart(month), monthEnd(month), storeId);

export const sumBy = <K extends string | null>(charges: ICharge[], key: (c: ICharge) => K): Map<K, number> => {
  const totals = new Map<K, number>();
  for (const charge of charges) totals.set(key(charge), (totals.get(key(charge)) ?? 0) + charge.amountPaise);
  return totals;
};
