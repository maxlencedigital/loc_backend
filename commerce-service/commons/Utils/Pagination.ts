import { CustomException } from "../Exception/CustomException.js";
import { badRequest } from "./StatusCode.js";

// Every list endpoint pages the same way: ?page=1&limit=20, limit capped at 100, and the
// answer is { items, page, limit, total }. The cap is what keeps one request from
// reading a whole table; pair it with an index on the ORDER BY column.

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface PageRequest {
  page: number;
  limit: number;
  /** Rows to skip: pass to Prisma as `skip`, with `limit` as `take`. */
  offset: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

const positiveInt = (raw: unknown, name: string, fallback: number): number => {
  if (raw === undefined || raw === null || raw === "") return fallback;
  // A repeated or nested query value (?page=1&page=2) arrives as an array or object.
  const value = typeof raw === "string" || typeof raw === "number" ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < 1) {
    throw new CustomException(`${name} must be a whole number of 1 or more.`, badRequest);
  }
  return value;
};

/** Reads page and limit from a query object. A limit above the cap is lowered, not refused. */
export const parsePage = (query: { page?: unknown; limit?: unknown } = {}): PageRequest => {
  const page = positiveInt(query.page, "page", 1);
  const limit = Math.min(positiveInt(query.limit, "limit", DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  return { page, limit, offset: (page - 1) * limit };
};

export const toPage = <T>(items: T[], total: number, request: PageRequest): Page<T> => ({
  items,
  page: request.page,
  limit: request.limit,
  total,
});
