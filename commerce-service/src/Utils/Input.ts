import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";

export const DEFAULT_LIST_LIMIT = 500;
export const MAX_LIST_LIMIT = 1000;

const fail = (message: string): never => {
  throw new CustomException(message, badRequest);
};

// Trimmed string within a length bound. Optional fields pass `undefined` through.
export const text = (value: unknown, field: string, max: number): string => {
  if (typeof value !== "string" || value.trim() === "") return fail(`${field} is required.`);
  const trimmed = value.trim();
  return trimmed.length > max ? fail(`${field} must be at most ${max} characters.`) : trimmed;
};

export const optionalText = (value: unknown, field: string, max: number): string | undefined =>
  value === undefined || value === null ? undefined : text(value, field, max);

export const oneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string): T =>
  allowed.includes(value as T) ? (value as T) : fail(`${field} must be one of: ${allowed.join(", ")}.`);

export const optionalOneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string
): T | undefined => (value === undefined || value === null || value === "" ? undefined : oneOf(value, allowed, field));

export const wholeNumber = (value: unknown, field: string, min: number, max: number): number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fail(`${field} must be a whole number from ${min} to ${max}.`);

// A query-string value: several values or objects (?q[a]=1) are refused, not coerced.
export const queryString = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return fail(`${field} must be a single value.`);
  return value.trim() === "" ? undefined : value.trim();
};

export const parseLimit = (value: unknown): number => {
  const raw = queryString(value, "limit");
  if (raw === undefined) return DEFAULT_LIST_LIMIT;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1) return fail("limit must be a positive whole number.");
  return Math.min(limit, MAX_LIST_LIMIT);
};

export const parseBody = (body: unknown): Record<string, unknown> =>
  body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
