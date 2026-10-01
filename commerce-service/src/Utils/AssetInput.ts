import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { MS_PER_MINUTE, parseDate } from "./AssetDates.js";
import { queryString, text } from "./Input.js";
import { isUuid } from "./Uuid.js";

// Money lives in integer paise (a column is an Int, about Rs 2 crore at most).
export const MAX_AMOUNT_PAISE = 2_000_000_000;
const MAX_DOWNTIME_HOURS = 24 * 366;

const fail = (message: string): never => {
  throw new CustomException(message, badRequest);
};

// Rupees with at most two decimals, zero allowed (a repair under warranty costs nothing).
export const amountToPaise = (value: unknown, field: string): number => {
  const rupees = typeof value === "number" ? value : Number.NaN;
  const paise = Math.round(rupees * 100);
  if (!Number.isFinite(rupees) || rupees < 0 || Math.abs(rupees * 100 - paise) > 1e-6) {
    return fail(`${field} must be an amount of zero or more with at most two decimals.`);
  }
  return paise > MAX_AMOUNT_PAISE ? fail(`${field} is too large.`) : paise;
};

// Kilograms with at most three decimals, kept as whole grams.
export const kgToGrams = (value: unknown, field: string): number => {
  const kg = typeof value === "number" ? value : Number.NaN;
  const grams = Math.round(kg * 1000);
  if (!Number.isFinite(kg) || kg <= 0 || Math.abs(kg * 1000 - grams) > 1e-6 || grams > 100_000_000) {
    return fail(`${field} must be a positive weight in kg with at most three decimals.`);
  }
  return grams;
};

export const hoursToMinutes = (value: unknown, field: string): number => {
  const hours = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(hours) || hours < 0 || hours > MAX_DOWNTIME_HOURS) {
    return fail(`${field} must be a number of hours from 0 to ${MAX_DOWNTIME_HOURS}.`);
  }
  return Math.round(hours * 60);
};

export const minutesToHours = (minutes: number): number => Math.round((minutes / 60) * 100) / 100;

export const uuidField = (value: unknown, field: string): string =>
  isUuid(value) ? value : fail(`${field} must be a valid id.`);

export const queryUuid = (value: unknown, field: string): string | undefined => {
  const raw = queryString(value, field);
  return raw === undefined ? undefined : uuidField(raw, field);
};

// PATCH semantics for an optional column: absent leaves it alone, null clears it.
export const patchable = <T>(value: unknown, parse: (value: unknown) => T): T | null | undefined =>
  value === undefined ? undefined : value === null ? null : parse(value);

export const patchText = (value: unknown, field: string, max: number) => patchable(value, (v) => text(v, field, max));
export const patchDate = (value: unknown, field: string) => patchable(value, (v) => parseDate(v, field));
export const patchAmount = (value: unknown, field: string) => patchable(value, (v) => amountToPaise(v, field));
export const patchUuid = (value: unknown, field: string) => patchable(value, (v) => uuidField(v, field));

export const requireChange = (data: object): void => {
  if (Object.keys(data).length === 0) fail("Nothing to update.");
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  hr: "HR",
  manager: "Store manager",
  staff: "Employee",
  driver: "Rider",
};

// The gateway forwards the verified id and role; a name is shown when it forwards one too.
export const actorName = (user: RequestUser): string => user.name ?? ROLE_LABEL[user.role] ?? user.role;

// History columns are uuids; an id that is not one is recorded as "unknown" rather than failing the write.
export const actorId = (user: RequestUser): string | null => (isUuid(user.id) ? user.id : null);

export const elapsedMinutes = (from: Date, to: Date): number => Math.max(0, Math.round((to.getTime() - from.getTime()) / MS_PER_MINUTE));
