import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { CommerceClient, IOrderSummary } from "../Clients/Commerce.Client.js";
import { Actor } from "../Middleware/StoreScope.js";
import { CashQuery } from "../Queries/Cash.Query.js";
import { ExpenseQuery } from "../Queries/Expense.Query.js";
import { addDays, clock, dateToDay, dayRange, dayToDate, DayRange, istToday, monthEnd, monthStart } from "../Utils/Dates.js";
import { optionalOneOf, queryString } from "../Utils/Input.js";
import { toRupees } from "../Utils/Money.js";
import { operatingChargesBetween } from "./Costing.js";
import { cachedInsight, insightStore, previousRange, trendPct, UNAVAILABLE_NOTE } from "./Insights.js";

const GRANULARITIES = ["day", "week", "month"] as const;
type Granularity = (typeof GRANULARITIES)[number];
const FINAL_STATUSES = new Set(["delivered", "cancelled"]);

const rangeOf = (query: Record<string, unknown>): DayRange =>
  dayRange({ from: queryString(query.from, "from"), to: queryString(query.to, "to") }, { defaultDays: 30, maxDays: 366 });

/** The first day of the bucket a date falls in. Weeks start on Monday. */
export const bucketStart = (day: string, granularity: Granularity): string => {
  if (granularity === "day") return day;
  if (granularity === "month") return monthStart(day.slice(0, 7));
  const weekday = dayToDate(day).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
};

const summaryFor = (range: DayRange, storeId?: string): Promise<IOrderSummary> =>
  CommerceClient.getOrderSummary({ from: range.from, to: range.to, storeId });

