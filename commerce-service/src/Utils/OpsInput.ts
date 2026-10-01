import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import { text } from "./Input.js";
import { isUuid } from "./Uuid.js";

const fail = (message: string): never => {
  throw new CustomException(message, badRequest);
};

// A PATCH field: absent leaves the value alone, null or "" clears it, anything else is text.
export const nullableText = (value: unknown, field: string, max: number): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === "string" && value.trim() === "")) return null;
  return text(value, field, max);
};

export const optionalUuid = (value: unknown, field: string): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  return isUuid(value) ? value : fail(`${field} must be a valid id.`);
};

export const requiredUuid = (value: unknown, field: string): string =>
  isUuid(value) ? value : fail(`${field} must be a valid id.`);

// A list of distinct ids, at most `max` long.
export const uuidList = (value: unknown, field: string, max: number): string[] => {
  if (!Array.isArray(value)) return fail(`${field} must be a list of ids.`);
  if (value.length > max) return fail(`${field} can hold at most ${max} ids.`);
  const ids = value.map((id) => requiredUuid(id, field));
  return [...new Set(ids.map((id) => id.toLowerCase()))];
};

// Quantities travel as decimals and are stored as whole thousandths, so a quantity with a
// fourth decimal is refused instead of being silently rounded.
export const MILLI = 1000;

export const quantityToMilli = (value: unknown, field: string, maxMilli: number): number => {
  const quantity = typeof value === "number" ? value : Number.NaN;
  const milli = Math.round(quantity * MILLI);
  if (!Number.isFinite(quantity) || quantity <= 0 || Math.abs(quantity * MILLI - milli) > 1e-6) {
    return fail(`${field} must be a positive number with at most three decimals.`);
  }
  return milli > maxMilli ? fail(`${field} is too large.`) : milli;
};

export const nonNegativeQuantityToMilli = (value: unknown, field: string, maxMilli: number): number =>
  value === 0 ? 0 : quantityToMilli(value, field, maxMilli);

export const milliToQuantity = (milli: number): number => milli / MILLI;

export const MAX_BODY_ITEMS = 100;

export const queryBoolean = (value: unknown, field: string): boolean | undefined => {
  if (value === undefined || value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return fail(`${field} must be true or false.`);
};

export const queryInteger = (value: unknown, field: string, min: number, max: number): number | undefined => {
  if (value === undefined || value === "") return undefined;
  const number = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(number) || number < min || number > max) {
    return fail(`${field} must be a whole number from ${min} to ${max}.`);
  }
  return number;
};

const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,100}$/;

export const parseIdempotencyKey = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !IDEMPOTENCY_KEY.test(value)) {
    return fail("Idempotency-Key must be 8 to 100 visible characters.");
  }
  return value;
};

export interface IDocumentRef {
  url: string;
  name: string;
  caption: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  attachedAt: string;
  attachedBy: string;
}

const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const CONTENT_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i;

const fileNameOf = (url: URL): string => {
  try {
    return decodeURIComponent(url.pathname.split("/").pop() || "");
  } catch {
    return "";
  }
};

// File storage is out of scope: a document is a reference to a file kept elsewhere. Only
// https links are taken, and never ones carrying credentials.
export const parseDocumentRef = (input: Record<string, unknown>, attachedBy: string, now: Date): IDocumentRef => {
  const rawUrl = text(input.url, "url", 500);
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return fail("url must be a valid https link.");
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    return fail("url must be an https link without a username or password.");
  }
  const name = input.name === undefined ? fileNameOf(parsed) : input.name;
  const contentType = input.contentType === undefined || input.contentType === null ? null : text(input.contentType, "contentType", 100);
  if (contentType !== null && !CONTENT_TYPE.test(contentType)) return fail("contentType must look like application/pdf.");
  let sizeBytes: number | null = null;
  if (input.sizeBytes !== undefined && input.sizeBytes !== null) {
    const size = input.sizeBytes;
    if (typeof size !== "number" || !Number.isInteger(size) || size < 0 || size > MAX_DOCUMENT_BYTES) {
      return fail(`sizeBytes must be a whole number up to ${MAX_DOCUMENT_BYTES}.`);
    }
    sizeBytes = size;
  }
  return {
    url: parsed.toString(),
    name: text(name || "document", "name", 120),
    caption: input.caption === undefined || input.caption === null ? null : text(input.caption, "caption", 200),
    contentType,
    sizeBytes,
    attachedAt: now.toISOString(),
    attachedBy,
  };
};
