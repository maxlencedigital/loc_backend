// In-memory stand-in for every Query module, for the Flow tests. The service layer runs for real
// on top of it. It keeps the semantics the services depend on: unique constraints (P2002),
// conditional updates, and transactions that roll back everything on a throw and run one at a
// time (the stand-in for Postgres row locks). Never imported by production code.

type Row = Record<string, any>;

let seq = 0;
export const newId = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export const db = {
  coupons: new Map<string, Row>(),
  redemptions: new Map<string, Row>(),
  couponUsage: new Map<string, Row>(),
  packages: new Map<string, Row>(),
  customerPackages: new Map<string, Row>(),
  program: null as Row | null,
  tiers: [] as Row[],
  accounts: new Map<string, Row>(),
  loyaltyTx: new Map<string, Row>(),
  stats: new Map<string, Row>(),
  orders: new Map<string, Row>(),
  winBacks: [] as Row[],
  notifications: new Map<string, Row>(),
  preferences: new Map<string, Row>(),
  templates: new Map<string, Row>(),
  campaigns: new Map<string, Row>(),
  recipients: new Map<string, Row>(),
  counters: new Map<string, Row>(),
};

export const reset = () => {
  for (const value of Object.values(db)) {
    if (value instanceof Map) value.clear();
  }
  db.program = null;
  db.tiers = [];
  db.winBacks = [];
  chain = Promise.resolve();
};

const unique = (target: string): never => {
  throw Object.assign(new Error(`Unique constraint failed on ${target}`), { code: "P2002", meta: { target: [target] } });
};
const foreignKey = (): never => {
  throw Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" });
};

const clone = <T>(row: T): T => (row === null || row === undefined ? row : (structuredClone(row) as T));
const all = (map: Map<string, Row>) => [...map.values()];
const paged = <T>(rows: T[], paging: { offset: number; limit: number }) => ({
  items: rows.slice(paging.offset, paging.offset + paging.limit).map(clone),
  total: rows.length,
});
const desc = (a: Row, b: Row) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1);

// --------------------------------------------------------------- transactions

let chain: Promise<unknown> = Promise.resolve();

const snapshot = () => {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(db)) copy[key] = value instanceof Map ? new Map([...value].map(([k, v]) => [k, clone(v)])) : clone(value);
  return copy;
};
const restore = (copy: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(copy)) {
    const current = (db as any)[key];
    if (current instanceof Map) {
      current.clear();
      for (const [k, v] of value as Map<string, Row>) current.set(k, v);
    } else {
      (db as any)[key] = value;
    }
  }
};

export const inTransaction = async <T>(work: (tx: object) => Promise<T>): Promise<T> => {
  const run = async () => {
    const before = snapshot();
    try {
      return await work({});
    } catch (error) {
      restore(before);
      throw error;
    }
  };
  const result = chain.then(run, run);
  chain = result.catch(() => undefined);
  return result;
};

// ------------------------------------------------------------------- coupons

