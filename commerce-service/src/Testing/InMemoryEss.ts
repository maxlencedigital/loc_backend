// An in-memory stand-in for the two Query modules of employee self-service: the idempotency claims
// (unique per employee, operation and key, with Prisma's error shape) and the incident list.
// Every call yields to the event loop first so concurrent requests really interleave.
import crypto from "crypto";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export const ess = {
  claims: new Map<string, { id: string; employeeId: string; operation: string; key: string; resourceId: string | null; createdAt: Date }>(),
  incidents: [] as any[],
};

export const resetEss = () => {
  ess.claims.clear();
  ess.incidents.length = 0;
};

const keyOf = (employeeId: string, operation: string, key: string) => `${employeeId}|${operation}|${key}`;

export const idempotencyQuery = {
  insert: async (employeeId: string, operation: string, key: string) => {
    await tick();
    const k = keyOf(employeeId, operation, key);
    if (ess.claims.has(k)) return null;
    const row = { id: crypto.randomUUID(), employeeId, operation, key, resourceId: null, createdAt: new Date() };
    ess.claims.set(k, row);
    return { id: row.id, resourceId: null };
  },
  find: async (employeeId: string, operation: string, key: string) => {
    await tick();
    const row = ess.claims.get(keyOf(employeeId, operation, key));
    return row ? { id: row.id, resourceId: row.resourceId } : null;
  },
  releaseStale: async (employeeId: string, operation: string, key: string, olderThan: Date) => {
    await tick();
    const k = keyOf(employeeId, operation, key);
    const row = ess.claims.get(k);
    if (!row || row.resourceId !== null || row.createdAt >= olderThan) return false;
    ess.claims.delete(k);
    return true;
  },
  setResource: async (id: string, resourceId: string) => {
    await tick();
    for (const row of ess.claims.values()) if (row.id === id && row.resourceId === null) row.resourceId = resourceId;
  },
  release: async (id: string) => {
    await tick();
    for (const [k, row] of ess.claims) if (row.id === id && row.resourceId === null) ess.claims.delete(k);
  },
};

export const incidentQuery = {
  listReportedBy: async (userId: string, page: { offset: number; limit: number }) => {
    await tick();
    const rows = ess.incidents
      .filter((i) => i.reportedBy === userId)
      .sort((a, b) => b.occurredAt - a.occurredAt || a.id.localeCompare(b.id));
    return { items: rows.slice(page.offset, page.offset + page.limit).map(({ reportedBy: _r, ...i }) => i), total: rows.length };
  },
};
