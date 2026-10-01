import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { inTransaction } from "../Queries/Db.js";
import { CouponQuery } from "../Queries/Coupon.Query.js";
import type { ICoupon, ICouponCreate, ICouponRedemption, CouponType } from "../Models/Coupon/Coupon.Interface.js";
import {
  boolField,
  bodyOf,
  dateField,
  enumField,
  intField,
  iso,
  onlyKeys,
  pathId,
  queryBool,
  queryText,
  stringField,
  toPaise,
  toRupees,
  uuidField,
  uuidList,
} from "../Utils/Input.js";
import { Limits, RateLimit } from "./RateLimit.Service.js";

const COUPON_TYPES = ["percent", "flat", "free_delivery"] as const;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
const INVALID = "This coupon is not valid.";
const MAX_STORES = 50;
const PATCHABLE = [
  "code", "title", "type", "value", "minOrderValue", "maxDiscount", "validFrom", "validUntil",
  "usageLimit", "perCustomerLimit", "storeIds", "firstOrderOnly", "isActive",
] as const;

// ------------------------------------------------------------------ shapes

const valueToApi = (c: ICoupon) => (c.type === "flat" ? toRupees(c.value) : c.value);

const toApi = (c: ICoupon) => ({
  id: c.id,
  code: c.code,
  title: c.title,
  type: c.type,
  value: valueToApi(c),
  minOrderValue: toRupees(c.minOrderPaise),
  maxDiscount: c.maxDiscountPaise === null ? null : toRupees(c.maxDiscountPaise),
  validFrom: iso(c.validFrom),
  validUntil: iso(c.validUntil),
  usageLimit: c.usageLimit,
  perCustomerLimit: c.perCustomerLimit,
  storeIds: c.storeIds,
  firstOrderOnly: c.firstOrderOnly,
  isActive: c.isActive,
  createdAt: iso(c.createdAt),
  updatedAt: iso(c.updatedAt),
});

// A customer never sees limits, usage counts or store lists: only what they need to choose.
const toCustomerApi = (c: ICoupon) => ({
  code: c.code,
  title: c.title,
  type: c.type,
  value: valueToApi(c),
  minOrderValue: toRupees(c.minOrderPaise),
  validUntil: iso(c.validUntil),
});

// ------------------------------------------------------------- input rules

export const normalizeCode = (raw: unknown): string => {
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!CODE_PATTERN.test(code)) {
    throw new CustomException("code must be 3 to 32 letters, digits, dashes or underscores.", badRequest);
  }
  return code;
};

const nullable = <T>(value: unknown, parse: (v: unknown) => T): T | null => (value === null ? null : parse(value));

const parseValue = (raw: unknown, type: CouponType): number => {
  if (type === "percent") return intField(raw, "value", 1, 100);
  if (type === "flat") return toPaise(raw, "value", false);
  return intField(raw, "value", 0, 0);
};

// Builds the full coupon from a create body, or a PATCH merged over the current row, and
// checks the rules that span fields. Only whitelisted keys are ever read.
const buildCoupon = (input: Record<string, unknown>, base: ICouponCreate | null): ICouponCreate => {
  onlyKeys(input, PATCHABLE);
  const has = (key: string) => input[key] !== undefined;
  const next: ICouponCreate = base
    ? { ...base }
    : {
        code: "", title: "", type: "percent", value: 0, minOrderPaise: 0, maxDiscountPaise: null,
        validFrom: new Date(0), validUntil: new Date(0), usageLimit: null, perCustomerLimit: null,
        storeIds: [], firstOrderOnly: false, isActive: true,
      };

  if (has("code")) next.code = normalizeCode(input.code);
  if (has("title")) next.title = stringField(input.title, "title", 1, 120);
  if (has("type")) next.type = enumField(input.type, "type", COUPON_TYPES);
  if (has("value")) next.value = parseValue(input.value, next.type);
  else if (base && next.type !== base.type) throw new CustomException("value is required when type changes.", badRequest);
  if (has("minOrderValue")) next.minOrderPaise = toPaise(input.minOrderValue, "minOrderValue");
  if (has("maxDiscount")) next.maxDiscountPaise = nullable(input.maxDiscount, (v) => toPaise(v, "maxDiscount", false));
  if (has("validFrom")) next.validFrom = dateField(input.validFrom, "validFrom");
  if (has("validUntil")) next.validUntil = dateField(input.validUntil, "validUntil", true);
  if (has("usageLimit")) next.usageLimit = nullable(input.usageLimit, (v) => intField(v, "usageLimit", 1, 1_000_000_000));
  if (has("perCustomerLimit")) next.perCustomerLimit = nullable(input.perCustomerLimit, (v) => intField(v, "perCustomerLimit", 1, 1_000_000));
  if (has("storeIds")) next.storeIds = uuidList(input.storeIds, "storeIds", MAX_STORES);
  if (has("firstOrderOnly")) next.firstOrderOnly = boolField(input.firstOrderOnly, "firstOrderOnly");
  if (has("isActive")) next.isActive = boolField(input.isActive, "isActive");

  if (next.validUntil < next.validFrom) throw new CustomException("validUntil must not be before validFrom.", badRequest);
  if (next.maxDiscountPaise !== null && next.type !== "percent") {
    throw new CustomException("maxDiscount only applies to percent coupons.", badRequest);
  }
  return next;
};

