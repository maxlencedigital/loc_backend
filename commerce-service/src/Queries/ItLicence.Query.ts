import type { Prisma } from "@prisma/client";
import { Page, PageRequest } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  ILicence,
  ILicenceCreate,
  ILicenceEvent,
  ILicenceEventCreate,
  ILicenceUpdate,
  ISeatHolder,
} from "../Models/It/It.Interface.js";

export type Db = Prisma.TransactionClient;

const LIVE = { deletedAt: null };

const toLicence = ({ deletedAt: _deletedAt, ...row }: Prisma.ItLicenceGetPayload<object>): ILicence => row;

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

const create = async (data: ILicenceCreate, db: Db = prisma): Promise<ILicence> => {
  try {
    return toLicence(await db.itLicence.create({ data }));
  } catch (error) {
    throw error;
  }
};

// Soft-deleted licences are invisible here, so no service function can act on one.
const findById = async (id: string, db: Db = prisma): Promise<ILicence | null> => {
  try {
    const row = await db.itLicence.findFirst({ where: { id, ...LIVE } });
    return row ? toLicence(row) : null;
  } catch (error) {
    throw error;
  }
};

// A no-op UPDATE is the row lock. Seat assignment reads the count and then writes, so
// it runs entirely behind this lock: the last seat can only be given once.
const lockById = async (id: string, db: Db): Promise<ILicence | null> => {
  try {
    const { count } = await db.itLicence.updateMany({ where: { id, ...LIVE }, data: { updatedAt: new Date() } });
    return count === 0 ? null : await findById(id, db);
  } catch (error) {
    throw error;
  }
};

const update = async (id: string, data: ILicenceUpdate, db: Db = prisma): Promise<ILicence> => {
  try {
    return toLicence(await db.itLicence.update({ where: { id }, data }));
  } catch (error) {
    throw error;
  }
};

const softDelete = async (id: string, db: Db = prisma): Promise<void> => {
  try {
    await db.itLicence.update({ where: { id }, data: { deletedAt: new Date() } });
  } catch (error) {
    throw error;
  }
};

const search = async (page: PageRequest, db: Db = prisma): Promise<Page<ILicence>> => {
  try {
    const [rows, total] = await Promise.all([
      db.itLicence.findMany({
        where: LIVE,
        orderBy: [{ software: "asc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.itLicence.count({ where: LIVE }),
    ]);
    return { items: rows.map(toLicence), total, page: page.page, limit: page.limit };
  } catch (error) {
    throw error;
  }
};

const hasSeat = async (licenceId: string, employeeId: string, db: Db): Promise<boolean> => {
  try {
    return (await db.itLicenceSeat.count({ where: { licenceId, employeeId } })) > 0;
  } catch (error) {
    throw error;
  }
};

// Takes a seat: the row, the counter and the history entry move together.
const addSeat = async (
  licenceId: string,
  employeeId: string,
  event: ILicenceEventCreate,
  db: Db
): Promise<ILicence> => {
  try {
    await db.itLicenceSeat.create({ data: { licenceId, employeeId, assignedByUserId: event.byUserId } });
    const row = await db.itLicence.update({
      where: { id: licenceId },
      data: { seatsUsed: { increment: 1 }, events: { create: event } },
    });
    return toLicence(row);
  } catch (error) {
    throw error;
  }
};

// Returns the updated licence, or null when that person held no seat.
const removeSeat = async (
  licenceId: string,
  employeeId: string,
  event: ILicenceEventCreate,
  db: Db
): Promise<ILicence | null> => {
  try {
    const { count } = await db.itLicenceSeat.deleteMany({ where: { licenceId, employeeId } });
    if (count === 0) return null;
    const row = await db.itLicence.update({
      where: { id: licenceId },
      data: { seatsUsed: { decrement: count }, events: { create: event } },
    });
    return toLicence(row);
  } catch (error) {
    throw error;
  }
};

const listHolders = async (licenceId: string, limit: number, db: Db = prisma): Promise<ISeatHolder[]> => {
  try {
    const rows = await db.itLicenceSeat.findMany({
      where: { licenceId },
      orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map((row) => ({ employeeId: row.employeeId, assignedAt: row.assignedAt }));
  } catch (error) {
    throw error;
  }
};

const listEvents = async (licenceId: string, limit: number, db: Db = prisma): Promise<ILicenceEvent[]> => {
  try {
    const rows = await db.itLicenceEvent.findMany({
      where: { licenceId },
      orderBy: [{ at: "desc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(({ licenceId: _licenceId, byUserId: _byUserId, ...event }) => event);
  } catch (error) {
    throw error;
  }
};

export const ItLicenceQuery = {
  inTransaction,
  create,
  findById,
  lockById,
  update,
  softDelete,
  search,
  hasSeat,
  addSeat,
  removeSeat,
  listHolders,
  listEvents,
};
