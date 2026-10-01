import { prisma } from "../DB/Prisma.Connection.Db.js";
import type { ICollection, IOrderNote, IOrderSummary } from "../Models/StoreFloor/StoreFloor.Interface.js";
import type { OrderStatus } from "../Models/Order/OrderStatus.js";
import type { Db } from "./Floor.Transaction.js";

// The most notes one order returns; a counter order does not get hundreds.
const MAX_NOTES = 200;

const addNote = async (
  data: { orderId: string; storeId: string; note: string; byName: string; byUserId: string },
  db: Db = prisma
): Promise<IOrderNote> => {
  try {
    return (await db.orderNote.create({ data })) as IOrderNote;
  } catch (error) {
    throw error;
  }
};

const listNotes = async (orderId: string, db: Db = prisma): Promise<IOrderNote[]> => {
  try {
    const rows = await db.orderNote.findMany({ where: { orderId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAX_NOTES });
    return rows as IOrderNote[];
  } catch (error) {
    throw error;
  }
};

// Moves an order that has not reached the floor yet. Conditional on the store and status the
// caller read, so a check-in racing the move wins or loses cleanly.
const reassignStore = async (orderId: string, fromStoreId: string, toStoreId: string, movable: OrderStatus[], db: Db): Promise<boolean> => {
  try {
    const { count } = await db.order.updateMany({
      where: { id: orderId, storeId: fromStoreId, status: { in: movable } },
      data: { storeId: toStoreId },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

// A timeline entry that records something other than a status change (the order keeps its status).
const addEvent = async (
  data: { orderId: string; status: OrderStatus; note: string; byName: string; byUserId: string },
  db: Db
): Promise<void> => {
  try {
    await db.orderEvent.create({ data });
  } catch (error) {
    throw error;
  }
};

// The unique order id makes a second hand-over fail with a unique violation.
const createCollection = async (
  data: { orderId: string; storeId: string; collectedBy: string; signature: string | null; paymentOutstanding: boolean; byName: string; byUserId: string },
  db: Db
): Promise<ICollection> => {
  try {
    return (await db.orderCollection.create({ data })) as ICollection;
  } catch (error) {
    throw error;
  }
};

const findCollection = async (orderId: string, db: Db = prisma): Promise<ICollection | null> => {
  try {
    return (await db.orderCollection.findUnique({ where: { orderId } })) as ICollection | null;
  } catch (error) {
    throw error;
  }
};

const summaries = async (ids: string[], db: Db = prisma): Promise<IOrderSummary[]> => {
  try {
    return await db.order.findMany({ where: { id: { in: ids } }, select: { id: true, storeId: true, ref: true, status: true } });
  } catch (error) {
    throw error;
  }
};

// Walk-in booking keys: claim first (the unique key lets one request through), then attach the order.
const claimRequest = async (userId: string, key: string): Promise<{ id: string }> => {
  try {
    return await prisma.walkInRequest.create({ data: { userId, key }, select: { id: true } });
  } catch (error) {
    throw error;
  }
};

const findRequest = async (userId: string, key: string): Promise<{ id: string; orderId: string | null } | null> => {
  try {
    return await prisma.walkInRequest.findUnique({ where: { userId_key: { userId, key } }, select: { id: true, orderId: true } });
  } catch (error) {
    throw error;
  }
};

const completeRequest = async (id: string, orderId: string): Promise<void> => {
  try {
    await prisma.walkInRequest.update({ where: { id }, data: { orderId } });
  } catch (error) {
    throw error;
  }
};

const releaseRequest = async (id: string): Promise<void> => {
  try {
    await prisma.walkInRequest.deleteMany({ where: { id, orderId: null } });
  } catch (error) {
    throw error;
  }
};

export const StoreOrderQuery = {
  addNote,
  listNotes,
  reassignStore,
  addEvent,
  createCollection,
  findCollection,
  summaries,
  claimRequest,
  findRequest,
  completeRequest,
  releaseRequest,
};
