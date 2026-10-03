// An in-memory stand-in for the P07 Query modules (vendors, materials, purchase orders,
// policies, claims) and the store lookup they use. It keeps the semantics the services rely
// on: unique keys with Prisma's error shape, store scoping, conditional updates, and row locks
// held until the transaction ends. SQL and real transactions are covered by the live run.
import crypto from "crypto";

const clone = <T>(value: T): T => structuredClone(value);
const id = () => crypto.randomUUID();
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const uniqueViolation = (constraint: string) =>
  Object.assign(new Error(`Unique constraint failed on the constraint: \`${constraint}\``), { code: "P2002" });

export const state = {
  stores: new Map<string, any>(),
  vendors: new Map<string, any>(),
  agreements: new Map<string, any>(),
  materials: new Map<string, any>(),
  stock: new Map<string, number>(),
  orders: new Map<string, any>(),
  policies: new Map<string, any>(),
  renewals: [] as any[],
  claims: new Map<string, any>(),
  counters: { po: 1000, claim: 1000 },
  locks: new Map<string, Promise<void>>(),
};

export const reset = () => {
  for (const key of ["stores", "vendors", "agreements", "materials", "stock", "orders", "policies", "claims"] as const) {
    state[key].clear();
  }
  state.renewals = [];
  state.counters = { po: 1000, claim: 1000 };
  state.locks.clear();
};

interface Tx {
  held: Map<string, () => void>;
}

const acquire = async (tx: Tx, key: string) => {
  if (tx.held.has(key)) return;
  const previous = state.locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  state.locks.set(key, previous.then(() => mine));
  await previous;
  tx.held.set(key, release);
};

const inTransaction = async <T>(work: (tx: Tx) => Promise<T>): Promise<T> => {
  const tx: Tx = { held: new Map() };
  try {
    return await work(tx);
  } finally {
    for (const release of tx.held.values()) release();
  }
};

const page = <T>(rows: T[], offset: number, limit: number) => ({ items: rows.slice(offset, offset + limit).map(clone), total: rows.length });
const now = () => new Date();

export const seed = {
  store: (extra: Record<string, unknown> = {}) => {
    const store = { id: id(), code: `S${state.stores.size + 1}`, status: "live", ...extra };
    state.stores.set(store.id, store);
    return store as any;
  },
  vendor: async (extra: Record<string, unknown> = {}) =>
    (await vendorQuery.create({ name: "Acme Chemicals", category: "detergent", contactName: null, phone: null, email: null, address: null, gstin: null, paymentTerms: null, bankAccountLast4: null, bankIfsc: null, createdBy: "seed", ...extra } as any)) as any,
  material: async (extra: Record<string, unknown> = {}) =>
    (await materialQuery.create({ name: `Detergent ${state.materials.size + 1}`, category: "detergent", unit: "kg", reorderLevelMilli: 0, preferredVendorId: null, ...extra } as any)) as any,
};

export const storeQuery = {
  findById: async (storeId: string, scope: string | null) => {
    const store = state.stores.get(storeId);
    return store && (!scope || store.id === scope) ? clone(store) : null;
  },
  list: async (scope: string | null, status?: string) =>
    [...state.stores.values()].filter((s) => (!scope || s.id === scope) && (!status || s.status === status)).map(clone),
};

