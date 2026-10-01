import { prisma } from "../DB/Prisma.Connection.Db.js";
import type {
  IPiece,
  IPieceCreate,
  IPieceEdit,
  IPieceGuard,
  PieceStage,
} from "../Models/StoreFloor/StoreFloor.Interface.js";
import { NO_DRYING } from "../Services/ProcessSuggestion.js";
import type { Db } from "./Floor.Transaction.js";

// An order never has more pieces than this: it bounds every per-order read.
const MAX_PIECES_PER_ORDER = 500;

const toPiece = (row: any): IPiece => row as IPiece;

const scopeWhere = (storeId: string | null) => (storeId ? { storeId } : {});

const guardWhere = (guard: IPieceGuard) => ({
  ...(guard.stage ? { stage: guard.stage } : {}),
  ...(guard.noBatch ? { activeBatchId: null } : {}),
});

// One atomic upsert-increment hands out a block of tag numbers; returns the last one.
const allocateTags = async (storeId: string, count: number, db: Db): Promise<number> => {
  try {
    const row = await db.floorTagCounter.upsert({
      where: { storeId },
      create: { storeId, value: count },
      update: { value: { increment: count } },
    });
    return row.value;
  } catch (error) {
    throw error;
  }
};

const createMany = async (rows: IPieceCreate[], db: Db): Promise<IPiece[]> => {
  try {
    const created = await db.garmentPiece.createManyAndReturn({ data: rows });
    return created.map(toPiece);
  } catch (error) {
    throw error;
  }
};

const listByOrder = async (orderId: string, storeId: string | null, db: Db = prisma): Promise<IPiece[]> => {
  try {
    const rows = await db.garmentPiece.findMany({
      where: { orderId, ...scopeWhere(storeId) },
      orderBy: [{ tagCode: "asc" }],
      take: MAX_PIECES_PER_ORDER,
    });
    return rows.map(toPiece);
  } catch (error) {
    throw error;
  }
};

const findInOrder = async (orderId: string, pieceId: string, storeId: string | null, db: Db = prisma): Promise<IPiece | null> => {
  try {
    const row = await db.garmentPiece.findFirst({ where: { id: pieceId, orderId, ...scopeWhere(storeId) } });
    return row ? toPiece(row) : null;
  } catch (error) {
    throw error;
  }
};

const findManyInStore = async (ids: string[], storeId: string | null, db: Db = prisma): Promise<IPiece[]> => {
  try {
    const rows = await db.garmentPiece.findMany({ where: { id: { in: ids }, ...scopeWhere(storeId) } });
    return rows.map(toPiece);
  } catch (error) {
    throw error;
  }
};

const stageCounts = async (orderId: string, db: Db = prisma): Promise<Partial<Record<PieceStage, number>>> => {
  try {
    const groups = await db.garmentPiece.groupBy({ by: ["stage"], where: { orderId }, _count: { _all: true } });
    return Object.fromEntries(groups.map((g) => [g.stage, g._count._all]));
  } catch (error) {
    throw error;
  }
};

// Every write below is conditional on the state the caller read, and reports whether it applied:
// that is the lock. Two staff acting on one piece cannot both succeed.
const edit = async (id: string, data: IPieceEdit, guard: IPieceGuard, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.garmentPiece.updateMany({ where: { id, ...guardWhere(guard) }, data });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const remove = async (id: string, guard: IPieceGuard, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.garmentPiece.deleteMany({ where: { id, ...guardWhere(guard) } });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const claimForBatch = async (ids: string[], batchId: string, stage: PieceStage, storeId: string, db: Db): Promise<number> => {
  try {
    const { count } = await db.garmentPiece.updateMany({
      where: { id: { in: ids }, storeId, stage, activeBatchId: null },
      data: { activeBatchId: batchId },
    });
    return count;
  } catch (error) {
    throw error;
  }
};

const releaseFromBatch = async (ids: string[], batchId: string, db: Db): Promise<number> => {
  try {
    const { count } = await db.garmentPiece.updateMany({
      where: { id: { in: ids }, activeBatchId: batchId },
      data: { activeBatchId: null },
    });
    return count;
  } catch (error) {
    throw error;
  }
};

// Moves the batch's pieces from one stage to the next. `dryNone` splits washing output: garments
// that are not machine dried go straight to quality check.
const advanceBatchPieces = async (
  batchId: string,
  from: PieceStage,
  to: PieceStage,
  options: { clearBatch: boolean; dryNone?: boolean },
  db: Db
): Promise<number> => {
  try {
    const dryFilter =
      options.dryNone === undefined
        ? {}
        : options.dryNone
          ? { processDry: { equals: NO_DRYING, mode: "insensitive" as const } }
          : { NOT: { processDry: { equals: NO_DRYING, mode: "insensitive" as const } } };
    const { count } = await db.garmentPiece.updateMany({
      where: { activeBatchId: batchId, stage: from, ...dryFilter },
      data: { stage: to, ...(options.clearBatch ? { activeBatchId: null } : {}) },
    });
    return count;
  } catch (error) {
    throw error;
  }
};

const waitingForBatch = async (storeId: string, stage: PieceStage, limit: number, db: Db = prisma): Promise<IPiece[]> => {
  try {
    const rows = await db.garmentPiece.findMany({
      where: { storeId, stage, activeBatchId: null },
      orderBy: [{ dueAt: "asc" }, { tagCode: "asc" }],
      take: limit,
    });
    return rows.map(toPiece);
  } catch (error) {
    throw error;
  }
};

const markQcPassed = async (ids: string[], orderId: string, at: Date, db: Db): Promise<number> => {
  try {
    const { count } = await db.garmentPiece.updateMany({
      where: { id: { in: ids }, orderId, stage: "quality_check" },
      data: { qcPassedAt: at },
    });
    return count;
  } catch (error) {
    throw error;
  }
};

// A failed piece goes back to the sorted queue with its process kept; rework is counted.
const sendBackForRework = async (ids: string[], orderId: string, db: Db): Promise<number> => {
  try {
    const { count } = await db.garmentPiece.updateMany({
      where: { id: { in: ids }, orderId, stage: "quality_check" },
      data: { stage: "sorted", qcPassedAt: null, reworkCount: { increment: 1 } },
    });
    return count;
  } catch (error) {
    throw error;
  }
};

const packOrder = async (orderId: string, db: Db): Promise<number> => {
  try {
    const { count } = await db.garmentPiece.updateMany({
      where: { orderId, stage: "quality_check", qcPassedAt: { not: null } },
      data: { stage: "packed" },
    });
    return count;
  } catch (error) {
    throw error;
  }
};

export const PieceQuery = {
  allocateTags,
  createMany,
  listByOrder,
  findInOrder,
  findManyInStore,
  stageCounts,
  edit,
  remove,
  claimForBatch,
  releaseFromBatch,
  advanceBatchPieces,
  waitingForBatch,
  markQcPassed,
  sendBackForRework,
  packOrder,
};
