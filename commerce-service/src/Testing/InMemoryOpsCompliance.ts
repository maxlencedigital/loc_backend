// An in-memory stand-in for the P09 Query modules (compliance, audits, incidents, activity)
// for tests that run the real services end to end. It keeps the semantics the services rely
// on: store visibility, unique keys (with Prisma's error shape), guarded conditional updates,
// row locks, and transactions that roll back everything they wrote when they throw.
import crypto from "crypto";

const clone = <T>(value: T): T => structuredClone(value);
const uniqueViolation = (name: string) =>
  Object.assign(new Error(`Unique constraint failed on the constraint: \`${name}\``), { code: "P2002" });
const id = () => crypto.randomUUID();
const now = () => new Date();

export const state = {
  stores: new Map<string, any>(),
  items: new Map<string, any>(),
  renewals: [] as any[],
  audits: new Map<string, any>(),
  findings: new Map<string, any>(),
  incidents: new Map<string, any>(),
  activity: [] as any[],
};

const TABLES = ["stores", "items", "audits", "findings", "incidents"] as const;
let chain: Promise<unknown> = Promise.resolve();

export const reset = () => {
  for (const key of TABLES) state[key].clear();
  state.renewals = [];
  state.activity = [];
  chain = Promise.resolve();
};

const snapshot = () => ({
  maps: TABLES.map((key) => [key, clone([...state[key].entries()])] as const),
  renewals: clone(state.renewals),
  activity: clone(state.activity),
});
const restore = (saved: ReturnType<typeof snapshot>) => {
  for (const [key, entries] of saved.maps) state[key] = new Map(entries);
  state.renewals = saved.renewals;
  state.activity = saved.activity;
};

// Transactions run one at a time, and a failed one leaves nothing behind.
export const inTransaction = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
  const run = chain.then(async () => {
    const saved = snapshot();
    try {
      return await work({});
    } catch (error) {
      restore(saved);
      throw error;
    }
  });
  chain = run.catch(() => undefined);
  return run;
};

const visible = (row: any, scope: string | null) => !scope || row.storeId === scope || row.storeId === null;
const page = <T>(rows: T[], p: { offset: number; limit: number }) => rows.slice(p.offset, p.offset + p.limit);
const time = (d: Date | null | undefined) => (d ? d.getTime() : Infinity);
const SEVERITY = ["low", "medium", "high", "critical"];

// ------------------------------------------------------------------ stores
export const storeQuery = {
  findById: async (storeId: string, scope: string | null) => {
    const store = state.stores.get(storeId);
    return store && (!scope || scope === storeId) ? clone(store) : null;
  },
  list: async () => [...state.stores.values()].map(clone),
};
export const seedStore = (code: string) => {
  const store = { id: id(), code };
  state.stores.set(store.id, store);
  return store;
};

// -------------------------------------------------------------- compliance
const statusRows = (rows: any[], f: { status?: string; today: Date; expiringUntil: Date }) =>
  rows.filter((r) => {
    if (f.status === "expired") return r.expiresOn < f.today;
    if (f.status === "expiring") return r.expiresOn >= f.today && r.expiresOn <= f.expiringUntil;
    if (f.status === "valid") return r.expiresOn > f.expiringUntil;
    return true;
  });

const complianceRows = (scope: string | null, storeId?: string) =>
  [...state.items.values()].filter((r) => visible(r, scope) && (!storeId || r.storeId === storeId));