// ------------------------------------------------------------------ vendors
export const vendorQuery = {
  inTransaction,
  create: async (data: any) => {
    if (data.gstin && [...state.vendors.values()].some((v) => v.gstin === data.gstin)) throw uniqueViolation("commerce_vendors_gstin_key");
    const vendor = { id: id(), isActive: true, deactivatedAt: null, deactivationReason: null, createdAt: now(), updatedAt: now(), ...data };
    state.vendors.set(vendor.id, vendor);
    return clone(vendor);
  },
  findById: async (vid: string) => clone(state.vendors.get(vid) ?? null),
  findByIds: async (ids: string[]) => ids.map((i) => state.vendors.get(i)).filter(Boolean).map(clone),
  list: async (f: any) =>
    page(
      [...state.vendors.values()]
        .filter((v) => (!f.category || v.category === f.category) && (f.isActive === undefined || v.isActive === f.isActive) && (!f.q || v.name.toLowerCase().includes(f.q.toLowerCase())))
        .sort((a, b) => a.name.localeCompare(b.name)),
      f.offset,
      f.limit
    ),
  update: async (vid: string, data: any) => {
    if (data.gstin && [...state.vendors.values()].some((v) => v.id !== vid && v.gstin === data.gstin)) throw uniqueViolation("commerce_vendors_gstin_key");
    const vendor = Object.assign(state.vendors.get(vid), data, { updatedAt: now() });
    return clone(vendor);
  },
  switchActive: async (vid: string, expected: boolean, data: any) => {
    const vendor = state.vendors.get(vid);
    if (!vendor || vendor.isActive !== expected) return null;
    return clone(Object.assign(vendor, data));
  },
  createAgreement: async (data: any) => {
    const agreement = { id: id(), documents: [], createdAt: now(), updatedAt: now(), ...data };
    state.agreements.set(agreement.id, agreement);
    return clone(agreement);
  },
  listAgreements: async (vendorId: string, offset: number, limit: number) =>
    page([...state.agreements.values()].filter((a) => a.vendorId === vendorId).sort((a, b) => b.startDate.localeCompare(a.startDate)), offset, limit),
  findAgreement: async (vendorId: string, agreementId: string) => {
    const a = state.agreements.get(agreementId);
    return a && a.vendorId === vendorId ? clone(a) : null;
  },
  lockAgreement: async (vendorId: string, agreementId: string, tx: Tx) => {
    const a = state.agreements.get(agreementId);
    if (!a || a.vendorId !== vendorId) return false;
    await acquire(tx, `agreement:${agreementId}`);
    return true;
  },
  saveAgreementDocuments: async (aid: string, documents: any[]) => clone(Object.assign(state.agreements.get(aid), { documents })),
};

// ---------------------------------------------------------------- materials
export const materialQuery = {
  create: async (data: any) => {
    if ([...state.materials.values()].some((m) => m.name === data.name)) throw uniqueViolation("commerce_materials_name_key");
    const material = { id: id(), createdAt: now(), updatedAt: now(), ...data };
    state.materials.set(material.id, material);
    return clone(material);
  },
  findById: async (mid: string) => clone(state.materials.get(mid) ?? null),
  findByIds: async (ids: string[]) => ids.map((i) => state.materials.get(i)).filter(Boolean).map(clone),
  list: async (offset: number, limit: number) => page([...state.materials.values()].sort((a, b) => a.name.localeCompare(b.name)), offset, limit),
  update: async (mid: string, data: any) => {
    if (data.name && [...state.materials.values()].some((m) => m.id !== mid && m.name === data.name)) throw uniqueViolation("commerce_materials_name_key");
    return clone(Object.assign(state.materials.get(mid), data));
  },
  listWithReorderLevel: async (limit: number) =>
    [...state.materials.values()].filter((m) => m.reorderLevelMilli > 0).sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit).map(clone),
  stockFor: async (materialIds: string[], storeIds: string[]) =>
    [...state.stock].map(([k, quantityMilli]) => ({ materialId: k.split(":")[0], storeId: k.split(":")[1], quantityMilli })).filter((r) => materialIds.includes(r.materialId) && storeIds.includes(r.storeId)),
  addStock: async (materialId: string, storeId: string, quantityMilli: number) => {
    const key = `${materialId}:${storeId}`;
    state.stock.set(key, (state.stock.get(key) ?? 0) + quantityMilli);
  },
};

// ---------------------------------------------------------- purchase orders
const summary = (o: any) => {
  const { items: _i, events: _e, receipts: _r, ...rest } = o;
  return clone(rest);
};

