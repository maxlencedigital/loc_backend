// An in-memory stand-in for the store-admin Query modules, for tests that run the real services.
// It keeps the semantics the services rely on: the per-day lock (transactions on one day queue),
// unique keys with Prisma's error shape, append-only rows and store scoping. SQL itself, real
// transactions and the raw queries are proven by the live run instead.
import crypto from "crypto";

const uniqueViolation = (constraint: string) =>
  Object.assign(new Error(`Unique constraint failed on the constraint: \`${constraint}\``), { code: "P2002" });

export const state: any = {};
export const reset = () => {
  Object.assign(state, {
    stores: new Map<string, any>(),
    days: new Map<string, any>(),
    counts: [] as any[],
    deposits: [] as any[],
    variances: [] as any[],
    cashSales: new Map<string, number>(),
    chain: Promise.resolve(),
    areas: new Map<string, any>(),
    members: [] as { areaId: string; storeId: string }[],
    overrides: [] as any[],
    history: [] as any[],
    movements: [] as any[],
    stock: new Map<string, number>(),
    flags: [] as any[],
    invalidations: 0,
    openOrders: new Map<string, number>(),
  });
};
reset();

const id = () => crypto.randomUUID();
const clone = <T>(value: T): T => structuredClone(value);
const dayKey = (storeId: string, date: string) => `${storeId}|${date}`;

export const seedStore = (data: Record<string, unknown> = {}) => {
  const store = { id: id(), code: "S", name: "Store", status: "live", ...data };
  state.stores.set(store.id, store);
  return store as any;
};

export const storeQuery = {
  findById: async (storeId: string, scope: string | null) => {
    const store = state.stores.get(storeId);
    return store && (!scope || store.id === scope) ? clone(store) : null;
  },
  update: async (storeId: string, data: any) => {
    Object.assign(state.stores.get(storeId), data);
    return clone(state.stores.get(storeId));
  },
};

export const orderQuery = {
  countByStatus: async (storeId: string) => ({ washing: state.openOrders.get(storeId) ?? 0 }),
};

// Transactions run one after another, which is what the real day row lock does.
const serial = <T>(work: () => Promise<T>): Promise<T> => {
  const run = state.chain.then(work);
  state.chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
};

const latest = (storeId: string, date: string) =>
  [...state.counts].reverse().find((c: any) => c.storeId === storeId && c.date === date) ?? null;

export const cashQuery = {
  inTransaction: serial,
  findDay: async (storeId: string, date: string) => clone(state.days.get(dayKey(storeId, date)) ?? null),
  lockDay: async (storeId: string, date: string) => {
    const key = dayKey(storeId, date);
    if (!state.days.has(key)) state.days.set(key, { id: id(), storeId, date, state: "open", closedAt: null });
    return clone(state.days.get(key));
  },
  sumCashSales: async (storeId: string, date: string) => state.cashSales.get(dayKey(storeId, date)) ?? 0,
  dayTotals: async (storeId: string, date: string) => {
    const deposits = state.deposits.filter((d: any) => d.storeId === storeId && d.date === date);
    return {
      latestCount: clone(latest(storeId, date)),
      depositedPaise: deposits.reduce((sum: number, d: any) => sum + d.amountPaise, 0),
      depositCount: deposits.length,
    };
  },
  createCount: async (data: any) => {
    const count = { id: id(), createdAt: new Date(), variancePaise: data.countedPaise - data.expectedPaise, ...data };
    state.counts.push(count);
    for (const v of state.variances) {
      if (v.storeId === data.storeId && v.date === data.date && v.status === "open") v.status = "resolved";
    }
    if (count.variancePaise !== 0) {
      state.variances.push({ id: id(), storeId: data.storeId, date: data.date, amountPaise: count.variancePaise, status: "open" });
    }
    const day = state.days.get(dayKey(data.storeId, data.date));
    if (day.state === "open") day.state = "counted";
    return clone(count);
  },
  createDeposit: async (data: any) => {
    if (state.deposits.some((d: any) => d.storeId === data.storeId && d.bankReference === data.bankReference)) {
      throw uniqueViolation("uq_cash_deposit_reference");
    }
    const deposit = { id: id(), ...data };
    state.deposits.push(deposit);
    return clone(deposit);
  },
  closeDay: async (dayId: string, storeId: string, date: string, close: any) => {
    const day = [...state.days.values()].find((d: any) => d.id === dayId);
    if (day.state === "closed") return false;
    Object.assign(day, {
      state: "closed",
      closedAt: close.closedAt,
      closedByName: close.closedByName,
      closeNote: close.closeNote,
      closedExpectedPaise: close.expectedPaise,
      closedCountedPaise: close.countedPaise,
      closedVariancePaise: close.variancePaise,
    });
    for (const v of state.variances) if (v.storeId === storeId && v.date === date && v.status === "open") v.status = "explained";
    return true;
  },
  listUnresolvedVariances: async (storeId: string, page: any) => {
    const items = state.variances.filter((v: any) => v.storeId === storeId && v.status !== "resolved");
    return { items: clone(items.slice(page.offset, page.offset + page.limit)), page: page.page, limit: page.limit, total: items.length };
  },
};

