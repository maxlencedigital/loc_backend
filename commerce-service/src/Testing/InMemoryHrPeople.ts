// An in-memory stand-in for the HR people Query modules (training, appraisals, pay,
// grievances) and for the few HR core queries they read, for tests that run the real
// services end to end. It keeps what the rules lean on: unique keys (in Prisma's error
// shape), conditional updates that are atomic, row locks held until the transaction ends
// and rollback of a failed transaction. Every call yields to the event loop first, so two
// requests really interleave. Real SQL, indexes and the lock manager are covered by the
// live run against Postgres.
import crypto from "crypto";
import { clock } from "../Utils/HrDate.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const clone = <T>(value: T): T => structuredClone(value);
const id = () => crypto.randomUUID();
// The tests fix the clock; rows are stamped by it, as the database default would stamp them.
const now = () => clock.now();

const uniqueViolation = (constraint: string) =>
  Object.assign(new Error(`Unique constraint failed on the constraint: \`${constraint}\``), { code: "P2002" });

interface Tx {
  held: Map<string, () => void>;
  undo: (() => void)[];
}

export const state = {
  employees: new Map<string, any>(),
  attendance: [] as any[],
  leave: [] as any[],
  holidays: [] as any[],
  courses: new Map<string, any>(),
  requirements: [] as any[],
  assignments: new Map<string, any>(),
  appraisals: new Map<string, any>(),
  compensation: [] as any[],
  schemes: new Map<string, any>(),
  schemeAssignments: [] as any[],
  metrics: new Map<string, any>(),
  earnings: new Map<string, any>(),
  payouts: [] as any[],
  grievances: new Map<string, any>(),
  notes: [] as any[],
  requests: new Map<string, any>(),
  locks: new Map<string, Promise<void>>(),
  // Test hook: make the next note append fail, to prove a transition rolls back whole.
  failNextNote: false,
};

export const reset = () => {
  for (const key of ["employees", "courses", "assignments", "appraisals", "schemes", "metrics", "earnings", "grievances", "requests"] as const) state[key].clear();
  for (const key of ["attendance", "leave", "holidays", "requirements", "compensation", "schemeAssignments", "payouts", "notes"] as const) state[key].length = 0;
  state.locks.clear();
  state.failNextNote = false;
};

// ------------------------------------------------------------ transactions

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
const removeWhere = <V>(list: V[], test: (v: V) => boolean, tx?: Tx) => {
  const removed = list.filter(test);
  for (const r of removed) list.splice(list.indexOf(r), 1);
  tx?.undo.push(() => list.push(...removed));
};

const page = <T>(rows: T[], offset: number, limit: number) => rows.slice(offset, offset + limit);
const desc = (a: Date, b: Date) => b.getTime() - a.getTime();
const inScope = (storeId: string | null, scope: string | null) => !scope || storeId === scope;

// --------------------------------------------------------------- HR core reads

const periodFilter = (scope: string | null, from: Date, to: Date) => (e: any) =>
  inScope(e.storeId, scope) && e.joinDate <= to && (e.status !== "exited" || (e.lastWorkingDay && e.lastWorkingDay >= from));