export const CouponQuery = {
  create: async (data: Row) => {
    if (all(db.coupons).some((c) => c.code === data.code)) unique("code");
    const row = { id: newId(), usedCount: 0, createdAt: new Date(), updatedAt: new Date(), ...data };
    db.coupons.set(row.id, row);
    return clone(row);
  },
  findById: async (id: string) => clone(db.coupons.get(id) ?? null),
  findByCode: async (code: string) => clone(all(db.coupons).find((c) => c.code === code) ?? null),
  update: async (id: string, data: Row) => {
    const row = db.coupons.get(id);
    if (!row) return null;
    if (data.code && all(db.coupons).some((c) => c.code === data.code && c.id !== id)) unique("code");
    Object.assign(row, data, { updatedAt: new Date() });
    return clone(row);
  },
  list: async (filter: Row, paging: any) => {
    const q = filter.q?.toLowerCase();
    return paged(
      all(db.coupons)
        .filter((c) => filter.isActive === undefined || c.isActive === filter.isActive)
        .filter((c) => !q || c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
        .sort(desc),
      paging
    );
  },
  listAvailable: async (now: Date, excludeIds: string[], paging: any) =>
    paged(
      all(db.coupons)
        .filter((c) => c.isActive && c.validFrom <= now && c.validUntil >= now)
        .filter((c) => c.usageLimit === null || c.usedCount < c.usageLimit)
        .filter((c) => !excludeIds.includes(c.id))
        .sort((a, b) => a.validUntil.getTime() - b.validUntil.getTime()),
      paging
    ),
  exhaustedForCustomer: async (customerId: string) =>
    all(db.couponUsage)
      .filter((u) => u.customerId === customerId)
      .filter((u) => {
        const coupon = db.coupons.get(u.couponId);
        return coupon && coupon.perCustomerLimit !== null && u.usedCount >= coupon.perCustomerLimit;
      })
      .map((u) => u.couponId),
  customerUseCount: async (couponId: string, customerId: string) =>
    db.couponUsage.get(`${couponId}:${customerId}`)?.usedCount ?? 0,
  takeUse: async (couponId: string) => {
    const c = db.coupons.get(couponId);
    if (!c || !c.isActive || (c.usageLimit !== null && c.usedCount >= c.usageLimit)) return false;
    c.usedCount += 1;
    return true;
  },
  takeCustomerUse: async (couponId: string, customerId: string, limit: number | null) => {
    const key = `${couponId}:${customerId}`;
    const usage = db.couponUsage.get(key) ?? { id: newId(), couponId, customerId, usedCount: 0 };
    db.couponUsage.set(key, usage);
    if (limit !== null && usage.usedCount >= limit) return false;
    usage.usedCount += 1;
    return true;
  },
  findRedemption: async (couponId: string, orderRef: string) =>
    clone(all(db.redemptions).find((r) => r.couponId === couponId && r.orderRef === orderRef) ?? null),
  insertRedemption: async (data: Row) => {
    if (all(db.redemptions).some((r) => r.couponId === data.couponId && r.orderRef === data.orderRef)) unique("uq_redemption_coupon_order");
    const row = { id: newId(), createdAt: new Date(), ...data };
    db.redemptions.set(row.id, row);
    return clone(row);
  },
  usage: async (couponId: string) => {
    const redemptions = all(db.redemptions).filter((r) => r.couponId === couponId);
    return {
      redemptions: redemptions.length,
      totalDiscountPaise: redemptions.reduce((sum, r) => sum + r.discountPaise, 0),
      uniqueCustomers: all(db.couponUsage).filter((u) => u.couponId === couponId && u.usedCount > 0).length,
    };
  },
};

// ------------------------------------------------------------------ counters

export const CounterQuery = {
  hit: async (key: string, windowMs: number) => {
    const now = Date.now();
    const row = db.counters.get(key);
    if (!row || row.windowEndsAt <= now) {
      db.counters.set(key, { count: 1, windowEndsAt: now + windowMs });
      return 1;
    }
    row.count += 1;
    return row.count;
  },
};

// ------------------------------------------------------------------ packages

const effective = (p: Row, now: Date) => (p.status === "active" && p.expiresAt && p.expiresAt <= now ? "expired" : p.status);

export const PackageQuery = {
  createPackage: async (data: Row) => {
    const row = { id: newId(), createdAt: new Date(), updatedAt: new Date(), ...data };
    db.packages.set(row.id, row);
    return clone(row);
  },
  findPackage: async (id: string) => clone(db.packages.get(id) ?? null),
  updatePackage: async (id: string, data: Row) => {
    const row = db.packages.get(id);
    if (!row) return null;
    Object.assign(row, data, { updatedAt: new Date() });
    return clone(row);
  },
  listPackages: async (filter: Row, paging: any) =>
    paged(all(db.packages).filter((p) => filter.isActive === undefined || p.isActive === filter.isActive).sort(desc), paging),
  listCustomerPackages: async (filter: Row, paging: any) =>
    paged(
      all(db.customerPackages)
        .filter((p) => !filter.customerId || p.customerId === filter.customerId)
        .filter((p) => !filter.packageId || p.packageId === filter.packageId)
        .filter((p) => (filter.status ? effective(p, filter.now) === filter.status : p.status !== "pending"))
        .sort(desc),
      paging
    ),
  findCustomerPackage: async (id: string) => clone(db.customerPackages.get(id) ?? null),
  findCustomerPackageByRef: async (orderRef: string) => clone(all(db.customerPackages).find((p) => p.orderRef === orderRef) ?? null),
  createCustomerPackage: async (data: Row) => {
    const row = { remainingCreditPaise: data.creditPaise, status: "pending", expiresAt: null, activatedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data };
    db.customerPackages.set(row.id, row);
    return clone(row);
  },
  countPending: async (customerId: string, since: Date) =>
    all(db.customerPackages).filter((p) => p.customerId === customerId && p.status === "pending" && p.createdAt >= since).length,
  activate: async (orderRef: string, expiresAt: Date, activatedAt: Date) => {
    const row = all(db.customerPackages).find((p) => p.orderRef === orderRef && p.status === "pending");
    if (!row) return false;
    Object.assign(row, { status: "active", expiresAt, activatedAt });
    return true;
  },
};

// ------------------------------------------------------------------- loyalty

export const LoyaltyQuery = {
  getProgram: async () => clone(db.program),
  listTiers: async () => clone([...db.tiers].sort((a, b) => a.minPoints - b.minPoints)),
  saveProgram: async (program: Row, tiers: Row[]) => {
    db.program = clone(program);
    db.tiers = clone(tiers);
  },
  findAccount: async (customerId: string) => clone(db.accounts.get(customerId) ?? null),
  lockAccount: async (customerId: string) => {
    if (!db.accounts.has(customerId)) {
      db.accounts.set(customerId, { id: newId(), customerId, points: 0, lifetimePoints: 0, lastEarnAt: new Date() });
    }
    return clone(db.accounts.get(customerId));
  },
  applyDelta: async (change: Row) => {
    const account = db.accounts.get(change.customerId);
    if (!account || account.points < Math.max(0, -change.delta)) return false;
    account.points += change.delta;
    account.lifetimePoints += change.lifetimeDelta;
    if (change.earnedAt) account.lastEarnAt = change.earnedAt;
    return true;
  },
  insertTransaction: async (data: Row) => {
    if (data.orderRef !== null && all(db.loyaltyTx).some((t) => t.customerId === data.customerId && t.type === data.type && t.orderRef === data.orderRef)) {
      unique("uq_loyalty_tx_customer_type_ref");
    }
    const row = { id: newId(), createdAt: new Date(), ...data };
    db.loyaltyTx.set(row.id, row);
    return clone(row);
  },
  findTransaction: async (customerId: string, type: string, orderRef: string) =>
    clone(all(db.loyaltyTx).find((t) => t.customerId === customerId && t.type === type && t.orderRef === orderRef) ?? null),
  listTransactions: async (filter: Row, paging: any) =>
    paged(
      all(db.loyaltyTx)
        .filter((t) => !filter.customerId || t.customerId === filter.customerId)
        .filter((t) => !filter.from || t.createdAt >= filter.from)
        .filter((t) => !filter.to || t.createdAt <= filter.to)
        .sort(desc),
      paging
    ),
  listDormant: async (cutoff: Date, limit: number) =>
    clone(all(db.accounts).filter((a) => a.points > 0 && a.lastEarnAt < cutoff).sort((a, b) => a.lastEarnAt - b.lastEarnAt).slice(0, limit)),
};

// ----------------------------------------------------------------- customers

const matches = (stat: Row, c: Row): boolean =>
  (!c.storeIds || c.storeIds.length === 0 || c.storeIds.includes(stat.lastStoreId)) &&
  (!c.minOrders || stat.orderCount >= c.minOrders) &&
  (!c.minSpentPaise || stat.totalSpentPaise >= c.minSpentPaise) &&
  (!c.firstOrderAfter || stat.firstOrderAt > c.firstOrderAfter) &&
  (!c.lastOrderBefore || stat.lastOrderAt < c.lastOrderBefore) &&
  (!c.lastOrderAfter || stat.lastOrderAt > c.lastOrderAfter);

export const CustomerQuery = {
  insertOrder: async (order: Row) => {
    if (db.orders.has(order.orderRef)) return false;
    db.orders.set(order.orderRef, clone(order));
    return true;
  },
  findOrder: async (orderRef: string) => clone(db.orders.get(orderRef) ?? null),
  lockStat: async (customerId: string, first: Row) => {
    if (!db.stats.has(customerId)) {
      db.stats.set(customerId, { customerId, orderCount: 0, totalSpentPaise: 0, firstOrderAt: first.at, lastOrderAt: first.at, lastStoreId: first.storeId });
    }
    return clone(db.stats.get(customerId));
  },
  addOrderToStat: async (customerId: string, change: Row) => {
    const stat = db.stats.get(customerId) as Row;
    stat.orderCount += 1;
    stat.totalSpentPaise += change.amountPaise;
    Object.assign(stat, { firstOrderAt: change.firstOrderAt, lastOrderAt: change.lastOrderAt, lastStoreId: change.lastStoreId });
  },
  findStat: async (customerId: string) => clone(db.stats.get(customerId) ?? null),
  listOrders: async (customerId: string, limit: number) =>
    clone(all(db.orders).filter((o) => o.customerId === customerId).sort((a, b) => b.completedAt - a.completedAt).slice(0, limit)),
  audienceBatch: async (criteria: Row, after: string | null, limit: number) =>
    all(db.stats)
      .filter((s) => matches(s, criteria) && (!after || s.customerId > after))
      .map((s) => s.customerId)
      .sort()
      .slice(0, limit),
  audienceCount: async (criteria: Row) => all(db.stats).filter((s) => matches(s, criteria)).length,
  listByRecency: async (criteria: Row, limit: number) =>
    clone(all(db.stats).filter((s) => matches(s, criteria)).sort((a, b) => a.lastOrderAt - b.lastOrderAt).slice(0, limit)),
  findStatsByIds: async (ids: string[]) => clone(all(db.stats).filter((s) => ids.includes(s.customerId))),
  insertWinBack: async (data: Row) => {
    db.winBacks.push({ ...data, createdAt: new Date() });
  },
  recentWinBacks: async (since: Date, limit: number) =>
    clone(db.winBacks.filter((w) => w.createdAt >= since).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)),
};