export const complianceQuery = {
  create: async (data: any) => {
    if ([...state.items.values()].some((r) => r.storeId === data.storeId && r.type === data.type && r.name === data.name)) {
      throw uniqueViolation("uq_compliance_store_type_name");
    }
    const item = { id: id(), checklist: [], documents: [], createdAt: now(), updatedAt: now(), ...data };
    state.items.set(item.id, item);
    return clone(item);
  },
  findById: async (itemId: string, scope: string | null) => {
    const row = state.items.get(itemId);
    return row && visible(row, scope) ? clone(row) : null;
  },
  lockById: async (itemId: string, scope: string | null) => {
    const row = state.items.get(itemId);
    return row && visible(row, scope) ? clone(row) : null;
  },
  update: async (itemId: string, data: any) => {
    const row = state.items.get(itemId);
    const next = { ...row, ...data, updatedAt: now() };
    if ([...state.items.values()].some((r) => r.id !== itemId && r.storeId === next.storeId && r.type === next.type && r.name === next.name)) {
      throw uniqueViolation("uq_compliance_store_type_name");
    }
    state.items.set(itemId, next);
    return clone(next);
  },
  setChecklist: async (itemId: string, checklist: any[]) => complianceQuery.update(itemId, { checklist }),
  setDocuments: async (itemId: string, documents: any[]) => complianceQuery.update(itemId, { documents }),
  renew: async (itemId: string, change: any) =>
    complianceQuery.update(itemId, {
      expiresOn: change.newExpiresOn,
      ...(change.referenceNumber !== undefined ? { referenceNumber: change.referenceNumber } : {}),
    }),
  addRenewal: async (data: any) => {
    const row = { id: id(), renewedAt: now(), ...data };
    state.renewals.push(row);
    return clone(row);
  },
  listRenewals: async (itemId: string, limit: number) =>
    state.renewals.filter((r) => r.itemId === itemId).sort((a, b) => b.renewedAt - a.renewedAt).slice(0, limit).map(clone),
  search: async (f: any, p: any) => {
    const rows = statusRows(complianceRows(f.scope, f.storeId), f)
      .filter((r) => !f.type || r.type === f.type)
      .sort((a, b) => a.expiresOn - b.expiresOn);
    return { items: page(rows, p).map(clone), total: rows.length };
  },
  searchDue: async (f: any, p: any) => {
    const rows = complianceRows(f.scope, f.storeId).filter((r) => r.expiresOn <= f.until).sort((a, b) => a.expiresOn - b.expiresOn);
    return { items: page(rows, p).map(clone), total: rows.length };
  },
  countByStatus: async (scope: string | null, storeId: string | undefined, today: Date, expiringUntil: Date) => {
    const base = complianceRows(scope, storeId);
    const count = (status: string) => statusRows(base, { status, today, expiringUntil }).length;
    return { expired: count("expired"), expiring: count("expiring"), valid: count("valid") };
  },
};

// ------------------------------------------------------------------ audits
const OPEN = ["open", "in_progress"];

