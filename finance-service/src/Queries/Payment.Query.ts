import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IPayment, IPaymentCreate, IPaymentUpdate } from "../Models/Payment/Payment.Interface.js";

// A query accepts the transaction it runs in, so a webhook's "record the event"
// and "update the payment" commit or roll back together.
export type Db = Prisma.TransactionClient;

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

const create = async (data: IPaymentCreate, db: Db = prisma): Promise<IPayment> => {
  try {
    return (await db.payment.create({ data })) as IPayment;
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, db: Db = prisma): Promise<IPayment | null> => {
  try {
    return (await db.payment.findUnique({ where: { id } })) as IPayment | null;
  } catch (error) {
    throw error;
  }
};

const findByRazorpayOrderId = async (razorpayOrderId: string, db: Db = prisma): Promise<IPayment | null> => {
  try {
    return (await db.payment.findUnique({ where: { razorpayOrderId } })) as IPayment | null;
  } catch (error) {
    throw error;
  }
};

// Takes a row lock until the transaction ends. Two events for one payment (a
// capture and a refund arriving together) would otherwise both read the old row
// and the later write would erase the earlier one. A no-op UPDATE is the lock: raw
// SQL would not get the per-service schema the driver adapter applies.
const lockByRazorpayOrderId = async (razorpayOrderId: string, db: Db): Promise<IPayment | null> => {
  try {
    await db.payment.updateMany({ where: { razorpayOrderId }, data: { updatedAt: new Date() } });
    return await findByRazorpayOrderId(razorpayOrderId, db);
  } catch (error) {
    throw error;
  }
};

const hasPaidForOrder = async (orderRef: string, db: Db = prisma): Promise<boolean> => {
  try {
    const paid = await db.payment.count({ where: { orderRef, status: { in: ["captured", "refunded"] } } });
    return paid > 0;
  } catch (error) {
    throw error;
  }
};

const update = async (id: string, data: IPaymentUpdate, db: Db = prisma): Promise<IPayment> => {
  try {
    return (await db.payment.update({ where: { id }, data })) as IPayment;
  } catch (error) {
    throw error;
  }
};

/** Records a webhook event. False means this event id was seen before: a replay. */
const recordWebhookEvent = async (
  event: { eventId: string; type: string; payload: Prisma.InputJsonValue },
  db: Db
): Promise<boolean> => {
  try {
    // ON CONFLICT DO NOTHING: a unique-violation error would abort the transaction.
    const { count } = await db.paymentWebhookEvent.createMany({ data: [event], skipDuplicates: true });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

export const PaymentQuery = {
  inTransaction,
  create,
  findById,
  findByRazorpayOrderId,
  lockByRazorpayOrderId,
  hasPaidForOrder,
  update,
  recordWebhookEvent,
};