// ------------------------------------------------------------- notifications

const notificationRow = (data: Row): Row => ({
  id: newId(),
  status: "queued",
  providerMessageId: null,
  error: null,
  attempts: 1,
  readAt: null,
  sentAt: null,
  customerId: null,
  campaignId: null,
  idempotencyKey: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...data,
});

export const NotificationQuery = {
  create: async (data: Row) => {
    if (data.idempotencyKey && all(db.notifications).some((n) => n.idempotencyKey === data.idempotencyKey)) unique("idempotencyKey");
    const row = notificationRow(data);
    db.notifications.set(row.id, row);
    return clone(row);
  },
  createMany: async (rows: Row[]) => {
    for (const data of rows) {
      const row = notificationRow(data);
      db.notifications.set(row.id, row);
    }
  },
  findById: async (id: string) => clone(db.notifications.get(id) ?? null),
  findByKey: async (key: string) => clone(all(db.notifications).find((n) => n.idempotencyKey === key) ?? null),
  complete: async (id: string, outcome: Row) => {
    const row = db.notifications.get(id) as Row;
    Object.assign(row, {
      status: outcome.status,
      providerMessageId: outcome.providerMessageId ?? null,
      error: outcome.error ?? null,
      sentAt: outcome.status === "sent" ? new Date() : null,
    });
    return clone(row);
  },
  claimRetry: async (id: string, maxAttempts: number) => {
    const row = db.notifications.get(id);
    if (!row || row.status !== "failed" || row.attempts >= maxAttempts) return false;
    Object.assign(row, { status: "queued", error: null, attempts: row.attempts + 1 });
    return true;
  },
  list: async (filter: Row, paging: any) =>
    paged(
      all(db.notifications)
        .filter((n) => !filter.channel || n.channel === filter.channel)
        .filter((n) => !filter.status || n.status === filter.status)
        .filter((n) => !filter.customerId || n.customerId === filter.customerId)
        .filter((n) => !filter.from || n.createdAt >= filter.from)
        .filter((n) => !filter.to || n.createdAt <= filter.to)
        .sort(desc),
      paging
    ),
  listForCustomer: async (customerId: string, unreadOnly: boolean, paging: any) =>
    paged(all(db.notifications).filter((n) => n.customerId === customerId && (!unreadOnly || n.readAt === null)).sort(desc), paging),
  markRead: async (id: string, customerId: string) => {
    const row = db.notifications.get(id);
    if (!row || row.customerId !== customerId) return false;
    row.readAt ??= new Date();
    return true;
  },
  findPreference: async (customerId: string) => clone(db.preferences.get(customerId) ?? null),
  findPreferences: async (ids: string[]) => clone(all(db.preferences).filter((p) => ids.includes(p.customerId))),
  savePreference: async (customerId: string, data: Row) => {
    const row = db.preferences.get(customerId) ?? { customerId, sms: true, email: true, whatsapp: true, push: false, language: "en", quietFrom: null, quietTo: null };
    Object.assign(row, data);
    db.preferences.set(customerId, row);
    return clone(row);
  },
  createTemplate: async (data: Row) => {
    if (all(db.templates).some((t) => t.name === data.name)) unique("name");
    const row = { id: newId(), createdAt: new Date(), updatedAt: new Date(), ...data };
    db.templates.set(row.id, row);
    return clone(row);
  },
  findTemplate: async (id: string) => clone(db.templates.get(id) ?? null),
  updateTemplate: async (id: string, data: Row) => {
    const row = db.templates.get(id);
    if (!row) return null;
    if (all(db.templates).some((t) => t.name === data.name && t.id !== id)) unique("name");
    Object.assign(row, data, { updatedAt: new Date() });
    return clone(row);
  },
  deleteTemplate: async (id: string) => {
    if (!db.templates.has(id)) return false;
    if (all(db.campaigns).some((c) => c.templateId === id)) foreignKey();
    db.templates.delete(id);
    return true;
  },
  listTemplates: async (paging: any) => paged(all(db.templates).sort(desc), paging),
};

