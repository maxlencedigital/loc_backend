// An in-memory stand-in for the equipment and IT Query modules, for tests that run the real
// services end to end. It keeps what the services rely on: store scoping, unique keys (with
// Prisma's error shape), newest-first paging, and row locks held until the transaction ends.
// What it cannot prove (SQL, real transactions) the live run covers.
import crypto from "crypto";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const clone = <T>(value: T): T => structuredClone(value);
const id = () => crypto.randomUUID();
const now = () => new Date();
const uniqueViolation = (constraint: string) =>
  Object.assign(new Error(`Unique constraint failed on the constraint: \`${constraint}\``), { code: "P2002" });

interface Tx {
  held: Map<string, () => void>;
}

export const db = {
  stores: new Map<string, any>(),
  equipment: new Map<string, any>(),
  equipmentEvents: [] as any[],
  inspections: [] as any[],
  repairs: [] as any[],
  tasks: new Map<string, any>(),
  logs: [] as any[],
  tagCounter: { value: 0 },
  devices: new Map<string, any>(),
  deviceEvents: [] as any[],
  deviceRepairs: [] as any[],
  licences: new Map<string, any>(),
  seats: [] as any[],
  licenceEvents: [] as any[],
  requests: new Map<string, any>(),
  comments: [] as any[],
  requestEvents: [] as any[],
  locks: new Map<string, Promise<void>>(),
};

export const reset = () => {
  for (const value of Object.values(db)) {
    if (value instanceof Map) value.clear();
    else if (Array.isArray(value)) value.length = 0;
  }
  db.tagCounter.value = 0;
};

