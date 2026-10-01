import type { Prisma } from "@prisma/client";
import { Page, PageRequest } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IDevice,
  IDeviceCreate,
  IDeviceEvent,
  IDeviceEventCreate,
  IDeviceFilter,
  IDeviceRepair,
  IDeviceRepairCreate,
  IDeviceUpdate,
} from "../Models/It/It.Interface.js";

export type Db = Prisma.TransactionClient;

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

const create = async (data: IDeviceCreate, event: IDeviceEventCreate, db: Db = prisma): Promise<IDevice> => {
  try {
    return await db.itDevice.create({ data: { ...data, events: { create: event } } });
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, db: Db = prisma): Promise<IDevice | null> => {
  try {
    return await db.itDevice.findUnique({ where: { id } });
  } catch (error) {
    throw error;
  }
};

// A no-op UPDATE is the row lock: two people handing out the same laptop queue up, and
// the second sees it already assigned.
const lockById = async (id: string, db: Db): Promise<IDevice | null> => {
  try {
    const { count } = await db.itDevice.updateMany({ where: { id }, data: { updatedAt: new Date() } });
    return count === 0 ? null : await findById(id, db);
  } catch (error) {
    throw error;
  }
};

const update = async (
  id: string,
  data: IDeviceUpdate,
  event: IDeviceEventCreate | null,
  db: Db = prisma
): Promise<IDevice> => {
  try {
    return await db.itDevice.update({
      where: { id },
      data: { ...data, ...(event ? { events: { create: event } } : {}) },
    });
  } catch (error) {
    throw error;
  }
};

const search = async (filter: IDeviceFilter, page: PageRequest, db: Db = prisma): Promise<Page<IDevice>> => {
  try {
    const where: Prisma.ItDeviceWhereInput = {
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.assignedTo ? { assignedToEmployeeId: filter.assignedTo } : {}),
    };
    const [items, total] = await Promise.all([
      db.itDevice.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.itDevice.count({ where }),
    ]);
    return { items, total, page: page.page, limit: page.limit };
  } catch (error) {
    throw error;
  }
};

const listEvents = async (deviceId: string, limit: number, db: Db = prisma): Promise<IDeviceEvent[]> => {
  try {
    const rows = await db.itDeviceEvent.findMany({
      where: { deviceId },
      orderBy: [{ at: "desc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(({ deviceId: _deviceId, byUserId: _byUserId, ...event }) => event);
  } catch (error) {
    throw error;
  }
};

const exists = async (id: string, db: Db = prisma): Promise<boolean> => {
  try {
    return (await db.itDevice.count({ where: { id } })) > 0;
  } catch (error) {
    throw error;
  }
};

const createRepair = async (deviceId: string, data: IDeviceRepairCreate, db: Db = prisma): Promise<IDeviceRepair> => {
  try {
    const { createdByUserId: _createdByUserId, createdAt: _createdAt, ...row } = await db.itDeviceRepair.create({
      data: { ...data, deviceId },
    });
    return row;
  } catch (error) {
    throw error;
  }
};

const listRepairs = async (deviceId: string, page: PageRequest, db: Db = prisma): Promise<Page<IDeviceRepair>> => {
  try {
    const [rows, total] = await Promise.all([
      db.itDeviceRepair.findMany({
        where: { deviceId },
        orderBy: [{ repairedOn: "desc" }, { createdAt: "desc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.itDeviceRepair.count({ where: { deviceId } }),
    ]);
    const items = rows.map(({ createdByUserId: _createdByUserId, createdAt: _createdAt, ...row }) => row);
    return { items, total, page: page.page, limit: page.limit };
  } catch (error) {
    throw error;
  }
};

export const ItDeviceQuery = {
  inTransaction,
  create,
  findById,
  lockById,
  update,
  search,
  listEvents,
  exists,
  createRepair,
  listRepairs,
};
