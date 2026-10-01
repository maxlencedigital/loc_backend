import { prisma } from "../DB/Prisma.Connection.Db.js";
import { toPage } from "../../commons/Utils/Pagination.js";
import type { Page, PageRequest } from "../../commons/Utils/Pagination.js";
import type {
  FaultSeverity,
  IMachine,
  IMachineCheck,
  IMachineCreate,
  IMachineFault,
  IMachineFilter,
  MachineState,
  CheckStatus,
} from "../Models/StoreFloor/StoreFloor.Interface.js";
import type { Db } from "./Floor.Transaction.js";

const toMachine = (row: any): IMachine => row as IMachine;
const scopeWhere = (storeId: string | null) => (storeId ? { storeId } : {});

const filterWhere = (filter: IMachineFilter) => {
  const clauses: object[] = [];
  if (filter.states) clauses.push({ state: { in: filter.states } });
  // "finishing" is a running machine that frees up within minutes; "running" is the rest.
  if (filter.finishingBefore) clauses.push({ freeAt: { lte: filter.finishingBefore } });
  if (filter.finishingAfter) clauses.push({ OR: [{ freeAt: null }, { freeAt: { gt: filter.finishingAfter } }] });
  return { ...scopeWhere(filter.storeId), ...(filter.type ? { type: filter.type } : {}), ...(clauses.length ? { AND: clauses } : {}) };
};

