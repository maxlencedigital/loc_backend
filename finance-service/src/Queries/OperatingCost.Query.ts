import type { Prisma } from "@prisma/client";
import { PageRequest } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { dayToDate } from "../Utils/Dates.js";
import {
  IOperatingCost,
  IOperatingCostCreate,
  IOperatingCostUpdate,
  OperatingCostType,
} from "../Models/Expense/Expense.Interface.js";
import { toDay } from "./Db.js";

const COLUMNS = {
  id: true,
  name: true,
  type: true,
  amountPaise: true,
  frequency: true,
  storeId: true,
  dueDay: true,
  startDate: true,
  endDate: true,
  vendorId: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Row = Prisma.OperatingCostGetPayload<{ select: typeof COLUMNS }>;
const toCost = (row: Row): IOperatingCost => ({
  ...row,
  startDate: toDay(row.startDate),
  endDate: row.endDate ? toDay(row.endDate) : null,
});

const toData = (data: IOperatingCostUpdate) => ({
  ...data,
  ...(data.startDate ? { startDate: dayToDate(data.startDate) } : {}),
  ...(data.endDate !== undefined ? { endDate: data.endDate ? dayToDate(data.endDate) : null } : {}),
});

const create = async (data: IOperatingCostCreate): Promise<IOperatingCost> => {
  try {
    return toCost(
      await prisma.operatingCost.create({
        data: toData(data) as Prisma.OperatingCostUncheckedCreateInput,
        select: COLUMNS,
      })
    );
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string): Promise<IOperatingCost | null> => {
  try {
    const row = await prisma.operatingCost.findFirst({ where: { id, deletedAt: null }, select: COLUMNS });
    return row ? toCost(row) : null;
  } catch (error) {
    throw error;
  }
};

const search = async (
  filter: { storeId?: string; type?: OperatingCostType },
  page: PageRequest
): Promise<{ items: IOperatingCost[]; total: number }> => {
  try {
    const where: Prisma.OperatingCostWhereInput = {
      deletedAt: null,
      ...(filter.storeId ? { storeId: filter.storeId } : {}),
      ...(filter.type ? { type: filter.type } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.operatingCost.findMany({
        where,
        select: COLUMNS,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: page.offset,
        take: page.limit,
      }),
      prisma.operatingCost.count({ where }),
    ]);
    return { items: rows.map(toCost), total };
  } catch (error) {
    throw error;
  }
};

const update = async (id: string, data: IOperatingCostUpdate): Promise<IOperatingCost | null> => {
  try {
    const { count } = await prisma.operatingCost.updateMany({
      where: { id, deletedAt: null },
      data: toData(data) as Prisma.OperatingCostUncheckedUpdateManyInput,
    });
    return count === 1 ? await findById(id) : null;
  } catch (error) {
    throw error;
  }
};

const softDelete = async (id: string): Promise<boolean> => {
  try {
    const { count } = await prisma.operatingCost.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

export const SCHEDULE_LIMIT = 1000;

/** Cost definitions whose start/end overlap the window; the service expands them into charges. */
const listActiveBetween = async (from: string, to: string, storeId?: string): Promise<IOperatingCost[]> => {
  try {
    const rows = await prisma.operatingCost.findMany({
      where: {
        deletedAt: null,
        startDate: { lte: dayToDate(to) },
        OR: [{ endDate: null }, { endDate: { gte: dayToDate(from) } }],
        ...(storeId ? { storeId } : {}),
      },
      select: COLUMNS,
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
      take: SCHEDULE_LIMIT,
    });
    return rows.map(toCost);
  } catch (error) {
    throw error;
  }
};

export const OperatingCostQuery = { create, findById, search, update, softDelete, listActiveBetween };
