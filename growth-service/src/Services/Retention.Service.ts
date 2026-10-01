import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { CouponQuery } from "../Queries/Coupon.Query.js";
import { CustomerQuery } from "../Queries/Customer.Query.js";
import { NotificationQuery } from "../Queries/Notification.Query.js";
import { GatewayClient } from "../Clients/Gateway.Client.js";
import type { ICustomerStat } from "../Models/Customer/Customer.Interface.js";
import { bodyOf, enumField, iso, onlyKeys, pathId, queryInt, queryUuid, stringField, toRupees, uuidField } from "../Utils/Input.js";
import { DEFAULT_MIN_SCORE, LOST_AFTER_DAYS, daysForScore, riskScore } from "./Audience.js";
import { renderMessage } from "./Campaign.Service.js";
import { NotificationService } from "./Notification.Service.js";
import { Limits, RateLimit } from "./RateLimit.Service.js";

const DAY_MS = 24 * 60 * 60_000;
const AT_RISK_DEFAULT_LIMIT = 50;
const AT_RISK_MAX_LIMIT = 100;
const HISTORY_LIMIT = 20;
const WIN_BACK_WINDOW_DAYS = 90;
const WIN_BACK_RETURN_DAYS = 30;
const WIN_BACK_SCAN_LIMIT = 1000;
const WIN_BACK_CHANNELS = ["sms", "email"] as const;

const daysSince = (date: Date, now: Date) => Math.floor((now.getTime() - date.getTime()) / DAY_MS);

const reasonsFor = (stat: ICustomerStat, now: Date): string[] => {
  const reasons = [`No order for ${daysSince(stat.lastOrderAt, now)} days`];
  if (stat.orderCount <= 1) reasons.push("Has ordered only once");
  else if (stat.orderCount >= 5) reasons.push(`Was a regular customer (${stat.orderCount} orders)`);
  return reasons;
};

const pct = (part: number, whole: number): number => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);

const atRiskCriteria = (minScore: number, storeId: string | undefined, now: Date) => ({
  lastOrderBefore: new Date(now.getTime() - daysForScore(minScore) * DAY_MS),
  lastOrderAfter: new Date(now.getTime() - LOST_AFTER_DAYS * DAY_MS),
  ...(storeId ? { storeIds: [storeId] } : {}),
});

const parseMinScore = (raw: unknown): number => {
  if (raw === undefined || raw === "") return DEFAULT_MIN_SCORE;
  const value = typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new CustomException("minScore must be from 0 to 100.", badRequest);
  return value;
};

