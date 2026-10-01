import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { inTransaction } from "../Queries/Db.js";
import { LoyaltyQuery } from "../Queries/Loyalty.Query.js";
import { CustomerQuery } from "../Queries/Customer.Query.js";
import { GatewayClient } from "../Clients/Gateway.Client.js";
import type { ILoyaltyAccount, ILoyaltyProgram, ILoyaltyTier, ILoyaltyTransaction } from "../Models/Loyalty/Loyalty.Interface.js";
import {
  bodyOf,
  dateField,
  intField,
  isUuid,
  iso,
  pathId,
  queryDate,
  queryUuid,
  stringField,
  toPaise,
  toRupees,
  uuidField,
} from "../Utils/Input.js";
import { Limits, RateLimit } from "./RateLimit.Service.js";

const MAX_POINTS = 1_000_000;
const MAX_TIERS = 10;
// Thousandths of a point per rupee: 1000 = one point per rupee.
const MILLI = 1000;
const NOT_ENOUGH_POINTS = "Not enough points.";

// Used until an admin saves a programme, so the service works on a fresh install.
export const DEFAULT_PROGRAM: ILoyaltyProgram = { pointsPerRupeeMilli: 1000, redemptionValuePaise: 25, expiryDays: 365 };
export const DEFAULT_TIERS: ILoyaltyTier[] = [
  { name: "Bronze", minPoints: 0, benefits: [] },
  { name: "Silver", minPoints: 1000, benefits: [] },
  { name: "Gold", minPoints: 5000, benefits: [] },
];

const loadProgram = async () => {
  const program = await LoyaltyQuery.getProgram();
  if (!program) return { program: DEFAULT_PROGRAM, tiers: DEFAULT_TIERS };
  const tiers = await LoyaltyQuery.listTiers();
  return { program, tiers: tiers.length > 0 ? tiers : DEFAULT_TIERS };
};

/** Tier by lifetime points, plus the next one to reach. Always read against the current tiers. */
export const tierFor = (lifetimePoints: number, tiers: ILoyaltyTier[]) => {
  const sorted = [...tiers].sort((a, b) => a.minPoints - b.minPoints);
  let current = sorted[0];
  for (const tier of sorted) if (lifetimePoints >= tier.minPoints) current = tier;
  const next = sorted.find((t) => t.minPoints > lifetimePoints) ?? null;
  return {
    tier: current?.name ?? null,
    nextTier: next?.name ?? null,
    pointsToNextTier: next ? next.minPoints - lifetimePoints : null,
  };
};

const accountView = (account: ILoyaltyAccount | null, tiers: ILoyaltyTier[]) => {
  const lifetime = account?.lifetimePoints ?? 0;
  return { points: account?.points ?? 0, ...tierFor(lifetime, tiers) };
};

const orderIdOf = (ref: string | null) => (ref && isUuid(ref) ? ref : null);

const toTransactionApi = (t: ILoyaltyTransaction) => ({
  id: t.id,
  points: t.points,
  reason: t.reason,
  orderId: orderIdOf(t.orderRef),
  at: iso(t.createdAt),
});

const toAdminTransactionApi = (t: ILoyaltyTransaction) => ({
  id: t.id,
  customerId: t.customerId,
  type: t.type,
  points: t.points,
  balanceAfter: t.balanceAfter,
  reason: t.reason,
  at: iso(t.createdAt),
});

// ---------------------------------------------------------------- programme

const toProgramApi = (program: ILoyaltyProgram, tiers: ILoyaltyTier[]) => ({
  pointsPerRupee: program.pointsPerRupeeMilli / MILLI,
  redemptionValue: toRupees(program.redemptionValuePaise),
  expiryDays: program.expiryDays,
  tiers: tiers.map((t) => ({ name: t.name, minPoints: t.minPoints, benefits: t.benefits })),
});

const getProgram = async () => {
  try {
    const { program, tiers } = await loadProgram();
    return toProgramApi(program, tiers);
  } catch (error) {
    throw toCustomException(error);
  }
};

