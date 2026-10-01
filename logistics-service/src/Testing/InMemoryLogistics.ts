// An in-memory stand-in for the four Query modules, used by the flow tests. It keeps the
// semantics the services lean on: conditional updates that report whether they won, unique
// constraints that throw Prisma's unique-violation error, and transactions that roll back.
// Services, rules and state machines in the tests are the real code.

const ACTIVE = ["assigned", "en_route", "arrived", "out_for_delivery", "picked_up"];
const COMPLETED = ["at_store", "delivered"];

type Row = Record<string, any>;

const tables = [
  "applications",
  "documents",
  "riders",
  "riderEvents",
  "shifts",
  "jobs",
  "events",
  "assignments",
  "scans",
  "inspections",
  "photos",
  "proofs",
  "ledger",
  "payments",
  "ratings",
  "outbox",
] as const;
type Table = (typeof tables)[number];

export const state = Object.fromEntries(tables.map((t) => [t, [] as Row[]])) as Record<Table, Row[]>;
let seq = 0;
export const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export const reset = () => {
  for (const t of tables) state[t].length = 0;
};

const unique = (message = "unique") => Object.assign(new Error(message), { code: "P2002" });
const clone = <T>(row: T): T => (row ? ({ ...(row as object) } as T) : row);
const cloneAll = <T>(rows: T[]): T[] => rows.map(clone);
const inRange = (value: Date | null | undefined, from?: Date | null, to?: Date | null) =>
  !!value && (!from || value >= from) && (!to || value < to);
const page = <T>(rows: T[], window: { offset: number; limit: number }) => rows.slice(window.offset, window.offset + window.limit);
const byDate = (a: Date, b: Date) => a.getTime() - b.getTime();
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

