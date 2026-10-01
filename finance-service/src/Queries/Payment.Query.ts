import type { Prisma } from "@prisma/client";
import { PageRequest } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IMismatch,
  IMismatchResolution,
  IPayment,
  IPaymentCreate,
  IPaymentFilter,
  IPaymentUpdate,
  MismatchResolution,
} from "../Models/Payment/Payment.Interface.js";
import { IReconcilablePayment } from "../Models/Reconciliation/Reconciliation.Interface.js";

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

const findByIdempotency = async (owner: string, key: string, db: Db = prisma): Promise<IPayment | null> => {
  try {
    return (await db.payment.findUnique({
      where: { idempotencyOwner_idempotencyKey: { idempotencyOwner: owner, idempotencyKey: key } },
    })) as IPayment | null;
  } catch (error) {
    throw error;
  }
};

/** Row lock by id (a no-op UPDATE, as in lockByRazorpayOrderId). */
const lockById = async (id: string, db: Db): Promise<IPayment | null> => {
  try {
    await db.payment.updateMany({ where: { id }, data: { updatedAt: new Date() } });
    return await findById(id, db);
  } catch (error) {
    throw error;
  }
};

const listByOrderRef = async (orderRef: string, limit: number, db: Db = prisma): Promise<IPayment[]> => {
  try {
    return (await db.payment.findMany({
      where: { orderRef },
      orderBy: { createdAt: "desc" },
      take: limit,
    })) as IPayment[];
  } catch (error) {
    throw error;
  }
};

const whereOf = (filter: IPaymentFilter): Prisma.PaymentWhereInput => ({
  ...(filter.storeId ? { storeId: filter.storeId } : {}),
  ...(filter.status ? { status: filter.status } : {}),
  ...(filter.method ? { method: filter.method } : {}),
  ...(filter.from || filter.to
    ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } }
    : {}),
});

const search = async (filter: IPaymentFilter, page: PageRequest): Promise<{ items: IPayment[]; total: number }> => {
  try {
    const where = whereOf(filter);
    const [items, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: page.offset,
        take: page.limit,
      }),
      prisma.payment.count({ where }),
    ]);
    return { items: items as IPayment[], total };
  } catch (error) {
    throw error;
  }
};

const toResolution = (row: {
  paymentId: string;
  resolution: string;
  note: string;
  resolvedByUserId: string;
  resolvedByName: string | null;
  createdAt: Date;
}): IMismatchResolution => ({ ...row, resolution: row.resolution as MismatchResolution });

/** Payments flagged amountMismatch, newest first. "open" means no decision recorded yet. */
const searchMismatches = async (
  status: "open" | "resolved" | undefined,
  storeScope: string | null,
  page: PageRequest
): Promise<{ items: IMismatch[]; total: number }> => {
  try {
    const where: Prisma.PaymentWhereInput = {
      amountMismatch: true,
      ...(storeScope ? { storeId: storeScope } : {}),
      ...(status === "open" ? { mismatchResolution: { is: null } } : {}),
      ...(status === "resolved" ? { mismatchResolution: { isNot: null } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: { mismatchResolution: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: page.offset,
        take: page.limit,
      }),
      prisma.payment.count({ where }),
    ]);
    const items = rows.map(({ mismatchResolution, ...payment }) => ({
      payment: payment as IPayment,
      resolution: mismatchResolution ? toResolution(mismatchResolution) : null,
    }));
    return { items, total };
  } catch (error) {
    throw error;
  }
};

const findMismatch = async (id: string, storeScope: string | null, db: Db = prisma): Promise<IMismatch | null> => {
  try {
    const row = await db.payment.findFirst({
      where: { id, amountMismatch: true, ...(storeScope ? { storeId: storeScope } : {}) },
      include: { mismatchResolution: true },
    });
    if (!row) return null;
    const { mismatchResolution, ...payment } = row;
    return { payment: payment as IPayment, resolution: mismatchResolution ? toResolution(mismatchResolution) : null };
  } catch (error) {
    throw error;
  }
};

/** Inserts the decision. False means one already exists (unique paymentId): nothing was written. */
const createResolution = async (data: Omit<IMismatchResolution, "createdAt">, db: Db = prisma): Promise<boolean> => {
  try {
    const { count } = await db.paymentMismatchResolution.createMany({ data: [data], skipDuplicates: true });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

// Captured payments in the window, for reconciliation. Bounded by `take`.
const listCapturedBetween = async (from: Date, to: Date, take: number): Promise<IReconcilablePayment[]> => {
  try {
    return await prisma.payment.findMany({
      where: { status: { in: ["captured", "refunded"] }, capturedAt: { gte: from, lt: to } },
      select: {
        id: true,
        orderRef: true,
        razorpayPaymentId: true,
        amountPaise: true,
        gatewayAmountPaise: true,
        status: true,
      },
      orderBy: [{ capturedAt: "asc" }, { id: "asc" }],
      take,
    });
  } catch (error) {
    throw error;
  }
};

export const PaymentQuery = {
  findByIdempotency,
  lockById,
  listByOrderRef,
  search,
  searchMismatches,
  findMismatch,
  createResolution,
  listCapturedBetween,
  inTransaction,
  create,
  findById,
  findByRazorpayOrderId,
  lockByRazorpayOrderId,
  hasPaidForOrder,
  update,
  recordWebhookEvent,
};
