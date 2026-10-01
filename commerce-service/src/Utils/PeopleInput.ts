import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";

const fail = (message: string): never => {
  throw new CustomException(message, badRequest);
};

// Rupees from the API to integer paise: at most two decimals, never rounded silently.
export const parsePaise = (value: unknown, field: string, maxPaise: number, allowZero = false): number => {
  const rupees = typeof value === "number" ? value : Number.NaN;
  const paise = Math.round(rupees * 100);
  if (!Number.isFinite(rupees) || rupees < 0 || Math.abs(rupees * 100 - paise) > 1e-6) {
    return fail(`${field} must be an amount with at most two decimals.`);
  }
  if (paise === 0 && !allowZero) return fail(`${field} must be more than zero.`);
  if (paise > maxPaise) return fail(`${field} is too large.`);
  return paise;
};

// A decimal quantity with up to `decimals` places as an integer count of 10^-decimals.
const scaled = (value: unknown, field: string, decimals: number, min: number, max: number): number => {
  const factor = 10 ** decimals;
  const n = typeof value === "number" ? value : Number.NaN;
  const whole = Math.round(n * factor);
  if (!Number.isFinite(n) || Math.abs(n * factor - whole) > 1e-6) {
    return fail(`${field} must be a number with at most ${decimals} decimals.`);
  }
  if (n < min || n > max) return fail(`${field} must be from ${min} to ${max}.`);
  return whole;
};

/** A quantity in thousandths (4.5 becomes 4500). */
export const parseMilli = (value: unknown, field: string, min: number, max: number): number => scaled(value, field, 3, min, max);

/** A mark of 0 to 100 with two decimals, in hundredths. */
export const parseScore = (value: unknown, field: string): number => scaled(value, field, 2, 0, 100);

export const fromMilli = (milli: number): number => milli / 1000;
export const fromHundredths = (hundredths: number): number => hundredths / 100;

/** The keys a PATCH may change must be present: an empty update is a mistake, not a no-op. */
export const requireSomething = (changes: Record<string, unknown>): void => {
  if (Object.values(changes).every((v) => v === undefined)) fail("Nothing to update.");
};

/** Round half up (away from zero for positives) of numerator/denominator in whole units. */
export const divideHalfUp = (numerator: number, denominator: number): number =>
  Math.floor((2 * numerator + denominator) / (2 * denominator));

export const idempotencyKeyOf = (value: unknown): string | null => {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9_\-:.]{8,80}$/.test(value.trim())) {
    return fail("Idempotency-Key must be 8 to 80 letters, digits or _-:. characters.");
  }
  return value.trim();
};