// ------------------------------------------------------------------- transactions
const snapshot = () => Object.fromEntries(tables.map((t) => [t, state[t].map((r) => ({ ...r }))])) as Record<Table, Row[]>;
// Transactions run one at a time (a valid serial schedule), so a rollback can restore the
// snapshot without wiping another transaction's committed work. Reads made before a
// transaction starts still race, as they do against a real database.
let queue: Promise<unknown> = Promise.resolve();
const inTransaction = <T>(work: (tx: object) => Promise<T>): Promise<T> => {
  const run = async (): Promise<T> => {
    const before = snapshot();
    try {
      return await work({});
    } catch (error) {
      for (const t of tables) {
        state[t].length = 0;
        state[t].push(...before[t]);
      }
      throw error;
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
};

// ------------------------------------------------------------------------ jobs
const jobDefaults = () => ({
  status: "pending",
  riderId: null,
  shiftId: null,
  sequence: null,
  distanceMeters: null,
  collectedPaise: 0,
  codeAttempts: 0,
  assignedAt: null,
  startedAt: null,
  arrivedAt: null,
  pickedUpAt: null,
  completedAt: null,
  failedAt: null,
  cancelledAt: null,
  failureReason: null,
  failureNote: null,
  cancelReason: null,
  rescheduleCount: 0,
  durationMinutes: null,
  onTime: null,
});

const jobFilter = (filter: Row) => (j: Row) =>
  (!filter.storeId || j.storeId === filter.storeId) &&
  (!filter.riderId || j.riderId === filter.riderId) &&
  (!filter.status || j.status === filter.status) &&
  (!filter.type || j.type === filter.type) &&
  (!(filter.from || filter.to) || inRange(j.slotFrom, filter.from, filter.to));

const routeOrder = (a: Row, b: Row) =>
  (a.sequence ?? Infinity) - (b.sequence ?? Infinity) || byDate(a.slotFrom, b.slotFrom) || a.id.localeCompare(b.id);

export const jobQuery = {
  inTransaction,
  create: async (data: Row) => {
    if (state.jobs.some((j) => j.orderId === data.orderId && j.type === data.type)) throw unique("uq_job_order_type");
    const row = { ...jobDefaults(), id: newId(), createdAt: new Date(), updatedAt: new Date(), ...data };
    state.jobs.push(row);
    return clone(row);
  },
  findById: async (id: string) => clone(state.jobs.find((j) => j.id === id) ?? null),
  findByOrderAndType: async (orderId: string, type: string) =>
    clone(state.jobs.find((j) => j.orderId === orderId && j.type === type) ?? null),
  listByOrder: async (orderId: string) => cloneAll(state.jobs.filter((j) => j.orderId === orderId)),
  lockById: async (id: string) => clone(state.jobs.find((j) => j.id === id) ?? null),
  list: async (filter: Row, window: any) => {
    const rows = state.jobs.filter(jobFilter(filter)).sort((a, b) => byDate(b.createdAt, a.createdAt) || a.id.localeCompare(b.id));
    return { items: cloneAll(page(rows, window)), total: rows.length };
  },
  listForRider: async (riderId: string, filter: Row, window: any) => {
    const rows = state.jobs
      .filter((j) => j.riderId === riderId && inRange(j.slotFrom, filter.from, filter.to) && (!filter.status || j.status === filter.status) && (!filter.type || j.type === filter.type))
      .sort(routeOrder);
    return { items: cloneAll(page(rows, window)), total: rows.length };
  },
  listActiveForRider: async (riderId: string, range: Row, limit: number, storeId: string | null = null) =>
    cloneAll(
      state.jobs
        .filter((j) => j.riderId === riderId && ACTIVE.includes(j.status) && inRange(j.slotFrom, range.from, range.to) && (!storeId || j.storeId === storeId))
        .sort(routeOrder)
        .slice(0, limit)
    ),
  listUnassigned: async (filter: Row, limit: number) =>
    cloneAll(
      state.jobs
        .filter((j) => j.status === "pending" && jobFilter({ storeId: filter.storeId, from: filter.from, to: filter.to })(j))
        .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "express" ? -1 : 1) || byDate(a.slotFrom, b.slotFrom) || a.id.localeCompare(b.id))
        .slice(0, limit)
    ),
  countUnassigned: async (filter: Row) =>
    state.jobs.filter((j) => j.status === "pending" && jobFilter({ storeId: filter.storeId, from: filter.from, to: filter.to })(j)).length,
  activeCounts: async (riderIds: string[]) => {
    const counts = new Map<string, number>();
    for (const j of state.jobs) if (j.riderId && riderIds.includes(j.riderId) && ACTIVE.includes(j.status)) counts.set(j.riderId, (counts.get(j.riderId) ?? 0) + 1);
    return counts;
  },
  countByStatusForRider: async (riderId: string, status: string) => state.jobs.filter((j) => j.riderId === riderId && j.status === status).length,
  transition: async (id: string, expect: Row, patch: Row) => {
    const job = state.jobs.find((j) => j.id === id);
    if (!job || !expect.status.includes(job.status)) return false;
    if (expect.riderId !== undefined && job.riderId !== expect.riderId) return false;
    Object.assign(job, patch, { updatedAt: new Date() });
    return true;
  },
  claimPending: async (jobIds: string[], riderId: string, at: Date) => {
    const won: string[] = [];
    for (const job of state.jobs) {
      if (jobIds.includes(job.id) && job.status === "pending" && job.riderId === null) {
        Object.assign(job, { status: "assigned", riderId, assignedAt: at, sequence: null });
        won.push(job.id);
      }
    }
    return won;
  },
  bumpCodeAttempts: async (id: string) => {
    const job = state.jobs.find((j) => j.id === id) as Row;
    job.codeAttempts += 1;
    return job.codeAttempts;
  },
  addCollected: async (id: string, expected: number, amount: number) => {
    const job = state.jobs.find((j) => j.id === id);
    if (!job || job.collectedPaise !== expected) return false;
    job.collectedPaise = expected + amount;
    return true;
  },
  addEvent: async (event: Row) => void state.events.push({ id: newId(), at: new Date(), ...event }),
  addEvents: async (events: Row[]) => void events.forEach((e) => state.events.push({ id: newId(), at: new Date(), ...e })),
  listEvents: async (jobId: string, limit: number) => cloneAll(state.events.filter((e) => e.jobId === jobId).slice(0, limit)),
  releaseAssignment: async (jobId: string, reason: string) => {
    for (const a of state.assignments) if (a.activeJobId === jobId) Object.assign(a, { activeJobId: null, releasedAt: new Date(), releaseReason: reason });
  },
  createAssignments: async (rows: Row[]) => {
    for (const row of rows) {
      if (state.assignments.some((a) => a.activeJobId === row.jobId)) throw unique("activeJobId");
      state.assignments.push({ id: newId(), releasedAt: null, releaseReason: null, ...row, activeJobId: row.jobId });
    }
  },
  findProof: async (jobId: string) => clone(state.proofs.find((p) => p.jobId === jobId) ?? null),
  upsertProof: async (jobId: string, patch: Row) => {
    const existing = state.proofs.find((p) => p.jobId === jobId);
    if (existing) Object.assign(existing, patch);
    else state.proofs.push({ id: newId(), jobId, itemCount: null, ...patch });
  },
  addScan: async (jobId: string, tagId: string, condition: string) => {
    if (state.scans.some((s) => s.jobId === jobId && s.tagId === tagId)) return false;
    state.scans.push({ jobId, tagId, condition });
    return true;
  },
  countScans: async (jobId: string) => state.scans.filter((s) => s.jobId === jobId).length,
  replaceInspections: async (jobId: string, items: Row[]) => {
    const ids = items.map((i) => i.itemId);
    for (let i = state.inspections.length - 1; i >= 0; i--) if (state.inspections[i].jobId === jobId && ids.includes(state.inspections[i].itemId)) state.inspections.splice(i, 1);
    items.forEach((item) => state.inspections.push({ jobId, ...item }));
  },
  listInspections: async (jobId: string) =>
    state.inspections.filter((i) => i.jobId === jobId).map((i) => ({ itemId: i.itemId, condition: i.condition, note: i.note })),
  addPhoto: async (data: Row) => {
    const row = { id: newId(), createdAt: new Date(), ...data };
    state.photos.push(row);
    return clone(row);
  },
  countPhotos: async (jobId: string, kind: string) => state.photos.filter((p) => p.jobId === jobId && p.kind === kind).length,
  listPhotos: async (jobId: string, limit: number) => cloneAll(state.photos.filter((p) => p.jobId === jobId).slice(0, limit)),
  riderStats: async (range: Row, filter: Row, limit: number) => {
    const done = state.jobs.filter(
      (j) => COMPLETED.includes(j.status) && inRange(j.completedAt, range.from, range.to) && j.riderId && (!filter.riderId || j.riderId === filter.riderId) && (!filter.storeId || j.storeId === filter.storeId)
    );
    const ids = [...new Set(done.map((j) => j.riderId as string))];
    return ids
      .map((riderId) => {
        const mine = done.filter((j) => j.riderId === riderId);
        const timed = mine.filter((j) => j.durationMinutes !== null);
        return {
          riderId,
          jobsCompleted: mine.length,
          distanceMeters: sum(mine.map((j) => j.distanceMeters ?? 0)),
          avgDurationMinutes: timed.length ? sum(timed.map((j) => j.durationMinutes)) / timed.length : null,
          onTimeJobs: mine.filter((j) => j.onTime === true).length,
          measuredJobs: mine.filter((j) => j.onTime !== null).length,
        };
      })
      .sort((a, b) => b.jobsCompleted - a.jobsCompleted)
      .slice(0, limit);
  },
  shiftStats: async (shiftId: string) => {
    const mine = state.jobs.filter((j) => j.shiftId === shiftId && COMPLETED.includes(j.status));
    return { jobsCompleted: mine.length, distanceMeters: sum(mine.map((j) => j.distanceMeters ?? 0)) };
  },
  completedTotals: async (riderId: string, range: Row) => {
    const mine = state.jobs.filter((j) => j.riderId === riderId && COMPLETED.includes(j.status) && inRange(j.completedAt, range.from, range.to));
    return { jobsCompleted: mine.length, distanceMeters: sum(mine.map((j) => j.distanceMeters ?? 0)) };
  },
  routeSummaries: async (range: Row, filter: Row, limit: number) => {
    const mine = state.jobs.filter(
      (j) => j.riderId && inRange(j.slotFrom, range.from, range.to) && !["pending", "failed", "cancelled"].includes(j.status) && (!filter.riderId || j.riderId === filter.riderId) && (!filter.storeId || j.storeId === filter.storeId)
    );
    return [...new Set(mine.map((j) => j.riderId as string))]
      .slice(0, limit)
      .map((riderId) => ({ riderId, stops: mine.filter((j) => j.riderId === riderId).length, distanceMeters: sum(mine.filter((j) => j.riderId === riderId).map((j) => j.distanceMeters ?? 0)) }));
  },
  setSequences: async (updates: Row[]) => {
    for (const u of updates) Object.assign(state.jobs.find((j) => j.id === u.id) as Row, { sequence: u.sequence, distanceMeters: u.distanceMeters });
  },
};

