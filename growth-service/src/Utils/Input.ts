import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";

// Boundary parsing shared by every service: explicit type, range and length checks, and
// money converted between the API's rupees and the database's integer paise.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_PAISE = 2_000_000_000;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** A path id that is not a uuid cannot exist: answer 404, never a database error. */
export const pathId = (value: unknown): string => {
  if (!isUuid(value)) throw new CustomException("Not found.", notFound);
  return value.toLowerCase();
};

export const bodyOf = (body: unknown): Record<string, unknown> => {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new CustomException("Request body must be a JSON object.", badRequest);
  }
  return body as Record<string, unknown>;
};

export const uuidField = (value: unknown, field: string): string => {
  if (!isUuid(value)) throw new CustomException(`${field} must be a valid id.`, badRequest);
  return value.toLowerCase();
};

export const stringField = (value: unknown, field: string, min: number, max: number): string => {
  if (typeof value !== "string") throw new CustomException(`${field} must be text.`, badRequest);
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw new CustomException(`${field} must be between ${min} and ${max} characters.`, badRequest);
  }
  return text;
};

export const intField = (value: unknown, field: string, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new CustomException(`${field} must be a whole number from ${min} to ${max}.`, badRequest);
  }
  return value;
};

export const boolField = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") throw new CustomException(`${field} must be true or false.`, badRequest);
  return value;
};

export const enumField = <T extends string>(value: unknown, field: string, allowed: readonly T[]): T => {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new CustomException(`${field} must be one of ${allowed.join(", ")}.`, badRequest);
  }
  return value as T;
};

export const uuidList = (value: unknown, field: string, max: number): string[] => {
  if (!Array.isArray(value) || value.length > max) {
    throw new CustomException(`${field} must be a list of at most ${max} ids.`, badRequest);
  }
  return [...new Set(value.map((v) => uuidField(v, field)))];
};

/** Rupees (up to 2 decimals) from the API to whole paise. */
export const toPaise = (value: unknown, field: string, allowZero = true): number => {
  const rupees = typeof value === "number" ? value : Number.NaN;
  const paise = Math.round(rupees * 100);
  if (!Number.isFinite(rupees) || paise < (allowZero ? 0 : 1) || paise > MAX_PAISE) {
    throw new CustomException(`${field} must be a valid rupee amount.`, badRequest);
  }
  return paise;
};

export const toRupees = (paise: number): number => paise / 100;

/** A date or date-time. A bare date means the start of that day, or its end when `endOfDay`. */
export const dateField = (value: unknown, field: string, endOfDay = false): Date => {
  if (typeof value !== "string" || value.length > 40) {
    throw new CustomException(`${field} must be a date.`, badRequest);
  }
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : value);
  if (Number.isNaN(parsed.getTime())) throw new CustomException(`${field} must be a date.`, badRequest);
  return parsed;
};

/** Reads a boolean query flag ("true"/"false"); anything else is a 400. */
export const queryBool = (value: unknown, field: string): boolean | undefined => {
  if (value === undefined || value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new CustomException(`${field} must be true or false.`, badRequest);
};

export const queryText = (value: unknown, field: string, max = 100): string | undefined => {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length > max) {
    throw new CustomException(`${field} must be text of at most ${max} characters.`, badRequest);
  }
  return value.trim() || undefined;
};

export const queryUuid = (value: unknown, field: string): string | undefined =>
  value === undefined || value === "" ? undefined : uuidField(value, field);

export const queryEnum = <T extends string>(value: unknown, field: string, allowed: readonly T[]): T | undefined =>
  value === undefined || value === "" ? undefined : enumField(value, field, allowed);

export const queryDate = (value: unknown, field: string, endOfDay = false): Date | undefined =>
  value === undefined || value === "" ? undefined : dateField(value, field, endOfDay);

export const queryInt = (value: unknown, field: string, min: number, max: number, fallback: number): number => {
  if (value === undefined || value === "") return fallback;
  const n = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new CustomException(`${field} must be a whole number from ${min} to ${max}.`, badRequest);
  }
  return n;
};

/** Rejects keys outside the whitelist, so a PATCH can never write a field it was not meant to. */
export const onlyKeys = (body: Record<string, unknown>, allowed: readonly string[]): void => {
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length > 0) throw new CustomException(`Unknown field: ${extra.slice(0, 3).join(", ")}.`, badRequest);
};

export const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);
