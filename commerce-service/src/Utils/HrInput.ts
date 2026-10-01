import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import { text } from "./Input.js";
import { isUuid } from "./Uuid.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fail = (message: string): never => {
  throw new CustomException(message, badRequest);
};

// Patch fields: undefined leaves the column alone, null or "" clears it.
export const isCleared = (value: unknown): boolean => value === null || value === "";

export const nullableText = (value: unknown, field: string, max: number): string | null | undefined => {
  if (value === undefined) return undefined;
  return isCleared(value) ? null : text(value, field, max);
};

export const parseEmail = (value: unknown): string => {
  const email = text(value, "email", 120).toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : fail("email is not valid.");
};

// Canonical E.164. A bare 10-digit mobile is taken as Indian; anything else must carry its "+".
export const parsePhone = (value: unknown, field = "phone"): string => {
  const raw = typeof value === "string" ? value.trim() : "";
  const compact = raw.replace(/[\s\-().]/g, "");
  if (/^\+\d{8,15}$/.test(compact)) return compact;
  const digits = compact.replace(/\D/g, "");
  const national = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.replace(/^0(?=\d{10}$)/, "");
  if (/^[6-9]\d{9}$/.test(national) && !compact.startsWith("+")) return `+91${national}`;
  return fail(`${field} must be a phone number like +919876543210.`);
};

export const parseUuid = (value: unknown, field: string): string =>
  isUuid(value) ? value : fail(`${field} must be a valid id.`);

export const parseUuidList = (value: unknown, field: string, maxItems: number): string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    return fail(`${field} must be a list of 1 to ${maxItems} ids.`);
  }
  const ids = value.map((item) => parseUuid(item, field));
  return [...new Set(ids)];
};

export const parseBoolean = (value: unknown, field: string): boolean =>
  typeof value === "boolean" ? value : fail(`${field} must be true or false.`);

export const parseHttpsUrl = (value: unknown, field: string, max: number): string => {
  const raw = text(value, field, max);
  try {
    if (new URL(raw).protocol === "https:") return raw;
  } catch {
    // falls through to the shared message
  }
  return fail(`${field} must be an https link.`);
};

export const textList = (value: unknown, field: string, maxItems: number, maxLength: number): string[] => {
  if (!Array.isArray(value) || value.length > maxItems) return fail(`${field} must be a list of at most ${maxItems} items.`);
  return value.map((item) => text(item, field, maxLength));
};

/** Lower-case key for matching free-text roles and blocker themes exactly. */
export const normaliseKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
