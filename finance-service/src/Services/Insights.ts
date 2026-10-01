import { getOrSet } from "../../commons/Cache/Cache.js";
import { Actor, effectiveStore } from "../Middleware/StoreScope.js";
import { addDays, DayRange, daysBetween } from "../Utils/Dates.js";
import { queryUuid } from "../Utils/Input.js";

// Dashboards and analytics are aggregates over a bounded window, cached for a few seconds so a
// screen full of widgets does not recompute the same sums. The cache lives at most 30 seconds,
// and nothing invalidates it earlier: a number may be up to 30 seconds old, no more.
export const INSIGHT_TTL_SECONDS = 30;

/** The store an insight is computed for: an admin's choice (query, else header scope), or all. */
export const insightStore = (query: Record<string, unknown>, actor: Actor): string | undefined =>
  effectiveStore(actor, queryUuid(query.storeId, "storeId")) ?? undefined;

/**
 * Caches one computed answer. The key carries everything the answer depends on: which insight,
 * the caller's role, the store scope and the parameters. Two callers with different scope or
 * role can therefore never be handed each other's entry.
 */
export const cachedInsight = <T>(
  name: string,
  actor: Pick<Actor, "role">,
  store: string | undefined,
  params: Record<string, string>,
  load: () => Promise<T>
): Promise<T> => {
  const parts = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join(",");
  return getOrSet(`insight:${name}:role=${actor.role}:store=${store ?? "all"}:${parts}`, INSIGHT_TTL_SECONDS, load);
};

/** The window of the same length that ends the day before `range` starts. */
export const previousRange = (range: DayRange): DayRange => {
  const length = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
};

/** Percent change to one decimal, or null when there is nothing to compare against. */
export const trendPct = (current: number, previous: number): number | null =>
  previous > 0 ? Math.round(((current - previous) * 1000) / previous) / 10 : null;

export const UNAVAILABLE_NOTE =
  "This figure comes from a service finance has no feed from yet, so it is reported as unavailable rather than guessed.";
