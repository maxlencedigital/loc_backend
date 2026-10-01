import type { Prisma } from "@prisma/client";
import { Page, PageRequest } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IChecklistItem,
  IInspection,
  IInspectionCreate,
  IRepair,
  IRepairCreate,
  IRepairSpend,
  IRepairUpdate,
} from "../Models/Equipment/Equipment.Interface.js";

export type Db = Prisma.TransactionClient;

const toInspection = ({
  checklist,
  inspectorUserId: _inspectorUserId,
  ...row
}: Prisma.EquipmentInspectionGetPayload<object>): IInspection => ({
  ...row,
  checklist: checklist as unknown as IChecklistItem[],
});

const toRepair = ({ createdByUserId: _createdByUserId, updatedAt: _updatedAt, ...row }: Prisma.EquipmentRepairGetPayload<object>): IRepair =>
  row;

const createInspection = async (
  equipmentId: string,
  data: IInspectionCreate,
  db: Db = prisma
): Promise<IInspection> => {
  try {
    const row = await db.equipmentInspection.create({
      data: { ...data, equipmentId, checklist: data.checklist as unknown as Prisma.InputJsonValue },
    });
    return toInspection(row);
  } catch (error) {
    throw error;
  }
};

const listInspections = async (
  equipmentId: string,
  page: PageRequest,
  db: Db = prisma
): Promise<Page<IInspection>> => {
  try {
    const [rows, total] = await Promise.all([
      db.equipmentInspection.findMany({
        where: { equipmentId },
        orderBy: [{ inspectedOn: "desc" }, { createdAt: "desc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.equipmentInspection.count({ where: { equipmentId } }),
    ]);
    return { items: rows.map(toInspection), total, page: page.page, limit: page.limit };
  } catch (error) {
    throw error;
  }
};

const createRepair = async (equipmentId: string, data: IRepairCreate, db: Db = prisma): Promise<IRepair> => {
  try {
    return toRepair(await db.equipmentRepair.create({ data: { ...data, equipmentId } }));
  } catch (error) {
    throw error;
  }
};

const findRepair = async (equipmentId: string, repairId: string, db: Db = prisma): Promise<IRepair | null> => {
  try {
    const row = await db.equipmentRepair.findFirst({ where: { id: repairId, equipmentId } });
    return row ? toRepair(row) : null;
  } catch (error) {
    throw error;
  }
};

const updateRepair = async (repairId: string, data: IRepairUpdate, db: Db = prisma): Promise<IRepair> => {
  try {
    return toRepair(await db.equipmentRepair.update({ where: { id: repairId }, data }));
  } catch (error) {
    throw error;
  }
};

const listRepairs = async (equipmentId: string, page: PageRequest, db: Db = prisma): Promise<Page<IRepair>> => {
  try {
    const [rows, total] = await Promise.all([
      db.equipmentRepair.findMany({
        where: { equipmentId },
        orderBy: [{ reportedOn: "desc" }, { createdAt: "desc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.equipmentRepair.count({ where: { equipmentId } }),
    ]);
    return { items: rows.map(toRepair), total, page: page.page, limit: page.limit };
  } catch (error) {
    throw error;
  }
};

// Repairs still open, not counting the one being closed right now.
const countOpenRepairs = async (equipmentId: string, exceptRepairId: string | null, db: Db): Promise<number> => {
  try {
    return await db.equipmentRepair.count({
      where: { equipmentId, resolvedOn: null, ...(exceptRepairId ? { id: { not: exceptRepairId } } : {}) },
    });
  } catch (error) {
    throw error;
  }
};

// Repairs whose date range touches [from, to]: reported by `to`, and either still open or
// closed on or after `from`. Bounded: a machine has a handful of repairs a year.
const listRepairsOverlapping = async (
  equipmentId: string,
  from: Date,
  to: Date,
  limit: number,
  db: Db = prisma
): Promise<IRepair[]> => {
  try {
    const rows = await db.equipmentRepair.findMany({
      where: {
        equipmentId,
        reportedOn: { lte: to },
        OR: [{ resolvedOn: null }, { resolvedOn: { gte: from } }],
      },
      orderBy: [{ reportedOn: "asc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(toRepair);
  } catch (error) {
    throw error;
  }
};

// Repair spend per live machine since a date, biggest first, summed in SQL. `limit` bounds
// the answer when a store has an unusually large number of machines with repairs.
const repairSpendSince = async (
  storeId: string | null,
  since: Date,
  limit: number,
  db: Db = prisma
): Promise<IRepairSpend[]> => {
  try {
    const groups = await db.equipmentRepair.groupBy({
      by: ["equipmentId"],
      where: {
        reportedOn: { gte: since },
        equipment: { status: { not: "retired" }, ...(storeId ? { storeId } : {}) },
      },
      _sum: { costPaise: true },
      orderBy: { _sum: { costPaise: "desc" } },
      take: limit,
    });
    return groups.map((g) => ({ equipmentId: g.equipmentId, costPaise: g._sum.costPaise ?? 0 }));
  } catch (error) {
    throw error;
  }
};

export const EquipmentRecordsQuery = {
  createInspection,
  listInspections,
  createRepair,
  findRepair,
  updateRepair,
  listRepairs,
  countOpenRepairs,
  listRepairsOverlapping,
  repairSpendSince,
};