export const auditQuery = {
  create: async (data: any) => {
    const audit = {
      id: id(), status: "scheduled", startedAt: null, completedAt: null, summary: null, waiverReason: null,
      cancelReason: null, cancelledAt: null, createdAt: now(), updatedAt: now(), ...data,
    };
    state.audits.set(audit.id, audit);
    return clone(audit);
  },
  findById: async (auditId: string, scope: string | null) => {
    const row = state.audits.get(auditId);
    return row && visible(row, scope) ? clone(row) : null;
  },
  lockById: async (auditId: string, scope: string | null) => auditQuery.findById(auditId, scope),
  changeIfStatus: async (auditId: string, expected: string[], change: any) => {
    const row = state.audits.get(auditId);
    if (!row || !expected.includes(row.status)) return null;
    state.audits.set(auditId, { ...row, ...change, updatedAt: now() });
    return clone(state.audits.get(auditId));
  },
  search: async (f: any, p: any) => {
    const rows = [...state.audits.values()]
      .filter((r) => visible(r, f.scope) && (!f.storeId || r.storeId === f.storeId) && (!f.status || r.status === f.status) && (!f.type || r.type === f.type))
      .sort((a, b) => b.scheduledFor - a.scheduledFor);
    return { items: page(rows, p).map(clone), total: rows.length };
  },
  openFindingCounts: async (auditIds: string[]) => {
    const map = new Map<string, number>();
    for (const f of state.findings.values()) {
      if (auditIds.includes(f.auditId) && OPEN.includes(f.status)) map.set(f.auditId, (map.get(f.auditId) ?? 0) + 1);
    }
    return map;
  },
  countFindings: async (auditId: string) => [...state.findings.values()].filter((f) => f.auditId === auditId).length,
  openCriticalFindingIds: async (auditId: string) =>
    [...state.findings.values()].filter((f) => f.auditId === auditId && f.severity === "critical" && OPEN.includes(f.status)).map((f) => f.id),
  createFinding: async (data: any) => {
    const finding = {
      id: id(), status: "open", correctiveAction: null, evidence: null, closedAt: null, closedBy: null,
      createdAt: now(), updatedAt: now(), ...data,
    };
    state.findings.set(finding.id, finding);
    return clone(finding);
  },
  findFindingById: async (findingId: string, scope: string | null) => {
    const row = state.findings.get(findingId);
    return row && visible(row, scope) ? clone(row) : null;
  },
  changeFindingIfStatus: async (findingId: string, expected: string, change: any) => {
    const row = state.findings.get(findingId);
    if (!row || row.status !== expected) return null;
    state.findings.set(findingId, { ...row, ...change, updatedAt: now() });
    return clone(state.findings.get(findingId));
  },
  searchFindings: async (auditId: string, p: any) => {
    const rows = [...state.findings.values()].filter((f) => f.auditId === auditId)
      .sort((a, b) => SEVERITY.indexOf(b.severity) - SEVERITY.indexOf(a.severity) || a.createdAt - b.createdAt);
    return { items: page(rows, p).map(clone), total: rows.length };
  },
  searchOpenFindings: async (f: any, p: any) => {
    const rows = [...state.findings.values()]
      .filter((r) => visible(r, f.scope) && OPEN.includes(r.status) && (!f.severity || r.severity === f.severity) &&
        (!f.ownerId || r.ownerId === f.ownerId) && (!f.overdueBefore || (r.dueDate && r.dueDate < f.overdueBefore)))
      .sort((a, b) => SEVERITY.indexOf(b.severity) - SEVERITY.indexOf(a.severity) || time(a.dueDate) - time(b.dueDate));
    return { items: page(rows, p).map(clone), total: rows.length };
  },
};

// --------------------------------------------------------------- incidents
const accessOk = (row: any, access: { storeId: string | null; reportedBy?: string }) =>
  (!access.storeId || row.storeId === access.storeId) && (!access.reportedBy || row.reportedBy === access.reportedBy);

const incidentView = ({ idempotencyKey: _k, ...row }: any) => clone(row);

