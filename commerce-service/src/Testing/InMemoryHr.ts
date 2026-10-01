// An in-memory stand-in for the HR core Query modules, for tests that run the real services
// end to end. It keeps the semantics the services rely on: store scoping, unique keys (with
// Prisma's error shape), the check constraint on leave balances, row locks held until the
// transaction ends, and rollback of a failed transaction. What it cannot prove (SQL,
// indexes, the real lock manager) the live run against Postgres covers.
import crypto from "crypto";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const clone = <T>(value: T): T => structuredClone(value);
const id = () => crypto.randomUUID();
const now = () => new Date();

const uniqueViolation = (constraint: string) =>
  Object.assign(new Error(`Unique constraint failed on the constraint: \`${constraint}\``), { code: "P2002" });

interface Tx {
  held: Map<string, () => void>;
  undo: (() => void)[];
}

const DEFAULT_POLICIES = [
  { type: "casual", annualHalfDays: 24, carryForward: false },
  { type: "sick", annualHalfDays: 24, carryForward: false },
  { type: "earned", annualHalfDays: 30, carryForward: true },
  { type: "other", annualHalfDays: 6, carryForward: false },
  { type: "unpaid", annualHalfDays: 0, carryForward: false },
];
const DEFAULT_TEMPLATE = ["Photo ID collected", "Address proof collected", "Uniform issued"];

export const state = {
  stores: new Map<string, any>(),
  employees: new Map<string, any>(),
  history: [] as any[],
  documents: new Map<string, any>(),
  templates: [] as any[],
  onboarding: new Map<string, any>(),
  attendance: new Map<string, any>(),
  corrections: [] as any[],
  rosters: new Map<string, any>(),
  policies: new Map<string, any>(),
  balances: new Map<string, any>(),
  ledger: [] as any[],
  requests: new Map<string, any>(),
  holidays: new Map<string, any>(),
  plans: new Map<string, any>(),
  reviews: [] as any[],
  paths: new Map<string, any>(),
  reports: new Map<string, any>(),
  reassignments: [] as any[],
  counter: { value: 0 },
  locks: new Map<string, Promise<void>>(),
  // Test hook: make the next ledger append fail, to prove a decision rolls back whole.
  failNextLedger: false,
};

const seedDefaults = () => {
  for (const p of DEFAULT_POLICIES) state.policies.set(p.type, { ...p });
  DEFAULT_TEMPLATE.forEach((title, position) =>
    state.templates.push({ id: id(), role: "default", position, title, category: "documents" })
  );
};

export const reset = () => {
  for (const key of [
    "stores", "employees", "documents", "onboarding", "attendance", "rosters", "policies", "balances",
    "requests", "holidays", "plans", "paths", "reports",
  ] as const) state[key].clear();
  for (const key of ["history", "templates", "corrections", "ledger", "reviews", "reassignments"] as const) state[key].length = 0;
  state.counter.value = 0;
  state.locks.clear();
  state.failNextLedger = false;
  seedDefaults();
};

// FIFO row lock: waiters queue behind the holder and proceed when its transaction ends.
const acquire = async (tx: Tx, key: string) => {
  if (tx.held.has(key)) return;
  const previous = state.locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  state.locks.set(key, previous.then(() => mine));
  await previous;
  tx.held.set(key, release);
};

export const inHrTransaction = async <T>(work: (tx: Tx) => Promise<T>): Promise<T> => {
  const tx: Tx = { held: new Map(), undo: [] };
  try {
    return await work(tx);
  } catch (error) {
    for (const undo of tx.undo.reverse()) undo();
    throw error;
  } finally {
    for (const release of tx.held.values()) release();
  }
};

// Writes go through these so a failed transaction can put everything back.
const put = <V>(map: Map<string, V>, key: string, value: V, tx?: Tx) => {
  const had = map.has(key);
  const previous = map.get(key);
  tx?.undo.push(() => (had ? map.set(key, previous as V) : map.delete(key)));
  map.set(key, value);
};
const push = <V>(list: V[], value: V, tx?: Tx) => {
  list.push(value);
  tx?.undo.push(() => list.splice(list.indexOf(value), 1));
};
const drop = <V>(map: Map<string, V>, key: string, tx?: Tx) => {
  const previous = map.get(key) as V;
  tx?.undo.push(() => map.set(key, previous));
  map.delete(key);
};

