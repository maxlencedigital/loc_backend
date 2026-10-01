import type { Prisma } from "@prisma/client";
import { Page, PageRequest } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  EquipmentStatus,
  IEquipment,
  IEquipmentCreate,
  IEquipmentFilter,
  IEquipmentUpdate,
  IStatusEvent,
  IStatusEventCreate,
} from "../Models/Equipment/Equipment.Interface.js";

export type Db = Prisma.TransactionClient;

const EQUIPMENT_TAG_COUNTER = "equipment_tag";

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

const storeWhere = (storeId: string | null) => (storeId ? { storeId } : {});

// One atomic UPDATE ... RETURNING, so two registrations never draw the same number.
const nextTagNumber = async (db: Db = prisma): Promise<number> => {
  try {
    const counter = await db.sequenceCounter.update({
      where: { name: EQUIPMENT_TAG_COUNTER },
      data: { value: { increment: 1 } },
    });
    return counter.value;
  } catch (error) {
    throw error;
  }
};

const create = async (data: IEquipmentCreate, event: IStatusEventCreate, db: Db = prisma): Promise<IEquipment> => {
  try {
    return await db.equipment.create({ data: { ...data, statusEvents: { create: event } } });
  } catch (error) {
    throw error;
  }
};

// A scope narrows to one store; null means every store. Outside it the row does not exist.
const findById = async (id: string, scope: string | null, db: Db = prisma): Promise<IEquipment | null> => {
  try {
    return await db.equipment.findFirst({ where: { id, ...storeWhere(scope) } });
  } catch (error) {
    throw error;
  }
};

// A no-op UPDATE is the row lock (raw SQL would not get the per-service schema): status
// changes, repairs and retirement for one machine queue up instead of racing.
const lockById = async (id: string, scope: string | null, db: Db): Promise<IEquipment | null> => {
  try {
    const { count } = await db.equipment.updateMany({
      where: { id, ...storeWhere(scope) },
      data: { updatedAt: new Date() },
    });
    return count === 0 ? null : await findById(id, scope, db);
  } catch (error) {
    throw error;
  }
};

const update = async (
  id: string,
  data: IEquipmentUpdate,
  event: IStatusEventCreate | null,
  db: Db = prisma
): Promise<IEquipment> => {
  try {
    return await db.equipment.update({
      where: { id },
      data: { ...data, ...(event ? { statusEvents: { create: event } } : {}) },
    });
  } catch (error) {
    throw error;
  }
};

const search = async (filter: IEquipmentFilter, page: PageRequest, db: Db = prisma): Promise<Page<IEquipment>> => {
  try {
    const where: Prisma.EquipmentWhereInput = {
      ...storeWhere(filter.storeId),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const [items, total] = await Promise.all([
      db.equipment.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.equipment.count({ where }),
    ]);
    return { items, total, page: page.page, limit: page.limit };
  } catch (error) {
    throw error;
  }
};

const findManyByIds = async (ids: string[], db: Db = prisma): Promise<IEquipment[]> => {
  try {
    return await db.equipment.findMany({ where: { id: { in: ids } } });
  } catch (error) {
    throw error;
  }
};

const listStatusEvents = async (equipmentId: string, limit: number, db: Db = prisma): Promise<IStatusEvent[]> => {
  try {
    const rows = await db.equipmentStatusEvent.findMany({
      where: { equipmentId },
      orderBy: [{ at: "desc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(({ equipmentId: _equipmentId, byUserId: _byUserId, ...event }) => event);
  } catch (error) {
    throw error;
  }
};

const countByStatus = async (
  storeId: string | null,
  db: Db = prisma
): Promise<Partial<Record<EquipmentStatus, number>>> => {
  try {
    const groups = await db.equipment.groupBy({
      by: ["status"],
      where: storeWhere(storeId),
      _count: { _all: true },
    });
    return Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  } catch (error) {
    throw error;
  }
};

// Machines with at least one repair reported on or after `since`: an EXISTS, not a row scan.
const countWithRepairSince = async (storeId: string | null, since: Date, db: Db = prisma): Promise<number> => {
  try {
    return await db.equipment.count({
      where: { ...storeWhere(storeId), repairs: { some: { reportedOn: { gte: since } } } },
    });
  } catch (error) {
    throw error;
  }
};

export const EquipmentQuery = {
  inTransaction,
  nextTagNumber,
  create,
  findById,
  lockById,
  update,
  search,
  findManyByIds,
  listStatusEvents,
  countByStatus,
  countWithRepairSince,
};