// ---------------------------------------------------------------------- riders
const riderView = (rider: Row | undefined) => {
  if (!rider) return null;
  const open = state.shifts.find((s) => s.riderId === rider.id && s.endedAt === null);
  return { ...rider, openShiftId: open?.id ?? null };
};

export const riderQuery = {
  createApplication: async (data: Row) => {
    if (state.applications.some((a) => a.openPhone === data.openPhone)) throw unique("openPhone");
    const row = { id: newId(), status: "submitted", requestedDocuments: [], requestMessage: null, identityVerified: null, vehicleVerified: null, insuranceValid: null, insuranceExpiry: null, verifyNotes: null, decisionNotes: null, rejectionReason: null, submittedAt: new Date(), ...data };
    state.applications.push(row);
    return clone(row);
  },
  findApplicationById: async (id: string) => clone(state.applications.find((a) => a.id === id) ?? null),
  lockApplication: async (id: string) => clone(state.applications.find((a) => a.id === id) ?? null),
  listApplications: async (filter: Row, window: any) => {
    const rows = state.applications
      .filter((a) => (!filter.status || a.status === filter.status) && (!filter.city || a.city.toLowerCase() === filter.city.toLowerCase()) && (!(filter.from || filter.to) || inRange(a.submittedAt, filter.from, filter.to)))
      .sort((a, b) => byDate(b.submittedAt, a.submittedAt));
    return { items: cloneAll(page(rows, window)), total: rows.length };
  },
  updateApplication: async (id: string, expect: string[], patch: Row) => {
    const row = state.applications.find((a) => a.id === id);
    if (!row || !expect.includes(row.status)) return false;
    Object.assign(row, patch);
    return true;
  },
  upsertDocument: async (applicationId: string, type: string, fileUrl: string) => {
    const existing = state.documents.find((d) => d.applicationId === applicationId && d.type === type);
    if (existing) Object.assign(existing, { fileUrl, updatedAt: new Date() });
    else state.documents.push({ applicationId, type, fileUrl, createdAt: new Date(), updatedAt: new Date() });
  },
  listDocuments: async (applicationId: string) => cloneAll(state.documents.filter((d) => d.applicationId === applicationId)),
  createRider: async (data: Row) => {
    if (state.riders.some((r) => r.phone === data.phone || (data.userId && r.userId === data.userId) || (data.applicationId && r.applicationId === data.applicationId))) throw unique("rider");
    const row = { id: newId(), available: false, lastLatitude: null, lastLongitude: null, lastLocationAt: null, suspendedReason: null, suspendedAt: null, ...data };
    state.riders.push(row);
    return riderView(row);
  },
  findRiderById: async (id: string) => riderView(state.riders.find((r) => r.id === id)),
  findRiderByUserId: async (userId: string) => riderView(state.riders.find((r) => r.userId === userId)),
  findRiderByApplicationId: async (applicationId: string) => riderView(state.riders.find((r) => r.applicationId === applicationId)),
  findRidersByIds: async (ids: string[]) => state.riders.filter((r) => ids.includes(r.id)).map((r) => riderView(r)),
  lockRider: async (id: string) => riderView(state.riders.find((r) => r.id === id)),
  updateRider: async (id: string, patch: Row) => {
    if (patch.userId && state.riders.some((r) => r.id !== id && r.userId === patch.userId)) throw unique("userId");
    Object.assign(state.riders.find((r) => r.id === id) as Row, patch);
  },
  listRiders: async (filter: Row, window: any) => {
    const rows = state.riders
      .filter((r) => (!filter.homeStoreId || r.homeStoreId === filter.homeStoreId) && (filter.available === null || filter.available === undefined || r.available === filter.available) && (!filter.status || r.status === filter.status))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { items: page(rows, window).map((r) => riderView(r)), total: rows.length };
  },
  listCandidates: async (options: Row) =>
    state.riders
      .filter(
        (r) =>
          r.status === "active" && r.available && r.userId && r.identityVerified && r.vehicleVerified && r.insuranceValid && r.insuranceExpiry && r.insuranceExpiry >= options.today &&
          (!options.onShiftOnly || state.shifts.some((s) => s.riderId === r.id && s.endedAt === null))
      )
      .slice(0, options.limit)
      .map((r) => riderView(r)),
  addRiderEvent: async (event: Row) => void state.riderEvents.push({ at: new Date(), ...event }),
  openShiftOf: async (riderId: string) => clone(state.shifts.find((s) => s.riderId === riderId && s.endedAt === null) ?? null),
  startShift: async (data: Row) => {
    if (state.shifts.some((s) => s.riderId === data.riderId && s.endedAt === null)) throw unique("openRiderId");
    const row = { id: newId(), startedAt: new Date(), endedAt: null, odometerKm: null, jobsCompleted: null, distanceMeters: null, earningsPaise: null, ...data };
    state.shifts.push(row);
    return clone(row);
  },
  closeShift: async (id: string, data: Row) => {
    const shift = state.shifts.find((s) => s.id === id);
    if (!shift || shift.endedAt !== null) return false;
    Object.assign(shift, data);
    return true;
  },
  shiftsInRange: async (riderId: string, range: Row) => cloneAll(state.shifts.filter((s) => s.riderId === riderId && inRange(s.startedAt, range.from, range.to))),
  addRating: async (data: Row) => {
    if (state.ratings.some((r) => r.jobId === data.jobId)) return false;
    state.ratings.push({ createdAt: new Date(), ...data });
    return true;
  },
  ratingSummary: async (riderId: string, range: Row) => {
    const mine = state.ratings.filter((r) => r.riderId === riderId && inRange(r.createdAt, range.from, range.to));
    return { average: mine.length ? sum(mine.map((r) => r.rating)) / mine.length : null, count: mine.length };
  },
  recentRatings: async (riderId: string, range: Row, limit: number) =>
    state.ratings.filter((r) => r.riderId === riderId && inRange(r.createdAt, range.from, range.to)).sort((a, b) => byDate(b.createdAt, a.createdAt)).slice(0, limit).map((r) => ({ rating: r.rating, comment: r.comment, at: r.createdAt })),
  ratingAverages: async (riderIds: string[], range: Row) => {
    const out = new Map<string, number>();
    for (const id of riderIds) {
      const mine = state.ratings.filter((r) => r.riderId === id && inRange(r.createdAt, range.from, range.to));
      if (mine.length) out.set(id, sum(mine.map((r) => r.rating)) / mine.length);
    }
    return out;
  },
};