const acquire = async (tx: Tx, key: string) => {
  if (tx.held.has(key)) return;
  const previous = db.locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  db.locks.set(key, previous.then(() => mine));
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

const paged = <T>(rows: T[], page: { offset: number; limit: number; page: number }) => ({
  items: rows.slice(page.offset, page.offset + page.limit).map(clone),
  total: rows.length,
  page: page.page,
  limit: page.limit,
});
const newestFirst = (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);
const inStore = (row: any, storeId: string | null) => !storeId || row.storeId === storeId;

export const storeQuery = {
  findById: async (storeId: string) => (db.stores.has(storeId) ? clone(db.stores.get(storeId)) : null),
};

// ------------------------------------------------------------------ equipment
const equipmentEvent = (equipmentId: string, event: any) => db.equipmentEvents.push({ id: id(), equipmentId, at: now(), ...event });

export const equipmentQuery = {
  inTransaction,
  nextTagNumber: async () => ++db.tagCounter.value,
  create: async (data: any, event: any) => {
    await tick();
    if ([...db.equipment.values()].some((e) => e.assetTag === data.assetTag)) throw uniqueViolation("commerce_equipment_assetTag_key");
    const row = { id: id(), retiredAt: null, retiredReason: null, createdAt: now(), updatedAt: now(), ...data };
    delete row.createdByUserId;
    db.equipment.set(row.id, row);
    equipmentEvent(row.id, event);
    return clone(row);
  },
  findById: async (equipmentId: string, scope: string | null) => {
    await tick();
    const row = db.equipment.get(equipmentId);
    return row && inStore(row, scope) ? clone(row) : null;
  },
  lockById: async (equipmentId: string, scope: string | null, tx: Tx) => {
    const row = db.equipment.get(equipmentId);
    if (!row || !inStore(row, scope)) return null;
    await acquire(tx, `eq:${equipmentId}`);
    await tick();
    return clone(db.equipment.get(equipmentId));
  },
  update: async (equipmentId: string, data: any, event: any) => {
    await tick();
    const row = Object.assign(db.equipment.get(equipmentId), data, { updatedAt: now() });
    if (event) equipmentEvent(equipmentId, event);
    return clone(row);
  },
  search: async (filter: any, page: any) =>
    paged(
      [...db.equipment.values()]
        .filter((e) => inStore(e, filter.storeId) && (!filter.type || e.type === filter.type) && (!filter.status || e.status === filter.status))
        .sort(newestFirst),
      page
    ),
  findManyByIds: async (ids: string[]) => ids.filter((x) => db.equipment.has(x)).map((x) => clone(db.equipment.get(x))),
  listStatusEvents: async (equipmentId: string, limit: number) =>
    db.equipmentEvents.filter((e) => e.equipmentId === equipmentId).reverse().slice(0, limit).map(clone),
  countByStatus: async (storeId: string | null) => {
    const counts: Record<string, number> = {};
    for (const e of db.equipment.values()) if (inStore(e, storeId)) counts[e.status] = (counts[e.status] ?? 0) + 1;
    return counts;
  },
  countWithRepairSince: async (storeId: string | null, since: Date) =>
    [...db.equipment.values()].filter((e) => inStore(e, storeId) && db.repairs.some((r) => r.equipmentId === e.id && r.reportedOn >= since)).length,
};

export const equipmentRecordsQuery = {
  createInspection: async (equipmentId: string, data: any) => {
    const row = { id: id(), equipmentId, createdAt: now(), ...data };
    db.inspections.push(row);
    return clone(row);
  },
  listInspections: async (equipmentId: string, page: any) =>
    paged(db.inspections.filter((i) => i.equipmentId === equipmentId).sort((a, b) => b.inspectedOn - a.inspectedOn), page),
  createRepair: async (equipmentId: string, data: any) => {
    await tick();
    const row = { id: id(), equipmentId, resolvedOn: null, notes: null, createdAt: now(), ...data };
    db.repairs.push(row);
    return clone(row);
  },
  findRepair: async (equipmentId: string, repairId: string) => {
    const row = db.repairs.find((r) => r.id === repairId && r.equipmentId === equipmentId);
    return row ? clone(row) : null;
  },
  updateRepair: async (repairId: string, data: any) => clone(Object.assign(db.repairs.find((r) => r.id === repairId), data)),
  listRepairs: async (equipmentId: string, page: any) =>
    paged(db.repairs.filter((r) => r.equipmentId === equipmentId).sort((a, b) => b.reportedOn - a.reportedOn), page),
  countOpenRepairs: async (equipmentId: string, except: string | null) =>
    db.repairs.filter((r) => r.equipmentId === equipmentId && r.resolvedOn === null && r.id !== except).length,
  listRepairsOverlapping: async (equipmentId: string, from: Date, to: Date, limit: number) =>
    db.repairs
      .filter((r) => r.equipmentId === equipmentId && r.reportedOn <= to && (r.resolvedOn === null || r.resolvedOn >= from))
      .sort((a, b) => a.reportedOn - b.reportedOn)
      .slice(0, limit)
      .map(clone),
  repairSpendSince: async (storeId: string | null, since: Date, limit: number) => {
    const sums = new Map<string, number>();
    for (const r of db.repairs) {
      const machine = db.equipment.get(r.equipmentId);
      if (r.reportedOn >= since && machine.status !== "retired" && inStore(machine, storeId)) {
        sums.set(r.equipmentId, (sums.get(r.equipmentId) ?? 0) + (r.costPaise ?? 0));
      }
    }
    return [...sums].map(([equipmentId, costPaise]) => ({ equipmentId, costPaise })).sort((a, b) => b.costPaise - a.costPaise).slice(0, limit);
  },
};

const dueRows = (range: any) =>
  [...db.tasks.values()].filter((t) => {
    const machine = db.equipment.get(t.equipmentId);
    return machine.status !== "retired" && inStore(machine, range.storeId) && (!range.from || t.nextDueOn >= range.from) && t.nextDueOn <= range.to;
  });

export const equipmentMaintenanceQuery = {
  listTasks: async (equipmentId: string) =>
    [...db.tasks.values()].filter((t) => t.equipmentId === equipmentId).sort((a, b) => a.nextDueOn - b.nextDueOn || a.name.localeCompare(b.name)).map(clone),
  applyPlan: async (equipmentId: string, plan: any) => {
    for (const taskId of plan.removeIds) db.tasks.delete(taskId);
    for (const { id: taskId, ...data } of plan.update) Object.assign(db.tasks.get(taskId), data);
    for (const draft of plan.create) {
      const row = { id: id(), equipmentId, ...draft };
      db.tasks.set(row.id, row);
    }
  },
  deleteForEquipment: async (equipmentId: string) => {
    for (const [taskId, t] of db.tasks) if (t.equipmentId === equipmentId) db.tasks.delete(taskId);
  },
  listDue: async (range: any, page: any) => {
    const rows = dueRows(range).sort((a, b) => a.nextDueOn - b.nextDueOn);
    const result = paged(rows, page);
    return { ...result, items: result.items.map((t: any) => ({ ...t, equipmentName: db.equipment.get(t.equipmentId).name })) };
  },
  countDue: async (range: any) => dueRows(range).length,
  lockTask: async (taskId: string, scope: string | null, tx: Tx) => {
    const task = db.tasks.get(taskId);
    if (!task || !inStore(db.equipment.get(task.equipmentId), scope)) return null;
    await acquire(tx, `task:${taskId}`);
    await tick();
    return { task: clone(db.tasks.get(taskId)), equipmentName: db.equipment.get(task.equipmentId).name };
  },
  recordCompletion: async (task: any, doneOn: Date, nextDueOn: Date, log: any) => {
    if (db.logs.some((l) => l.taskId === task.id && l.doneOn.getTime() === doneOn.getTime())) throw uniqueViolation("taskId_doneOn_key");
    Object.assign(db.tasks.get(task.id), { lastDoneOn: doneOn, nextDueOn });
    const row = { id: id(), equipmentId: task.equipmentId, taskId: task.id, ...log };
    db.logs.push(row);
    return { task: clone(db.tasks.get(task.id)), log: clone(row) };
  },
};

// ------------------------------------------------------------------------- IT
export const itDeviceQuery = {
  inTransaction,
  create: async (data: any, event: any) => {
    await tick();
    if ([...db.devices.values()].some((d) => d.assetTag === data.assetTag)) throw uniqueViolation("commerce_it_devices_assetTag_key");
    const row = { id: id(), assignedToEmployeeId: null, assignedAt: null, createdAt: now(), updatedAt: now(), ...data };
    db.devices.set(row.id, row);
    db.deviceEvents.push({ id: id(), deviceId: row.id, at: now(), ...event });
    return clone(row);
  },
  findById: async (deviceId: string) => {
    await tick();
    return db.devices.has(deviceId) ? clone(db.devices.get(deviceId)) : null;
  },
  lockById: async (deviceId: string, tx: Tx) => {
    if (!db.devices.has(deviceId)) return null;
    await acquire(tx, `dev:${deviceId}`);
    await tick();
    return clone(db.devices.get(deviceId));
  },
  update: async (deviceId: string, data: any, event: any) => {
    await tick();
    if (data.assetTag && [...db.devices.values()].some((d) => d.id !== deviceId && d.assetTag === data.assetTag)) throw uniqueViolation("commerce_it_devices_assetTag_key");
    const row = Object.assign(db.devices.get(deviceId), data, { updatedAt: now() });
    if (event) db.deviceEvents.push({ id: id(), deviceId, at: now(), ...event });
    return clone(row);
  },
  search: async (filter: any, page: any) =>
    paged(
      [...db.devices.values()]
        .filter((d) => (!filter.type || d.type === filter.type) && (!filter.status || d.status === filter.status) && (!filter.assignedTo || d.assignedToEmployeeId === filter.assignedTo))
        .sort(newestFirst),
      page
    ),
  listEvents: async (deviceId: string, limit: number) => db.deviceEvents.filter((e) => e.deviceId === deviceId).slice(-limit).reverse().map(clone),
  exists: async (deviceId: string) => db.devices.has(deviceId),
  createRepair: async (deviceId: string, data: any) => {
    const row = { id: id(), deviceId, ...data };
    db.deviceRepairs.push(row);
    return clone(row);
  },
  listRepairs: async (deviceId: string, page: any) => paged(db.deviceRepairs.filter((r) => r.deviceId === deviceId).sort((a, b) => b.repairedOn - a.repairedOn), page),
};

const liveLicence = (licenceId: string) => {
  const row = db.licences.get(licenceId);
  return row && !row.deletedAt ? row : null;
};

export const itLicenceQuery = {
  inTransaction,
  create: async (data: any) => {
    const row = { id: id(), seatsUsed: 0, deletedAt: null, createdAt: now(), updatedAt: now(), ...data };
    db.licences.set(row.id, row);
    return clone(row);
  },
  findById: async (licenceId: string) => {
    await tick();
    return liveLicence(licenceId) ? clone(liveLicence(licenceId)) : null;
  },
  lockById: async (licenceId: string, tx: Tx) => {
    if (!liveLicence(licenceId)) return null;
    await acquire(tx, `lic:${licenceId}`);
    await tick();
    return clone(liveLicence(licenceId));
  },
  update: async (licenceId: string, data: any) => clone(Object.assign(db.licences.get(licenceId), data)),
  softDelete: async (licenceId: string) => {
    db.licences.get(licenceId).deletedAt = now();
  },
  search: async (page: any) => paged([...db.licences.values()].filter((l) => !l.deletedAt).sort((a, b) => a.software.localeCompare(b.software)), page),
  hasSeat: async (licenceId: string, employeeId: string) => db.seats.some((s) => s.licenceId === licenceId && s.employeeId === employeeId),
  addSeat: async (licenceId: string, employeeId: string, event: any) => {
    await tick();
    if (db.seats.some((s) => s.licenceId === licenceId && s.employeeId === employeeId)) throw uniqueViolation("licenceId_employeeId_key");
    db.seats.push({ licenceId, employeeId, assignedAt: now() });
    db.licences.get(licenceId).seatsUsed += 1;
    db.licenceEvents.push({ id: id(), licenceId, at: now(), ...event });
    return clone(db.licences.get(licenceId));
  },
  removeSeat: async (licenceId: string, employeeId: string, event: any) => {
    const index = db.seats.findIndex((s) => s.licenceId === licenceId && s.employeeId === employeeId);
    if (index < 0) return null;
    db.seats.splice(index, 1);
    db.licences.get(licenceId).seatsUsed -= 1;
    db.licenceEvents.push({ id: id(), licenceId, at: now(), ...event });
    return clone(db.licences.get(licenceId));
  },
  listHolders: async (licenceId: string, limit: number) => db.seats.filter((s) => s.licenceId === licenceId).slice(0, limit).map(clone),
  listEvents: async (licenceId: string, limit: number) => db.licenceEvents.filter((e) => e.licenceId === licenceId).slice(-limit).reverse().map(clone),
};

export const itRequestQuery = {
  inTransaction,
  create: async (data: any, event: any) => {
    const row = { id: id(), status: "open", assigneeUserId: null, assigneeName: null, resolution: null, closedAt: null, createdAt: now(), updatedAt: now(), ...data };
    db.requests.set(row.id, row);
    db.requestEvents.push({ id: id(), requestId: row.id, at: now(), ...event });
    return clone(row);
  },
  findById: async (requestId: string) => {
    await tick();
    return db.requests.has(requestId) ? clone(db.requests.get(requestId)) : null;
  },
  lockById: async (requestId: string, tx: Tx) => {
    if (!db.requests.has(requestId)) return null;
    await acquire(tx, `req:${requestId}`);
    await tick();
    return clone(db.requests.get(requestId));
  },
  update: async (requestId: string, data: any, events: any[]) => {
    const row = Object.assign(db.requests.get(requestId), data, { updatedAt: now() });
    for (const event of events) db.requestEvents.push({ id: id(), requestId, at: now(), ...event });
    return clone(row);
  },
  search: async (filter: any, page: any) =>
    paged(
      [...db.requests.values()]
        .filter((r) => (!filter.raisedByUserId || r.raisedByUserId === filter.raisedByUserId) && (!filter.status || r.status === filter.status) && (!filter.category || r.category === filter.category))
        .sort(newestFirst),
      page
    ),
  addComment: async (requestId: string, author: any, message: string) => {
    const row = { id: id(), requestId, authorName: author.name, message, createdAt: now() };
    db.comments.push(row);
    return clone(row);
  },
  listComments: async (requestId: string, limit: number) => db.comments.filter((c) => c.requestId === requestId).slice(-limit).map(clone),
  listEvents: async (requestId: string, limit: number) => db.requestEvents.filter((e) => e.requestId === requestId).slice(-limit).map(clone),
};