const parseTiers = (raw: unknown): ILoyaltyTier[] => {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_TIERS) {
    throw new CustomException(`tiers must list 1 to ${MAX_TIERS} tiers.`, badRequest);
  }
  const tiers = raw.map((item): ILoyaltyTier => {
    const t = bodyOf(item);
    requireFields(t, ["name", "minPoints"]);
    const benefits = t.benefits === undefined ? [] : t.benefits;
    if (!Array.isArray(benefits) || benefits.length > 10) throw new CustomException("benefits must be a short list of text.", badRequest);
    return {
      name: stringField(t.name, "tier name", 1, 40),
      minPoints: intField(t.minPoints, "minPoints", 0, 1_000_000_000),
      benefits: benefits.map((b) => stringField(b, "benefit", 1, 100)),
    };
  });
  if (new Set(tiers.map((t) => t.name.toLowerCase())).size !== tiers.length) {
    throw new CustomException("Tier names must be different.", badRequest);
  }
  if (new Set(tiers.map((t) => t.minPoints)).size !== tiers.length) {
    throw new CustomException("Tier thresholds must be different.", badRequest);
  }
  if (!tiers.some((t) => t.minPoints === 0)) {
    throw new CustomException("One tier must start at 0 points so every customer has a tier.", badRequest);
  }
  return tiers.sort((a, b) => a.minPoints - b.minPoints);
};

const setProgram = async (body: unknown) => {
  try {
    const input = bodyOf(body);
    requireFields(input, ["pointsPerRupee", "redemptionValue", "tiers"]);
    if (typeof input.pointsPerRupee !== "number") throw new CustomException("pointsPerRupee must be a number.", badRequest);
    const program: ILoyaltyProgram = {
      pointsPerRupeeMilli: intField(Math.round(input.pointsPerRupee * MILLI), "pointsPerRupee (up to 3 decimals)", 1, 1_000_000),
      redemptionValuePaise: toPaise(input.redemptionValue, "redemptionValue", false),
      expiryDays: input.expiryDays === undefined || input.expiryDays === null ? null : intField(input.expiryDays, "expiryDays", 1, 3650),
    };
    if (program.redemptionValuePaise > 10_000) throw new CustomException("redemptionValue is too large.", badRequest);
    const tiers = parseTiers(input.tiers);
    await LoyaltyQuery.saveProgram(program, tiers);
    return toProgramApi(program, tiers);
  } catch (error) {
    throw toCustomException(error);
  }
};

// ----------------------------------------------------------------- accounts