// -------------------------------------------------------------------- earnings
export const earningsQuery = {
  addEntries: async (entries: Row[]) => {
    let added = 0;
    for (const e of entries) {
      if (e.dedupeKey && state.ledger.some((l) => l.dedupeKey === e.dedupeKey)) continue;
      state.ledger.push({ id: newId(), createdAt: new Date(), ...e });
      added++;
    }
    return added;
  },
  totals: async (riderId: string, range: Row) => {
    const out: Row = {};
    for (const l of state.ledger) if (l.riderId === riderId && inRange(l.createdAt, range.from, range.to)) out[l.kind] = (out[l.kind] ?? 0) + l.amountPaise;
    return out;
  },
  shiftTotal: async (shiftId: string) => sum(state.ledger.filter((l) => l.shiftId === shiftId).map((l) => l.amountPaise)),
  createFieldPayment: async (data: Row) => {
    if (data.idempotencyKey && state.payments.some((p) => p.riderId === data.riderId && p.idempotencyKey === data.idempotencyKey)) throw unique("idempotency");
    const row = { id: newId(), collectedAt: new Date(), settledByUserId: null, settledStoreId: null, settleNote: null, ...data };
    state.payments.push(row);
    return clone(row);
  },
  findFieldPaymentByKey: async (riderId: string, key: string) => clone(state.payments.find((p) => p.riderId === riderId && p.idempotencyKey === key) ?? null),
  findFieldPaymentById: async (id: string) => clone(state.payments.find((p) => p.id === id) ?? null),
  listFieldPayments: async (filter: Row, window: any) => {
    const rows = state.payments
      .filter((p) => (!filter.storeId || p.storeId === filter.storeId) && (!filter.riderId || p.riderId === filter.riderId) && (!filter.status || p.status === filter.status) && (!(filter.from || filter.to) || inRange(p.collectedAt, filter.from, filter.to)))
      .sort((a, b) => byDate(b.collectedAt, a.collectedAt));
    return { items: cloneAll(page(rows, window)), total: rows.length };
  },
  settleFieldPayment: async (id: string, data: Row) => {
    const p = state.payments.find((x) => x.id === id);
    if (!p || p.status !== "collected") return false;
    Object.assign(p, data, { status: "settled", settledAt: new Date() });
    return true;
  },
  cashTotals: async (riderId: string) => {
    const cash = state.payments.filter((p) => p.riderId === riderId && p.method === "cash");
    return { collectedPaise: sum(cash.map((p) => p.amountPaise)), settledPaise: sum(cash.filter((p) => p.status === "settled").map((p) => p.amountPaise)) };
  },
};

