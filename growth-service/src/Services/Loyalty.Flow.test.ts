import { CustomException } from "../../commons/Exception/CustomException.js";

const mockGetUser = jest.fn();
jest.mock("../Queries/Db.js", () => ({ inTransaction: (work: any) => require("../Testing/FakeQueries").inTransaction(work) }));
jest.mock("../Queries/Loyalty.Query.js", () => ({ LoyaltyQuery: require("../Testing/FakeQueries").LoyaltyQuery }));
jest.mock("../Queries/Customer.Query.js", () => ({ CustomerQuery: require("../Testing/FakeQueries").CustomerQuery }));
jest.mock("../Queries/Counter.Query.js", () => ({ CounterQuery: require("../Testing/FakeQueries").CounterQuery }));
jest.mock("../Clients/Gateway.Client.js", () => ({ GatewayClient: { getUser: (...a: unknown[]) => mockGetUser(...a) } }));

import { LoyaltyService, tierFor, DEFAULT_TIERS } from "./Loyalty.Service.js";
import { db, reset } from "../Testing/FakeQueries.js";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const ADMIN = "99999999-9999-4999-8999-999999999999";
const ORDER = "33333333-3333-4333-8333-333333333333";
const DAY = 86_400_000;

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a rejection");
};

const earn = (over: Record<string, unknown> = {}) =>
  LoyaltyService.earn({ customerId: C1, orderRef: "o-1", amountPaise: 50_000, ...over }) as Promise<any>;

beforeEach(() => {
  reset();
  mockGetUser.mockReset().mockResolvedValue({ id: C1, isActive: true });
});

describe("programme and tiers", () => {
  it("answers a default programme before an admin saves one", async () => {
    const program: any = await LoyaltyService.getProgram();

    expect(program).toMatchObject({ pointsPerRupee: 1, redemptionValue: 0.25, expiryDays: 365 });
    expect(program.tiers.map((t: any) => t.name)).toEqual(["Bronze", "Silver", "Gold"]);
  });

  it("saves a programme and tiers together and reads them back", async () => {
    await LoyaltyService.setProgram({
      pointsPerRupee: 0.5, redemptionValue: 0.5, expiryDays: 90,
      tiers: [{ name: "Top", minPoints: 100, benefits: ["Free pickup"] }, { name: "Base", minPoints: 0 }],
    });

    const program: any = await LoyaltyService.getProgram();

    expect(program).toMatchObject({ pointsPerRupee: 0.5, redemptionValue: 0.5, expiryDays: 90 });
    expect(program.tiers).toEqual([{ name: "Base", minPoints: 0, benefits: [] }, { name: "Top", minPoints: 100, benefits: ["Free pickup"] }]);
  });

  it.each([
    ["no tier at zero", { tiers: [{ name: "A", minPoints: 10 }] }],
    ["duplicate names", { tiers: [{ name: "A", minPoints: 0 }, { name: "a", minPoints: 5 }] }],
    ["duplicate thresholds", { tiers: [{ name: "A", minPoints: 0 }, { name: "B", minPoints: 0 }] }],
    ["no tiers", { tiers: [] }],
    ["negative threshold", { tiers: [{ name: "A", minPoints: -1 }, { name: "B", minPoints: 0 }] }],
    ["zero rate", { pointsPerRupee: 0 }],
    ["rate text", { pointsPerRupee: "1" }],
    ["huge point value", { redemptionValue: 5000 }],
    ["zero expiry", { expiryDays: 0 }],
  ])("rejects %s with 400", async (_name, over) => {
    const body = { pointsPerRupee: 1, redemptionValue: 0.25, tiers: [{ name: "A", minPoints: 0 }], ...over };

    expect((await rejection(LoyaltyService.setProgram(body))).errorCode).toBe(400);
    expect(db.program).toBeNull();
  });

  it("finds the tier, the next tier and the distance to it from lifetime points", () => {
    expect(tierFor(0, DEFAULT_TIERS)).toEqual({ tier: "Bronze", nextTier: "Silver", pointsToNextTier: 1000 });
    expect(tierFor(1000, DEFAULT_TIERS)).toEqual({ tier: "Silver", nextTier: "Gold", pointsToNextTier: 4000 });
    expect(tierFor(999, DEFAULT_TIERS).tier).toBe("Bronze");
    expect(tierFor(9000, DEFAULT_TIERS)).toEqual({ tier: "Gold", nextTier: null, pointsToNextTier: null });
  });
});