const listAtRisk = async (query: Record<string, unknown>) => {
  try {
    const now = new Date();
    const limit = queryInt(query.limit, "limit", 1, AT_RISK_MAX_LIMIT, AT_RISK_DEFAULT_LIMIT);
    const criteria = atRiskCriteria(parseMinScore(query.minScore), queryUuid(query.storeId, "storeId"), now);
    const stats = await CustomerQuery.listByRecency(criteria, limit);
    let names = new Map<string, string | null>();
    try {
      names = new Map((await GatewayClient.lookupUsers(stats.map((s) => s.customerId))).map((u) => [u.id, u.name]));
    } catch {
      names = new Map();
    }
    return {
      customers: stats.map((s) => ({
        customerId: s.customerId,
        name: names.get(s.customerId) ?? null,
        score: riskScore(daysSince(s.lastOrderAt, now)),
        lastOrderAt: iso(s.lastOrderAt),
        reasons: reasonsFor(s, now),
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const getCustomer = async (customerId: unknown) => {
  try {
    const id = pathId(customerId);
    const stat = await CustomerQuery.findStat(id);
    if (!stat) throw new CustomException("No order history for this customer.", notFound);
    const now = new Date();
    const orders = await CustomerQuery.listOrders(id, HISTORY_LIMIT);
    return {
      score: riskScore(daysSince(stat.lastOrderAt, now)),
      reasons: reasonsFor(stat, now),
      orderHistory: orders.map((o) => ({ date: iso(o.completedAt), total: toRupees(o.amountPaise) })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const getSummary = async (query: Record<string, unknown>) => {
  try {
    const now = new Date();
    const storeId = queryUuid(query.storeId, "storeId");
    const storeIds = storeId ? [storeId] : undefined;
    const [atRisk, customers, repeat, recent] = await Promise.all([
      CustomerQuery.audienceCount(atRiskCriteria(DEFAULT_MIN_SCORE, storeId, now)),
      CustomerQuery.audienceCount({ storeIds, minOrders: 1 }),
      CustomerQuery.audienceCount({ storeIds, minOrders: 2 }),
      CustomerQuery.recentWinBacks(new Date(now.getTime() - WIN_BACK_WINDOW_DAYS * DAY_MS), WIN_BACK_SCAN_LIMIT),
    ]);

    // Won back = ordered again within 30 days of being contacted (bounded to the latest 1000 contacts).
    let contacted = 0;
    let won = 0;
    if (recent.length > 0) {
      const stats = new Map(
        (await CustomerQuery.findStatsByIds([...new Set(recent.map((w) => w.customerId))])).map((s) => [s.customerId, s])
      );
      for (const winBack of recent) {
        const stat = stats.get(winBack.customerId);
        if (!stat || (storeId && stat.lastStoreId !== storeId)) continue;
        contacted += 1;
        const ordered = stat.lastOrderAt.getTime() - winBack.createdAt.getTime();
        if (ordered > 0 && ordered <= WIN_BACK_RETURN_DAYS * DAY_MS) won += 1;
      }
    }
    return { atRisk, winBackRatePct: pct(won, contacted), repeatRatePct: pct(repeat, customers) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const sendWinBack = async (customerId: unknown, body: unknown) => {
  try {
    const id = pathId(customerId);
    const input = bodyOf(body);
    requireFields(input, ["channel"]);
    onlyKeys(input, ["channel", "offerCouponId", "message"]);
    const channel = enumField(input.channel, "channel", WIN_BACK_CHANNELS);
    const message = input.message === undefined ? null : stringField(input.message, "message", 1, 500);

    let couponCode: string | null = null;
    let couponId: string | null = null;
    if (input.offerCouponId !== undefined) {
      couponId = uuidField(input.offerCouponId, "offerCouponId");
      const coupon = await CouponQuery.findById(couponId);
      if (!coupon) throw new CustomException("Coupon not found.", notFound);
      if (!coupon.isActive || coupon.validUntil < new Date()) throw new CustomException("That coupon cannot be offered: it is inactive or expired.", badRequest);
      couponCode = coupon.code;
    }

    if (!(await CustomerQuery.findStat(id))) throw new CustomException("No order history for this customer.", notFound);
    const user = await GatewayClient.getUser(id);
    if (!user || !user.isActive) throw new CustomException("Customer not found.", notFound);
    const address = channel === "email" ? user.email : user.phoneNumber;
    if (!address) throw new CustomException("The customer has no contact address for this channel.", conflict);
    const preference = await NotificationQuery.findPreference(id);
    if (preference && !preference[channel]) throw new CustomException("The customer has opted out of this channel.", conflict);

    // One win-back per customer per week: a bound on pestering, and on a double click.
    const { max, windowMs } = Limits.winBack;
    await RateLimit.enforce(`win-back:${id}`, max, windowMs, "This customer was already contacted this week.");

    const name = user.name?.trim().split(/\s+/)[0] || "there";
    const text = `${renderMessage(message ?? "Hi {{name}}, we miss you at LOC!", name)}${couponCode ? ` Use code ${couponCode} on your next order.` : ""}`;
    const sent = await NotificationService.sendText({ customerId: id, channel, to: address, subject: "We miss you at LOC", text });
    await CustomerQuery.insertWinBack({ customerId: id, channel, couponId, notificationId: sent.id });
    return { delivered: sent.status === "sent", channel, notificationId: sent.id };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const RetentionService = { listAtRisk, getCustomer, getSummary, sendWinBack };