export const purchaseOrderQuery = {
  inTransaction,
  nextNumber: async () => `PO-${++state.counters.po}`,
  create: async (number: string, data: any) => {
    if (data.idempotencyKey && [...state.orders.values()].some((o) => o.createdBy === data.createdBy && o.idempotencyKey === data.idempotencyKey)) {
      throw uniqueViolation("uq_ops_po_idempotency");
    }
    const { items, firstEvent, ...rest } = data;
    const order = {
      id: id(), number, status: "draft", receivedValuePaise: 0, sentAt: null, receivedAt: null, deliveredOnTime: null,
      cancelledAt: null, cancelReason: null, createdAt: now(), updatedAt: now(),
      vendorName: state.vendors.get(data.vendorId).name,
      ...rest,
      items: items.map((i: any) => ({ id: id(), receivedMilli: 0, ...i })),
      events: [{ fromStatus: null, toStatus: "draft", note: null, at: now(), ...firstEvent }],
      receipts: [],
    };
    state.orders.set(order.id, order);
    return clone(order);
  },
  findById: async (oid: string, scope: string | null) => {
    await tick();
    const o = state.orders.get(oid);
    return o && (!scope || o.storeId === scope) ? clone(o) : null;
  },
  findByIdempotencyKey: async (createdBy: string, key: string) =>
    clone([...state.orders.values()].find((o) => o.createdBy === createdBy && o.idempotencyKey === key) ?? null),
  list: async (f: any) =>
    page(
      [...state.orders.values()]
        .filter((o) => (!f.storeId || o.storeId === f.storeId) && (!f.vendorId || o.vendorId === f.vendorId) && (!f.statuses || f.statuses.includes(o.status)))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(summary),
      f.offset,
      f.limit
    ),
  lockInStatus: async (oid: string, scope: string | null, statuses: string[], tx: Tx) => {
    const o = state.orders.get(oid);
    if (!o || (scope && o.storeId !== scope)) return false;
    await acquire(tx, `po:${oid}`);
    return statuses.includes(o.status);
  },
  updateDraft: async (oid: string, _storeId: string, data: any) => {
    const o = state.orders.get(oid);
    const { items, ...fields } = data;
    Object.assign(o, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
    if (items) o.items = items.map((i: any) => ({ id: id(), receivedMilli: 0, ...i }));
  },
  transition: async (oid: string, from: string, data: any, event: any) => {
    await tick();
    const o = state.orders.get(oid);
    if (!o || o.status !== from) return false;
    Object.assign(o, data);
    o.events.push({ ...event, at: now() });
    return true;
  },
  applyReceipt: async (oid: string, a: any) => {
    const o = state.orders.get(oid);
    if (!o || o.status !== a.from) return false;
    o.status = a.status;
    o.receivedValuePaise += a.receivedValueDeltaPaise;
    if (a.receivedAt) Object.assign(o, { receivedAt: a.receivedAt, deliveredOnTime: a.deliveredOnTime });
    for (const u of a.items) o.items.find((i: any) => i.id === u.itemId).receivedMilli = u.receivedMilli;
    o.receipts.push({ id: id(), ...a.receipt, receivedAt: now() });
    o.events.push({ ...a.event, at: now() });
    return true;
  },
  spendByVendor: async (scope: string | null, range: any, vendorId?: string) => {
    const totals = new Map<string, number>();
    for (const o of state.orders.values()) {
      if (!["sent", "partially_received", "received"].includes(o.status)) continue;
      if ((scope && o.storeId !== scope) || (vendorId && o.vendorId !== vendorId)) continue;
      if ((range.from && o.sentAt < range.from) || (range.to && o.sentAt >= range.to)) continue;
      totals.set(o.vendorId, (totals.get(o.vendorId) ?? 0) + o.totalPaise);
    }
    return [...totals].map(([vendorId, spendPaise]) => ({ vendorId, spendPaise })).sort((a, b) => b.spendPaise - a.spendPaise);
  },
  vendorHistory: async (vendorId: string, scope: string | null, range: any) => {
    const mine = [...state.orders.values()].filter((o) => o.vendorId === vendorId && (!scope || o.storeId === scope));
    const cohort = mine.filter((o) => ["sent", "partially_received", "received"].includes(o.status) && (!range.from || o.sentAt >= range.from) && (!range.to || o.sentAt < range.to));
    const open = mine.filter((o) => ["sent", "partially_received"].includes(o.status));
    return {
      orders: cohort.length,
      deliveredOnTime: cohort.filter((o) => o.deliveredOnTime === true).length,
      deliveredLate: cohort.filter((o) => o.deliveredOnTime === false).length,
      totalSpendPaise: cohort.reduce((s, o) => s + o.totalPaise, 0),
      outstandingPaise: open.reduce((s, o) => s + o.totalPaise - o.receivedValuePaise, 0),
    };
  },
  onOrder: async (materialIds: string[], storeIds: string[]) => {
    const sums = new Map<string, any>();
    for (const o of state.orders.values()) {
      if (!["sent", "partially_received"].includes(o.status) || !storeIds.includes(o.storeId)) continue;
      for (const i of o.items) {
        if (!materialIds.includes(i.materialId)) continue;
        const key = `${i.materialId}:${o.storeId}`;
        const row = sums.get(key) ?? { materialId: i.materialId, storeId: o.storeId, quantityMilli: 0 };
        row.quantityMilli += i.quantityMilli - i.receivedMilli;
        sums.set(key, row);
      }
    }
    return [...sums.values()];
  },
};

// ----------------------------------------------------------------- policies
const policyScope = (p: any, scope: string | null) => !scope || p.storeIds.includes(scope);

export const policyQuery = {
  inTransaction,
  create: async (data: any) => {
    const key = data.insurer.toLowerCase();
    if ([...state.policies.values()].some((p) => p.insurer.toLowerCase() === key && p.policyNumber === data.policyNumber)) {
      throw uniqueViolation("uq_ops_policy_insurer_number");
    }
    const policy = { id: id(), cancelledAt: null, cancelReason: null, documents: [], createdAt: now(), updatedAt: now(), ...data };
    state.policies.set(policy.id, policy);
    return clone(policy);
  },
  findById: async (pid: string, scope: string | null) => {
    await tick();
    const p = state.policies.get(pid);
    return p && policyScope(p, scope) ? clone(p) : null;
  },
  lockById: async (pid: string, scope: string | null, tx: Tx) => {
    const p = state.policies.get(pid);
    if (!p || !policyScope(p, scope)) return false;
    await acquire(tx, `policy:${pid}`);
    return true;
  },
  update: async (pid: string, data: any) => {
    const clash = data.policyNumber !== undefined || data.insurer !== undefined;
    const p = state.policies.get(pid);
    const next = { ...p, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) };
    if (clash && [...state.policies.values()].some((x) => x.id !== pid && x.insurer.toLowerCase() === next.insurer.toLowerCase() && x.policyNumber === next.policyNumber)) {
      throw uniqueViolation("uq_ops_policy_insurer_number");
    }
    state.policies.set(pid, next);
    return clone(next);
  },
  list: async (f: any) =>
    page(
      [...state.policies.values()]
        .filter(
          (p) =>
            policyScope(p, f.storeId) &&
            (!f.type || p.type === f.type) &&
            (f.cancelled === undefined || Boolean(p.cancelledAt) === f.cancelled) &&
            (!f.endFrom || p.endDate >= f.endFrom) &&
            (!f.endTo || p.endDate <= f.endTo)
        )
        .sort((a, b) => a.endDate.localeCompare(b.endDate)),
      f.offset,
      f.limit
    ),
  renew: async (pid: string, expectedEnd: string, change: any, renewal: any) => {
    const p = state.policies.get(pid);
    if (!p || p.endDate !== expectedEnd || p.cancelledAt) return false;
    if (change.policyNumber !== p.policyNumber && [...state.policies.values()].some((x) => x.insurer.toLowerCase() === p.insurer.toLowerCase() && x.policyNumber === change.policyNumber)) {
      throw uniqueViolation("uq_ops_policy_insurer_number");
    }
    p.endDate = change.endDate;
    p.policyNumber = change.policyNumber;
    if (change.premiumPaise !== undefined) p.premiumPaise = change.premiumPaise;
    state.renewals.push({ policyId: pid, at: now(), ...renewal });
    return true;
  },
  listRenewals: async (pid: string) => state.renewals.filter((r) => r.policyId === pid).map(clone),
  saveDocuments: async (pid: string, documents: any[]) => clone(Object.assign(state.policies.get(pid), { documents })),
  countStores: async (ids: string[]) => ids.filter((i) => state.stores.has(i)).length,
  findRiderPolicies: async (riderId: string, scope: string | null, limit: number) =>
    [...state.policies.values()]
      .filter((p) => p.type === "rider_vehicle" && p.employeeIds.includes(riderId) && !p.cancelledAt && policyScope(p, scope))
      .sort((a, b) => b.endDate.localeCompare(a.endDate))
      .slice(0, limit)
      .map(clone),
};