const day = (d: Date) => d.getTime();
const inScope = (storeId: string | null, scope: string | null) => !scope || storeId === scope;
const page = <T>(rows: T[], offset: number, limit: number) => rows.slice(offset, offset + limit);
const byName = (a: any, b: any) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

// ------------------------------------------------------------------ stores
export const storeQuery = {
  findById: async (storeId: string, scope: string | null) => {
    const store = state.stores.get(storeId);
    return store && (!scope || store.id === scope) ? clone(store) : null;
  },
  list: async (scope: string | null) => [...state.stores.values()].filter((s) => !scope || s.id === scope).map(clone),
};

// --------------------------------------------------------------- employees
const periodFilter = (scope: string | null, from: Date, to: Date) => (e: any) =>
  inScope(e.storeId, scope) && day(e.joinDate) <= day(to) && (e.status !== "exited" || (e.lastWorkingDay && day(e.lastWorkingDay) >= day(from)));

const assertUniqueEmployee = (data: any, ownId?: string) => {
  for (const e of state.employees.values()) {
    if (e.id === ownId) continue;
    if (data.phone !== undefined && e.phone === data.phone) throw uniqueViolation("commerce_hr_employees_phone_key");
    if (data.gatewayUserId && e.gatewayUserId === data.gatewayUserId) throw uniqueViolation("commerce_hr_employees_gatewayUserId_key");
  }
};

export const employeeQuery = {
  nextCodeNumber: async (tx: Tx) => {
    const previous = state.counter.value;
    tx.undo.push(() => (state.counter.value = previous));
    await acquire(tx, "counter:employee_code");
    state.counter.value += 1;
    return state.counter.value;
  },
  create: async (data: any, code: string, tx: Tx) => {
    assertUniqueEmployee(data);
    const employee = { id: id(), code, lastWorkingDay: null, exitReason: null, createdAt: now(), updatedAt: now(), ...data };
    put(state.employees, employee.id, employee, tx);
    return clone(employee);
  },
  findById: async (employeeId: string, scope: string | null) => {
    const e = state.employees.get(employeeId);
    return e && inScope(e.storeId, scope) ? clone(e) : null;
  },
  lockById: async (employeeId: string, scope: string | null, tx: Tx) => {
    const e = state.employees.get(employeeId);
    if (!e || !inScope(e.storeId, scope)) return null;
    await acquire(tx, `emp:${employeeId}`);
    const fresh = state.employees.get(employeeId);
    return fresh ? clone(fresh) : null;
  },
  findByGatewayUserId: async (userId: string) => {
    const e = [...state.employees.values()].find((x) => x.gatewayUserId === userId);
    return e ? clone(e) : null;
  },
  findByIds: async (ids: string[], scope: string | null) =>
    ids.map((i) => state.employees.get(i)).filter((e) => e && inScope(e.storeId, scope)).map(clone),
  search: async (filter: any) => {
    const q = filter.q?.toLowerCase();
    const digits = filter.q?.replace(/\D/g, "");
    const rows = [...state.employees.values()]
      .filter(
        (e) =>
          inScope(e.storeId, filter.storeId) &&
          (!filter.employeeType || e.employeeType === filter.employeeType) &&
          (!filter.status || e.status === filter.status) &&
          (!q || e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q) || (digits && e.phone.includes(digits)))
      )
      .sort(byName);
    return { items: page(rows, filter.offset, filter.limit).map(clone), total: rows.length };
  },
  listInPeriod: async (scope: string | null, from: Date, to: Date, offset: number, limit: number) => {
    const rows = [...state.employees.values()].filter(periodFilter(scope, from, to)).sort(byName);
    return { items: page(rows, offset, limit).map(clone), total: rows.length };
  },
  update: async (employeeId: string, data: any, tx: Tx) => {
    assertUniqueEmployee(data, employeeId);
    const updated = { ...state.employees.get(employeeId), ...data, updatedAt: now() };
    put(state.employees, employeeId, updated, tx);
    return clone(updated);
  },
  listIds: async (scope: string | null, o: any) =>
    [...state.employees.values()]
      .filter((e) => inScope(e.storeId, scope) && (!o.statuses || o.statuses.includes(e.status)) && (!o.types || o.types.includes(e.employeeType)))
      .map((e) => e.id)
      .sort()
      .slice(o.offset, o.offset + o.limit),
  headcount: async (scope: string | null) => {
    const all = [...state.employees.values()].filter((e) => inScope(e.storeId, scope));
    const live = all.filter((e) => e.status !== "exited");
    const tally = (rows: any[], key: (e: any) => string) =>
      rows.reduce((acc: Record<string, number>, e) => ({ ...acc, [key(e)]: (acc[key(e)] ?? 0) + 1 }), {});
    return {
      byType: tally(live, (e) => e.employeeType),
      byStatus: tally(all, (e) => e.status),
      byStore: tally(live, (e) => e.storeId ?? "unassigned"),
    };
  },
  countExitsSince: async (scope: string | null, since: Date) =>
    [...state.employees.values()].filter((e) => inScope(e.storeId, scope) && e.status === "exited" && e.lastWorkingDay && day(e.lastWorkingDay) >= day(since)).length,
  countExpectedByStore: async (scope: string | null, date: Date) => {
    const out: Record<string, number> = {};
    for (const e of [...state.employees.values()].filter(periodFilter(scope, date, date))) {
      out[e.storeId ?? "unassigned"] = (out[e.storeId ?? "unassigned"] ?? 0) + 1;
    }
    return out;
  },
  appendHistory: async (entries: any[], tx: Tx) => {
    for (const entry of entries) push(state.history, { id: id(), createdAt: now(), ...entry }, tx);
  },
  listHistory: async (employeeId: string, offset: number, limit: number) => {
    const rows = state.history.filter((h) => h.employeeId === employeeId).sort((a, b) => b.createdAt - a.createdAt);
    return { items: page(rows, offset, limit).map(clone), total: rows.length };
  },
};