const revenue = async (query: Record<string, unknown>, actor: Actor) => {
  try {
    const range = rangeOf(query);
    const granularity = optionalOneOf(queryString(query.granularity, "granularity"), GRANULARITIES, "granularity") ?? "day";
    const store = insightStore(query, actor);
    return await cachedInsight("revenue", actor, store, { ...range, granularity }, async () => {
      const [current, previous] = await Promise.all([summaryFor(range, store), summaryFor(previousRange(range), store)]);
      const buckets = new Map<string, { revenuePaise: number; orders: number }>();
      for (const row of current.byDay) {
        const key = bucketStart(row.date, granularity);
        const bucket = buckets.get(key) ?? { revenuePaise: 0, orders: 0 };
        bucket.revenuePaise += row.revenuePaise;
        bucket.orders += row.orders;
        buckets.set(key, bucket);
      }
      return {
        from: range.from,
        to: range.to,
        total: toRupees(current.revenuePaise),
        trendPct: trendPct(current.revenuePaise, previous.revenuePaise),
        series: [...buckets.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, b]) => ({ date, revenue: toRupees(b.revenuePaise), orders: b.orders })),
      };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const orders = async (query: Record<string, unknown>, actor: Actor) => {
  try {
    const range = rangeOf(query);
    const store = insightStore(query, actor);
    return await cachedInsight("orders", actor, store, { ...range }, async () => {
      const summary = await summaryFor(range, store);
      return {
        from: range.from,
        to: range.to,
        total: summary.orders,
        byStatus: summary.byStatus,
        // Turnaround and on-time need order timestamps that commerce's summary does not carry.
        avgTurnaroundHours: null,
        onTimePct: null,
        unavailable: ["avgTurnaroundHours", "onTimePct"],
      };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const stores = async (query: Record<string, unknown>, actor: Actor) => {
  try {
    const range = rangeOf(query);
    const store = insightStore(query, actor);
    return await cachedInsight("stores", actor, store, { ...range }, async () => {
      const summary = await summaryFor(range, store);
      return {
        from: range.from,
        to: range.to,
        stores: summary.byStore
          .slice()
          .sort((a, b) => b.revenuePaise - a.revenuePaise)
          .map((row) => ({
            storeId: row.storeId,
            // Store names live in commerce and the summary carries ids only.
            name: null,
            revenue: toRupees(row.revenuePaise),
            orders: row.orders,
            onTimePct: null,
            satisfaction: null,
          })),
        unavailable: ["name", "onTimePct", "satisfaction"],
      };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const monthToDateCosts = async (from: string, to: string, store: string | undefined): Promise<number> => {
  const [charges, spend] = await Promise.all([operatingChargesBetween(from, to, store), ExpenseQuery.spendByStore(from, to, store)]);
  return charges.reduce((sum, c) => sum + c.amountPaise, 0) + spend.reduce((sum, s) => sum + s.amountPaise, 0);
};

const overview = async (query: Record<string, unknown>, actor: Actor) => {
  try {
    // Everything is "as of" a day (default today): today, and the month up to that day.
    const asOf = queryString(query.to, "to") ? rangeOf({ to: query.to }).to : istToday(clock.now());
    const store = insightStore(query, actor);
    return await cachedInsight("overview", actor, store, { asOf }, async () => {
      const from = monthStart(asOf.slice(0, 7));
      const monthRange = { from, to: asOf };
      // The same number of days of the previous month, never spilling past its end.
      const prevMonth = dateToDay(new Date(Date.UTC(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)) - 2, 1))).slice(0, 7);
      const prevFrom = monthStart(prevMonth);
      const prevEnd = monthEnd(prevMonth);
      const sameDay = addDays(prevFrom, Number(asOf.slice(8)) - 1);
      const prevRange = { from: prevFrom, to: sameDay < prevEnd ? sameDay : prevEnd };
      const [current, previous, costs, cash] = await Promise.all([
        summaryFor(monthRange, store),
        summaryFor(prevRange, store),
        monthToDateCosts(from, asOf, store),
        CashQuery.summarise(asOf, asOf, store ?? null),
      ]);
      const today = current.byDay.find((row) => row.date === asOf);
      const inProgress = Object.entries(current.byStatus)
        .filter(([status]) => !FINAL_STATUSES.has(status))
        .reduce((sum, [, n]) => sum + n, 0);
      return {
        asOf,
        revenue: {
          today: toRupees(today?.revenuePaise ?? 0),
          monthToDate: toRupees(current.revenuePaise),
          trendPct: trendPct(current.revenuePaise, previous.revenuePaise),
        },
        orders: { today: today?.orders ?? 0, inProgress, delayed: null },
        capacity: null,
        costs: {
          monthToDate: toRupees(costs),
          perOrder: current.orders > 0 ? toRupees(Math.round(costs / current.orders)) : null,
        },
        cash: {
          collected: toRupees(cash.countedPaise),
          banked: toRupees(cash.bankedPaise),
          variance: toRupees(cash.bankedPaise - cash.expectedPaise),
        },
        people: null,
        satisfaction: null,
        risks: null,
        unavailable: ["orders.delayed", "capacity", "people", "satisfaction", "risks"],
        note: UNAVAILABLE_NOTE,
      };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

// People, satisfaction and risks are held by other services, with no feed into finance yet.
// They answer with their shape and an explicit "unavailable", never zeros that look like data.
const unavailable = async (kind: "people" | "satisfaction" | "risks", query: Record<string, unknown>, actor: Actor) => {
  try {
    insightStore(query, actor);
    const shells = {
      people: { headcount: null, presentToday: null, onLeave: null, openGrievances: null, overdueTraining: null },
      satisfaction: { average: null, trend: null, complaintsOpen: null, byStore: [] },
      risks: { items: [], complete: false },
    };
    return { ...shells[kind], unavailable: true, note: UNAVAILABLE_NOTE };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const DashboardService = {
  overview,
  revenue,
  orders,
  stores,
  people: (query: Record<string, unknown>, actor: Actor) => unavailable("people", query, actor),
  satisfaction: (query: Record<string, unknown>, actor: Actor) => unavailable("satisfaction", query, actor),
  risks: (query: Record<string, unknown>, actor: Actor) => unavailable("risks", query, actor),
};