export const employeeQuery = {
  findById: async (employeeId: string, scope: string | null) => {
    await tick();
    const e = state.employees.get(employeeId);
    return e && inScope(e.storeId, scope) ? clone(e) : null;
  },
  findByIds: async (ids: string[], scope: string | null) => {
    await tick();
    return ids.map((i) => state.employees.get(i)).filter((e) => e && inScope(e.storeId, scope)).map(clone);
  },
  findByGatewayUserId: async (userId: string) => {
    await tick();
    const e = [...state.employees.values()].find((x) => x.gatewayUserId === userId);
    return e ? clone(e) : null;
  },
  lockById: async (employeeId: string, scope: string | null, tx: Tx) => {
    const e = state.employees.get(employeeId);
    if (!e || !inScope(e.storeId, scope)) return null;
    await acquire(tx, `emp:${employeeId}`);
    return clone(state.employees.get(employeeId));
  },
  listIds: async (scope: string | null, o: any) => {
    await tick();
    return page(
      [...state.employees.values()]
        .filter((e) => inScope(e.storeId, scope) && (!o.statuses || o.statuses.includes(e.status)) && (!o.types || o.types.includes(e.employeeType)))
        .map((e) => e.id)
        .sort(),
      o.offset,
      o.limit
    );
  },
  listInPeriod: async (scope: string | null, from: Date, to: Date, offset: number, limit: number) => {
    await tick();
    const rows = [...state.employees.values()].filter(periodFilter(scope, from, to)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return { items: page(rows, offset, limit).map(clone), total: rows.length };
  },
};

export const attendanceQuery = {
  countByEmployee: async (ids: string[], from: Date, to: Date) => {
    await tick();
    return ids
      .map((employeeId) => {
        const rows = state.attendance.filter((a) => a.employeeId === employeeId && a.date >= from && a.date <= to);
        return { employeeId, present: rows.filter((r) => r.status === "present").length, late: rows.filter((r) => r.status === "late").length };
      })
      .filter((c) => c.present + c.late > 0);
  },
  listForEmployees: async (ids: string[], from: Date, to: Date) => {
    await tick();
    return state.attendance.filter((a) => ids.includes(a.employeeId) && a.date >= from && a.date <= to).map(clone);
  },
};

export const leaveQuery = {
  approvedForEmployees: async (ids: string[], from: Date, to: Date) => {
    await tick();
    return state.leave.filter((l) => ids.includes(l.employeeId) && l.fromDate <= to && l.toDate >= from).map(clone);
  },
};

export const holidayQuery = {
  inRange: async (from: Date, to: Date) => {
    await tick();
    return state.holidays.filter((h) => h.date >= from && h.date <= to).map(clone);
  },
};

// ---------------------------------------------------------------- training

const OPEN = ["assigned", "in_progress"];
const courseOf = (courseId: string) => state.courses.get(courseId);
const assignmentView = (a: any) => ({ ...clone(a), courseTitle: courseOf(a.courseId).title, courseMaterialUrl: courseOf(a.courseId).materialUrl ?? null });
const strip = (c: any) => clone(c);

export const trainingQuery = {
  createCourse: async (data: any) => {
    await tick();
    const course = { id: id(), createdAt: now(), updatedAt: now(), deletedAt: null, ...data };
    state.courses.set(course.id, course);
    return strip(course);
  },
  findCourse: async (courseId: string) => {
    await tick();
    const c = state.courses.get(courseId);
    return c && !c.deletedAt ? strip(c) : null;
  },
  listCourses: async (offset: number, limit: number) => {
    await tick();
    const rows = [...state.courses.values()].filter((c) => !c.deletedAt).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    return { items: page(rows, offset, limit).map(strip), total: rows.length };
  },
  lockCourse: async (courseId: string, tx: Tx) => {
    const c = state.courses.get(courseId);
    if (!c || c.deletedAt) return null;
    await acquire(tx, `course:${courseId}`);
    const fresh = state.courses.get(courseId);
    return fresh && !fresh.deletedAt ? strip(fresh) : null;
  },
  updateCourse: async (courseId: string, data: any) => {
    await tick();
    const c = state.courses.get(courseId);
    if (!c || c.deletedAt) return null;
    Object.assign(c, data, { updatedAt: now() });
    return strip(c);
  },
  retireCourse: async (courseId: string, at: Date, tx: Tx) => {
    const c = state.courses.get(courseId);
    if (!c || c.deletedAt) return false;
    await acquire(tx, `course:${courseId}`);
    const fresh = state.courses.get(courseId);
    if (!fresh || fresh.deletedAt) return false;
    tx.undo.push(() => (fresh.deletedAt = null));
    fresh.deletedAt = at;
    return true;
  },
  liveCourseIds: async (ids: string[]) => {
    await tick();
    return ids.filter((i) => state.courses.get(i) && !state.courses.get(i).deletedAt);
  },
  countOpenForCourse: async (courseId: string) => {
    await tick();
    return [...state.assignments.values()].filter((a) => a.courseId === courseId && OPEN.includes(a.status)).length;
  },
  removeRequirementsForCourse: async (courseId: string, tx: Tx) => removeWhere(state.requirements, (r) => r.courseId === courseId, tx),
  listRequirements: async () => {
    await tick();
    return clone([...state.requirements].sort((a, b) => a.roleKey.localeCompare(b.roleKey) || a.courseId.localeCompare(b.courseId)));
  },
  replaceRequirements: async (roleKey: string, courseIds: string[], tx: Tx) => {
    removeWhere(state.requirements, (r) => r.roleKey === roleKey, tx);
    for (const courseId of courseIds) push(state.requirements, { roleKey, courseId }, tx);
  },
  createAssignments: async (rows: any[], tx: Tx) => {
    await tick();
    let count = 0;
    for (const row of rows) {
      const clash = [...state.assignments.values()].some((a) => a.employeeId === row.employeeId && a.courseId === row.courseId && a.isOpen === true);
      if (clash) continue;
      const a = { id: id(), status: "assigned", isOpen: true, startedAt: null, completedAt: null, scoreHundredths: null, expiresAt: null, supersededAt: null, createdAt: now(), ...row };
      put(state.assignments, a.id, a, tx);
      count += 1;
    }
    return count;
  },
  findOpenFor: async (courseId: string, employeeIds: string[]) => {
    await tick();
    return [...state.assignments.values()]
      .filter((a) => a.courseId === courseId && employeeIds.includes(a.employeeId) && OPEN.includes(a.status))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .map(assignmentView);
  },
  findAssignment: async (assignmentId: string) => {
    await tick();
    const a = state.assignments.get(assignmentId);
    return a ? assignmentView(a) : null;
  },
  listAssignments: async (f: any) => {
    await tick();
    const rows = [...state.assignments.values()]
      .filter(
        (a) =>
          (f.employeeId ? a.employeeId === f.employeeId : !f.employeeIds || f.employeeIds.includes(a.employeeId)) &&
          (!f.courseId || a.courseId === f.courseId) &&
          (!f.status || a.status === f.status) &&
          (!f.overdueBefore || (a.nextDueOn && a.nextDueOn < f.overdueBefore))
      )
      .sort((a, b) => desc(a.createdAt, b.createdAt) || a.id.localeCompare(b.id));
    return { items: page(rows, f.offset, f.limit).map(assignmentView), total: rows.length };
  },
  startAssignment: async (assignmentId: string, at: Date, tx: Tx) => {
    await tick();
    const a = state.assignments.get(assignmentId);
    if (!a || a.status !== "assigned") return false;
    const before = { ...a };
    tx.undo.push(() => Object.assign(a, before));
    Object.assign(a, { status: "in_progress", startedAt: at });
    return true;
  },
  completeAssignment: async (assignmentId: string, c: any, tx: Tx) => {
    await tick();
    const a = state.assignments.get(assignmentId);
    if (!a || !OPEN.includes(a.status)) return false;
    const before = { ...a };
    tx.undo.push(() => Object.assign(a, before));
    Object.assign(a, { status: "completed", isOpen: null, completedAt: c.completedAt, scoreHundredths: c.scoreHundredths, expiresAt: c.expiresAt, nextDueOn: c.expiresAt });
    return true;
  },
  supersedePrevious: async (employeeId: string, courseId: string, exceptId: string, at: Date, tx: Tx) => {
    await tick();
    for (const a of state.assignments.values()) {
      if (a.employeeId === employeeId && a.courseId === courseId && a.status === "completed" && !a.supersededAt && a.id !== exceptId) {
        const before = { ...a };
        tx.undo.push(() => Object.assign(a, before));
        Object.assign(a, { supersededAt: at, nextDueOn: null });
      }
    }
  },
  listOverdue: async (ids: string[] | null, today: Date, offset: number, limit: number) => {
    await tick();
    const rows = [...state.assignments.values()]
      .filter((a) => (!ids || ids.includes(a.employeeId)) && a.nextDueOn && a.nextDueOn < today)
      .sort((a, b) => a.nextDueOn.getTime() - b.nextDueOn.getTime() || a.id.localeCompare(b.id));
    return { items: page(rows, offset, limit).map((a) => ({ employeeId: a.employeeId, courseTitle: courseOf(a.courseId).title, dueOn: a.nextDueOn })), total: rows.length };
  },
  countOverdue: async (ids: string[] | null, today: Date) => {
    await tick();
    return [...state.assignments.values()].filter((a) => (!ids || ids.includes(a.employeeId)) && a.nextDueOn && a.nextDueOn < today).length;
  },
  listRefreshers: async (ids: string[] | null, from: Date, to: Date, offset: number, limit: number) => {
    await tick();
    const rows = [...state.assignments.values()]
      .filter((a) => (!ids || ids.includes(a.employeeId)) && a.status === "completed" && a.nextDueOn && a.nextDueOn >= from && a.nextDueOn <= to)
      .sort((a, b) => a.nextDueOn.getTime() - b.nextDueOn.getTime() || a.id.localeCompare(b.id));
    return { items: page(rows, offset, limit).map((a) => ({ employeeId: a.employeeId, courseTitle: courseOf(a.courseId).title, dueOn: a.nextDueOn })), total: rows.length };
  },
  countDueAndDone: async (ids: string[], from: Date, to: Date) => {
    await tick();
    return ids
      .map((employeeId) => {
        const rows = [...state.assignments.values()].filter((a) => a.employeeId === employeeId && a.dueDate >= from && a.dueDate <= to);
        return { employeeId, due: rows.length, done: rows.filter((r) => r.status === "completed").length };
      })
      .filter((r) => r.due > 0);
  },
};

// ------------------------------------------------------------- performance

const appraisalClash = (employeeId: string, cycle: string) =>
  [...state.appraisals.values()].some((a) => a.employeeId === employeeId && a.cycle === cycle);

const newAppraisal = (data: any) => ({
  id: id(), status: "scheduled", rating: null, strengths: null, improvements: null, goals: [], conductedAt: null, conductedByName: null,
  outcome: null, outcomeNote: null, completedAt: null, completedByName: null, createdAt: now(), updatedAt: now(), ...data,
});

export const performanceQuery = {
  create: async (data: any) => {
    await tick();
    if (appraisalClash(data.employeeId, data.cycle)) throw uniqueViolation("uq_hr_appraisal_cycle");
    const a = newAppraisal(data);
    state.appraisals.set(a.id, a);
    return clone(a);
  },
  createMany: async (rows: any[]) => {
    await tick();
    let count = 0;
    for (const row of rows) {
      if (appraisalClash(row.employeeId, row.cycle)) continue;
      const a = newAppraisal(row);
      state.appraisals.set(a.id, a);
      count += 1;
    }
    return count;
  },
  findById: async (appraisalId: string) => {
    await tick();
    const a = state.appraisals.get(appraisalId);
    return a ? clone(a) : null;
  },
  findByCycle: async (cycle: string, ids: string[]) => {
    await tick();
    return [...state.appraisals.values()].filter((a) => a.cycle === cycle && ids.includes(a.employeeId)).sort((a, b) => a.id.localeCompare(b.id)).map(clone);
  },
  list: async (f: any) => {
    await tick();
    const rows = [...state.appraisals.values()]
      .filter(
        (a) =>
          (f.employeeId ? a.employeeId === f.employeeId : !f.employeeIds || f.employeeIds.includes(a.employeeId)) &&
          (!f.status || a.status === f.status) &&
          (!f.cycle || a.cycle === f.cycle)
      )
      .sort((a, b) => desc(a.scheduledFor, b.scheduledFor) || a.id.localeCompare(b.id));
    return { items: page(rows, f.offset, f.limit).map(clone), total: rows.length };
  },
  listForEmployee: async (employeeId: string, limit: number) => {
    await tick();
    return [...state.appraisals.values()].filter((a) => a.employeeId === employeeId).sort((a, b) => desc(a.scheduledFor, b.scheduledFor)).slice(0, limit).map(clone);
  },
  reschedule: async (appraisalId: string, data: any, tx: Tx) => {
    await tick();
    const a = state.appraisals.get(appraisalId);
    if (!a || a.status !== "scheduled") return false;
    const next = { ...a, ...data };
    if (data.cycle && data.cycle !== a.cycle && appraisalClash(a.employeeId, data.cycle)) throw uniqueViolation("uq_hr_appraisal_cycle");
    const before = { ...a };
    tx.undo.push(() => Object.assign(a, before));
    Object.assign(a, next);
    return true;
  },
  start: async (appraisalId: string, tx: Tx) => {
    await tick();
    const a = state.appraisals.get(appraisalId);
    if (!a || a.status !== "scheduled") return false;
    tx.undo.push(() => (a.status = "scheduled"));
    a.status = "in_progress";
    return true;
  },
  conduct: async (appraisalId: string, data: any, tx: Tx) => {
    await tick();
    const a = state.appraisals.get(appraisalId);
    if (!a || !["scheduled", "in_progress"].includes(a.status) || a.rating !== null) return false;
    const before = { ...a };
    tx.undo.push(() => Object.assign(a, before));
    Object.assign(a, data, { status: "in_progress" });
    return true;
  },
  complete: async (appraisalId: string, data: any, tx: Tx) => {
    await tick();
    const a = state.appraisals.get(appraisalId);
    if (!a || a.status !== "in_progress" || a.rating === null) return false;
    const before = { ...a };
    tx.undo.push(() => Object.assign(a, before));
    Object.assign(a, data, { status: "completed" });
    return true;
  },
  ratingsFor: async (ids: string[], from: Date, to: Date) => {
    await tick();
    return [...state.appraisals.values()]
      .filter((a) => ids.includes(a.employeeId) && a.rating !== null && a.conductedAt >= from && a.conductedAt < to)
      .sort((a, b) => desc(a.conductedAt, b.conductedAt))
      .map((a) => ({ employeeId: a.employeeId, rating: a.rating, conductedAt: a.conductedAt }));
  },
  ratingDistribution: async (ids: string[] | null, from: Date, to: Date) => {
    await tick();
    const out: Record<number, number> = {};
    for (const a of state.appraisals.values()) {
      if ((!ids || ids.includes(a.employeeId)) && a.rating !== null && a.conductedAt >= from && a.conductedAt < to) out[a.rating] = (out[a.rating] ?? 0) + 1;
    }
    return out;
  },
};

// --------------------------------------------------------------------- pay

const earningKey = (e: any) => `${e.employeeId}|${e.schemeId}|${e.period}`;

export const payQuery = {
  createCompensation: async (data: any, tx: Tx) => {
    await tick();
    if (state.compensation.some((c) => c.employeeId === data.employeeId && c.effectiveFrom.getTime() === data.effectiveFrom.getTime())) {
      throw uniqueViolation("uq_hr_compensation_effective");
    }
    const row = { id: id(), createdAt: now(), ...data };
    push(state.compensation, row, tx);
    return clone(row);
  },
  listCompensation: async (employeeId: string) => {
    await tick();
    return state.compensation.filter((c) => c.employeeId === employeeId).sort((a, b) => desc(a.effectiveFrom, b.effectiveFrom)).map(clone);
  },
  latestCompensation: async (employeeId: string) => {
    await tick();
    const rows = state.compensation.filter((c) => c.employeeId === employeeId).sort((a, b) => desc(a.effectiveFrom, b.effectiveFrom));
    return rows[0] ? clone(rows[0]) : null;
  },
  createScheme: async (data: any) => {
    await tick();
    const s = { id: id(), createdAt: now(), updatedAt: now(), ...data };
    state.schemes.set(s.id, s);
    return clone(s);
  },
  findScheme: async (schemeId: string) => {
    await tick();
    const s = state.schemes.get(schemeId);
    return s ? clone(s) : null;
  },
  listSchemes: async (offset: number, limit: number) => {
    await tick();
    const rows = [...state.schemes.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return { items: page(rows, offset, limit).map(clone), total: rows.length };
  },
  updateScheme: async (schemeId: string, data: any) => {
    await tick();
    const s = state.schemes.get(schemeId);
    if (!s) return null;
    Object.assign(s, data, { updatedAt: now() });
    return clone(s);
  },
  assignMany: async (schemeId: string, employeeIds: string[], by: string, tx: Tx) => {
    await tick();
    for (const employeeId of employeeIds) {
      if (!state.schemeAssignments.some((a) => a.schemeId === schemeId && a.employeeId === employeeId)) push(state.schemeAssignments, { schemeId, employeeId, by }, tx);
    }
  },
  assignedEmployeeIds: async (schemeId: string, employeeIds: string[]) => {
    await tick();
    return state.schemeAssignments.filter((a) => a.schemeId === schemeId && employeeIds.includes(a.employeeId)).map((a) => a.employeeId);
  },
  activeSchemesFor: async (employeeIds: string[]) => {
    await tick();
    return state.schemeAssignments
      .filter((a) => employeeIds.includes(a.employeeId) && state.schemes.get(a.schemeId)?.isActive)
      .map((a) => ({ employeeId: a.employeeId, scheme: clone(state.schemes.get(a.schemeId)) }));
  },
  upsertMetric: async (m: any, tx: Tx) => {
    await tick();
    put(state.metrics, `${m.employeeId}|${m.metric}|${m.period}`, { ...m }, tx);
  },
  upsertPendingEarning: async (e: any, createIfMissing: boolean, tx: Tx) => {
    await tick();
    const existing = [...state.earnings.values()].find((x) => earningKey(x) === earningKey(e));
    if (existing) {
      if (existing.status === "pending") {
        const before = { ...existing };
        tx.undo.push(() => Object.assign(existing, before));
        Object.assign(existing, { metricValueMilli: e.metricValueMilli, rewardPaise: e.rewardPaise, schemeName: e.schemeName });
      }
      return;
    }
    if (createIfMissing) {
      const row = { id: id(), status: "pending", approvedAt: null, approvedByName: null, paidAt: null, createdAt: now(), ...e };
      put(state.earnings, row.id, row, tx);
    }
  },
  listEarnings: async (f: any) => {
    await tick();
    const rows = [...state.earnings.values()]
      .filter(
        (e) =>
          (f.employeeId ? e.employeeId === f.employeeId : !f.employeeIds || f.employeeIds.includes(e.employeeId)) &&
          (!f.status || e.status === f.status) &&
          (!f.periodMonth || (e.periodStart >= f.periodMonth.from && e.periodStart <= f.periodMonth.to)) &&
          (!f.periodExact || e.period === f.periodExact)
      )
      .sort((a, b) => desc(a.createdAt, b.createdAt) || a.id.localeCompare(b.id));
    return { items: page(rows, f.offset, f.limit).map(clone), total: rows.length };
  },
  findEarning: async (earningId: string) => {
    await tick();
    const e = state.earnings.get(earningId);
    return e ? clone(e) : null;
  },
  approveEarning: async (earningId: string, at: Date, by: string, tx: Tx) => {
    await tick();
    const e = state.earnings.get(earningId);
    if (!e || e.status !== "pending") return false;
    const before = { ...e };
    tx.undo.push(() => Object.assign(e, before));
    Object.assign(e, { status: "approved", approvedAt: at, approvedByName: by });
    return true;
  },
  earningsOfMonth: async (employeeId: string, from: Date, to: Date) => {
    await tick();
    return [...state.earnings.values()]
      .filter((e) => e.employeeId === employeeId && e.periodStart >= from && e.periodStart <= to)
      .sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .map(clone);
  },
  markPaid: async (ids: string[], at: Date, tx: Tx) => {
    await tick();
    for (const earningId of ids) {
      const e = state.earnings.get(earningId);
      if (e && e.status === "approved") {
        const before = { ...e };
        tx.undo.push(() => Object.assign(e, before));
        Object.assign(e, { status: "paid", paidAt: at });
      }
    }
  },
  createPayout: async (data: any, tx: Tx) => {
    await tick();
    if (data.idempotencyKey && state.payouts.some((p) => p.recordedByUserId === data.recordedByUserId && p.idempotencyKey === data.idempotencyKey)) {
      throw uniqueViolation("uq_hr_payout_idempotency");
    }
    const row = { id: id(), createdAt: now(), ...data };
    push(state.payouts, row, tx);
    return clone(row);
  },
  findPayoutByKey: async (userId: string, key: string) => {
    await tick();
    const row = state.payouts.find((p) => p.recordedByUserId === userId && p.idempotencyKey === key);
    return row ? clone(row) : null;
  },
  listPayouts: async (f: any) => {
    await tick();
    const rows = state.payouts
      .filter(
        (p) =>
          (f.employeeId ? p.employeeId === f.employeeId : !f.employeeIds || f.employeeIds.includes(p.employeeId)) &&
          (!f.type || p.type === f.type) &&
          (!f.from || p.paidOn >= f.from) &&
          (!f.to || p.paidOn <= f.to)
      )
      .sort((a, b) => desc(a.paidOn, b.paidOn) || a.id.localeCompare(b.id));
    return { items: page(rows, f.offset, f.limit).map(clone), total: rows.length };
  },
  sumsByType: async (employeeId: string, period: string) => {
    await tick();
    const out: Record<string, number> = {};
    for (const p of state.payouts) if (p.employeeId === employeeId && p.period === period) out[p.type] = (out[p.type] ?? 0) + p.amountPaise;
    return out;
  },
};

// -------------------------------------------------------------- grievances

const visible = (v: any) => (g: any) =>
  (!v.employeeIds || v.employeeIds.includes(g.employeeId)) &&
  (!v.nonConfidentialOnly || !g.confidential) &&
  (!v.notAgainst || g.againstEmployeeId !== v.notAgainst);

const LIVE = ["open", "assigned", "in_progress", "escalated"];

export const grievanceQuery = {
  create: async (data: any) => {
    await tick();
    const g = {
      id: id(), status: "open", assigneeId: null, assignedAt: null, raisedAt: now(), firstResponseAt: null, escalatedAt: null,
      escalationReason: null, closedAt: null, outcome: null, closedByName: null, ...data,
    };
    state.grievances.set(g.id, g);
    return clone(g);
  },
  findById: async (grievanceId: string) => {
    await tick();
    const g = state.grievances.get(grievanceId);
    return g ? clone(g) : null;
  },
  list: async (f: any) => {
    await tick();
    const rows = [...state.grievances.values()]
      .filter(
        (g) =>
          visible(f.visibility)(g) &&
          (!f.status || g.status === f.status) &&
          (!f.category || g.category === f.category) &&
          (!f.assigneeId || g.assigneeId === f.assigneeId) &&
          (!f.from || g.raisedAt >= f.from) &&
          (!f.to || g.raisedAt < f.to)
      )
      .sort((a, b) => desc(a.raisedAt, b.raisedAt) || a.id.localeCompare(b.id));
    return { items: page(rows, f.offset, f.limit).map(clone), total: rows.length };
  },
  countOpen: async (v: any) => {
    await tick();
    return [...state.grievances.values()].filter((g) => visible(v)(g) && g.status !== "closed").length;
  },
  assign: async (grievanceId: string, assigneeId: string, at: Date, tx: Tx) => {
    await tick();
    const g = state.grievances.get(grievanceId);
    if (!g || g.status === "closed") return false;
    const before = { ...g };
    tx.undo.push(() => Object.assign(g, before));
    Object.assign(g, { assigneeId, assignedAt: at, status: g.status === "open" ? "assigned" : g.status });
    return true;
  },
  noteFirstResponse: async (grievanceId: string, at: Date, tx: Tx) => {
    await tick();
    const g = state.grievances.get(grievanceId);
    if (g && !g.firstResponseAt) {
      tx.undo.push(() => (g.firstResponseAt = null));
      g.firstResponseAt = at;
    }
  },
  startProgress: async (grievanceId: string, tx: Tx) => {
    await tick();
    const g = state.grievances.get(grievanceId);
    if (g && g.status === "assigned") {
      tx.undo.push(() => (g.status = "assigned"));
      g.status = "in_progress";
    }
  },
  escalate: async (grievanceId: string, reason: string, at: Date, tx: Tx) => {
    await tick();
    const g = state.grievances.get(grievanceId);
    if (!g || !["open", "assigned", "in_progress"].includes(g.status)) return false;
    const before = { ...g };
    tx.undo.push(() => Object.assign(g, before));
    Object.assign(g, { status: "escalated", escalatedAt: at, escalationReason: reason });
    return true;
  },
  close: async (grievanceId: string, outcome: string, at: Date, by: string, tx: Tx) => {
    await tick();
    const g = state.grievances.get(grievanceId);
    if (!g || !LIVE.includes(g.status)) return false;
    const before = { ...g };
    tx.undo.push(() => Object.assign(g, before));
    Object.assign(g, { status: "closed", closedAt: at, outcome, closedByName: by });
    return true;
  },
  addNote: async (note: any, tx: Tx) => {
    await tick();
    if (state.failNextNote) {
      state.failNextNote = false;
      throw new Error("note insert failed");
    }
    push(state.notes, { id: id(), createdAt: now(), ...note }, tx);
  },
  listNotes: async (grievanceId: string, includeInternal: boolean) => {
    await tick();
    return state.notes.filter((n) => n.grievanceId === grievanceId && (includeInternal || !n.internal)).map(clone);
  },
  createRequest: async (data: any) => {
    await tick();
    const r = { id: id(), status: "open", response: null, respondedAt: null, respondedByName: null, closedAt: null, closeNote: null, createdAt: now(), ...data };
    state.requests.set(r.id, r);
    return clone(r);
  },
  findRequest: async (requestId: string) => {
    await tick();
    const r = state.requests.get(requestId);
    return r ? clone(r) : null;
  },
  listRequests: async (f: any) => {
    await tick();
    const rows = [...state.requests.values()]
      .filter(
        (r) =>
          (f.employeeId ? r.employeeId === f.employeeId : !f.employeeIds || f.employeeIds.includes(r.employeeId)) &&
          (!f.status || r.status === f.status) &&
          (!f.category || r.category === f.category)
      )
      .sort((a, b) => desc(a.createdAt, b.createdAt) || a.id.localeCompare(b.id));
    return { items: page(rows, f.offset, f.limit).map(clone), total: rows.length };
  },
  respondToRequest: async (requestId: string, response: string, at: Date, by: string, tx: Tx) => {
    await tick();
    const r = state.requests.get(requestId);
    if (!r || r.status !== "open") return false;
    const before = { ...r };
    tx.undo.push(() => Object.assign(r, before));
    Object.assign(r, { status: "answered", response, respondedAt: at, respondedByName: by });
    return true;
  },
  closeRequest: async (requestId: string, note: string | null, at: Date, tx: Tx) => {
    await tick();
    const r = state.requests.get(requestId);
    if (!r || r.status === "closed") return false;
    const before = { ...r };
    tx.undo.push(() => Object.assign(r, before));
    Object.assign(r, { status: "closed", closedAt: at, closeNote: note });
    return true;
  },
};

// ------------------------------------------------------------------ seeding

let seq = 0;
export const seed = {
  employee: (over: Record<string, any> = {}) => {
    seq += 1;
    const e = {
      id: id(), code: `EMP-${String(seq).padStart(5, "0")}`, name: `Person ${seq}`, employeeType: "staff", storeId: null, role: "Washer",
      designation: null, status: "active", gatewayUserId: null, reportingTo: null, joinDate: new Date("2026-01-01T00:00:00.000Z"),
      lastWorkingDay: null, ...over,
    };
    state.employees.set(e.id, e);
    return e;
  },
};
