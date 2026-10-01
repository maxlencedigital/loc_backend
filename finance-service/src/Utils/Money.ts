import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";

// Every amount is stored and calculated as integer paise. Rupees exist only at the HTTP
// boundary, where the dashboard speaks them.

// Columns are 32-bit integers; 2,000,000,000 paise is 2 crore rupees, far above any single item.
export const MAX_ITEM_PAISE = 2_000_000_000;

export const toRupees = (paise: number): number => Number((paise / 100).toFixed(2));

/**
 * Rupees from the caller (a number or a decimal string) to whole paise. Refuses more than two
 * decimals instead of rounding, so an amount never silently becomes something else.
 */
export const rupeesToPaise = (
  value: unknown,
  field: string,
  options: { allowZero?: boolean; max?: number } = {}
): number => {
  const invalid = () =>
    new CustomException(`${field} must be an amount in rupees with at most two decimals.`, badRequest);
  let paise: number;
  if (typeof value === "number") {
    paise = Math.round(value * 100);
    // 1.005 * 100 is 100.49999999999999: a real third decimal, not float noise, is refused.
    if (!Number.isFinite(value) || Math.abs(value * 100 - paise) > 1e-6) throw invalid();
  } else if (typeof value === "string" && /^\d{1,12}(\.\d{1,2})?$/.test(value.trim())) {
    const [whole, fraction = ""] = value.trim().split(".");
    paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  } else {
    throw invalid();
  }
  if (paise < 0 || (paise === 0 && !options.allowZero)) {
    throw new CustomException(`${field} must be greater than zero.`, badRequest);
  }
  if (paise > (options.max ?? MAX_ITEM_PAISE)) throw new CustomException(`${field} is too large.`, badRequest);
  return paise;
};

/** Integer paise sent by another service: strict, no rupee conversion. */
export const wholePaise = (value: unknown, field: string, options: { allowZero?: boolean; max?: number } = {}): number => {
  const max = options.max ?? MAX_ITEM_PAISE;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    (value === 0 && !options.allowZero) ||
    value > max
  ) {
    throw new CustomException(`${field} must be a whole number of paise.`, badRequest);
  }
  return value;
};

/**
 * round(amount * numerator / denominator) for non-negative integers, halves rounding up.
 * BigInt keeps the intermediate product exact however large the monthly totals get.
 * This is the one rounding rule in the service: round half up on whole paise.
 */
export const mulDivHalfUp = (amount: number, numerator: number, denominator: number): number => {
  if (denominator <= 0 || amount < 0 || numerator < 0) throw new RangeError("mulDivHalfUp takes non-negative values.");
  const a = BigInt(amount);
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  return Number((2n * a * n + d) / (2n * d));
};
