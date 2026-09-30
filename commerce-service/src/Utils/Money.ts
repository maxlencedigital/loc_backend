import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";

// Rates and totals are stored as integer paise; the dashboard speaks rupees.
export const toRupees = (paise: number): number => paise / 100;

// Rejects anything that is not a positive amount with at most two decimals, so a
// rate never silently rounds to something the caller did not type.
export const rupeesToPaise = (value: unknown, field: string, maxPaise: number): number => {
  const rupees = typeof value === "number" ? value : Number.NaN;
  const paise = Math.round(rupees * 100);
  if (!Number.isFinite(rupees) || rupees <= 0 || Math.abs(rupees * 100 - paise) > 1e-6) {
    throw new CustomException(`${field} must be a positive amount with at most two decimals.`, badRequest);
  }
  if (paise > maxPaise) {
    throw new CustomException(`${field} is too large.`, badRequest);
  }
  return paise;
};