// --------------------------------------------------------------- documents
export const documentQuery = {
  create: async (data: any) => {
    const doc = { id: id(), uploadedAt: now(), ...data };
    put(state.documents, doc.id, doc);
    return clone(doc);
  },
  list: async (employeeId: string, offset: number, limit: number) => {
    const rows = [...state.documents.values()].filter((d) => d.employeeId === employeeId).sort((a, b) => b.uploadedAt - a.uploadedAt);
    return { items: page(rows, offset, limit).map(clone), total: rows.length };
  },
  remove: async (employeeId: string, docId: string) => {
    const doc = state.documents.get(docId);
    if (!doc || doc.employeeId !== employeeId) return false;
    drop(state.documents, docId);
    return true;
  },
};

export const onboardingQuery = {
  templateItems: async (role: string) =>
    state.templates.filter((t) => t.role === role).sort((a, b) => a.position - b.position).map(({ title, category }) => ({ title, category })),
  replaceTemplate: async (role: string, items: any[], tx: Tx) => {
    const kept = state.templates.filter((t) => t.role !== role);
    const previous = [...state.templates];
    tx.undo.push(() => state.templates.splice(0, state.templates.length, ...previous));
    state.templates.splice(0, state.templates.length, ...kept, ...items.map((item, position) => ({ id: id(), role, position, ...item })));
  },
  createItems: async (employeeId: string, items: any[], tx: Tx) => {
    items.forEach((item, position) => {
      const row = { id: id(), employeeId, position, status: "pending", note: null, doneAt: null, ...item };
      put(state.onboarding, row.id, row, tx);
    });
  },
  listItems: async (employeeId: string) =>
    [...state.onboarding.values()].filter((i) => i.employeeId === employeeId).sort((a, b) => a.position - b.position).map(clone),
  updateItem: async (employeeId: string, itemId: string, change: any) => {
    const item = state.onboarding.get(itemId);
    if (!item || item.employeeId !== employeeId) return null;
    const next = { ...item, status: change.status, doneAt: change.doneAt, ...(change.note !== undefined ? { note: change.note } : {}) };
    put(state.onboarding, itemId, next);
    return clone(next);
  },
};

// -------------------------------------------------------------- attendance
const attendanceKey = (employeeId: string, date: Date) => `${employeeId}:${day(date)}`;

