import { CustomException } from "../../commons/Exception/CustomException.js";

jest.mock("../Queries/Db.js", () => ({ inTransaction: (work: any) => require("../Testing/FakeQueries").inTransaction(work) }));
jest.mock("../Queries/Coupon.Query.js", () => ({ CouponQuery: require("../Testing/FakeQueries").CouponQuery }));
jest.mock("../Queries/Counter.Query.js", () => ({ CounterQuery: require("../Testing/FakeQueries").CounterQuery }));

import { CouponService, evaluate, discountFor } from "./Coupon.Service.js";
import { db, reset } from "../Testing/FakeQueries.js";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const STORE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const base = { code: "SAVE10", title: "Ten percent", type: "percent", value: 10, validFrom: "2020-01-01", validUntil: "2099-12-31" };
const make = async (over: Record<string, unknown> = {}) => CouponService.create({ ...base, ...over }) as Promise<any>;

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a rejection");
};

const redeem = (over: Record<string, unknown> = {}) =>
  CouponService.redeemInternal({ code: "SAVE10", customerId: C1, orderRef: "order-1", orderValuePaise: 100_000, ...over }) as Promise<any>;

beforeEach(() => reset());

describe("admin: create and update", () => {
  it("stores the code upper-case and answers money in rupees", async () => {
    const coupon = await make({ code: " save10 ", type: "flat", value: 50.5, minOrderValue: 199, maxDiscount: undefined });

    expect(coupon).toMatchObject({ code: "SAVE10", type: "flat", value: 50.5, minOrderValue: 199, isActive: true, storeIds: [] });
    expect([...db.coupons.values()][0]).toMatchObject({ value: 5050, minOrderPaise: 19900 });
  });

  it("treats codes as case-insensitively unique", async () => {
    await make();

    const error = await rejection(make({ code: "save10" }));

    expect(error.errorCode).toBe(409);
  });

  it.each([
    ["missing title", { title: undefined }],
    ["short code", { code: "ab" }],
    ["code with spaces", { code: "SAVE 10" }],
    ["percent above 100", { value: 101 }],
    ["fractional percent", { value: 10.5 }],
    ["zero flat", { type: "flat", value: 0 }],
    ["free delivery with a value", { type: "free_delivery", value: 5 }],
    ["window reversed", { validFrom: "2030-01-01", validUntil: "2029-01-01" }],
    ["maxDiscount on a flat coupon", { type: "flat", value: 10, maxDiscount: 5 }],
    ["zero usage limit", { usageLimit: 0 }],
    ["bad store id", { storeIds: ["nope"] }],
    ["too many stores", { storeIds: Array.from({ length: 51 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`) }],
    ["unknown field", { usedCount: 0 }],
  ])("rejects %s with 400", async (_name, over) => {
    const error = await rejection(make(over));

    expect(error.errorCode).toBe(400);
  });

  it("patches only whitelisted fields and never lets a client write usedCount", async () => {
    const coupon = await make();

    const error = await rejection(CouponService.update(coupon.id, { usedCount: 0 }));
    const updated = await CouponService.update(coupon.id, { title: "New title", isActive: false });

    expect(error.errorCode).toBe(400);
    expect(updated).toMatchObject({ title: "New title", isActive: false, code: "SAVE10" });
  });

  it("needs a new value when the type changes, because the unit changes", async () => {
    const coupon = await make();

    const error = await rejection(CouponService.update(coupon.id, { type: "flat" }));
    const ok = await CouponService.update(coupon.id, { type: "flat", value: 20 });

    expect(error.errorCode).toBe(400);
    expect(ok).toMatchObject({ type: "flat", value: 20 });
  });

  it("refuses to rename a coupon that has been redeemed", async () => {
    const coupon = await make();
    await redeem();

    const error = await rejection(CouponService.update(coupon.id, { code: "OTHER10" }));

    expect(error.errorCode).toBe(409);
  });

  it("answers 404 for an unknown or malformed id", async () => {
    expect((await rejection(CouponService.get("not-a-uuid"))).errorCode).toBe(404);
    expect((await rejection(CouponService.get(C1))).errorCode).toBe(404);
    expect((await rejection(CouponService.deactivate(C1))).errorCode).toBe(404);
  });

  it("deactivates, and a deactivated coupon no longer validates", async () => {
    const coupon = await make();

    await CouponService.deactivate(coupon.id);
    const verdict = await CouponService.validateInternal({ code: "SAVE10", customerId: C1, orderValuePaise: 1000 });

    expect(verdict).toMatchObject({ valid: false });
  });

  it("pages the list, caps the limit at 100 and filters by active and text", async () => {
    for (let i = 0; i < 3; i++) await make({ code: `CODE${i}0`, title: i === 1 ? "Special" : "Plain", isActive: i !== 2 });

    const page = (await CouponService.list({ limit: "2", page: "1" })) as any;
    const huge = (await CouponService.list({ limit: "5000" })) as any;
    const active = (await CouponService.list({ isActive: "true" })) as any;
    const search = (await CouponService.list({ q: "special" })) as any;

    expect(page).toMatchObject({ page: 1, limit: 2, total: 3 });
    expect(page.items).toHaveLength(2);
    expect(huge.limit).toBe(100);
    expect(active.total).toBe(2);
    expect(search.items.map((c: any) => c.title)).toEqual(["Special"]);
    expect((await rejection(CouponService.list({ isActive: "maybe" }))).errorCode).toBe(400);
  });

  it("reports usage: redemptions, total discount and distinct customers", async () => {
    const coupon = await make();
    await redeem({ orderRef: "o1", orderValuePaise: 100_000 });
    await redeem({ orderRef: "o2", orderValuePaise: 50_000 });
    await redeem({ orderRef: "o3", customerId: C2, orderValuePaise: 20_000 });

    const usage = await CouponService.usage(coupon.id);

    expect(usage).toEqual({ redemptions: 3, totalDiscount: 170, uniqueCustomers: 2 });
  });
});

describe("discount rules", () => {
  const coupon = (over: Record<string, unknown>) =>
    ({ type: "percent", value: 10, maxDiscountPaise: null, ...over }) as any;

  it("percent rounds down and honours the cap", () => {
    expect(discountFor(coupon({ value: 15 }), 999)).toBe(149);
    expect(discountFor(coupon({ value: 50, maxDiscountPaise: 2000 }), 100_000)).toBe(2000);
  });

  it("flat never exceeds the order", () => {
    expect(discountFor(coupon({ type: "flat", value: 5000 }), 3000)).toBe(3000);
  });

  it("free delivery discounts nothing itself", () => {
    expect(discountFor(coupon({ type: "free_delivery", value: 0 }), 3000)).toBe(0);
  });

  it("refuses an order under the minimum, a wrong store and a non-first order", () => {
    const now = new Date();
    const full = {
      isActive: true, validFrom: new Date(0), validUntil: new Date(now.getTime() + 1e9), usageLimit: null, usedCount: 0,
      perCustomerLimit: null, minOrderPaise: 10_000, storeIds: [STORE_A], firstOrderOnly: true, type: "flat", value: 100, maxDiscountPaise: null,
    } as any;
    const ctx = { now, customerUses: 0, strict: true, storeId: STORE_A, isFirstOrder: true, orderValuePaise: 20_000 };

    expect(evaluate(full, ctx)).toMatchObject({ ok: true, discountPaise: 100 });
    expect(evaluate(full, { ...ctx, orderValuePaise: 5_000 })).toMatchObject({ ok: false });
    expect(evaluate(full, { ...ctx, storeId: STORE_B })).toMatchObject({ ok: false, reason: expect.stringContaining("store") });
    expect(evaluate(full, { ...ctx, isFirstOrder: false })).toMatchObject({ ok: false, reason: expect.stringContaining("first order") });
    expect(evaluate(full, { ...ctx, isFirstOrder: undefined })).toMatchObject({ ok: false });
  });
});

describe("customer: list and validate", () => {
  it("lists only coupons usable now, and hides limits and stores", async () => {
    await make({ code: "GOOD10", usageLimit: 5, storeIds: [STORE_A] });
    await make({ code: "OFF10", isActive: false });
    await make({ code: "OLD10", validFrom: "2019-01-01", validUntil: "2020-01-01" });
    await make({ code: "FUTURE10", validFrom: "2098-01-01" });
    const full = await make({ code: "FULL10", usageLimit: 1 });
    await redeem({ code: "FULL10", orderRef: "x" });

    const result = (await CouponService.listMine(C1, {})) as any;

    expect(full.code).toBe("FULL10");
    expect(result.items.map((c: any) => c.code)).toEqual(["GOOD10"]);
    expect(result.items[0]).not.toHaveProperty("usageLimit");
    expect(result.items[0]).not.toHaveProperty("storeIds");
    expect(result.total).toBe(1);
  });

  it("hides a coupon from the customer who used up their own limit, not from others", async () => {
    await make({ code: "ONCE10", perCustomerLimit: 1 });
    await redeem({ code: "ONCE10", orderRef: "a" });

    const mine = (await CouponService.listMine(C1, {})) as any;
    const theirs = (await CouponService.listMine(C2, {})) as any;

    expect(mine.total).toBe(0);
    expect(theirs.total).toBe(1);
  });

  it("validates with the discount in rupees", async () => {
    await make({ minOrderValue: 100 });

    const ok = await CouponService.validateMine(C1, { code: "save10", orderValue: 500 });
    const small = await CouponService.validateMine(C1, { code: "SAVE10", orderValue: 50 });

    expect(ok).toEqual({ valid: true, discount: 50 });
    expect(small).toMatchObject({ valid: false, discount: 0, reason: expect.stringContaining("minimum") });
  });

  it("gives unknown, inactive and expired codes the same answer, so codes cannot be probed", async () => {
    await make({ code: "OFF10", isActive: false });
    await make({ code: "OLD10", validFrom: "2019-01-01", validUntil: "2020-01-01" });

    const answers = await Promise.all(
      ["NOSUCH", "OFF10", "OLD10"].map((code) => CouponService.validateMine(C1, { code, orderValue: 500 }))
    );

    expect(new Set(answers.map((a: any) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toMatchObject({ valid: false });
  });

  it("previews without an order value and flags first-order-only coupons as advisory", async () => {
    await make({ code: "FIRST10", firstOrderOnly: true });

    const result: any = await CouponService.validateMine(C1, { code: "FIRST10" });

    expect(result.valid).toBe(true);
    expect(result.reason).toContain("first order");
  });

  it("validates input: code required, orderValue must be a sane amount, storeId a uuid", async () => {
    expect((await rejection(CouponService.validateMine(C1, {}))).errorCode).toBe(400);
    expect((await rejection(CouponService.validateMine(C1, { code: "A", orderValue: -5 }))).errorCode).toBe(400);
    expect((await rejection(CouponService.validateMine(C1, { code: "A", storeId: "x" }))).errorCode).toBe(400);
  });

  it("stops brute-forcing: the 21st check in the window is a 429, per customer", async () => {
    for (let i = 0; i < 20; i++) await CouponService.validateMine(C1, { code: `GUESS${i}` });

    const error = await rejection(CouponService.validateMine(C1, { code: "GUESS99" }));
    const other = await CouponService.validateMine(C2, { code: "GUESS99" });

    expect(error.errorCode).toBe(429);
    expect(other).toMatchObject({ valid: false });
  });
});

describe("internal: validate and redeem", () => {
  it("validate needs every fact a redemption needs", async () => {
    await make({ code: "STORE10", storeIds: [STORE_A], firstOrderOnly: true });

    const missing: any = await CouponService.validateInternal({ code: "STORE10", customerId: C1, orderValuePaise: 1000 });
    const full: any = await CouponService.validateInternal({ code: "STORE10", customerId: C1, orderValuePaise: 1000, storeId: STORE_A, isFirstOrder: true });

    expect(missing.valid).toBe(false);
    expect(full).toMatchObject({ valid: true, discountPaise: 100, code: "STORE10" });
    expect((await rejection(CouponService.validateInternal({ code: "X", customerId: "bad", orderValuePaise: 1 }))).errorCode).toBe(400);
  });

  it("redeems once and records the discount", async () => {
    const coupon = await make();

    const result = await redeem();

    expect(result).toMatchObject({ redeemed: true, replayed: false, discountPaise: 10_000, orderRef: "order-1" });
    expect([...db.coupons.values()][0].usedCount).toBe(1);
    expect(coupon.id).toBeDefined();
  });

  it("is idempotent on orderRef: a retry returns the first redemption and uses nothing more", async () => {
    await make({ usageLimit: 1, perCustomerLimit: 1 });
    const first = await redeem();

    const again = await redeem();

    expect(again).toMatchObject({ replayed: true, discountPaise: first.discountPaise });
    expect([...db.coupons.values()][0].usedCount).toBe(1);
    expect(db.redemptions.size).toBe(1);
  });

  it("still answers a replay after the coupon was deactivated or ran out", async () => {
    const coupon = await make({ usageLimit: 1 });
    await redeem();
    await CouponService.deactivate(coupon.id);

    const again = await redeem();

    expect(again.replayed).toBe(true);
  });

  it("refuses to hand one order's redemption to a different customer", async () => {
    await make();
    await redeem();

    const error = await rejection(redeem({ customerId: C2 }));

    expect(error.errorCode).toBe(409);
  });

  it("answers 404 for an unknown code and 409 with a reason for an ineligible order", async () => {
    await make({ minOrderValue: 5000 });

    const unknown = await rejection(redeem({ code: "NOPE10" }));
    const small = await rejection(redeem({ orderValuePaise: 1000 }));

    expect(unknown.errorCode).toBe(404);
    expect(small.errorCode).toBe(409);
    expect(small.data).toMatchObject({ reason: expect.any(String) });
    expect(db.redemptions.size).toBe(0);
  });

  it("enforces the per-customer limit across orders", async () => {
    await make({ perCustomerLimit: 2 });
    await redeem({ orderRef: "a" });
    await redeem({ orderRef: "b" });

    const error = await rejection(redeem({ orderRef: "c" }));
    const other = await redeem({ orderRef: "d", customerId: C2 });

    expect(error.errorCode).toBe(409);
    expect(other.redeemed).toBe(true);
  });

  it("race: two orders after the LAST use cannot both succeed", async () => {
    await make({ usageLimit: 1 });

    const results = await Promise.allSettled([
      redeem({ orderRef: "race-1", customerId: C1 }),
      redeem({ orderRef: "race-2", customerId: C2 }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((refused.reason as CustomException).errorCode).toBe(409);
    expect([...db.coupons.values()][0].usedCount).toBe(1);
    expect(db.redemptions.size).toBe(1);
  });

  it("race: one customer's two simultaneous orders respect a per-customer limit of 1", async () => {
    await make({ perCustomerLimit: 1 });

    const results = await Promise.allSettled([redeem({ orderRef: "p-1" }), redeem({ orderRef: "p-2" })]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(db.redemptions.size).toBe(1);
    expect([...db.coupons.values()][0].usedCount).toBe(1);
  });

  it("race: the same order submitted twice at once redeems once and both callers succeed", async () => {
    await make({ usageLimit: 5 });

    const [a, b] = await Promise.all([redeem({ orderRef: "same" }), redeem({ orderRef: "same" })]);

    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.discountPaise).toBe(b.discountPaise);
    expect([...db.coupons.values()][0].usedCount).toBe(1);
    expect(db.redemptions.size).toBe(1);
  });

  it("a refused redemption leaves no half-written state (the global count is rolled back)", async () => {
    await make({ perCustomerLimit: 1, usageLimit: 10 });
    await redeem({ orderRef: "a" });

    await rejection(redeem({ orderRef: "b" }));

    expect([...db.coupons.values()][0].usedCount).toBe(1);
    expect(db.redemptions.size).toBe(1);
  });

  it("free delivery coupons redeem with a zero discount and say so", async () => {
    await make({ code: "FREEDEL", type: "free_delivery", value: 0 });

    const result = await redeem({ code: "FREEDEL" });

    expect(result).toMatchObject({ redeemed: true, discountPaise: 0, freeDelivery: true });
  });
});
