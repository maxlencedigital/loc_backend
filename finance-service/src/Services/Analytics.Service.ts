import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { CommerceClient } from "../Clients/Commerce.Client.js";
import { Actor } from "../Middleware/StoreScope.js";
import { ExpenseQuery } from "../Queries/Expense.Query.js";
import { dayRange, DayRange } from "../Utils/Dates.js";
import { oneOf, queryString } from "../Utils/Input.js";
import { mulDivHalfUp, toRupees } from "../Utils/Money.js";
import { ICharge, operatingChargesBetween } from "./Costing.js";
import { cachedInsight, insightStore } from "./Insights.js";

const RESOURCES = ["water", "electricity", "detergent"] as const;
type Resource = (typeof RESOURCES)[number];

// Detergent is bought, not billed: it is the spend on the expense category named "detergent".
const DETERGENT_CATEGORY = "detergent";

const rangeOf = (query: Record<string, unknown>): DayRange =>
  dayRange({ from: queryString(query.from, "from"), to: queryString(query.to, "to") }, { defaultDays: 30, maxDays: 366 });

const perOrder = (paise: number, orders: number): number => (orders > 0 ? toRupees(mulDivHalfUp(paise, 1, orders)) : 0);

const sumPaise = (rows: Array<{ amountPaise: number }>) => rows.reduce((sum, r) => sum + r.amountPaise, 0);

/** What the window cost, split the way the catalogue names it. */
const gatherCosts = async (range: DayRange, store: string | undefined) => {
  const [charges, detergentDays, allSpend] = await Promise.all([
    operatingChargesBetween(range.from, range.to, store),
    ExpenseQuery.spendByDay(range.from, range.to, { storeId: store, categoryKey: DETERGENT_CATEGORY }),
    ExpenseQuery.spendByStore(range.from, range.to, store),
  ]);
  const ofType = (type: string) => sumPaise(charges.filter((c) => c.type === type));
  const detergent = sumPaise(detergentDays);
  const water = ofType("water");
  const electricity = ofType("electricity");
  const labour = ofType("salary");
  const operating = sumPaise(charges);
  // Everything else: the other operating costs and the other approved expenses.
  const other = operating - water - electricity - labour + (sumPaise(allSpend) - detergent);
  return { charges, detergentDays, water, electricity, labour, detergent, other, total: operating + sumPaise(allSpend) };
};

const orderCost = async (query: Record<string, unknown>, actor: Actor) => {
  try {
    const range = rangeOf(query);
    const store = insightStore(query, actor);
    return await cachedInsight("order-cost", actor, store, { ...range }, async () => {
      const [summary, costs, daily] = await Promise.all([
        CommerceClient.getOrderSummary({ from: range.from, to: range.to, storeId: store }),
        gatherCosts(range, store),
        ExpenseQuery.spendByDay(range.from, range.to, { storeId: store }),
      ]);
      const spendByDay = new Map<string, number>();
      for (const c of costs.charges) spendByDay.set(c.date, (spendByDay.get(c.date) ?? 0) + c.amountPaise);
      for (const d of daily) spendByDay.set(d.date, (spendByDay.get(d.date) ?? 0) + d.amountPaise);
      const n = summary.orders;
      return {
        from: range.from,
        to: range.to,
        orders: n,
        averagePerOrder: {
          water: perOrder(costs.water, n),
          electricity: perOrder(costs.electricity, n),
          detergent: perOrder(costs.detergent, n),
          labour: perOrder(costs.labour, n),
          other: perOrder(costs.other, n),
          total: perOrder(costs.total, n),
        },
        // Only days with orders: a cost that falls due on a day with none has nothing to divide by.
        series: summary.byDay
          .filter((row) => row.orders > 0)
          .map((row) => ({ date: row.date, perOrder: perOrder(spendByDay.get(row.date) ?? 0, row.orders) })),
      };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const resourceUsage = async (query: Record<string, unknown>, actor: Actor) => {
  try {
    const range = rangeOf(query);
    const resource: Resource = oneOf(queryString(query.resource, "resource") ?? "water", RESOURCES, "resource");
    const store = insightStore(query, actor);
    return await cachedInsight("resource-usage", actor, store, { ...range, resource }, async () => {
      const [summary, costs] = await Promise.all([
        CommerceClient.getOrderSummary({ from: range.from, to: range.to, storeId: store }),
        gatherCosts(range, store),
      ]);
      const days: Array<{ date: string; amountPaise: number }> =
        resource === "detergent"
          ? costs.detergentDays
          : costs.charges.filter((c: ICharge) => c.type === resource).map((c) => ({ date: c.date, amountPaise: c.amountPaise }));
      const byDate = new Map<string, number>();
      for (const d of days) byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.amountPaise);
      const totalPaise = sumPaise(days);
      return {
        from: range.from,
        to: range.to,
        resource,
        // The platform records no meter or stock readings, so "used" is what was spent, in rupees.
        unit: "INR",
        total: toRupees(totalPaise),
        perOrder: perOrder(totalPaise, summary.orders),
        series: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, paise]) => ({ date, value: toRupees(paise) })),
      };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const storeEconomics = async (query: Record<string, unknown>, actor: Actor) => {
  try {
    const range = rangeOf(query);
    const store = insightStore(query, actor);
    return await cachedInsight("store-economics", actor, store, { ...range }, async () => {
      const [summary, charges, spend] = await Promise.all([
        CommerceClient.getOrderSummary({ from: range.from, to: range.to, storeId: store }),
        operatingChargesBetween(range.from, range.to, store),
        ExpenseQuery.spendByStore(range.from, range.to, store),
      ]);
      const rows = new Map<string | null, { revenue: number; cost: number }>();
      const slot = (id: string | null) => {
        const row = rows.get(id) ?? { revenue: 0, cost: 0 };
        rows.set(id, row);
        return row;
      };
      for (const r of summary.byStore) slot(r.storeId.toLowerCase()).revenue += r.revenuePaise;
      for (const c of charges) slot(c.storeId).cost += c.amountPaise;
      for (const s of spend) slot(s.storeId).cost += s.amountPaise;

      return {
        from: range.from,
        to: range.to,
        stores: [...rows.entries()]
          .sort(([a], [b]) => String(a).localeCompare(String(b)))
          .map(([storeId, r]) => {
            const margin = r.revenue - r.cost;
            return {
              storeId,
              // Names live in commerce; costs with no store are the company-wide row (storeId null).
              name: storeId === null ? "Company-wide" : null,
              revenue: toRupees(r.revenue),
              runningCost: toRupees(r.cost),
              margin: toRupees(margin),
              marginPct: r.revenue > 0 ? Math.round((margin * 1000) / r.revenue) / 10 : null,
            };
          }),
      };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

export const AnalyticsService = { orderCost, resourceUsage, storeEconomics };
