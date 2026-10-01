import { createHash } from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { tooManyRequests } from "../../commons/Utils/StatusCode.js";
import { CounterQuery } from "../Queries/Counter.Query.js";

// Every abuse bound in this service goes through here: a windowed counter in Postgres (works
// without Redis). Limits that matter for cost are env-tunable, read at call time.

const envInt = (name: string, fallback: number, min: number, max: number): number => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
};

export const Limits = {
  couponValidate: { max: 20, windowMs: 10 * 60_000 },
  loyaltyRedeem: { max: 10, windowMs: 60 * 60_000 },
  winBack: { max: 1, windowMs: 7 * 24 * 60 * 60_000 },
  packagePurchasePending: 5,
  notifyPerRecipient: () => ({ max: envInt("NOTIFY_MAX_PER_RECIPIENT_PER_HOUR", 20, 1, 1000), windowMs: 60 * 60_000 }),
  campaignBatchSize: () => envInt("CAMPAIGN_BATCH_SIZE", 50, 1, 200),
  campaignMaxRecipients: () => envInt("CAMPAIGN_MAX_RECIPIENTS", 1000, 1, 100_000),
  expireBatchSize: () => envInt("LOYALTY_EXPIRE_BATCH_SIZE", 200, 1, 1000),
};

/** True while the caller is still within `max` hits in the window (this call counts as a hit). */
const allow = async (key: string, max: number, windowMs: number): Promise<boolean> => {
  try {
    return (await CounterQuery.hit(key, windowMs)) <= max;
  } catch (error) {
    throw toCustomException(error);
  }
};

const enforce = async (key: string, max: number, windowMs: number, message: string): Promise<void> => {
  if (!(await allow(key, max, windowMs))) throw new CustomException(message, tooManyRequests);
};

/** Counter keys never contain a phone number or email: hash anything personal. */
const hashed = (value: string): string => createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32);

export const RateLimit = { allow, enforce, hashed };
