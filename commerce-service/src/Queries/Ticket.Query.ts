import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import type { PageRequest } from "../../commons/Utils/Pagination.js";
import {
  INewTicketMessage,
  ITicket,
  ITicketCreate,
  ITicketDetail,
  ITicketPatch,
  TicketStatus,
} from "../Models/Ticket/Ticket.Interface.js";

export type Db = Prisma.TransactionClient;

const detailInclude = {
  messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.SupportTicketInclude;

type DetailRow = Prisma.SupportTicketGetPayload<{ include: typeof detailInclude }>;

const toDetail = ({ messages, ...ticket }: DetailRow): ITicketDetail => ({
  ...ticket,
  messages: messages.map(({ ticketId: _ticketId, ...message }) => message),
});

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

const create = async (data: ITicketCreate, db: Db = prisma): Promise<ITicketDetail> => {
  try {
    const { firstMessage, ...ticket } = data;
    const row = await db.supportTicket.create({
      data: { ...ticket, messageCount: 1, messages: { create: [firstMessage] } },
      include: detailInclude,
    });
    return toDetail(row);
  } catch (error) {
    throw error;
  }
};

// Customer-facing reads always carry the owner; the internal support calls pass null.
const ownerWhere = (customerUserId: string | null) => (customerUserId ? { customerUserId } : {});

const findDetail = async (
  id: string,
  customerUserId: string | null,
  db: Db = prisma
): Promise<ITicketDetail | null> => {
  try {
    const row = await db.supportTicket.findFirst({
      where: { id, ...ownerWhere(customerUserId) },
      include: detailInclude,
    });
    return row ? toDetail(row) : null;
  } catch (error) {
    throw error;
  }
};

const findByCustomerKey = async (
  customerUserId: string,
  idempotencyKey: string,
  db: Db = prisma
): Promise<ITicketDetail | null> => {
  try {
    const row = await db.supportTicket.findFirst({
      where: { customerUserId, idempotencyKey },
      include: detailInclude,
    });
    return row ? toDetail(row) : null;
  } catch (error) {
    throw error;
  }
};

// Row lock until the transaction ends: two replies on one ticket queue up, and the message
// count the cap relies on is read after the first one has landed.
const lock = async (id: string, customerUserId: string | null, db: Db): Promise<ITicket | null> => {
  try {
    const { count } = await db.supportTicket.updateMany({
      where: { id, ...ownerWhere(customerUserId) },
      data: { updatedAt: new Date() },
    });
    return count === 0 ? null : await db.supportTicket.findUnique({ where: { id } });
  } catch (error) {
    throw error;
  }
};

const appendMessage = async (
  id: string,
  message: INewTicketMessage,
  patch: ITicketPatch,
  db: Db
): Promise<void> => {
  try {
    await db.supportTicket.update({
      where: { id },
      data: { ...patch, messageCount: { increment: 1 }, messages: { create: message } },
    });
  } catch (error) {
    throw error;
  }
};

const setStatus = async (id: string, patch: ITicketPatch, db: Db): Promise<void> => {
  try {
    await db.supportTicket.update({ where: { id }, data: patch });
  } catch (error) {
    throw error;
  }
};

const listForCustomer = async (
  customerUserId: string,
  status: TicketStatus | undefined,
  page: PageRequest,
  db: Db = prisma
): Promise<{ items: ITicket[]; total: number }> => {
  try {
    const where = { customerUserId, ...(status ? { status } : {}) };
    const [items, total] = await Promise.all([
      db.supportTicket.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.supportTicket.count({ where }),
    ]);
    return { items, total };
  } catch (error) {
    throw error;
  }
};

export const TicketQuery = {
  inTransaction,
  create,
  findDetail,
  findByCustomerKey,
  lock,
  appendMessage,
  setStatus,
  listForCustomer,
};