export const attendanceQuery = {
  findDay: async (employeeId: string, date: Date) => {
    const row = state.attendance.get(attendanceKey(employeeId, date));
    return row ? clone(row) : null;
  },
  findOpen: async (employeeId: string, since: Date) => {
    const rows = [...state.attendance.values()]
      .filter((r) => r.employeeId === employeeId && r.clockOut === null && r.clockIn && r.clockIn >= since)
      .sort((a, b) => day(b.date) - day(a.date));
    return rows[0] ? clone(rows[0]) : null;
  },
  create: async (data: any, tx: Tx) => {
    const key = attendanceKey(data.employeeId, data.date);
    if (state.attendance.has(key)) throw uniqueViolation("uq_hr_attendance_employee_date");
    const row = { id: id(), ...data };
    put(state.attendance, key, row, tx);
    return clone(row);
  },
  update: async (rowId: string, data: any, tx: Tx) => {
    const current = [...state.attendance.values()].find((r) => r.id === rowId);
    const next = { ...current, ...data };
    put(state.attendance, attendanceKey(next.employeeId, next.date), next, tx);
    return clone(next);
  },
  listForEmployees: async (ids: string[], from: Date, to: Date) =>
    [...state.attendance.values()].filter((r) => ids.includes(r.employeeId) && day(r.date) >= day(from) && day(r.date) <= day(to)).map(clone),
  countByEmployee: async (ids: string[], from: Date, to: Date) =>
    ids
      .map((employeeId) => {
        const rows = [...state.attendance.values()].filter((r) => r.employeeId === employeeId && day(r.date) >= day(from) && day(r.date) <= day(to));
        return { employeeId, present: rows.filter((r) => r.status === "present").length, late: rows.filter((r) => r.status === "late").length };
      })
      .filter((c) => c.present + c.late > 0),
  countRecorded: async (scope: string | null, date: Date) =>
    [...state.attendance.values()].filter((r) => day(r.date) === day(date) && inScope(r.storeId, scope)).length,
  listStillIn: async (scope: string | null, date: Date, limit: number) =>
    [...state.attendance.values()].filter((r) => day(r.date) === day(date) && r.clockOut === null && r.clockIn && inScope(r.storeId, scope)).slice(0, limit).map(clone),
  createCorrection: async (data: any, tx: Tx) => {
    const row = { id: id(), createdAt: now(), ...data };
    push(state.corrections, row, tx);
    return clone(row);
  },
  listCorrections: async (f: any) => {
    const rows = state.corrections
      .filter(
        (c) =>
          inScope(c.storeId, f.storeId) &&
          (!f.employeeId || c.employeeId === f.employeeId) &&
          (!f.from || day(c.date) >= day(f.from)) &&
          (!f.to || day(c.date) <= day(f.to))
      )
      .sort((a, b) => day(b.date) - day(a.date) || b.createdAt - a.createdAt);
    return { items: page(rows, f.offset, f.limit).map(clone), total: rows.length };
  },
};

export const rosterQuery = {
  create: async (data: any, tx: Tx) => {
    for (const r of state.rosters.values()) {
      if (r.employeeId === data.employeeId && day(r.date) === day(data.date) && r.shiftStartMin === data.shiftStartMin) {
        throw uniqueViolation("uq_hr_roster_employee_shift");
      }
    }
    const { createdByUserId: _by, ...rest } = data;
    const row = { id: id(), ...rest };
    put(state.rosters, row.id, row, tx);
    return clone(row);
  },
  findOverlapping: async (employeeId: string, date: Date, start: number, end: number) =>
    [...state.rosters.values()].filter((r) => r.employeeId === employeeId && day(r.date) === day(date) && r.shiftStartMin < end && r.shiftEndMin > start).length,
  findById: async (rosterId: string, scope: string | null) => {
    const r = state.rosters.get(rosterId);
    return r && inScope(r.storeId, scope) ? clone(r) : null;
  },
  remove: async (rosterId: string) => {
    if (state.rosters.has(rosterId)) drop(state.rosters, rosterId);
  },
  list: async (f: any) => {
    const rows = [...state.rosters.values()]
      .filter((r) => inScope(r.storeId, f.storeId) && (!f.from || day(r.date) >= day(f.from)) && (!f.to || day(r.date) <= day(f.to)))
      .sort((a, b) => day(a.date) - day(b.date) || a.shiftStartMin - b.shiftStartMin);
    return { items: page(rows, f.offset, f.limit).map(clone), total: rows.length };
  },
  firstShiftStart: async (employeeId: string, date: Date) => {
    const starts = [...state.rosters.values()].filter((r) => r.employeeId === employeeId && day(r.date) === day(date)).map((r) => r.shiftStartMin);
    return starts.length ? Math.min(...starts) : null;
  },
  shiftCounts: async (storeId: string, dates: Date[]) => {
    const groups = new Map<string, any>();
    for (const r of state.rosters.values()) {
      if (r.storeId !== storeId || !dates.some((d) => day(d) === day(r.date))) continue;
      const key = `${day(r.date)}:${r.shiftStartMin}:${r.shiftEndMin}`;
      const g = groups.get(key) ?? { date: r.date, shiftStartMin: r.shiftStartMin, shiftEndMin: r.shiftEndMin, rostered: 0 };
      g.rostered += 1;
      groups.set(key, g);
    }
    return [...groups.values()].map(clone);
  },
};