// ---------------------------------------------------------------------- outbox
export const outboxQuery = {
  enqueue: async (data: Row) => {
    const existing = state.outbox.find((o) => o.dedupeKey === data.dedupeKey);
    if (existing) return clone(existing);
    const row = { id: newId(), state: "pending", attempts: 0, lastError: null, nextAttemptAt: new Date(), ...data };
    state.outbox.push(row);
    return clone(row);
  },
  findById: async (id: string) => clone(state.outbox.find((o) => o.id === id) ?? null),
  listDue: async (now: Date, limit: number) => cloneAll(state.outbox.filter((o) => o.state === "pending" && o.nextAttemptAt <= now).slice(0, limit)),
  claim: async (id: string, now: Date, leaseUntil: Date) => {
    const row = state.outbox.find((o) => o.id === id);
    if (!row || row.state !== "pending" || row.nextAttemptAt > now) return false;
    Object.assign(row, { nextAttemptAt: leaseUntil, attempts: row.attempts + 1 });
    return true;
  },
  markDone: async (id: string) => {
    const row = state.outbox.find((o) => o.id === id);
    if (row?.state === "pending") Object.assign(row, { state: "done", lastError: null });
  },
  markFailed: async (id: string, error: string, next: string, nextAttemptAt: Date) => {
    const row = state.outbox.find((o) => o.id === id);
    if (row?.state === "pending") Object.assign(row, { state: next, lastError: error, nextAttemptAt });
  },
  savePayload: async (id: string, payload: Row) => {
    Object.assign(state.outbox.find((o) => o.id === id) as Row, { payload });
  },
};