// Idempotent on (store, code): registering the same machine again refreshes its description only.
const register = async (data: IMachineCreate, db: Db = prisma): Promise<IMachine> => {
  try {
    const { storeId, code, ...description } = data;
    return toMachine(
      await db.floorMachine.upsert({
        where: { storeId_code: { storeId, code } },
        create: data,
        update: description,
      })
    );
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, storeId: string | null, db: Db = prisma): Promise<IMachine | null> => {
  try {
    const row = await db.floorMachine.findFirst({ where: { id, ...scopeWhere(storeId) } });
    return row ? toMachine(row) : null;
  } catch (error) {
    throw error;
  }
};

// Row lock for the rest of the transaction (a no-op UPDATE), then the fresh row.
const lock = async (id: string, storeId: string | null, db: Db): Promise<IMachine | null> => {
  try {
    const { count } = await db.floorMachine.updateMany({ where: { id, ...scopeWhere(storeId) }, data: { updatedAt: new Date() } });
    return count === 0 ? null : await findById(id, storeId, db);
  } catch (error) {
    throw error;
  }
};

const search = async (filter: IMachineFilter, request: PageRequest, db: Db = prisma): Promise<Page<IMachine>> => {
  try {
    const where = filterWhere(filter);
    const [rows, total] = await Promise.all([
      db.floorMachine.findMany({ where, orderBy: [{ storeId: "asc" }, { code: "asc" }], skip: request.offset, take: request.limit }),
      db.floorMachine.count({ where }),
    ]);
    return toPage(rows.map(toMachine), total, request);
  } catch (error) {
    throw error;
  }
};

// Machines that can take a batch at `at`: idle now, or running/reserved and due free by then.
const available = async (storeId: string, type: IMachineFilter["type"], at: Date, db: Db = prisma): Promise<IMachine[]> => {
  try {
    const rows = await db.floorMachine.findMany({
      where: {
        storeId,
        ...(type ? { type } : {}),
        OR: [{ state: "idle" }, { state: { in: ["running", "reserved"] }, freeAt: { lte: at } }],
      },
      orderBy: [{ code: "asc" }],
      take: 100,
    });
    return rows.map(toMachine);
  } catch (error) {
    throw error;
  }
};

// Each transition below is one conditional UPDATE: it applies only from the expected state and
// reports whether it did. Two staff reserving one machine cannot both get a true.
const reserve = async (id: string, storeId: string, batchId: string, until: Date | null, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.floorMachine.updateMany({
      where: { id, storeId, state: "idle" },
      data: { state: "reserved", currentBatchId: batchId, reservedUntil: until, freeAt: until },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const release = async (id: string, batchId: string | null, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.floorMachine.updateMany({
      where: { id, state: "reserved", ...(batchId ? { currentBatchId: batchId } : {}) },
      data: { state: "idle", currentBatchId: null, reservedUntil: null, freeAt: null },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const start = async (id: string, batchId: string, freeAt: Date, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.floorMachine.updateMany({
      where: { id, state: "reserved", currentBatchId: batchId },
      data: { state: "running", reservedUntil: null, freeAt },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

// A finished batch frees a running machine. One that broke down meanwhile stays out of service,
// but no longer holds the batch.
const finish = async (id: string, batchId: string, db: Db): Promise<void> => {
  try {
    await db.floorMachine.updateMany({
      where: { id, state: "running", currentBatchId: batchId },
      data: { state: "idle", currentBatchId: null, freeAt: null },
    });
    await db.floorMachine.updateMany({
      where: { id, state: { in: ["faulted", "maintenance"] }, currentBatchId: batchId },
      data: { currentBatchId: null, freeAt: null },
    });
  } catch (error) {
    throw error;
  }
};

const setState = async (id: string, state: MachineState, clearReservation: boolean, db: Db): Promise<void> => {
  try {
    await db.floorMachine.update({
      where: { id },
      data: { state, ...(clearReservation ? { currentBatchId: null, reservedUntil: null, freeAt: null } : {}) },
    });
  } catch (error) {
    throw error;
  }
};

const toCheck = (row: any): IMachineCheck => row as IMachineCheck;

const saveCheck = async (
  data: { machineId: string; storeId: string; checkDate: Date; status: CheckStatus; checklist: unknown; note: string | null; checkedByName: string; checkedByUserId: string },
  db: Db
): Promise<IMachineCheck> => {
  try {
    const { machineId, checkDate, ...rest } = data;
    const body = { ...rest, checklist: data.checklist as object };
    return toCheck(
      await db.floorMachineCheck.upsert({
        where: { machineId_checkDate: { machineId, checkDate } },
        create: { machineId, checkDate, ...body },
        update: body,
      })
    );
  } catch (error) {
    throw error;
  }
};

const listChecks = async (machineId: string, range: { from?: Date; to?: Date }, request: PageRequest, db: Db = prisma): Promise<Page<IMachineCheck>> => {
  try {
    const where = { machineId, ...(range.from || range.to ? { checkDate: { gte: range.from, lte: range.to } } : {}) };
    const [rows, total] = await Promise.all([
      db.floorMachineCheck.findMany({ where, orderBy: [{ checkDate: "desc" }], skip: request.offset, take: request.limit }),
      db.floorMachineCheck.count({ where }),
    ]);
    return toPage(rows.map(toCheck), total, request);
  } catch (error) {
    throw error;
  }
};

// Status of the check recorded on `date`, for every machine in one query.
const checksOn = async (machineIds: string[], date: Date, db: Db = prisma): Promise<Map<string, CheckStatus>> => {
  try {
    const rows = await db.floorMachineCheck.findMany({ where: { machineId: { in: machineIds }, checkDate: date }, select: { machineId: true, status: true } });
    return new Map(rows.map((row) => [row.machineId, row.status]));
  } catch (error) {
    throw error;
  }
};

const addFault = async (
  data: { machineId: string; storeId: string; description: string; severity: FaultSeverity; reportedByName: string; reportedByUserId: string },
  db: Db
): Promise<IMachineFault> => {
  try {
    return (await db.floorMachineFault.create({ data })) as IMachineFault;
  } catch (error) {
    throw error;
  }
};

const openFaultCounts = async (machineIds: string[], db: Db = prisma): Promise<Map<string, number>> => {
  try {
    const groups = await db.floorMachineFault.groupBy({ by: ["machineId"], where: { machineId: { in: machineIds }, status: "open" }, _count: { _all: true } });
    return new Map(groups.map((g) => [g.machineId, g._count._all]));
  } catch (error) {
    throw error;
  }
};

const resolveFaults = async (machineId: string, db: Db): Promise<number> => {
  try {
    const { count } = await db.floorMachineFault.updateMany({ where: { machineId, status: "open" }, data: { status: "resolved", resolvedAt: new Date() } });
    return count;
  } catch (error) {
    throw error;
  }
};

const listOpenFaults = async (storeId: string | null, request: PageRequest, db: Db = prisma): Promise<Page<IMachineFault & { storeId: string }>> => {
  try {
    const where = { status: "open" as const, ...scopeWhere(storeId) };
    const [rows, total] = await Promise.all([
      db.floorMachineFault.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: request.offset, take: request.limit }),
      db.floorMachineFault.count({ where }),
    ]);
    return toPage(rows as unknown as (IMachineFault & { storeId: string })[], total, request);
  } catch (error) {
    throw error;
  }
};

export const MachineQuery = {
  register,
  findById,
  lock,
  search,
  available,
  reserve,
  release,
  start,
  finish,
  setState,
  saveCheck,
  listChecks,
  checksOn,
  addFault,
  openFaultCounts,
  resolveFaults,
  listOpenFaults,
};