describe("earn (internal)", () => {
  it("awards integer points for an order and records the order fact", async () => {
    const result = await earn({ amountPaise: 12_999, storeId: C2 });

    expect(result).toMatchObject({ points: 129, balance: 129, replayed: false });
    expect(db.stats.get(C1)).toMatchObject({ orderCount: 1, totalSpentPaise: 12_999, lastStoreId: C2 });
    expect([...db.loyaltyTx.values()][0]).toMatchObject({ type: "earn", points: 129, balanceAfter: 129, orderRef: "o-1" });
  });

  it("is idempotent: the same orderRef earns once", async () => {
    await earn();

    const again = await earn();

    expect(again).toMatchObject({ replayed: true, points: 500, balance: 500 });
    expect(db.loyaltyTx.size).toBe(1);
    expect(db.stats.get(C1)?.orderCount).toBe(1);
  });

  it("race: the same order delivered twice at once earns once", async () => {
    await Promise.all([earn(), earn()]);

    expect(db.accounts.get(C1)?.points).toBe(500);
    expect(db.stats.get(C1)?.orderCount).toBe(1);
  });

  it("uses the programme rate, and a zero-point order still counts as an order", async () => {
    await LoyaltyService.setProgram({ pointsPerRupee: 0.5, redemptionValue: 1, tiers: [{ name: "A", minPoints: 0 }] });

    const big = await earn({ amountPaise: 10_000 });
    const tiny = await earn({ orderRef: "o-2", amountPaise: 100 });

    expect(big.points).toBe(50);
    expect(tiny.points).toBe(0);
    expect(db.stats.get(C1)?.orderCount).toBe(2);
    expect(db.loyaltyTx.size).toBe(1);
  });

  it("tracks first and last order across out-of-order completion times", async () => {
    await earn({ orderRef: "new", completedAt: new Date(Date.now() - DAY).toISOString() });
    await earn({ orderRef: "old", completedAt: new Date(Date.now() - 30 * DAY).toISOString() });

    const stat = db.stats.get(C1) as any;

    expect(stat.orderCount).toBe(2);
    expect(Date.now() - stat.firstOrderAt.getTime()).toBeGreaterThan(29 * DAY);
    expect(Date.now() - stat.lastOrderAt.getTime()).toBeLessThan(2 * DAY);
  });

  it.each([
    ["missing orderRef", { orderRef: undefined }],
    ["bad customer", { customerId: "x" }],
    ["negative amount", { amountPaise: -1 }],
    ["fractional amount", { amountPaise: 10.5 }],
    ["amount in a string", { amountPaise: "100" }],
    ["future completion", { completedAt: new Date(Date.now() + 5 * DAY).toISOString() }],
  ])("rejects %s with 400", async (_name, over) => {
    expect((await rejection(earn(over))).errorCode).toBe(400);
    expect(db.orders.size).toBe(0);
  });
});

