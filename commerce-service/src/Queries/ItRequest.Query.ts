import type { Prisma } from "@prisma/client";
import { Page, PageRequest } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IRequest,
  IRequestComment,
  IRequestCreate,
  IRequestEvent,
  IRequestEventCreate,
  IRequestFilter,
  IRequestUpdate,
} from "../Models/It/It.Interface.js";

export type Db = Prisma.TransactionClient;

const toRequest = ({ closedByUserId: _closedByUserId, ...row }: Prisma.ItRequestGetPayload<object>): IRequest => row;

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

const create = async (data: IRequestCreate, event: IRequestEventCreate, db: Db = prisma): Promise<IRequest> => {
  try {
    return toRequest(await db.itRequest.create({ data: { ...data, events: { create: event } } }));
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, db: Db = prisma): Promise<IRequest | null> => {
  try {
    const row = await db.itRequest.findUnique({ where: { id } });
    return row ? toRequest(row) : null;
  } catch (error) {
    throw error;
  }
};

// A no-op UPDATE is the row lock: two people changing one ticket queue up, and the
// second is checked against the status the first one left.
const lockById = async (id: string, db: Db): Promise<IRequest | null> => {
  try {
    const { count } = await db.itRequest.updateMany({ where: { id }, data: { updatedAt: new Date() } });
    return count === 0 ? null : await findById(id, db);
  } catch (error) {
    throw error;
  }
};

const update = async (
  id: string,
  data: IRequestUpdate,
  events: IRequestEventCreate[],
  db: Db = prisma
): Promise<IRequest> => {
  try {
    const row = await db.itRequest.update({
      where: { id },
      data: { ...data, ...(events.length > 0 ? { events: { create: events } } : {}) },
    });
    return toRequest(row);
  } catch (error) {
    throw error;
  }
};

const search = async (filter: IRequestFilter, page: PageRequest, db: Db = prisma): Promise<Page<IRequest>> => {
  try {
    const where: Prisma.ItRequestWhereInput = {
      ...(filter.raisedByUserId ? { raisedByUserId: filter.raisedByUserId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.category ? { category: filter.category } : {}),
    };
    const [rows, total] = await Promise.all([
      db.itRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.itRequest.count({ where }),
    ]);
    return { items: rows.map(toRequest), total, page: page.page, limit: page.limit };
  } catch (error) {
    throw error;
  }
};

const addComment = async (
  requestId: string,
  author: { userId: string | null; name: string },
  message: string,
  db: Db = prisma
): Promise<IRequestComment> => {
  try {
    const row = await db.itRequestComment.create({
      data: { requestId, authorUserId: author.userId, authorName: author.name, message },
    });
    const { authorUserId: _authorUserId, ...comment } = row;
    return comment;
  } catch (error) {
    throw error;
  }
};

// The newest `limit` entries, returned oldest first so a thread reads top to bottom.
const listComments = async (requestId: string, limit: number, db: Db = prisma): Promise<IRequestComment[]> => {
  try {
    const rows = await db.itRequestComment.findMany({
      where: { requestId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
    });
    return rows.reverse().map(({ authorUserId: _authorUserId, ...comment }) => comment);
  } catch (error) {
    throw error;
  }
};

const listEvents = async (requestId: string, limit: number, db: Db = prisma): Promise<IRequestEvent[]> => {
  try {
    const rows = await db.itRequestEvent.findMany({
      where: { requestId },
      orderBy: [{ at: "desc" }, { id: "asc" }],
      take: limit,
    });
    return rows.reverse().map(({ requestId: _requestId, byUserId: _byUserId, ...event }) => event);
  } catch (error) {
    throw error;
  }
};

export const ItRequestQuery = {
  inTransaction,
  create,
  findById,
  lockById,
  update,
  search,
  addComment,
  listComments,
  listEvents,
};
