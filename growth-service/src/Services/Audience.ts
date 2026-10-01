import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import { AUDIENCE_SEGMENTS, type IAudience } from "../Models/Customer/Customer.Interface.js";
import type { IAudienceCriteria } from "../Queries/Customer.Query.js";
import { bodyOf, enumField, intField, onlyKeys, uuidList } from "../Utils/Input.js";

// Audiences are named segments plus a few bounded filters, never free-form queries: every
// shape here maps to an indexed range on growth_customer_stats.

const DAY_MS = 24 * 60 * 60_000;
const NEW_CUSTOMER_DAYS = 30;
const HIGH_VALUE_SPEND_PAISE = 500_000;
const DEFAULT_INACTIVE_DAYS = 60;
const MAX_STORES = 50;

// Risk grows linearly with silence: 0 up to RISK_FLOOR_DAYS, 100 from RISK_FULL_DAYS. Customers
// silent for over a year are treated as lost, not at risk.
export const RISK_FLOOR_DAYS = 14;
export const RISK_FULL_DAYS = 90;
export const LOST_AFTER_DAYS = 365;
export const DEFAULT_MIN_SCORE = 50;

export const riskScore = (daysSinceLastOrder: number): number =>
  Math.max(0, Math.min(100, Math.round(((daysSinceLastOrder - RISK_FLOOR_DAYS) / (RISK_FULL_DAYS - RISK_FLOOR_DAYS)) * 100)));

export const daysForScore = (score: number): number =>
  Math.ceil(RISK_FLOOR_DAYS + (score / 100) * (RISK_FULL_DAYS - RISK_FLOOR_DAYS));

export const parseAudience = (raw: unknown): IAudience => {
  const input = bodyOf(raw);
  onlyKeys(input, ["segment", "storeIds", "minOrders", "inactiveDays"]);
  const audience: IAudience = { segment: input.segment === undefined ? "all" : enumField(input.segment, "segment", AUDIENCE_SEGMENTS) };
  if (input.storeIds !== undefined) audience.storeIds = uuidList(input.storeIds, "storeIds", MAX_STORES);
  if (input.minOrders !== undefined) audience.minOrders = intField(input.minOrders, "minOrders", 1, 1000);
  if (input.inactiveDays !== undefined) audience.inactiveDays = intField(input.inactiveDays, "inactiveDays", 1, 730);
  return audience;
};

const earlier = (a: Date | undefined, b: Date): Date => (a && a < b ? a : b);

export const toCriteria = (audience: IAudience, now: Date): IAudienceCriteria => {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const criteria: IAudienceCriteria = {};
  switch (audience.segment) {
    case "all":
      break;
    case "new":
      criteria.firstOrderAfter = ago(NEW_CUSTOMER_DAYS);
      break;
    case "repeat":
      criteria.minOrders = 2;
      break;
    case "inactive":
      criteria.lastOrderBefore = ago(audience.inactiveDays ?? DEFAULT_INACTIVE_DAYS);
      break;
    case "high_value":
      criteria.minSpentPaise = HIGH_VALUE_SPEND_PAISE;
      break;
    case "at_risk":
      criteria.lastOrderBefore = ago(daysForScore(DEFAULT_MIN_SCORE));
      criteria.lastOrderAfter = ago(LOST_AFTER_DAYS);
      break;
    default:
      throw new CustomException("Unknown segment.", badRequest);
  }
  if (audience.storeIds && audience.storeIds.length > 0) criteria.storeIds = audience.storeIds;
  if (audience.minOrders) criteria.minOrders = Math.max(criteria.minOrders ?? 0, audience.minOrders);
  if (audience.inactiveDays) criteria.lastOrderBefore = earlier(criteria.lastOrderBefore, ago(audience.inactiveDays));
  return criteria;
};