const asCreate = (c: ICoupon): ICouponCreate => ({
  code: c.code, title: c.title, type: c.type, value: c.value, minOrderPaise: c.minOrderPaise,
  maxDiscountPaise: c.maxDiscountPaise, validFrom: c.validFrom, validUntil: c.validUntil,
  usageLimit: c.usageLimit, perCustomerLimit: c.perCustomerLimit, storeIds: c.storeIds,
  firstOrderOnly: c.firstOrderOnly, isActive: c.isActive,
});

// ------------------------------------------------------------- the rules

export interface CouponContext {
  now: Date;
  customerUses: number;
  orderValuePaise?: number;
  storeId?: string;
  isFirstOrder?: boolean;
  /** Redemption needs every fact; a customer previewing may leave some out. */
  strict: boolean;
}

export type Verdict =
  | { ok: true; discountPaise: number; freeDelivery: boolean; orderValueKnown: boolean }
  | { ok: false; reason: string };

const refuse = (reason: string): Verdict => ({ ok: false, reason });

// Unknown, switched-off, early, expired and used-up coupons all answer the same words, so a
// guessed code reveals nothing about which codes exist.
export const evaluate = (coupon: ICoupon, ctx: CouponContext): Verdict => {
  if (!coupon.isActive || ctx.now < coupon.validFrom || ctx.now > coupon.validUntil) return refuse(INVALID);
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) return refuse(INVALID);
  if (coupon.perCustomerLimit !== null && ctx.customerUses >= coupon.perCustomerLimit) {
    return refuse("You have already used this coupon the maximum number of times.");
  }
  if (coupon.storeIds.length > 0) {
    if (ctx.storeId === undefined) {
      if (ctx.strict) return refuse("A store is needed to check this coupon.");
    } else if (!coupon.storeIds.includes(ctx.storeId)) {
      return refuse("This coupon is not valid at this store.");
    }
  }
  if (coupon.firstOrderOnly) {
    if (ctx.isFirstOrder === false) return refuse("This coupon is for a first order only.");
    if (ctx.isFirstOrder === undefined && ctx.strict) return refuse("Could not confirm this is a first order.");
  }
  if (ctx.orderValuePaise === undefined) {
    if (ctx.strict) return refuse("The order value is needed to check this coupon.");
    return { ok: true, discountPaise: 0, freeDelivery: coupon.type === "free_delivery", orderValueKnown: false };
  }
  if (ctx.orderValuePaise < coupon.minOrderPaise) {
    return refuse(`The minimum order value for this coupon is ${toRupees(coupon.minOrderPaise)}.`);
  }
  return { ok: true, discountPaise: discountFor(coupon, ctx.orderValuePaise), freeDelivery: coupon.type === "free_delivery", orderValueKnown: true };
};

export const discountFor = (coupon: ICoupon, orderValuePaise: number): number => {
  if (coupon.type === "free_delivery") return 0;
  let discount = coupon.type === "percent" ? Math.floor((orderValuePaise * coupon.value) / 100) : coupon.value;
  if (coupon.maxDiscountPaise !== null) discount = Math.min(discount, coupon.maxDiscountPaise);
  return Math.min(discount, orderValuePaise);
};

const loadByCode = async (code: unknown): Promise<ICoupon | null> => {
  const normalized = typeof code === "string" ? code.trim().toUpperCase() : "";
  // A malformed code cannot exist; skip the query.
  return CODE_PATTERN.test(normalized) ? await CouponQuery.findByCode(normalized) : null;
};

