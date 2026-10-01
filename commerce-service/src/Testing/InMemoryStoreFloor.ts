// An in-memory stand-in for the store-floor Query modules, for tests that run the real services.
// It keeps the semantics the services rely on: store scoping, unique keys (in Prisma's error
// shape), conditional writes that report whether they applied, and a transaction that is
// isolated (one at a time) and rolled back when it throws. What it cannot prove (real SQL, real
// lock contention) the live run covers. Orders, stores and customers come from InMemoryCommerce.
import crypto from "crypto";
import { toPage } from "../../commons/Utils/Pagination.js";
import { state as commerce } from "./InMemoryCommerce.js";

const clone = <T>(value: T): T => structuredClone(value);
const id = () => crypto.randomUUID();
const now = () => new Date();

const uniqueViolation = (constraint: string) =>
  Object.assign(new Error(`Unique constraint failed on the constraint: \`${constraint}\``), { code: "P2002" });

export const floor = {
  pieces: new Map<string, any>(),
  batches: new Map<string, any>(),
  members: [] as { batchId: string; pieceId: string; addedAt: Date }[],
  machines: new Map<string, any>(),
  checks: [] as any[],
  faults: [] as any[],
  qcs: [] as any[],
  notes: [] as any[],
  collections: new Map<string, any>(),
  requests: new Map<string, any>(),
  tags: new Map<string, number>(),
  settings: new Map<string, any>(),
  rules: new Map<string, any>(),
  events: [] as any[],
};

const DEFAULT_RULES: [string, string, string, string, number, string][] = [
  ["cotton", "low", "Warm cotton 40°C", "Medium tumble", 40, "normal"],
  ["linen", "medium", "Gentle 30°C", "Low tumble", 30, "gentle"],
  ["wool", "high", "Wool cycle 20°C", "Flat dry", 20, "wool"],
  ["silk", "high", "Delicate cold 20°C", "Flat dry", 20, "delicate"],
  ["synthetic", "low", "Synthetic 30°C", "Low tumble", 30, "synthetic"],
  ["blend", "medium", "Gentle 30°C", "Low tumble", 30, "gentle"],
  ["denim", "medium", "Cool denim 30°C", "Medium tumble", 30, "normal"],
  ["leather", "high", "Specialist leather care", "none", 0, "none"],
  ["unknown", "medium", "Gentle 30°C", "Low tumble", 30, "gentle"],
];

const seedRules = () => {
  floor.rules.clear();
  for (const [fabric, risk, washProgramme, dryProgramme, maxTemperatureC, cycle] of DEFAULT_RULES) {
    floor.rules.set(fabric, { id: id(), fabric, risk, handling: `${fabric} handling`, washProgramme, dryProgramme, maxTemperatureC, cycle });
  }
};

export const resetFloor = () => {
  for (const key of ["pieces", "batches", "machines", "collections", "requests", "tags", "settings"] as const) floor[key].clear();
  for (const key of ["members", "checks", "faults", "qcs", "notes", "events"] as const) floor[key].length = 0;
  seedRules();
  mutex = Promise.resolve();
};

// ------------------------------------------------------------- transaction
let mutex: Promise<void> = Promise.resolve();

const snapshot = () => ({
  floor: Object.fromEntries(Object.entries(floor).map(([k, v]) => [k, clone(v)])),
  orders: clone(commerce.orders),
});

const restore = (saved: ReturnType<typeof snapshot>) => {
  for (const [key, value] of Object.entries(saved.floor)) {
    const target = (floor as any)[key];
    if (target instanceof Map) {
      target.clear();
      for (const [k, v] of value as Map<any, any>) target.set(k, v);
    } else {
      target.length = 0;
      target.push(...(value as any[]));
    }
  }
  commerce.orders.clear();
  for (const [k, v] of saved.orders) commerce.orders.set(k, v);
};

