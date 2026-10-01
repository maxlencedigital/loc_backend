import { randomUUID } from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { ServiceClient } from "../../commons/Http/ServiceClient.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import type { ActivityEntity, IActivityCreate } from "../Models/Ops/Activity.Interface.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { optionalText, queryString, text } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";

// Helpers shared by the compliance, audit and incident services of package P09: dates,
// ids, evidence links, store resolution, the user directory and history rows.

const MS_PER_DAY = 86_400_000;
// The business runs in India: a "day" (today, a from/to filter) is an IST calendar day.
const IST_OFFSET_MS = 330 * 60_000;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

export const STORE_NOT_FOUND = "Store not found.";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  hr: "HR",
  manager: "Store manager",
  staff: "Employee",
  driver: "Rider",
};

export const actorName = (user: RequestUser): string => user.name ?? ROLE_LABEL[user.role] ?? user.role;

// ------------------------------------------------------------------- dates
/** Today's IST calendar date as a UTC-midnight Date, the shape Postgres DATE columns return. */
export const todayInIst = (now: Date = new Date()): Date => {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
};

export const dayString = (day: Date): string => day.toISOString().slice(0, 10);
export const addDays = (day: Date, days: number): Date => new Date(day.getTime() + days * MS_PER_DAY);
export const daysBetween = (from: Date, to: Date): number => Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
/** The instant an IST calendar day begins. */
export const istDayStart = (day: Date): Date => new Date(day.getTime() - IST_OFFSET_MS);

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const parseDay = (value: unknown, field: string): Date => {
  const fail = () => new CustomException(`${field} must be a date like 2026-09-30.`, badRequest);
  if (typeof value !== "string" || !DAY_PATTERN.test(value)) throw fail();
  const day = new Date(`${value}T00:00:00Z`);
  // Rejects 2026-02-31, which Date would silently roll into March.
  if (Number.isNaN(day.getTime()) || dayString(day) !== value) throw fail();
  const year = day.getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) throw new CustomException(`${field} is out of range.`, badRequest);
  return day;
};

export const optionalDay = (value: unknown, field: string): Date | undefined =>
  value === undefined || value === null || value === "" ? undefined : parseDay(value, field);

/** For a PATCH: undefined leaves the field alone, null clears it. */
export const nullableDay = (value: unknown, field: string): Date | null | undefined =>
  value === null ? null : optionalDay(value, field);

export const parseInstant = (value: unknown, field: string): Date => {
  const at = new Date(typeof value === "string" ? value : Number.NaN);
  if (typeof value !== "string" || Number.isNaN(at.getTime())) {
    throw new CustomException(`${field} must be an ISO date and time.`, badRequest);
  }
  return at;
};

/** ?from=&to= as IST days: `from` is the start of its day, `to` is the end of its day (exclusive bound). */
export const parseDayRange = (query: Record<string, unknown>): { from?: Date; to?: Date } => {
  const from = optionalDay(queryString(query.from, "from"), "from");
  const to = optionalDay(queryString(query.to, "to"), "to");
  if (from && to && to < from) throw new CustomException("to must not be before from.", badRequest);
  return {
    ...(from ? { from: istDayStart(from) } : {}),
    ...(to ? { to: istDayStart(addDays(to, 1)) } : {}),
  };
};

// ---------------------------------------------------------------- scalars
export const uuidField = (value: unknown, field: string): string => {
  if (!isUuid(value)) throw new CustomException(`${field} must be a valid id.`, badRequest);
  return value;
};

export const optionalUuid = (value: unknown, field: string): string | undefined =>
  value === undefined || value === null || value === "" ? undefined : uuidField(value, field);

export const queryUuid = (value: unknown, field: string): string | undefined => {
  const raw = queryString(value, field);
  return raw === undefined ? undefined : uuidField(raw, field);
};

/** For a PATCH: undefined leaves the field alone, null clears it. */
export const nullableText = (value: unknown, field: string, max: number): string | null | undefined =>
  value === null ? null : optionalText(value, field, max);

export const nullableUuid = (value: unknown, field: string): string | null | undefined =>
  value === null ? null : optionalUuid(value, field);

export const queryBoolean = (value: unknown, field: string): boolean | undefined => {
  const raw = queryString(value, field);
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new CustomException(`${field} must be true or false.`, badRequest);
};