export const incidentQuery = {
  create: async (data: any) => {
    if (data.idempotencyKey && [...state.incidents.values()].some((r) => r.reportedBy === data.reportedBy && r.idempotencyKey === data.idempotencyKey)) {
      throw uniqueViolation("uq_incident_reporter_key");
    }
    const incident = {
      id: id(), status: "open", assigneeId: null, assignedAt: null, escalatedAt: null, escalationReason: null, photos: [],
      actionCount: 0, closedAt: null, closedBy: null, outcome: null, rootCause: null, preventiveMeasures: null,
      claimId: null, claimedAt: null, createdAt: now(), updatedAt: now(), ...data,
    };
    state.incidents.set(incident.id, incident);
    return incidentView(incident);
  },
  findById: async (incidentId: string, access: any) => {
    const row = state.incidents.get(incidentId);
    return row && accessOk(row, access) ? incidentView(row) : null;
  },
  findByKey: async (reportedBy: string, key: string) => {
    const row = [...state.incidents.values()].find((r) => r.reportedBy === reportedBy && r.idempotencyKey === key);
    return row ? incidentView(row) : null;
  },
  lockById: async (incidentId: string, access: any) => incidentQuery.findById(incidentId, access),
  setPhotos: async (incidentId: string, photos: any[]) => {
    const row = { ...state.incidents.get(incidentId), photos, updatedAt: now() };
    state.incidents.set(incidentId, row);
    return incidentView(row);
  },
  change: async (incidentId: string, change: any) => {
    const row = state.incidents.get(incidentId);
    if (!row || row.status !== change.expectedStatus) return null;
    if (change.expectedSeverity && row.severity !== change.expectedSeverity) return null;
    if (change.addAction && row.actionCount >= change.addAction.cap) return null;
    const next = { ...row, ...change.data, actionCount: row.actionCount + (change.addAction ? 1 : 0), updatedAt: now() };
    state.incidents.set(incidentId, next);
    return incidentView(next);
  },
  recordClaim: async (incidentId: string, claimId: string, claimedAt: Date) => {
    const row = state.incidents.get(incidentId);
    if (!row || row.claimId) return false;
    state.incidents.set(incidentId, { ...row, claimId, claimedAt });
    return true;
  },
  search: async (f: any, p: any) => {
    const rows = [...state.incidents.values()]
      .filter((r) => (!f.storeId || r.storeId === f.storeId) && (!f.status || r.status === f.status) && (!f.type || r.type === f.type) &&
        (!f.severity || r.severity === f.severity) && (!f.from || r.occurredAt >= f.from) && (!f.to || r.occurredAt < f.to))
      .sort((a, b) => b.occurredAt - a.occurredAt);
    return { items: page(rows, p).map(incidentView), total: rows.length };
  },
  searchEscalated: async (storeId: string | null, p: any) => {
    const rows = [...state.incidents.values()].filter((r) => r.status === "escalated" && (!storeId || r.storeId === storeId))
      .sort((a, b) => b.escalatedAt - a.escalatedAt);
    return { items: page(rows, p).map(incidentView), total: rows.length };
  },
  summarise: async (f: any) => {
    const rows = [...state.incidents.values()].filter((r) => (!f.storeId || r.storeId === f.storeId) &&
      (!f.from || r.occurredAt >= f.from) && (!f.to || r.occurredAt < f.to));
    const group = (key: string) => {
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(r[key], (counts.get(r[key]) ?? 0) + 1);
      return [...counts].map(([k, count]) => ({ key: k, count }));
    };
    const pairs = new Map<string, any>();
    for (const r of rows) {
      const k = `${r.type}|${r.storeId}`;
      pairs.set(k, { type: r.type, storeId: r.storeId, count: (pairs.get(k)?.count ?? 0) + 1 });
    }
    return {
      open: rows.filter((r) => r.status !== "closed").length,
      byType: group("type"),
      bySeverity: group("severity"),
      repeats: [...pairs.values()].filter((x) => x.count >= 2).sort((a, b) => b.count - a.count),
    };
  },
};

// ---------------------------------------------------------------- activity
export const activityQuery = {
  append: async (data: any) => {
    state.activity.push({ id: id(), at: now(), ...clone(data) });
  },
  forEntity: async (entity: string, entityId: string, limit: number) =>
    state.activity.filter((r) => r.entity === entity && r.entityId === entityId).slice(-limit).map(clone),
  forEntities: async (entity: string, ids: string[], action: string, limit: number) =>
    state.activity.filter((r) => r.entity === entity && r.action === action && ids.includes(r.entityId)).slice(0, limit).map(clone),
  search: async (f: any, p: any) => {
    const rows = state.activity
      .filter((r) => r.at >= f.from && r.at < f.to && (!f.actorId || r.actorId === f.actorId) && (!f.entity || r.entity === f.entity) &&
        (!f.action || r.action === f.action) && visible(r, f.scope))
      .sort((a, b) => b.at - a.at);
    return { items: page(rows, p).map(clone), total: rows.length };
  },
};