// Transactions run one at a time and undo everything on failure: the isolation a real database
// gives. Row locks taken through the order fake are released when the transaction ends.
export const floorTransaction = {
  run: async <T>(work: (tx: any) => Promise<T>): Promise<T> => {
    const previous = mutex;
    let release!: () => void;
    mutex = new Promise<void>((resolve) => (release = resolve));
    await previous;
    const saved = snapshot();
    const tx = { held: new Map<string, () => void>() };
    try {
      return await work(tx);
    } catch (error) {
      restore(saved);
      throw error;
    } finally {
      for (const free of tx.held.values()) free();
      release();
    }
  },
};

const scoped = (row: any, storeId: string | null) => row && (!storeId || row.storeId === storeId);

// ------------------------------------------------------------------ pieces
export const pieceQuery = {
  allocateTags: async (storeId: string, count: number) => {
    const next = (floor.tags.get(storeId) ?? 0) + count;
    floor.tags.set(storeId, next);
    return next;
  },
  createMany: async (rows: any[]) =>
    rows.map((row) => {
      if ([...floor.pieces.values()].some((p) => p.storeId === row.storeId && p.tagCode === row.tagCode)) {
        throw uniqueViolation("commerce_garment_pieces_storeId_tagCode_key");
      }
      const piece = {
        id: id(), stage: "received", activeBatchId: null, processWash: null, processDry: null, processTemperatureC: null,
        processCycle: null, suggestedWash: null, suggestedDry: null, overrideReason: null, processSetBy: null,
        processSetAt: null, qcPassedAt: null, reworkCount: 0, createdAt: now(), ...row,
      };
      floor.pieces.set(piece.id, piece);
      return clone(piece);
    }),
  listByOrder: async (orderId: string, storeId: string | null) =>
    [...floor.pieces.values()].filter((p) => p.orderId === orderId && scoped(p, storeId)).sort((a, b) => a.tagCode.localeCompare(b.tagCode)).map(clone),
  findInOrder: async (orderId: string, pieceId: string, storeId: string | null) => {
    const piece = floor.pieces.get(pieceId);
    return piece && piece.orderId === orderId && scoped(piece, storeId) ? clone(piece) : null;
  },
  findManyInStore: async (ids: string[], storeId: string | null) =>
    ids.map((i) => floor.pieces.get(i)).filter((p) => p && scoped(p, storeId)).map(clone),
  stageCounts: async (orderId: string) => {
    const counts: Record<string, number> = {};
    for (const p of floor.pieces.values()) if (p.orderId === orderId) counts[p.stage] = (counts[p.stage] ?? 0) + 1;
    return counts;
  },
  edit: async (pieceId: string, data: any, guard: any) => {
    const piece = floor.pieces.get(pieceId);
    if (!piece || (guard.stage && piece.stage !== guard.stage) || (guard.noBatch && piece.activeBatchId)) return false;
    Object.assign(piece, data);
    return true;
  },
  remove: async (pieceId: string, guard: any) => {
    const piece = floor.pieces.get(pieceId);
    if (!piece || (guard.stage && piece.stage !== guard.stage) || (guard.noBatch && piece.activeBatchId)) return false;
    floor.pieces.delete(pieceId);
    return true;
  },
  claimForBatch: async (ids: string[], batchId: string, stage: string, storeId: string) => {
    let count = 0;
    for (const i of ids) {
      const piece = floor.pieces.get(i);
      if (piece && piece.storeId === storeId && piece.stage === stage && !piece.activeBatchId) {
        piece.activeBatchId = batchId;
        count += 1;
      }
    }
    return count;
  },
  releaseFromBatch: async (ids: string[], batchId: string) => {
    let count = 0;
    for (const i of ids) {
      const piece = floor.pieces.get(i);
      if (piece && piece.activeBatchId === batchId) {
        piece.activeBatchId = null;
        count += 1;
      }
    }
    return count;
  },
  advanceBatchPieces: async (batchId: string, from: string, to: string, options: { clearBatch: boolean; dryNone?: boolean }) => {
    let count = 0;
    for (const piece of floor.pieces.values()) {
      const none = (piece.processDry ?? "").toLowerCase() === "none";
      if (piece.activeBatchId !== batchId || piece.stage !== from) continue;
      if (options.dryNone !== undefined && options.dryNone !== none) continue;
      piece.stage = to;
      if (options.clearBatch) piece.activeBatchId = null;
      count += 1;
    }
    return count;
  },
  waitingForBatch: async (storeId: string, stage: string, limit: number) =>
    [...floor.pieces.values()]
      .filter((p) => p.storeId === storeId && p.stage === stage && !p.activeBatchId)
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.tagCode.localeCompare(b.tagCode))
      .slice(0, limit)
      .map(clone),
  markQcPassed: async (ids: string[], orderId: string, at: Date) => {
    let count = 0;
    for (const i of ids) {
      const piece = floor.pieces.get(i);
      if (piece && piece.orderId === orderId && piece.stage === "quality_check") {
        piece.qcPassedAt = at;
        count += 1;
      }
    }
    return count;
  },
  sendBackForRework: async (ids: string[], orderId: string) => {
    let count = 0;
    for (const i of ids) {
      const piece = floor.pieces.get(i);
      if (piece && piece.orderId === orderId && piece.stage === "quality_check") {
        Object.assign(piece, { stage: "sorted", qcPassedAt: null, reworkCount: piece.reworkCount + 1 });
        count += 1;
      }
    }
    return count;
  },
  packOrder: async (orderId: string) => {
    let count = 0;
    for (const piece of floor.pieces.values()) {
      if (piece.orderId === orderId && piece.stage === "quality_check" && piece.qcPassedAt) {
        piece.stage = "packed";
        count += 1;
      }
    }
    return count;
  },
};

