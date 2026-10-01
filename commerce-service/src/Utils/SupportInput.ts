import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { isUuid } from "./Uuid.js";
import { queryString } from "./Input.js";

const MS_PER_DAY = 86_400_000;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:~-]{1,128}$/;

const fail = (message: string): never => {
  throw new CustomException(message, badRequest);
};

/** The signed-in account's id, which every owner column stores; the gateway always sends a uuid. */
export const userIdOf = (user: RequestUser): string => {
  if (!isUuid(user.id)) throw new CustomException("Your account identity is not valid.", badRequest);
  return user.id;
};

/** A malformed id is a miss, not a database error. */
export const idOrNotFound = (id: unknown, message: string): string => {
  if (!isUuid(id)) throw new CustomException(message, notFound);
  return id;
};

/** The optional Idempotency-Key header. */
export const parseIdempotencyKey = (raw: unknown): string | null => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !IDEMPOTENCY_KEY.test(raw.trim())) {
    return fail("Idempotency-Key must be 1 to 128 letters, digits or . _ : ~ - characters.");
  }
  return raw.trim();
};

export const optionalUuidQuery = (value: unknown, field: string): string | undefined => {
  const raw = queryString(value, field);
  if (raw === undefined) return undefined;
  return isUuid(raw) ? raw : fail(`${field} must be a valid id.`);
};

export const optionalIntQuery = (value: unknown, field: string, min: number, max: number): number | undefined => {
  const raw = queryString(value, field);
  if (raw === undefined) return undefined;
  const number = Number(raw);
  return Number.isInteger(number) && number >= min && number <= max
    ? number
    : fail(`${field} must be a whole number from ${min} to ${max}.`);
};

/** An ISO date from a query string; `to=2026-09-30` runs through the end of that day. */
export const optionalDayQuery = (value: unknown, field: string, endOfDay: boolean): Date | undefined => {
  const raw = queryString(value, field);
  if (raw === undefined) return undefined;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return fail(`${field} must be an ISO date.`);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  return endOfDay && dateOnly ? new Date(at.getTime() + MS_PER_DAY - 1) : at;
};

export const optionalBoolean = (value: unknown, field: string): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  return typeof value === "boolean" ? value : fail(`${field} must be true or false.`);
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  manager: "Store manager",
  staff: "Employee",
  customer: "Customer",
};

/** Shown on a thread entry: the name the gateway forwarded, else the role. */
export const actorNameOf = (user: RequestUser): string => user.name ?? ROLE_LABEL[user.role] ?? user.role;

/**
 * A store filter in the query string against the caller's store scope. A scope pins the
 * answer to one store (a store-bound role, or an admin who picked one), so asking for a
 * different store finds nothing rather than widening access.
 */
export const effectiveStore = (scope: string | null, requested: string | undefined): string | null => {
  if (scope && requested && requested !== scope) throw new CustomException("Store not found.", notFound);
  return scope ?? requested ?? null;
};