// ----------------------------------------------------------------- stock
const stockKey = (storeId: string, itemId: string) => `${storeId}|${itemId}`;

export const stockQuery = {
  findMaterial: async (itemId: string) => (itemId === state.materialId ? { id: itemId, name: "Detergent" } : null),
  findMovementByKey: async (storeId: string, itemId: string, key: string) =>
    clone(state.movements.find((m: any) => m.storeId === storeId && m.itemId === itemId && m.idempotencyKey === key) ?? null),
  inTransaction: serial,
  applyMovement: async (data: any) => {
    const key = stockKey(data.storeId, data.itemId);
    const have = state.stock.get(key) ?? 0;
    if (data.deltaMilli < 0 && have < -data.deltaMilli) return null;
    if (data.idempotencyKey && state.movements.some((m: any) => m.itemId === data.itemId && m.idempotencyKey === data.idempotencyKey)) {
      throw uniqueViolation("uq_stock_movement_key");
    }
    state.stock.set(key, have + data.deltaMilli);
    const movement = { id: id(), createdAt: new Date(), quantityAfterMilli: have + data.deltaMilli, ...data };
    state.movements.push(movement);
    return clone(movement);
  },
  select: async (query: any) => {
    const rows = state.stockRows ?? [];
    const found = rows.filter((r: any) => (!query.itemId || r.id === query.itemId)).slice(query.offset, query.offset + query.limit);
    return { rows: clone(found), total: rows.length };
  },
  count: async () => (state.stockRows ?? []).length,
  upsertFlag: async (data: any) => {
    state.flags = state.flags.filter((f: any) => f.itemId !== data.itemId);
    state.flags.push(data);
    const row = (state.stockRows ?? []).find((r: any) => r.id === data.itemId);
    Object.assign(row, { flagLevel: data.level, flagNote: data.note, flagRaisedBy: data.byName, flagRaisedAt: new Date() });
  },
};

// ------------------------------------------------------------------ areas
export const areaQuery = {
  inTransaction: async (work: (tx: unknown) => Promise<unknown>) => work({}),
  findArea: async (areaId: string, onlyStore: string | null) => {
    const area = state.areas.get(areaId);
    if (!area) return null;
    const members = state.members.filter((m: any) => m.areaId === areaId).map((m: any) => m.storeId);
    if (onlyStore && !members.includes(onlyStore)) return null;
    return clone({ ...area, storeIds: onlyStore ? [onlyStore] : members });
  },
  createArea: async (data: any) => {
    if ([...state.areas.values()].some((a: any) => a.name === data.name)) throw uniqueViolation("uq_store_area_name");
    const area = { id: id(), createdAt: new Date(), updatedAt: new Date(), ...data };
    state.areas.set(area.id, area);
    return area.id;
  },
  setMembers: async (areaId: string, storeIds: string[]) => {
    for (const storeId of storeIds) {
      if (state.members.some((m: any) => m.storeId === storeId && m.areaId !== areaId)) throw uniqueViolation("uq_area_member_store");
    }
    state.members = state.members.filter((m: any) => m.areaId !== areaId).concat(storeIds.map((storeId) => ({ areaId, storeId })));
  },
  countMembers: async (areaId: string) => state.members.filter((m: any) => m.areaId === areaId).length,
  deleteArea: async (areaId: string) => void state.areas.delete(areaId),
  updateArea: async (areaId: string, data: any) => void Object.assign(state.areas.get(areaId), data),
  existingStoreIds: async (ids: string[]) => ids.filter((x) => state.stores.has(x)),
};

// ---------------------------------------------------------------- pricing
export const pricingQuery = {
  inTransaction: serial,
  lockPricing: async () => undefined,
  listOverrides: async (scope: string, scopeId: string) => clone(state.overrides.filter((o: any) => o.scope === scope && o.scopeId === scopeId)),
  findOverride: async (scope: string, scopeId: string, overrideId: string) =>
    clone(state.overrides.find((o: any) => o.id === overrideId && o.scope === scope && o.scopeId === scopeId) ?? null),
  deleteOverrides: async (ids: string[]) => void (state.overrides = state.overrides.filter((o: any) => !ids.includes(o.id))),
  createOverrides: async (scope: string, scopeId: string, rows: any[]) => {
    for (const row of rows) state.overrides.push({ id: id(), scope, scopeId, updatedAt: new Date(), ...row });
  },
  createHistory: async (changes: any[]) => void state.history.push(...changes.map((c) => ({ id: id(), at: new Date(), ...c }))),
  listHistory: async (_filter: any, page: any) => ({ items: clone(state.history), page: page.page, limit: page.limit, total: state.history.length }),
  listGarmentTypes: async () => clone(state.garmentTypes ?? []),
  listGeneralListRows: async () => [],
  areaIdOfStore: async () => null,
  latestUpdate: async () => null,
};

export const overlayQuery = {
  overlayLists: async () => [],
  invalidatePricing: async () => void (state.invalidations += 1),
};

export const catalogQuery = {
  findServicesByIds: async (ids: string[]) => ids.filter((x) => x === state.serviceId).map((x) => ({ id: x })),
  findActiveForPricing: async () => [],
};
