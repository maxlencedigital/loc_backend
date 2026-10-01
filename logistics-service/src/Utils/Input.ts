import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import { isUuid } from "./Uuid.js";

// Explicit, typed readers for request bodies and query strings. Each one names the
// field in its error, so a client is told what to fix; none of them trusts a type.

const fail = (message: string): never => {
  throw new CustomException(message, badRequest);
};

export const isBlank = (value: unknown): boolean => value === undefined || value === null || value === "";

export const object = (value: unknown, name: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${name} must be an object.`);
  return value as Record<string, unknown>;
};

export const text = (
  value: unknown,
  name: string,
  options: { min?: number; max: number; required?: boolean }
): string | null => {
  if (isBlank(value)) {
    if (options.required) fail(`${name} is required.`);
    return null;
  }
  if (typeof value !== "string") return fail(`${name} must be text.`);
  const trimmed = value.trim();
  if (!trimmed) {
    if (options.required) fail(`${name} is required.`);
    return null;
  }
  if (trimmed.length < (options.min ?? 1) || trimmed.length > options.max) {
    fail(`${name} must be ${options.min ?? 1} to ${options.max} characters.`);
  }
  return trimmed;
};

export const requiredText = (value: unknown, name: string, max: number, min = 1): string =>
  text(value, name, { min, max, required: true }) as string;

export const oneOf = <T extends string>(value: unknown, allowed: readonly T[], name: string): T => {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(`${name} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
};

export const optionalOneOf = <T extends string>(value: unknown, allowed: readonly T[], name: string): T | null =>
  isBlank(value) ? null : oneOf(value, allowed, name);

export const uuid = (value: unknown, name: string): string => {
  if (!isUuid(value)) fail(`${name} must be a valid id.`);
  return value as string;
};

export const optionalUuid = (value: unknown, name: string): string | null => (isBlank(value) ? null : uuid(value, name));

export const integer = (value: unknown, name: string, min: number, max: number): number => {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    fail(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return parsed as number;
};

export const decimal = (value: unknown, name: string, min: number, max: number): number => {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < min || parsed > max) {
    fail(`${name} must be a number from ${min} to ${max}.`);
  }
  return parsed as number;
};

export const bool = (value: unknown, name: string): boolean => {
  if (typeof value !== "boolean") fail(`${name} must be true or false.`);
  return value as boolean;
};

export const optionalBool = (value: unknown, name: string): boolean | null => (isBlank(value) ? null : bool(value, name));

/** A single query-string value; a repeated or nested one is refused. */
export const queryText = (value: unknown, name: string, max = 200): string | null => {
  if (isBlank(value)) return null;
  if (typeof value !== "string") return fail(`${name} must be a single value.`);
  return value.length > max ? fail(`${name} is too long.`) : value.trim() || null;
};

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Both or neither: a lone latitude is a client bug, not a location. */
export const coordinates = (source: Record<string, unknown>, label = ""): Coordinates | null => {
  const lat = source.latitude;
  const lng = source.longitude;
  if (isBlank(lat) && isBlank(lng)) return null;
  if (isBlank(lat) || isBlank(lng)) fail(`${label}latitude and longitude must be given together.`);
  return {
    latitude: decimal(lat, `${label}latitude`, -90, 90),
    longitude: decimal(lng, `${label}longitude`, -180, 180),
  };
};

const E164 = /^\+[1-9]\d{9,14}$/;

/** Indian mobiles may arrive as 10 digits or with 91/0 prefixes; stored as E.164. */
export const phone = (value: unknown, name = "phone"): string => {
  if (typeof value !== "string") return fail(`${name} must be a phone number.`);
  const compact = value.replace(/[\s\-()]/g, "");
  let candidate = compact;
  if (/^[6-9]\d{9}$/.test(compact)) candidate = `+91${compact}`;
  else if (/^0[6-9]\d{9}$/.test(compact)) candidate = `+91${compact.slice(1)}`;
  else if (/^91[6-9]\d{9}$/.test(compact)) candidate = `+${compact}`;
  if (!E164.test(candidate)) fail(`${name} must be a valid phone number.`);
  return candidate;
};

export const email = (value: unknown, name = "email"): string | null => {
  const raw = text(value, name, { max: 254 });
  if (raw === null) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) fail(`${name} must be a valid email address.`);
  return raw.toLowerCase();
};

/** Only https links are references we are willing to store and later show to staff. */
export const httpsUrl = (value: unknown, name: string): string => {
  const raw = requiredText(value, name, 2048);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return fail(`${name} must be a valid https link.`);
  }
  if (parsed.protocol !== "https:") fail(`${name} must be a valid https link.`);
  return parsed.toString();
};

/** Keeps only the last four characters of an identifier, as XXXXXX1234. */
export const mask = (value: string): string => {
  const compact = value.replace(/\s+/g, "");
  return `${"X".repeat(Math.max(compact.length - 4, 0))}${compact.slice(-4)}`;
};