// ------------------------------------------------------------------- claims
export const claimQuery = {
  inTransaction,
  nextNumber: async () => `CLM-${++state.counters.claim}`,
  create: async (number: string, data: any) => {
    if (data.idempotencyKey && [...state.claims.values()].some((c) => c.createdBy === data.createdBy && c.idempotencyKey === data.idempotencyKey)) {
      throw uniqueViolation("uq_ops_claim_idempotency");
    }
    const { firstEvent, ...rest } = data;
    const claim = {
      id: id(), number, status: "raised", insurerReference: null, outcome: null, settledAmountPaise: null, settledAt: null,
      decisionSeconds: null, documents: [], raisedAt: now(), updatedAt: now(), ...rest,
      events: [{ fromStatus: null, toStatus: "raised", note: null, at: now(), ...firstEvent }],
    };
    state.claims.set(claim.id, claim);
    return clone(claim);
  },
  findById: async (cid: string) => {
    await tick();
    return clone(state.claims.get(cid) ?? null);
  },
  findByIdempotencyKey: async (createdBy: string, key: string) =>
    clone([...state.claims.values()].find((c) => c.createdBy === createdBy && c.idempotencyKey === key) ?? null),
  list: async (f: any) =>
    page(
      [...state.claims.values()]
        .filter((c) => (!f.status || c.status === f.status) && (!f.policyId || c.policyId === f.policyId) && (!f.from || c.raisedAt >= f.from) && (!f.to || c.raisedAt < f.to))
        .sort((a, b) => b.raisedAt - a.raisedAt),
      f.offset,
      f.limit
    ),
  change: async (cid: string, expected: string, data: any, event: any) => {
    await tick();
    const c = state.claims.get(cid);
    if (!c || c.status !== expected) return false;
    Object.assign(c, data);
    c.events.push({ ...event, at: now() });
    return true;
  },
  lockById: async (cid: string, tx: Tx) => {
    if (!state.claims.has(cid)) return false;
    await acquire(tx, `claim:${cid}`);
    return true;
  },
  saveDocuments: async (cid: string, documents: any[]) => {
    state.claims.get(cid).documents = documents;
  },
  history: async (range: any) => {
    const rows = new Map<string, any>();
    const secs: number[] = [];
    for (const c of state.claims.values()) {
      if ((range.from && c.raisedAt < range.from) || (range.to && c.raisedAt >= range.to)) continue;
      const key = `${c.type}:${c.status}`;
      const row = rows.get(key) ?? { type: c.type, status: c.status, count: 0, claimedPaise: 0, paidPaise: 0 };
      row.count += 1;
      row.claimedPaise += c.claimAmountPaise;
      row.paidPaise += c.settledAmountPaise ?? 0;
      rows.set(key, row);
      if (c.decisionSeconds !== null) secs.push(c.decisionSeconds);
    }
    return { rows: [...rows.values()], averageDecisionSeconds: secs.length ? secs.reduce((a, b) => a + b, 0) / secs.length : null };
  },
};