// ----------------------------------------------------------------- campaigns

export const CampaignQuery = {
  create: async (data: Row) => {
    const row = {
      id: newId(), status: "draft", startedAt: null, completedAt: null, cancelledAt: null,
      cursor: null, claimedCount: 0, leaseUntil: null, createdAt: new Date(), updatedAt: new Date(), ...data,
    };
    db.campaigns.set(row.id, row);
    return clone(row);
  },
  findById: async (id: string) => clone(db.campaigns.get(id) ?? null),
  list: async (filter: Row, paging: any) =>
    paged(
      all(db.campaigns)
        .filter((c) => !filter.status || c.status === filter.status)
        .filter((c) => !filter.channel || c.channel === filter.channel)
        .sort(desc),
      paging
    ),
  updateIn: async (id: string, from: string[], data: Row) => {
    const row = db.campaigns.get(id);
    if (!row || !from.includes(row.status)) return false;
    Object.assign(row, data, { updatedAt: new Date() });
    return true;
  },
  transition: async (id: string, from: string[], to: string, extra: Row = {}) => {
    const row = db.campaigns.get(id);
    if (!row || !from.includes(row.status)) return false;
    Object.assign(row, { status: to, ...extra }, to === "sending" ? {} : { leaseUntil: null });
    return true;
  },
  acquireLease: async (id: string, now: Date, until: Date) => {
    const row = db.campaigns.get(id);
    if (!row || row.status !== "sending" || (row.leaseUntil && row.leaseUntil >= now)) return false;
    row.leaseUntil = until;
    return true;
  },
  releaseLease: async (id: string) => {
    const row = db.campaigns.get(id);
    if (row) row.leaseUntil = null;
  },
  failInterrupted: async (campaignId: string) => {
    const rows = all(db.recipients).filter((r) => r.campaignId === campaignId && r.status === "sending");
    for (const r of rows) Object.assign(r, { status: "failed", error: "interrupted before the result was known; not retried to avoid a duplicate" });
    return rows.length;
  },
  pendingRecipients: async (campaignId: string, limit: number) =>
    clone(all(db.recipients).filter((r) => r.campaignId === campaignId && r.status === "pending").sort((a, b) => (a.customerId < b.customerId ? -1 : 1)).slice(0, limit)),
  claimBatch: async (campaignId: string, customerIds: string[], cursor: string) => {
    for (const customerId of customerIds) {
      if (!all(db.recipients).some((r) => r.campaignId === campaignId && r.customerId === customerId)) {
        const row = { id: newId(), campaignId, customerId, status: "pending", error: null };
        db.recipients.set(row.id, row);
      }
    }
    const campaign = db.campaigns.get(campaignId) as Row;
    campaign.cursor = cursor;
    campaign.claimedCount += customerIds.length;
  },
  markSending: async (campaignId: string, customerIds: string[]) => {
    for (const r of all(db.recipients)) if (r.campaignId === campaignId && customerIds.includes(r.customerId) && r.status === "pending") r.status = "sending";
  },
  setRecipientStatus: async (campaignId: string, customerIds: string[], status: string, error: string | null) => {
    for (const r of all(db.recipients)) {
      if (r.campaignId === campaignId && customerIds.includes(r.customerId) && r.status === "sending") Object.assign(r, { status, error });
    }
  },
  recipientCounts: async (campaignId: string) => {
    const counts: Record<string, number> = {};
    for (const r of all(db.recipients)) if (r.campaignId === campaignId) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  },
};

// Helpers the tests use to arrange state.
export const seed = {
  customer: (n: number, over: Row = {}) => {
    const customerId = `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
    const now = Date.now();
    db.stats.set(customerId, {
      customerId,
      orderCount: 2,
      totalSpentPaise: 100_000,
      firstOrderAt: new Date(now - 200 * 86_400_000),
      lastOrderAt: new Date(now - 5 * 86_400_000),
      lastStoreId: null,
      ...over,
    });
    return customerId;
  },
};

const queries: Record<string, object> = {
  CouponQuery, CounterQuery, PackageQuery, LoyaltyQuery, CustomerQuery, NotificationQuery, CampaignQuery,
};
/** For jest.mock factories that stub a whole Query module by its short name ("Coupon", ...). */
export const queryModule = (name: string) => ({ [`${name}Query`]: queries[`${name}Query`] });