// ----------------------------------------------------------------- batches
const batchView = (batch: any) => ({ ...clone(batch), pieceCount: floor.members.filter((m) => m.batchId === batch.id).length });

export const batchQuery = {
  create: async (data: any, pieceIds: string[]) => {
    const batch = { id: id(), status: "planned", machineId: null, startedAt: null, finishedAt: null, loadWeightGrams: null, notes: null, createdAt: now(), ...data };
    floor.batches.set(batch.id, batch);
    for (const pieceId of pieceIds) floor.members.push({ batchId: batch.id, pieceId, addedAt: now() });
    return batchView(batch);
  },
  findById: async (batchId: string, storeId: string | null) => {
    const batch = floor.batches.get(batchId);
    return scoped(batch, storeId) ? batchView(batch) : null;
  },
  listPieces: async (batchId: string) =>
    floor.members.filter((m) => m.batchId === batchId).map((m) => clone(floor.pieces.get(m.pieceId))).filter(Boolean),
  search: async (filter: any, request: any) => {
    const rows = [...floor.batches.values()]
      .filter(
        (b) =>
          scoped(b, filter.storeId) &&
          (!filter.status || b.status === filter.status) &&
          (!filter.serviceId || b.serviceId === filter.serviceId) &&
          (!filter.dueBefore || (b.dueAt && b.dueAt <= filter.dueBefore))
      )
      .sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    return toPage(rows.slice(request.offset, request.offset + request.limit).map(batchView), rows.length, request);
  },
  transition: async (batchId: string, from: string[], to: string, data: any) => {
    const batch = floor.batches.get(batchId);
    if (!batch || !from.includes(batch.status)) return false;
    Object.assign(batch, data, { status: to });
    return true;
  },
  setMachine: async (batchId: string, expected: string | null, machineId: string | null) => {
    const batch = floor.batches.get(batchId);
    if (!batch || batch.status !== "planned" || batch.machineId !== expected) return false;
    batch.machineId = machineId;
    return true;
  },
  unassignMachine: async (machineId: string) => {
    for (const batch of floor.batches.values()) if (batch.machineId === machineId && batch.status === "planned") batch.machineId = null;
  },
  addMembers: async (batchId: string, pieceIds: string[]) => {
    for (const pieceId of pieceIds) floor.members.push({ batchId, pieceId, addedAt: now() });
  },
  removeMember: async (batchId: string, pieceId: string) => {
    const index = floor.members.findIndex((m) => m.batchId === batchId && m.pieceId === pieceId);
    if (index < 0) return false;
    floor.members.splice(index, 1);
    return true;
  },
  memberCount: async (batchId: string) => floor.members.filter((m) => m.batchId === batchId).length,
};