// ------------------------------------------------------------------ admin

const list = async (query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await CouponQuery.list(
      { isActive: queryBool(query.isActive, "isActive"), q: queryText(query.q, "q") },
      page
    );
    return toPage(items.map(toApi), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const create = async (body: unknown) => {
  try {
    const input = bodyOf(body);
    requireFields(input, ["code", "title", "type", "value", "validFrom", "validUntil"]);
    const data = buildCoupon(input, null);
    try {
      return toApi(await CouponQuery.create(data));
    } catch (error) {
      if (isUniqueViolation(error)) throw new CustomException("A coupon with this code already exists.", conflict);
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const get = async (id: unknown) => {
  try {
    const coupon = await CouponQuery.findById(pathId(id));
    if (!coupon) throw new CustomException("Coupon not found.", notFound);
    return toApi(coupon);
  } catch (error) {
    throw toCustomException(error);
  }
};

const update = async (id: unknown, body: unknown) => {
  try {
    const couponId = pathId(id);
    const input = bodyOf(body);
    const current = await CouponQuery.findById(couponId);
    if (!current) throw new CustomException("Coupon not found.", notFound);
    if (input.code !== undefined && normalizeCode(input.code) !== current.code && current.usedCount > 0) {
      throw new CustomException("The code of a coupon that has been used cannot change.", conflict);
    }
    const data = buildCoupon(input, asCreate(current));
    try {
      const updated = await CouponQuery.update(couponId, data);
      if (!updated) throw new CustomException("Coupon not found.", notFound);
      return toApi(updated);
    } catch (error) {
      if (isUniqueViolation(error)) throw new CustomException("A coupon with this code already exists.", conflict);
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const deactivate = async (id: unknown) => {
  try {
    const updated = await CouponQuery.update(pathId(id), { isActive: false });
    if (!updated) throw new CustomException("Coupon not found.", notFound);
    return toApi(updated);
  } catch (error) {
    throw toCustomException(error);
  }
};

const usage = async (id: unknown) => {
  try {
    const couponId = pathId(id);
    if (!(await CouponQuery.findById(couponId))) throw new CustomException("Coupon not found.", notFound);
    const u = await CouponQuery.usage(couponId);
    return { redemptions: u.redemptions, totalDiscount: toRupees(u.totalDiscountPaise), uniqueCustomers: u.uniqueCustomers };
  } catch (error) {
    throw toCustomException(error);
  }
};

// --------------------------------------------------------------- customer

const listMine = async (customerId: string, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const exhausted = await CouponQuery.exhaustedForCustomer(customerId);
    const { items, total } = await CouponQuery.listAvailable(new Date(), exhausted, page);
    return toPage(items.map(toCustomerApi), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const validateMine = async (customerId: string, body: unknown) => {
  try {
    const input = bodyOf(body);
    requireFields(input, ["code"]);
    if (typeof input.code !== "string" || input.code.length > 64) throw new CustomException("code must be text.", badRequest);
    const orderValuePaise = input.orderValue === undefined ? undefined : toPaise(input.orderValue, "orderValue");
    const storeId = input.storeId === undefined ? undefined : uuidField(input.storeId, "storeId");

    // Brute-force bound: counts every attempt, valid or not.
    const { max, windowMs } = Limits.couponValidate;
    await RateLimit.enforce(`coupon-validate:${customerId}`, max, windowMs, "Too many coupon checks. Please wait a few minutes.");

    const coupon = await loadByCode(input.code);
    if (!coupon) return { valid: false, discount: 0, reason: INVALID };
    const uses = await CouponQuery.customerUseCount(coupon.id, customerId);
    const verdict = evaluate(coupon, { now: new Date(), customerUses: uses, orderValuePaise, storeId, strict: false });
    if (!verdict.ok) return { valid: false, discount: 0, reason: verdict.reason };
    const note = coupon.firstOrderOnly
      ? "This coupon applies to a first order only; it is confirmed when you place the order."
      : verdict.orderValueKnown
        ? undefined
        : "Add your order value to see the discount.";
    return { valid: true, discount: toRupees(verdict.discountPaise), ...(note ? { reason: note } : {}) };
  } catch (error) {
    throw toCustomException(error);
  }
};

// --------------------------------------------------------------- internal

interface InternalCouponInput {
  code: string;
  customerId: string;
  orderValuePaise: number;
  storeId?: string;
  isFirstOrder?: boolean;
}

const parseInternal = (body: unknown): InternalCouponInput => {
  const input = bodyOf(body);
  requireFields(input, ["code", "customerId", "orderValuePaise"]);
  if (typeof input.code !== "string" || input.code.length > 64) throw new CustomException("code must be text.", badRequest);
  return {
    code: input.code,
    customerId: uuidField(input.customerId, "customerId"),
    orderValuePaise: intField(input.orderValuePaise, "orderValuePaise", 0, 2_000_000_000),
    storeId: input.storeId === undefined ? undefined : uuidField(input.storeId, "storeId"),
    isFirstOrder: input.isFirstOrder === undefined ? undefined : boolField(input.isFirstOrder, "isFirstOrder"),
  };
};

const validateInternal = async (body: unknown) => {
  try {
    const input = parseInternal(body);
    const coupon = await loadByCode(input.code);
    if (!coupon) return { valid: false, reason: INVALID, discountPaise: 0, freeDelivery: false };
    const uses = await CouponQuery.customerUseCount(coupon.id, input.customerId);
    const verdict = evaluate(coupon, { now: new Date(), customerUses: uses, strict: true, ...input });
    return verdict.ok
      ? { valid: true, couponId: coupon.id, code: coupon.code, discountPaise: verdict.discountPaise, freeDelivery: verdict.freeDelivery }
      : { valid: false, reason: verdict.reason, discountPaise: 0, freeDelivery: false };
  } catch (error) {
    throw toCustomException(error);
  }
};

const redemptionResult = (coupon: ICoupon, redemption: ICouponRedemption, replayed: boolean) => ({
  redeemed: true,
  replayed,
  couponId: coupon.id,
  code: coupon.code,
  orderRef: redemption.orderRef,
  discountPaise: redemption.discountPaise,
  freeDelivery: coupon.type === "free_delivery",
});

const replayOf = (coupon: ICoupon, existing: ICouponRedemption, customerId: string) => {
  if (existing.customerId !== customerId) {
    throw new CustomException("This order already used this coupon for a different customer.", conflict);
  }
  return redemptionResult(coupon, existing, true);
};

const redeemInternal = async (body: unknown) => {
  try {
    const input = parseInternal(body);
    const orderRef = stringField(bodyOf(body).orderRef, "orderRef", 1, 100);
    const coupon = await loadByCode(input.code);
    if (!coupon) throw new CustomException("Coupon not found.", notFound);

    // A retry of an order that already redeemed gets the original answer, whatever the coupon's
    // state is now.
    const earlier = await CouponQuery.findRedemption(coupon.id, orderRef);
    if (earlier) return replayOf(coupon, earlier, input.customerId);

    const uses = await CouponQuery.customerUseCount(coupon.id, input.customerId);
    const verdict = evaluate(coupon, { now: new Date(), customerUses: uses, strict: true, ...input });
    if (!verdict.ok) throw new CustomException(verdict.reason, conflict, { reason: verdict.reason });

    try {
      const redemption = await inTransaction(async (tx) => {
        // Both takes are atomic conditional updates; throwing rolls the first one back.
        if (!(await CouponQuery.takeUse(coupon.id, tx))) throw new CustomException(INVALID, conflict, { reason: INVALID });
        if (!(await CouponQuery.takeCustomerUse(coupon.id, input.customerId, coupon.perCustomerLimit, tx))) {
          const reason = "You have already used this coupon the maximum number of times.";
          throw new CustomException(reason, conflict, { reason });
        }
        return await CouponQuery.insertRedemption(
          { couponId: coupon.id, customerId: input.customerId, orderRef, orderValuePaise: input.orderValuePaise, discountPaise: verdict.discountPaise },
          tx
        );
      });
      return redemptionResult(coupon, redemption, false);
    } catch (error) {
      // Two requests for the same order raced: the loser lands here and gets the winner's row.
      if (isUniqueViolation(error)) {
        const winner = await CouponQuery.findRedemption(coupon.id, orderRef);
        if (winner) return replayOf(coupon, winner, input.customerId);
      }
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

export const CouponService = {
  list, create, get, update, deactivate, usage, listMine, validateMine, validateInternal, redeemInternal,
};