// ------------------------------------------------------------------- leave
const balanceKey = (employeeId: string, type: string, year: number) => `${employeeId}:${type}:${year}`;

const withEmployee = (r: any) => {
  const e = state.employees.get(r.employeeId);
  return { ...clone(r), employeeName: e?.name ?? "", employeeStoreId: e?.storeId ?? null };
};
const requestInScope = (r: any, scope: string | null) => inScope(state.employees.get(r.employeeId)?.storeId ?? null, scope);

export const leaveQuery = {
  listPolicies: async () => [...state.policies.values()].sort((a, b) => a.type.localeCompare(b.type)).map(clone),
  upsertPolicies: async (policies: any[], tx: Tx) => {
    for (const p of policies) put(state.policies, p.type, { ...p }, tx);
  },
  createBalanceIfMissing: async (employeeId: string, type: string, year: number, entitledHalfDays: number, tx: Tx) => {
    const key = balanceKey(employeeId, type, year);
    // An uncommitted insert makes a conflicting insert wait for its transaction, as in Postgres.
    // Only an insert can conflict; an existing row is left alone and takes no lock here.
    if (state.balances.has(key)) return false;
    await acquire(tx, `bal:${key}`);
    if (state.balances.has(key)) return false;
    put(state.balances, key, { id: id(), employeeId, type, year, entitledHalfDays, takenHalfDays: 0 }, tx);
    return true;
  },
  findBalance: async (employeeId: string, type: string, year: number) => {
    const b = state.balances.get(balanceKey(employeeId, type, year));
    return b ? clone(b) : null;
  },
  lockBalance: async (employeeId: string, type: string, year: number, tx: Tx) => {
    if (!state.balances.has(balanceKey(employeeId, type, year))) return null;
    await acquire(tx, `bal:${balanceKey(employeeId, type, year)}`);
    return clone(state.balances.get(balanceKey(employeeId, type, year)));
  },
  addTaken: async (balanceId: string, halfDays: number, tx: Tx) => {
    const current = [...state.balances.values()].find((b) => b.id === balanceId);
    const next = { ...current, takenHalfDays: current.takenHalfDays + halfDays };
    // The table's check constraint: the last line of defence against overspending.
    if (next.takenHalfDays > next.entitledHalfDays) throw new Error("check constraint ck_hr_leave_balance_bounds violated");
    put(state.balances, balanceKey(next.employeeId, next.type, next.year), next, tx);
  },
  listBalances: async (ids: string[], year: number) =>
    [...state.balances.values()].filter((b) => ids.includes(b.employeeId) && b.year === year).map(clone),
  appendLedger: async (entry: any, tx: Tx) => {
    if (state.failNextLedger && entry.kind === "debit") {
      state.failNextLedger = false;
      throw new Error("ledger write failed");
    }
    if (entry.requestId && state.ledger.some((l) => l.requestId === entry.requestId && l.year === entry.year && l.kind === entry.kind)) {
      throw uniqueViolation("uq_hr_leave_ledger_request");
    }
    push(state.ledger, { id: id(), createdAt: now(), ...entry }, tx);
  },
  createRequest: async (data: any, tx: Tx) => {
    const row = {
      id: id(), status: "pending", decidedByUserId: null, decidedByName: null, decidedAt: null, decisionNote: null, createdAt: now(), ...data,
    };
    put(state.requests, row.id, row, tx);
    return withEmployee(row);
  },
  findRequest: async (requestId: string, scope: string | null) => {
    const r = state.requests.get(requestId);
    return r && requestInScope(r, scope) ? withEmployee(r) : null;
  },
  lockRequest: async (requestId: string, scope: string | null, tx: Tx) => {
    const r = state.requests.get(requestId);
    if (!r || !requestInScope(r, scope)) return null;
    await acquire(tx, `req:${requestId}`);
    return withEmployee(state.requests.get(requestId));
  },
  decideRequest: async (requestId: string, decision: any, tx: Tx) => {
    const next = { ...state.requests.get(requestId), ...decision };
    put(state.requests, requestId, next, tx);
    return withEmployee(next);
  },
  withdrawRequest: async (requestId: string, tx: Tx) => {
    const next = { ...state.requests.get(requestId), status: "withdrawn" };
    put(state.requests, requestId, next, tx);
    return withEmployee(next);
  },
  countOverlapping: async (employeeId: string, from: Date, to: Date) =>
    [...state.requests.values()].filter(
      (r) => r.employeeId === employeeId && ["pending", "approved"].includes(r.status) && day(r.fromDate) <= day(to) && day(r.toDate) >= day(from)
    ).length,
  listRequests: async (f: any) => {
    const rows = [...state.requests.values()]
      .filter(
        (r) =>
          requestInScope(r, f.storeId) &&
          (!f.status || r.status === f.status) &&
          (!f.employeeId || r.employeeId === f.employeeId) &&
          (!f.from || day(r.toDate) >= day(f.from)) &&
          (!f.to || day(r.fromDate) <= day(f.to))
      )
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    return { items: page(rows, f.offset, f.limit).map(withEmployee), total: rows.length };
  },
  countByStatus: async (scope: string | null, status: string) =>
    [...state.requests.values()].filter((r) => r.status === status && requestInScope(r, scope)).length,
  listApprovedInRange: async (scope: string | null, from: Date, to: Date, offset: number, limit: number) => {
    const rows = [...state.requests.values()]
      .filter((r) => r.status === "approved" && requestInScope(r, scope) && day(r.fromDate) <= day(to) && day(r.toDate) >= day(from))
      .sort((a, b) => day(a.fromDate) - day(b.fromDate));
    return { items: page(rows, offset, limit).map(withEmployee), total: rows.length };
  },
  approvedForEmployees: async (ids: string[], from: Date, to: Date) =>
    [...state.requests.values()]
      .filter((r) => ids.includes(r.employeeId) && r.status === "approved" && day(r.fromDate) <= day(to) && day(r.toDate) >= day(from))
      .map(({ employeeId, fromDate, toDate, halfDay }) => ({ employeeId, fromDate, toDate, halfDay })),
  countOnLeave: async (scope: string | null, date: Date) =>
    new Set(
      [...state.requests.values()]
        .filter((r) => r.status === "approved" && requestInScope(r, scope) && day(r.fromDate) <= day(date) && day(r.toDate) >= day(date))
        .map((r) => r.employeeId)
    ).size,
};