// ---------------------------------------------------------------- machines
export const machineQuery = {
  register: async (data: any) => {
    const existing = [...floor.machines.values()].find((m) => m.storeId === data.storeId && m.code === data.code);
    if (existing) {
      const { storeId: _s, code: _c, ...description } = data;
      Object.assign(existing, description);
      return clone(existing);
    }
    const machine = { id: id(), state: "idle", currentBatchId: null, reservedUntil: null, freeAt: null, ...data };
    floor.machines.set(machine.id, machine);
    return clone(machine);
  },
  findById: async (machineId: string, storeId: string | null) => {
    const machine = floor.machines.get(machineId);
    return scoped(machine, storeId) ? clone(machine) : null;
  },
  lock: async (machineId: string, storeId: string | null) => {
    const machine = floor.machines.get(machineId);
    return scoped(machine, storeId) ? clone(machine) : null;
  },
  search: async (filter: any, request: any) => {
    const rows = [...floor.machines.values()]
      .filter(
        (m) =>
          scoped(m, filter.storeId) &&
          (!filter.type || m.type === filter.type) &&
          (!filter.states || filter.states.includes(m.state)) &&
          (!filter.finishingBefore || (m.freeAt && m.freeAt <= filter.finishingBefore)) &&
          (!filter.finishingAfter || !m.freeAt || m.freeAt > filter.finishingAfter)
      )
      .sort((a, b) => a.code.localeCompare(b.code));
    return toPage(rows.slice(request.offset, request.offset + request.limit).map(clone), rows.length, request);
  },
  available: async (storeId: string, type: string | undefined, at: Date) =>
    [...floor.machines.values()]
      .filter((m) => m.storeId === storeId && (!type || m.type === type) && (m.state === "idle" || (["running", "reserved"].includes(m.state) && m.freeAt && m.freeAt <= at)))
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(clone),
  reserve: async (machineId: string, storeId: string, batchId: string, until: Date | null) => {
    const machine = floor.machines.get(machineId);
    if (!machine || machine.storeId !== storeId || machine.state !== "idle") return false;
    Object.assign(machine, { state: "reserved", currentBatchId: batchId, reservedUntil: until, freeAt: until });
    return true;
  },
  release: async (machineId: string, batchId: string | null) => {
    const machine = floor.machines.get(machineId);
    if (!machine || machine.state !== "reserved" || (batchId && machine.currentBatchId !== batchId)) return false;
    Object.assign(machine, { state: "idle", currentBatchId: null, reservedUntil: null, freeAt: null });
    return true;
  },
  start: async (machineId: string, batchId: string, freeAt: Date) => {
    const machine = floor.machines.get(machineId);
    if (!machine || machine.state !== "reserved" || machine.currentBatchId !== batchId) return false;
    Object.assign(machine, { state: "running", reservedUntil: null, freeAt });
    return true;
  },
  finish: async (machineId: string, batchId: string) => {
    const machine = floor.machines.get(machineId);
    if (!machine || machine.currentBatchId !== batchId) return;
    if (machine.state === "running") Object.assign(machine, { state: "idle", currentBatchId: null, freeAt: null });
    else if (machine.state === "faulted" || machine.state === "maintenance") Object.assign(machine, { currentBatchId: null, freeAt: null });
  },
  setState: async (machineId: string, newState: string, clearReservation: boolean) => {
    const machine = floor.machines.get(machineId);
    machine.state = newState;
    if (clearReservation) Object.assign(machine, { currentBatchId: null, reservedUntil: null, freeAt: null });
  },
  saveCheck: async (data: any) => {
    const existing = floor.checks.find((c) => c.machineId === data.machineId && c.checkDate.getTime() === data.checkDate.getTime());
    if (existing) return clone(Object.assign(existing, data));
    const check = { id: id(), createdAt: now(), ...data };
    floor.checks.push(check);
    return clone(check);
  },
  listChecks: async (machineId: string, range: any, request: any) => {
    const rows = floor.checks
      .filter((c) => c.machineId === machineId && (!range.from || c.checkDate >= range.from) && (!range.to || c.checkDate <= range.to))
      .sort((a, b) => b.checkDate.getTime() - a.checkDate.getTime());
    return toPage(rows.slice(request.offset, request.offset + request.limit).map(clone), rows.length, request);
  },
  checksOn: async (machineIds: string[], date: Date) =>
    new Map(floor.checks.filter((c) => machineIds.includes(c.machineId) && c.checkDate.getTime() === date.getTime()).map((c) => [c.machineId, c.status])),
  addFault: async (data: any) => {
    const fault = { id: id(), status: "open", resolvedAt: null, createdAt: now(), ...data };
    floor.faults.push(fault);
    return clone(fault);
  },
  openFaultCounts: async (machineIds: string[]) => {
    const counts = new Map<string, number>();
    for (const f of floor.faults) if (f.status === "open" && machineIds.includes(f.machineId)) counts.set(f.machineId, (counts.get(f.machineId) ?? 0) + 1);
    return counts;
  },
  resolveFaults: async (machineId: string) => {
    let count = 0;
    for (const f of floor.faults) if (f.machineId === machineId && f.status === "open") Object.assign(f, { status: "resolved", resolvedAt: now() }), (count += 1);
    return count;
  },
  listOpenFaults: async (storeId: string | null, request: any) => {
    const rows = floor.faults.filter((f) => f.status === "open" && scoped(f, storeId)).sort((a, b) => b.createdAt - a.createdAt);
    return toPage(rows.slice(request.offset, request.offset + request.limit).map(clone), rows.length, request);
  },
};