// ----------------------------------------------------------------------- seeds
export const seed = {
  rider: (overrides: Row = {}) => {
    const row = {
      id: newId(),
      userId: newId(),
      applicationId: null,
      name: "Ravi Kumar",
      phone: `+9198${String(seq).padStart(8, "0")}`,
      email: null,
      city: "Bengaluru",
      vehicleType: "bike",
      vehicleNumber: "KA01AB1234",
      homeStoreId: null,
      status: "active",
      available: true,
      identityVerified: true,
      vehicleVerified: true,
      insuranceValid: true,
      insuranceExpiry: new Date(Date.now() + 90 * 86_400_000),
      lastLatitude: null,
      lastLongitude: null,
      lastLocationAt: null,
      suspendedReason: null,
      suspendedAt: null,
      ...overrides,
    };
    state.riders.push(row);
    return riderView(row) as Row;
  },
  shift: (riderId: string, overrides: Row = {}) => {
    const row = { id: newId(), riderId, startedAt: new Date(), endedAt: null, vehicleChecked: true, odometerKm: null, jobsCompleted: null, distanceMeters: null, earningsPaise: null, ...overrides };
    state.shifts.push(row);
    return row;
  },
  job: (overrides: Row = {}) => {
    const row = {
      ...jobDefaults(),
      id: newId(),
      orderId: newId(),
      orderNumber: "ORD-1001",
      type: "pickup",
      priority: "normal",
      storeId: "11111111-1111-4111-8111-111111111101",
      customerName: "Ana Rao",
      customerPhone: "+919845012345",
      addressLine1: "12 MG Road",
      addressLine2: null,
      landmark: null,
      city: "Bengaluru",
      pincode: "560001",
      latitude: null,
      longitude: null,
      coordinatesSource: null,
      slotFrom: new Date(),
      slotTo: new Date(Date.now() + 2 * 3_600_000),
      isPremium: false,
      isDelicate: false,
      requiresInspection: false,
      amountToCollectPaise: 0,
      careNotes: null,
      items: [],
      notes: null,
      handoverCode: "123456",
      createdByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    state.jobs.push(row);
    if (row.riderId && ACTIVE.includes(row.status)) state.assignments.push({ id: newId(), jobId: row.id, riderId: row.riderId, activeJobId: row.id, assignedAt: new Date(), releasedAt: null });
    return clone(row) as Row;
  },
  application: (overrides: Row = {}) => riderQuery.createApplication({ name: "Asha", phone: "+919800000001", openPhone: "+919800000001", email: null, city: "Bengaluru", vehicleType: "bike", vehicleNumber: "KA01AB1234", drivingLicenceMasked: "XXXXXXXX1234", idType: "aadhaar", idNumberMasked: "XXXXXXXX9012", preferredStoreId: null, uploadTokenHash: "0".repeat(64), ...overrides }),
};