export const holidayQuery = {
  create: async (data: any) => {
    if ([...state.holidays.values()].some((h) => day(h.date) === day(data.date) && h.name === data.name)) {
      throw uniqueViolation("uq_hr_holiday_date_name");
    }
    const row = { id: id(), ...data };
    put(state.holidays, row.id, row);
    return clone(row);
  },
  remove: async (holidayId: string) => {
    if (!state.holidays.has(holidayId)) return false;
    drop(state.holidays, holidayId);
    return true;
  },
  list: async (from: Date, to: Date, audience: string | null | undefined, offset: number, limit: number) => {
    const rows = [...state.holidays.values()]
      .filter(
        (h) =>
          day(h.date) >= day(from) &&
          day(h.date) <= day(to) &&
          (audience === undefined || h.type !== "store" || (audience !== null && h.storeIds.includes(audience)))
      )
      .sort((a, b) => day(a.date) - day(b.date));
    return { items: page(rows, offset, limit).map(clone), total: rows.length };
  },
  inRange: async (from: Date, to: Date) =>
    [...state.holidays.values()].filter((h) => day(h.date) >= day(from) && day(h.date) <= day(to)).sort((a, b) => day(a.date) - day(b.date)).map(clone),
};

// ------------------------------------------------------------------ career
export const careerQuery = {
  findPlan: async (employeeId: string) => {
    const p = state.plans.get(employeeId);
    return p ? clone(p) : null;
  },
  savePlan: async (employeeId: string, data: any, tx: Tx) => {
    const next = { lastReviewedAt: null, ...state.plans.get(employeeId), employeeId, ...data };
    put(state.plans, employeeId, next, tx);
    return clone(next);
  },
  recordReview: async (employeeId: string, review: any, tx: Tx) => {
    const plan = state.plans.get(employeeId);
    if (!plan) return null;
    put(state.plans, employeeId, { ...plan, lastReviewedAt: review.at }, tx);
    push(state.reviews, { employeeId, ...review }, tx);
    return clone(state.plans.get(employeeId));
  },
  listPaths: async (offset: number, limit: number) => {
    const rows = [...state.paths.values()].sort((a, b) => a.role.localeCompare(b.role));
    return { items: page(rows, offset, limit).map(clone), total: rows.length };
  },
  savePath: async (path: any) => {
    put(state.paths, path.role, { ...path });
    return clone(path);
  },
};