const getMine = async (customerId: string) => {
  try {
    const { tiers } = await loadProgram();
    return accountView(await LoyaltyQuery.findAccount(customerId), tiers);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getAccount = async (customerId: unknown) => {
  try {
    const id = pathId(customerId);
    const { tiers } = await loadProgram();
    const account = await LoyaltyQuery.findAccount(id);
    return { customerId: id, ...accountView(account, tiers), lifetimePoints: account?.lifetimePoints ?? 0 };
  } catch (error) {
    throw toCustomException(error);
  }
};

const adjust = async (customerId: unknown, actorId: string, body: unknown) => {
  try {
    const id = pathId(customerId);
    const input = bodyOf(body);
    requireFields(input, ["points", "reason"]);
    const points = intField(input.points, "points", -MAX_POINTS, MAX_POINTS);
    if (points === 0) throw new CustomException("points must not be 0.", badRequest);
    const reason = stringField(input.reason, "reason", 3, 200);
    // An adjustment to an account that does not exist would create a ghost; ask the gateway.
    if (!(await GatewayClient.getUser(id))) throw new CustomException("Customer not found.", notFound);

    const { tiers } = await loadProgram();
    const result = await inTransaction(async (tx) => {
      await LoyaltyQuery.lockAccount(id, tx);
      // A correction moves lifetime points too, so a wrongly granted tier is taken back.
      if (!(await LoyaltyQuery.applyDelta({ customerId: id, delta: points, lifetimeDelta: points }, tx))) {
        throw new CustomException("The customer does not have enough points for this adjustment.", conflict);
      }
      const account = (await LoyaltyQuery.findAccount(id, tx)) as ILoyaltyAccount;
      const transaction = await LoyaltyQuery.insertTransaction(
        { customerId: id, type: "adjust", points, balanceAfter: account.points, reason, orderRef: null, actorId },
        tx
      );
      return { account, transaction };
    });
    return { customerId: id, ...accountView(result.account, tiers), transaction: toAdminTransactionApi(result.transaction) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const redeemMine = async (customerId: string, body: unknown) => {
  try {
    const input = bodyOf(body);
    requireFields(input, ["points"]);
    const points = intField(input.points, "points", 1, MAX_POINTS);
    const orderRef = input.orderId === undefined ? null : uuidField(input.orderId, "orderId");

    const { max, windowMs } = Limits.loyaltyRedeem;
    await RateLimit.enforce(`loyalty-redeem:${customerId}`, max, windowMs, "Too many redemptions. Please try again later.");
    const { program } = await loadProgram();
    const valueOf = (spent: number) => toRupees(spent * program.redemptionValuePaise);

    // A retry for the same order returns the first redemption instead of spending twice.
    if (orderRef) {
      const earlier = await LoyaltyQuery.findTransaction(customerId, "redeem", orderRef);
      if (earlier) return { pointsRedeemed: -earlier.points, value: valueOf(-earlier.points), balance: earlier.balanceAfter, replayed: true };
    }
    try {
      const done = await inTransaction(async (tx) => {
        await LoyaltyQuery.lockAccount(customerId, tx);
        if (!(await LoyaltyQuery.applyDelta({ customerId, delta: -points, lifetimeDelta: 0 }, tx))) {
          throw new CustomException(NOT_ENOUGH_POINTS, conflict);
        }
        const account = (await LoyaltyQuery.findAccount(customerId, tx)) as ILoyaltyAccount;
        await LoyaltyQuery.insertTransaction(
          { customerId, type: "redeem", points: -points, balanceAfter: account.points, reason: "Redeemed on an order", orderRef, actorId: null },
          tx
        );
        return account.points;
      });
      return { pointsRedeemed: points, value: valueOf(points), balance: done, replayed: false };
    } catch (error) {
      if (orderRef && isUniqueViolation(error)) {
        const winner = await LoyaltyQuery.findTransaction(customerId, "redeem", orderRef);
        if (winner) return { pointsRedeemed: -winner.points, value: valueOf(-winner.points), balance: winner.balanceAfter, replayed: true };
      }
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const listMyTransactions = async (customerId: string, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await LoyaltyQuery.listTransactions(
      { customerId, from: queryDate(query.from, "from"), to: queryDate(query.to, "to", true) },
      page
    );
    return toPage(items.map(toTransactionApi), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listTransactions = async (query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await LoyaltyQuery.listTransactions(
      { customerId: queryUuid(query.customerId, "customerId"), from: queryDate(query.from, "from"), to: queryDate(query.to, "to", true) },
      page
    );
    return toPage(items.map(toAdminTransactionApi), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

// ----------------------------------------------------------------- internal

/** Order completed: record the order fact and award points, once per orderRef. */
const earn = async (body: unknown) => {
  try {
    const input = bodyOf(body);
    requireFields(input, ["customerId", "orderRef", "amountPaise"]);
    const customerId = uuidField(input.customerId, "customerId");
    const orderRef = stringField(input.orderRef, "orderRef", 1, 100);
    const amountPaise = intField(input.amountPaise, "amountPaise", 0, 2_000_000_000);
    const storeId = input.storeId === undefined || input.storeId === null ? null : uuidField(input.storeId, "storeId");
    const completedAt = input.completedAt === undefined ? new Date() : dateField(input.completedAt, "completedAt");
    if (completedAt.getTime() > Date.now() + 24 * 60 * 60_000) throw new CustomException("completedAt is in the future.", badRequest);

    const { program } = await loadProgram();
    const points = Math.floor((amountPaise * program.pointsPerRupeeMilli) / (100 * MILLI));

    const outcome = await inTransaction(async (tx) => {
      const isNew = await CustomerQuery.insertOrder({ orderRef, customerId, storeId, amountPaise, completedAt }, tx);
      if (!isNew) return null;
      const stat = await CustomerQuery.lockStat(customerId, { at: completedAt, storeId }, tx);
      const newest = completedAt >= stat.lastOrderAt || stat.orderCount === 0;
      await CustomerQuery.addOrderToStat(
        customerId,
        {
          amountPaise,
          firstOrderAt: stat.orderCount === 0 || completedAt < stat.firstOrderAt ? completedAt : stat.firstOrderAt,
          lastOrderAt: newest ? completedAt : stat.lastOrderAt,
          lastStoreId: newest ? storeId : stat.lastStoreId,
        },
        tx
      );
      await LoyaltyQuery.lockAccount(customerId, tx);
      if (points > 0) await LoyaltyQuery.applyDelta({ customerId, delta: points, lifetimeDelta: points, earnedAt: new Date() }, tx);
      const account = (await LoyaltyQuery.findAccount(customerId, tx)) as ILoyaltyAccount;
      if (points > 0) {
        await LoyaltyQuery.insertTransaction(
          { customerId, type: "earn", points, balanceAfter: account.points, reason: "Points for a completed order", orderRef, actorId: null },
          tx
        );
      }
      return { points, balance: account.points };
    });
    if (outcome) return { ...outcome, replayed: false };
    const earlier = await LoyaltyQuery.findTransaction(customerId, "earn", orderRef);
    const account = await LoyaltyQuery.findAccount(customerId);
    return { points: earlier?.points ?? 0, balance: account?.points ?? 0, replayed: true };
  } catch (error) {
    throw toCustomException(error);
  }
};

/**
 * Rolling expiry: a balance lapses expiryDays after the customer's last earn. Processes one
 * bounded batch per call; a scheduler calls it until `more` is false. Safe to repeat: an
 * expired account has no balance, and the ledger marker is unique per dormancy period.
 */
const expireDormant = async () => {
  try {
    const { program } = await loadProgram();
    if (program.expiryDays === null) return { accounts: 0, points: 0, more: false };
    const cutoff = new Date(Date.now() - program.expiryDays * 24 * 60 * 60_000);
    const batchSize = Limits.expireBatchSize();
    const dormant = await LoyaltyQuery.listDormant(cutoff, batchSize);

    let accounts = 0;
    let points = 0;
    for (const candidate of dormant) {
      try {
        const expired = await inTransaction(async (tx) => {
          const account = await LoyaltyQuery.lockAccount(candidate.customerId, tx);
          if (account.points <= 0 || account.lastEarnAt >= cutoff) return 0;
          const marker = `expire:${account.lastEarnAt.getTime()}`;
          if (await LoyaltyQuery.findTransaction(account.customerId, "expire", marker, tx)) return 0;
          if (!(await LoyaltyQuery.applyDelta({ customerId: account.customerId, delta: -account.points, lifetimeDelta: 0 }, tx))) return 0;
          await LoyaltyQuery.insertTransaction(
            { customerId: account.customerId, type: "expire", points: -account.points, balanceAfter: 0, reason: `Expired after ${program.expiryDays} days without earning`, orderRef: marker, actorId: null },
            tx
          );
          return account.points;
        });
        if (expired > 0) {
          accounts += 1;
          points += expired;
        }
      } catch (error) {
        // A concurrent run expired this account first (unique marker): nothing left to do.
        if (!isUniqueViolation(error)) throw error;
      }
    }
    return { accounts, points, more: dormant.length === batchSize };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const LoyaltyService = {
  getProgram, setProgram, getMine, getAccount, adjust, redeemMine,
  listMyTransactions, listTransactions, earn, expireDormant,
};
