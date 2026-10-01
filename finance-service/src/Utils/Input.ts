import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A malformed id never reaches Postgres, whose uuid column would answer with a 500.
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const fail = (message: string): never => {
  throw new CustomException(message, badRequest);
};

/** A path id that is not a uuid cannot exist: answer 404, the same as an unknown id. */
export const pathId = (value: unknown, what = "Record"): string => {
  if (!isUuid(value)) throw new CustomException(`${what} not found.`, notFound);
  return value.toLowerCase();
};

export const uuidField = (value: unknown, field: string): string =>
  isUuid(value) ? value.toLowerCase() : fail(`${field} must be a valid id.`);

export const optionalUuidField = (value: unknown, field: string): string | undefined =>
  value === undefined || value === null || value === "" ? undefined : uuidField(value, field);

export const text = (value: unknown, field: string, max: number): string => {
  if (typeof value !== "string" || value.trim() === "") return fail(`${field} is required.`);
  const trimmed = value.trim();
  return trimmed.length > max ? fail(`${field} must be at most ${max} characters.`) : trimmed;
};

export const optionalText = (value: unknown, field: string, max: number): string | undefined =>
  value === undefined || value === null || value === "" ? undefined : text(value, field, max);

export const oneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string): T =>
  allowed.includes(value as T) ? (value as T) : fail(`${field} must be one of: ${allowed.join(", ")}.`);

export const optionalOneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined =>
  value === undefined || value === null || value === "" ? undefined : oneOf(value, allowed, field);

export const wholeNumber = (value: unknown, field: string, min: number, max: number): number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fail(`${field} must be a whole number from ${min} to ${max}.`);

export const optionalBoolean = (value: unknown, field: string): boolean | undefined => {
  if (value === undefined || value === "") return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fail(`${field} must be true or false.`);
};

/** A query-string value: repeated or nested values (?a=1&a=2, ?a[b]=1) are refused, not coerced. */
export const queryString = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return fail(`${field} must be a single value.`);
  return value.trim() === "" ? undefined : value.trim();
};

export const queryEnum = <T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined => {
  const raw = queryString(value, field);
  return raw === undefined ? undefined : oneOf(raw, allowed, field);
};

export const queryUuid = (value: unknown, field: string): string | undefined => {
  const raw = queryString(value, field);
  return raw === undefined ? undefined : uuidField(raw, field);
};

export const queryWholeNumber = (value: unknown, field: string, min: number, max: number): number | undefined => {
  const raw = queryString(value, field);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return wholeNumber(Number.isFinite(parsed) ? parsed : Number.NaN, field, min, max);
};

export const parseBody = (body: unknown): Record<string, unknown> =>
  body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

/** An Idempotency-Key header (or body value): printable, 1 to 128 characters. */
export const idempotencyKeyOf = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^[\x21-\x7e]{1,128}$/.test(value.trim())) {
    return fail("Idempotency-Key must be 1 to 128 printable characters without spaces.");
  }
  return value.trim();
};
