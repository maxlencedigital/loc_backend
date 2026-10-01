import { CustomException } from "../../commons/Exception/CustomException.js";
import { ServiceClient } from "../../commons/Http/ServiceClient.js";
import { serviceUnavailable } from "../../commons/Utils/StatusCode.js";

// The only door to commerce's order data. Finance owns no orders: every order-derived figure
// (revenue, counts, by day, by store) comes from commerce's SQL-aggregated summary.

export interface IOrderSummary {
  orders: number;
  revenuePaise: number;
  byStatus: Record<string, number>;
  byDay: Array<{ date: string; orders: number; revenuePaise: number }>;
  byStore: Array<{ storeId: string; orders: number; revenuePaise: number }>;
}

const unusable = () => new CustomException("Order figures are unavailable right now. Please try again.", serviceUnavailable);

const count = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw unusable();
  return value;
};

// A malformed answer is treated as an unavailable service, never passed on as numbers.
const normalise = (raw: unknown): IOrderSummary => {
  const body = raw as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || !Array.isArray(body.byDay) || !Array.isArray(body.byStore)) throw unusable();
  const byStatus: Record<string, number> = {};
  for (const [key, value] of Object.entries((body.byStatus as Record<string, unknown>) ?? {})) byStatus[key] = count(value);
  return {
    orders: count(body.orders),
    revenuePaise: count(body.revenuePaise),
    byStatus,
    byDay: (body.byDay as Array<Record<string, unknown>>).map((row) => ({
      date: String(row.date).slice(0, 10),
      orders: count(row.orders),
      revenuePaise: count(row.revenuePaise),
    })),
    byStore: (body.byStore as Array<Record<string, unknown>>).map((row) => ({
      storeId: String(row.storeId),
      orders: count(row.orders),
      revenuePaise: count(row.revenuePaise),
    })),
  };
};

const getOrderSummary = async (params: { from: string; to: string; storeId?: string }): Promise<IOrderSummary> =>
  normalise(
    await ServiceClient.get("commerce", "/internal/orders/summary", {
      query: { from: params.from, to: params.to, storeId: params.storeId },
    })
  );

export const CommerceClient = { getOrderSummary };