const withName = (r: any) => ({ ...clone(r), employeeName: state.employees.get(r.employeeId)?.name ?? "" });
const reportInScope = (r: any, scope: string | null) => inScope(state.employees.get(r.employeeId)?.storeId ?? null, scope);

export const dailyReportQuery = {
  create: async (data: any) => {
    if ([...state.reports.values()].some((r) => r.employeeId === data.employeeId && day(r.date) === day(data.date))) {
      throw uniqueViolation("uq_hr_daily_report_employee_date");
    }
    const row = { id: id(), createdAt: now(), ...data };
    put(state.reports, row.id, row);
    return withName(row);
  },
  findById: async (reportId: string, scope: string | null) => {
    const r = state.reports.get(reportId);
    return r && reportInScope(r, scope) ? withName(r) : null;
  },
  list: async (f: any) => {
    const rows = [...state.reports.values()]
      .filter(
        (r) =>
          reportInScope(r, f.storeId) &&
          (!f.employeeId || r.employeeId === f.employeeId) &&
          (!f.from || day(r.date) >= day(f.from)) &&
          (!f.to || day(r.date) <= day(f.to))
      )
      .sort((a, b) => day(b.date) - day(a.date) || b.createdAt - a.createdAt);
    return { items: page(rows, f.offset, f.limit).map(withName), total: rows.length };
  },
  blockerThemes: async (scope: string | null, from: Date, to: Date, minCount: number, limit: number) => {
    const counts = new Map<string, number>();
    for (const r of state.reports.values()) {
      if (r.blockerKey && reportInScope(r, scope) && day(r.date) >= day(from) && day(r.date) <= day(to)) {
        counts.set(r.blockerKey, (counts.get(r.blockerKey) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .filter(([, count]) => count >= minCount)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([key, count]) => ({ key, count }));
  },
  blockerExamples: async (scope: string | null, keys: string[], from: Date, to: Date, cap: number) =>
    [...state.reports.values()]
      .filter((r) => keys.includes(r.blockerKey) && reportInScope(r, scope) && day(r.date) >= day(from) && day(r.date) <= day(to))
      .sort((a, b) => day(b.date) - day(a.date))
      .slice(0, cap)
      .map((r) => ({ blockerKey: r.blockerKey, blockers: r.blockers })),
  createReassignment: async (data: any) => {
    const row = { id: id(), ...data };
    push(state.reassignments, row);
    return { id: row.id };
  },
};

// ------------------------------------------------------------------- seeds
export const seed = {
  store: (over: Record<string, unknown> = {}) => {
    const store = { id: id(), code: "BLR-IND", name: "Indiranagar", status: "live", ...over };
    state.stores.set(store.id, store);
    return store;
  },
};

export { tick };
seedDefaults();