export const queryInteger = (value: unknown, field: string, min: number, max: number): number | undefined => {
  const raw = queryString(value, field);
  if (raw === undefined) return undefined;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new CustomException(`${field} must be a whole number from ${min} to ${max}.`, badRequest);
  }
  return number;
};

/** A body array with a size bound, so one request cannot carry an unbounded list. */
export const boundedArray = (value: unknown, field: string, max: number): unknown[] => {
  if (!Array.isArray(value)) throw new CustomException(`${field} must be a list.`, badRequest);
  if (value.length > max) throw new CustomException(`${field} can hold at most ${max} entries.`, badRequest);
  return value;
};

// -------------------------------------------------------------- file links
const MAX_URL_LENGTH = 500;

/** An https link to a file kept elsewhere; nothing is fetched and no credentials are accepted. */
export const parseHttpsUrl = (value: unknown, field: string): string => {
  const fail = () => new CustomException(`${field} must be an https link.`, badRequest);
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) throw fail();
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw fail();
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw fail();
  return url.toString();
};

export interface IParsedFileRef {
  id: string;
  name: string;
  url: string;
  contentType?: string;
  caption?: string;
}

/** One file reference: an https URL plus a little metadata. */
export const parseFileRef = (value: unknown, field: string): IParsedFileRef => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CustomException(`${field} must be an object with an https url.`, badRequest);
  }
  const body = value as Record<string, unknown>;
  const url = parseHttpsUrl(body.url, `${field}.url`);
  const contentType = optionalText(body.contentType, `${field}.contentType`, 100);
  const caption = optionalText(body.caption, `${field}.caption`, 200);
  return {
    id: randomUUID(),
    name: optionalText(body.name, `${field}.name`, 120) ?? new URL(url).pathname.split("/").filter(Boolean).pop() ?? "file",
    url,
    ...(contentType ? { contentType } : {}),
    ...(caption ? { caption } : {}),
  };
};

// ----------------------------------------------------------------- stores
/** A list filter: an explicit store must be inside the caller's scope, or it does not exist for them. */
export const storeFilter = (scope: StoreScope, query: Record<string, unknown>): string | undefined => {
  const given = queryUuid(query.storeId, "storeId");
  if (scope && given && given !== scope) throw new CustomException(STORE_NOT_FOUND, notFound);
  return given;
};

/** The store a new row belongs to: the requested one (inside the scope), else the scope, else none. */
export const storeForWrite = async (scope: StoreScope, requested: unknown): Promise<string | null> => {
  const given = optionalUuid(requested, "storeId");
  if (scope && given && given !== scope) throw new CustomException(STORE_NOT_FOUND, notFound);
  const storeId = given ?? scope;
  if (storeId && !(await StoreQuery.findById(storeId, null))) throw new CustomException(STORE_NOT_FOUND, notFound);
  return storeId ?? null;
};

// ---------------------------------------------------------- user directory
interface DirectoryUser {
  id: string;
  isActive: boolean;
}

/**
 * Checks that every id is an active user, asking the gateway (which owns users). A gateway
 * failure refuses the request rather than saving an owner nobody has verified.
 */
export const requireActiveUsers = async (ids: string[], field: string): Promise<void> => {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const answer = await ServiceClient.post<{ users?: DirectoryUser[] }>("gateway", "/internal/users/lookup", {
    body: { ids: unique },
    idempotent: true,
  });
  const active = new Set((answer?.users ?? []).filter((user) => user.isActive).map((user) => user.id));
  if (unique.some((id) => !active.has(id))) {
    throw new CustomException(`${field} must be an active user.`, badRequest);
  }
};

// ---------------------------------------------------------------- history
export interface IActivityInput {
  entity: ActivityEntity;
  entityId: string;
  action: string;
  storeId: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  detail?: Record<string, unknown> | null;
}

export const activityRow = (user: RequestUser, input: IActivityInput): IActivityCreate => ({
  entity: input.entity,
  entityId: input.entityId,
  action: input.action,
  actorId: user.id,
  actorName: actorName(user),
  storeId: input.storeId,
  fromStatus: input.fromStatus ?? null,
  toStatus: input.toStatus ?? null,
  detail: input.detail ?? null,
});

export { text };