// ----------------------------------------------------------- quality, rules
export const qualityQuery = {
  create: async (data: any) => {
    const { results, ...rest } = data;
    const check = { id: id(), createdAt: new Date(now().getTime() + floor.qcs.length), ...rest, results: clone(results) };
    floor.qcs.push(check);
    return clone(check);
  },
  latestForOrder: async (orderId: string, storeId: string | null) => {
    const rows = floor.qcs.filter((c) => c.orderId === orderId && scoped(c, storeId));
    return rows.length ? clone(rows[rows.length - 1]) : null;
  },
};

export const fabricRuleQuery = {
  search: async (fabric: string | undefined, request: any) => {
    const rows = [...floor.rules.values()].filter((r) => !fabric || r.fabric === fabric).sort((a, b) => a.fabric.localeCompare(b.fabric));
    return toPage(rows.slice(request.offset, request.offset + request.limit).map(clone), rows.length, request);
  },
  findByFabric: async (fabric: string) => clone(floor.rules.get(fabric) ?? null),
  findByFabrics: async (fabrics: string[]) => new Map(fabrics.filter((f) => floor.rules.has(f)).map((f) => [f, clone(floor.rules.get(f))])),
};

// ----------------------------------------------------------- order helpers
export const storeOrderQuery = {
  addNote: async (data: any) => {
    const note = { id: id(), createdAt: now(), ...data };
    floor.notes.push(note);
    return clone(note);
  },
  listNotes: async (orderId: string) => floor.notes.filter((n) => n.orderId === orderId).map(clone),
  reassignStore: async (orderId: string, fromStoreId: string, toStoreId: string, movable: string[]) => {
    const order = commerce.orders.get(orderId);
    if (!order || order.storeId !== fromStoreId || !movable.includes(order.status)) return false;
    order.storeId = toStoreId;
    return true;
  },
  addEvent: async (data: any) => {
    const { orderId, ...event } = data;
    commerce.orders.get(orderId).events.push({ id: id(), at: now(), ...event });
  },
  createCollection: async (data: any) => {
    if (floor.collections.has(data.orderId)) throw uniqueViolation("commerce_order_collections_orderId_key");
    const row = { ...data, collectedAt: now() };
    floor.collections.set(data.orderId, row);
    return clone(row);
  },
  findCollection: async (orderId: string) => clone(floor.collections.get(orderId) ?? null),
  summaries: async (ids: string[]) =>
    ids.map((i) => commerce.orders.get(i)).filter(Boolean).map((o: any) => ({ id: o.id, storeId: o.storeId, ref: o.ref, status: o.status })),
  claimRequest: async (userId: string, key: string) => {
    if (floor.requests.has(`${userId}|${key}`)) throw uniqueViolation("uq_walkin_user_key");
    const row = { id: id(), userId, key, orderId: null };
    floor.requests.set(`${userId}|${key}`, row);
    return { id: row.id };
  },
  findRequest: async (userId: string, key: string) => clone(floor.requests.get(`${userId}|${key}`) ?? null),
  completeRequest: async (requestId: string, orderId: string) => {
    for (const row of floor.requests.values()) if (row.id === requestId) row.orderId = orderId;
  },
  releaseRequest: async (requestId: string) => {
    for (const [key, row] of floor.requests) if (row.id === requestId && !row.orderId) floor.requests.delete(key);
  },
};

