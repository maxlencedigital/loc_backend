import { prisma } from "../DB/Prisma.Connection.Db.js";
import type { Page, PageRequest } from "../../commons/Utils/Pagination.js";
import { toPage } from "../../commons/Utils/Pagination.js";
import type { BatchStatus, IBatch, IBatchCreate, IBatchFilter, IPiece } from "../Models/StoreFloor/StoreFloor.Interface.js";
import type { Db } from "./Floor.Transaction.js";

const countMembers = { _count: { select: { members: true } } } as const;

const toBatch = ({ _count, ...row }: any): IBatch => ({
  id: row.id,
  storeId: row.storeId,
  serviceId: row.serviceId,
  stage: row.stage,
  status: row.status,
  machineId: row.machineId,
  dueAt: row.dueAt,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
  loadWeightGrams: row.loadWeightGrams,
  notes: row.notes,
  createdByName: row.createdByName,
  createdAt: row.createdAt,
  pieceCount: _count.members,
});

const scopeWhere = (storeId: string | null) => (storeId ? { storeId } : {});

const create = async (data: IBatchCreate, pieceIds: string[], db: Db): Promise<IBatch> => {
  try {
    const row = await db.floorBatch.create({
      data: { ...data, members: { create: pieceIds.map((pieceId) => ({ pieceId })) } },
      include: countMembers,
    });
    return toBatch(row);
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, storeId: string | null, db: Db = prisma): Promise<IBatch | null> => {
  try {
    const row = await db.floorBatch.findFirst({ where: { id, ...scopeWhere(storeId) }, include: countMembers });
    return row ? toBatch(row) : null;
  } catch (error) {
    throw error;
  }
};

// Pieces in the batch, whether it is still planned or already finished.
const listPieces = async (batchId: string, db: Db = prisma): Promise<IPiece[]> => {
  try {
    const rows = await db.floorBatchPiece.findMany({
      where: { batchId },
      include: { piece: true },
      orderBy: [{ addedAt: "asc" }, { id: "asc" }],
      take: 500,
    });
    return rows.map((row) => row.piece as unknown as IPiece);
  } catch (error) {
    throw error;
  }
};

const search = async (filter: IBatchFilter, request: PageRequest, db: Db = prisma): Promise<Page<IBatch>> => {
  try {
    const where = {
      ...scopeWhere(filter.storeId),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.serviceId ? { serviceId: filter.serviceId } : {}),
      ...(filter.dueBefore ? { dueAt: { lte: filter.dueBefore } } : {}),
    };
    const [rows, total] = await Promise.all([
      db.floorBatch.findMany({
        where,
        include: countMembers,
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }],
        skip: request.offset,
        take: request.limit,
      }),
      db.floorBatch.count({ where }),
    ]);
    return toPage(rows.map(toBatch), total, request);
  } catch (error) {
    throw error;
  }
};

// Conditional on the status the caller read: false means somebody else got there first.
const transition = async (
  id: string,
  from: BatchStatus[],
  to: BatchStatus,
  data: { startedAt?: Date; finishedAt?: Date; loadWeightGrams?: number | null; notes?: string | null },
  db: Db
): Promise<boolean> => {
  try {
    const { count } = await db.floorBatch.updateMany({ where: { id, status: { in: from } }, data: { ...data, status: to } });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const setMachine = async (id: string, expected: string | null, machineId: string | null, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.floorBatch.updateMany({
      where: { id, status: "planned", machineId: expected },
      data: { machineId },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

// A machine that leaves service drops its reservation; the planned batch is simply unassigned.
const unassignMachine = async (machineId: string, db: Db): Promise<void> => {
  try {
    await db.floorBatch.updateMany({ where: { machineId, status: "planned" }, data: { machineId: null } });
  } catch (error) {
    throw error;
  }
};

const addMembers = async (batchId: string, pieceIds: string[], db: Db): Promise<void> => {
  try {
    await db.floorBatchPiece.createMany({ data: pieceIds.map((pieceId) => ({ batchId, pieceId })) });
  } catch (error) {
    throw error;
  }
};

const removeMember = async (batchId: string, pieceId: string, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.floorBatchPiece.deleteMany({ where: { batchId, pieceId } });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const memberCount = async (batchId: string, db: Db): Promise<number> => {
  try {
    return await db.floorBatchPiece.count({ where: { batchId } });
  } catch (error) {
    throw error;
  }
};

export const BatchQuery = {
  create,
  findById,
  listPieces,
  search,
  transition,
  setMachine,
  unassignMachine,
  addMembers,
  removeMember,
  memberCount,
};