describe("customer: redeem, read, history", () => {
  const withPoints = async (points: number) => earn({ orderRef: `seed-${points}`, amountPaise: points * 100 });

  it("spends points and answers the value in rupees", async () => {
    await withPoints(400);

    const result: any = await LoyaltyService.redeemMine(C1, { points: 100, orderId: ORDER });

    expect(result).toMatchObject({ pointsRedeemed: 100, value: 25, balance: 300, replayed: false });
  });

  it("refuses to overspend with 409 and leaves the balance alone", async () => {
    await withPoints(50);

    const error = await rejection(LoyaltyService.redeemMine(C1, { points: 51 }));

    expect(error.errorCode).toBe(409);
    expect(db.accounts.get(C1)?.points).toBe(50);
  });

  it("never lets a balance go negative, even for a customer with no account", async () => {
    const error = await rejection(LoyaltyService.redeemMine(C2, { points: 1 }));

    expect(error.errorCode).toBe(409);
    expect((db.accounts.get(C2)?.points ?? 0) >= 0).toBe(true);
  });

  it("is idempotent per order: a retry returns the first redemption", async () => {
    await withPoints(400);
    await LoyaltyService.redeemMine(C1, { points: 100, orderId: ORDER });

    const again: any = await LoyaltyService.redeemMine(C1, { points: 100, orderId: ORDER });

    expect(again).toMatchObject({ replayed: true, balance: 300 });
    expect(db.accounts.get(C1)?.points).toBe(300);
  });

  it("race: two redemptions that together exceed the balance cannot both succeed", async () => {
    await withPoints(100);

    const results = await Promise.allSettled([LoyaltyService.redeemMine(C1, { points: 80 }), LoyaltyService.redeemMine(C1, { points: 80 })]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(db.accounts.get(C1)?.points).toBe(20);
  });

  it("validates points", async () => {
    for (const points of [0, -5, 1.5, "10", 2_000_000]) {
      expect((await rejection(LoyaltyService.redeemMine(C1, { points }))).errorCode).toBe(400);
    }
    expect((await rejection(LoyaltyService.redeemMine(C1, { points: 1, orderId: "x" }))).errorCode).toBe(400);
  });

  it("bounds redemption attempts: the 11th in an hour is a 429", async () => {
    await withPoints(1000);
    for (let i = 0; i < 10; i++) await LoyaltyService.redeemMine(C1, { points: 1 });

    expect((await rejection(LoyaltyService.redeemMine(C1, { points: 1 }))).errorCode).toBe(429);
  });

  it("shows my own points and tier, zeros for a customer with no account", async () => {
    await withPoints(1200);

    const mine: any = await LoyaltyService.getMine(C1);
    const empty: any = await LoyaltyService.getMine(C2);

    expect(mine).toEqual({ points: 1200, tier: "Silver", nextTier: "Gold", pointsToNextTier: 3800 });
    expect(empty).toEqual({ points: 0, tier: "Bronze", nextTier: "Silver", pointsToNextTier: 1000 });
  });

  it("keeps tiers on lifetime points: spending does not demote", async () => {
    await withPoints(1200);
    await LoyaltyService.redeemMine(C1, { points: 1000 });

    expect(((await LoyaltyService.getMine(C1)) as any)).toMatchObject({ points: 200, tier: "Silver" });
  });

  it("lists only my own transactions, newest first, in pages", async () => {
    await withPoints(100);
    await earn({ customerId: C2, orderRef: "theirs", amountPaise: 99_900 });
    await LoyaltyService.redeemMine(C1, { points: 10, orderId: ORDER });

    const mine: any = await LoyaltyService.listMyTransactions(C1, { limit: "1" });
    const all: any = await LoyaltyService.listMyTransactions(C1, {});

    expect(mine).toMatchObject({ limit: 1, total: 2 });
    expect(mine.items[0]).toMatchObject({ points: -10, orderId: ORDER });
    expect(all.items.every((t: any) => t.points !== 999)).toBe(true);
    expect(all.total).toBe(2);
  });

  it("rejects a malformed date filter", async () => {
    expect((await rejection(LoyaltyService.listMyTransactions(C1, { from: "yesterday" }))).errorCode).toBe(400);
  });
});

describe("admin: accounts, adjustments, ledger", () => {
  it("adjusts up and down with a reason, appending to the ledger and moving lifetime points", async () => {
    const up: any = await LoyaltyService.adjust(C1, ADMIN, { points: 300, reason: "Goodwill" });
    const down: any = await LoyaltyService.adjust(C1, ADMIN, { points: -100, reason: "Entered twice" });

    expect(up).toMatchObject({ points: 300, transaction: { type: "adjust", points: 300 } });
    expect(down).toMatchObject({ points: 200, transaction: { points: -100, balanceAfter: 200 } });
    expect(db.accounts.get(C1)).toMatchObject({ points: 200, lifetimePoints: 200 });
    expect(db.loyaltyTx.size).toBe(2);
    expect([...db.loyaltyTx.values()].every((t) => t.actorId === ADMIN)).toBe(true);
  });

  it("refuses a removal larger than the balance with 409 and records nothing", async () => {
    await LoyaltyService.adjust(C1, ADMIN, { points: 10, reason: "Start" });

    const error = await rejection(LoyaltyService.adjust(C1, ADMIN, { points: -11, reason: "Too much" }));

    expect(error.errorCode).toBe(409);
    expect(db.accounts.get(C1)?.points).toBe(10);
    expect(db.loyaltyTx.size).toBe(1);
  });

  it.each([
    ["no reason", { points: 5 }],
    ["short reason", { points: 5, reason: "x" }],
    ["zero points", { points: 0, reason: "nothing" }],
    ["fractional", { points: 1.5, reason: "nothing" }],
    ["too many", { points: 5_000_000, reason: "huge" }],
  ])("rejects %s with 400", async (_name, body) => {
    expect((await rejection(LoyaltyService.adjust(C1, ADMIN, body))).errorCode).toBe(400);
  });

  it("answers 404 for an unknown customer and does not create an account", async () => {
    mockGetUser.mockResolvedValue(null);

    const error = await rejection(LoyaltyService.adjust(C2, ADMIN, { points: 5, reason: "Ghost" }));

    expect(error.errorCode).toBe(404);
    expect(db.accounts.size).toBe(0);
    expect((await rejection(LoyaltyService.adjust("nope", ADMIN, { points: 5, reason: "Ghost" }))).errorCode).toBe(404);
  });

  it("shows any customer's account to the admin, and filters the ledger by customer", async () => {
    await earn({ amountPaise: 100_000 });
    await earn({ customerId: C2, orderRef: "o-9", amountPaise: 20_000 });

    const account: any = await LoyaltyService.getAccount(C1);
    const ledger: any = await LoyaltyService.listTransactions({ customerId: C2 });
    const everything: any = await LoyaltyService.listTransactions({});

    expect(account).toMatchObject({ customerId: C1, points: 1000, tier: "Silver", lifetimePoints: 1000 });
    expect(ledger.items.map((t: any) => t.customerId)).toEqual([C2]);
    expect(everything.total).toBe(2);
  });
});

describe("expiry (internal)", () => {
  const age = (customerId: string, days: number) => {
    (db.accounts.get(customerId) as any).lastEarnAt = new Date(Date.now() - days * DAY);
  };

  it("expires the whole balance once the last earn is older than expiryDays, with a ledger row", async () => {
    await earn();
    age(C1, 400);

    const result: any = await LoyaltyService.expireDormant();

    expect(result).toMatchObject({ accounts: 1, points: 500, more: false });
    expect(db.accounts.get(C1)?.points).toBe(0);
    expect([...db.loyaltyTx.values()].find((t) => t.type === "expire")).toMatchObject({ points: -500, balanceAfter: 0 });
  });

  it("leaves recent earners alone and keeps lifetime points", async () => {
    await earn();
    await earn({ customerId: C2, orderRef: "o-2" });
    age(C1, 100);

    const result: any = await LoyaltyService.expireDormant();

    expect(result.accounts).toBe(0);
    expect(db.accounts.get(C1)?.points).toBe(500);
  });

  it("is idempotent: running it again changes nothing", async () => {
    await earn();
    age(C1, 400);
    await LoyaltyService.expireDormant();

    const again: any = await LoyaltyService.expireDormant();

    expect(again).toMatchObject({ accounts: 0, points: 0 });
    expect([...db.loyaltyTx.values()].filter((t) => t.type === "expire")).toHaveLength(1);
  });

  it("a new earn after expiry starts a fresh balance", async () => {
    await earn();
    age(C1, 400);
    await LoyaltyService.expireDormant();

    await earn({ orderRef: "o-2", amountPaise: 10_000 });

    expect(db.accounts.get(C1)?.points).toBe(100);
  });

  it("does nothing when the programme has no expiry", async () => {
    await LoyaltyService.setProgram({ pointsPerRupee: 1, redemptionValue: 1, tiers: [{ name: "A", minPoints: 0 }] });
    await earn();
    age(C1, 4000);

    const result: any = await LoyaltyService.expireDormant();

    expect(result).toEqual({ accounts: 0, points: 0, more: false });
    expect(db.accounts.get(C1)?.points).toBe(500);
  });

  it("works in bounded batches and says when more remain", async () => {
    process.env.LOYALTY_EXPIRE_BATCH_SIZE = "2";
    try {
      for (let i = 1; i <= 3; i++) {
        const id = `00000000-0000-4000-9000-00000000000${i}`;
        await earn({ customerId: id, orderRef: `o-${i}` });
        age(id, 400);
      }

      const first: any = await LoyaltyService.expireDormant();
      const second: any = await LoyaltyService.expireDormant();

      expect(first).toMatchObject({ accounts: 2, more: true });
      expect(second).toMatchObject({ accounts: 1, more: false });
    } finally {
      delete process.env.LOYALTY_EXPIRE_BATCH_SIZE;
    }
  });
});