// ---------------------------------------------------------------- capacity
const IST_MS = 330 * 60_000;
const istDate = (at: Date) => new Date(at.getTime() + IST_MS).toISOString().slice(0, 10);

export const capacityQuery = {
  settings: async (storeId: string | null) => [...floor.settings.values()].filter((s) => !storeId || s.storeId === storeId).map(clone),
  saveSetting: async (data: any) => {
    floor.settings.set(data.storeId, clone(data));
    return clone(data);
  },
  machineAggregates: async (storeId: string | null) => {
    const groups = new Map<string, any>();
    for (const m of floor.machines.values()) {
      if (storeId && m.storeId !== storeId) continue;
      const key = `${m.type}|${m.state}`;
      const group = groups.get(key) ?? { type: m.type, state: m.state, count: 0, capacityGrams: 0 };
      group.count += 1;
      group.capacityGrams += m.capacityGrams;
      groups.set(key, group);
    }
    return [...groups.values()];
  },
  dayLoads: async (storeId: string | null, fromDate: string, toDate: string, openStatuses: string[], gramsPerPiece: number) => {
    const days = new Map<string, any>();
    for (const o of commerce.orders.values()) {
      if ((storeId && o.storeId !== storeId) || !openStatuses.includes(o.status)) continue;
      const due = istDate(o.promisedAt);
      if (due >= toDate) continue;
      const date = due < fromDate ? fromDate : due;
      const grams = o.weightGrams > 0 ? o.weightGrams : o.pieces * gramsPerPiece;
      const day = days.get(date) ?? { date, orders: 0, committedGrams: 0, expressGrams: 0 };
      day.orders += 1;
      day.committedGrams += grams;
      if (o.priority === "express") day.expressGrams += grams;
      days.set(date, day);
    }
    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  },
  expressCandidates: async (storeId: string | null, statuses: string[], limit: number) =>
    [...commerce.orders.values()]
      .filter((o) => (!storeId || o.storeId === storeId) && o.priority === "express" && statuses.includes(o.status))
      .sort((a, b) => a.promisedAt - b.promisedAt)
      .slice(0, limit)
      .map((o) => ({ orderId: o.id, ref: o.ref, storeId: o.storeId, status: o.status, promisedAt: o.promisedAt })),
};
