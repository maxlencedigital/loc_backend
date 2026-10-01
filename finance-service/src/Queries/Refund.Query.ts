import type { Prisma } from "@prisma/client";
import { PageRequest } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IRefund, IRefundCreate, IRefundFilter } from "../Models/Refund/Refund.Interface.js";
import { Db } from "./Db.js";

const create = async (data: IRefundCreate, db: Db = prisma): Promise<IRefund> => {
  try {
    return (await db.refund.create({ data })) as IRefund;
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, db: Db = prisma): Promise<IRefund | null> => {
  try {
    return (await db.refund.findUnique({ where: { id } })) as IRefund | null;
  } catch (error) {
    throw error;
  }
};

const findByKey = async (paymentId: string, idempotencyKey: string, db: Db = prisma): Promise<IRefund | null> => {
  try {
    return (await db.refund.findUnique({
      where: { paymentId_idempotencyKey: { paymentId, idempotencyKey } },
    })) as IRefund | null;
  } catch (error) {
    throw error;
  }
};

const findByGatewayId = async (razorpayRefundId: string, db: Db = prisma): Promise<IRefund | null> => {
  try {
    return (await db.refund.findUnique({ where: { razorpayRefundId } })) as IRefund | null;
  } catch (error) {
    throw error;
  }
};

/** What is committed to the gateway but not yet reflected in the payment's refundedPaise. */
const sumInFlight = async (paymentId: string, db: Db = prisma): Promise<number> => {
  try {
    const sum = await db.refund.aggregate({
      where: { paymentId, status: { in: ["requested", "approved"] } },
      _sum: { amountPaise: true },
    });
    return Number(sum._sum.amountPaise ?? 0);
  } catch (error) {
    throw error;
  }
};

/** requested -> approved as one guarded statement; the count says whether this caller won. */
const claimApproval = async (id: string, approverId: string, db: Db = prisma): Promise<boolean> => {
  try {
    const { count } = await db.refund.updateMany({
      where: { id, status: "requested" },
      data: { status: "approved", approvedByUserId: approverId, approvedAt: new Date() },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const update = async (
  id: string,
  data: Partial<Pick<IRefund, "status" | "razorpayRefundId" | "failureReason" | "processedAt">>,
  db: Db = prisma
): Promise<IRefund> => {
  try {
    return (await db.refund.update({ where: { id }, data })) as IRefund;
  } catch (error) {
    throw error;
  }
};

const search = async (filter: IRefundFilter, page: PageRequest): Promise<{ items: IRefund[]; total: number }> => {
  try {
    const where: Prisma.RefundWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.from || filter.to
        ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.refund.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: page.offset,
        take: page.limit,
      }),
      prisma.refund.count({ where }),
    ]);
    return { items: items as IRefund[], total };
  } catch (error) {
    throw error;
  }
};

/** Refunds confirmed in [from, to), grouped by store (null: store unknown). */
const sumProcessedByStore = async (
  from: Date,
  to: Date
): Promise<Array<{ storeId: string | null; amountPaise: number }>> => {
  try {
    const groups = await prisma.refund.groupBy({
      by: ["storeId"],
      where: { status: "processed", processedAt: { gte: from, lt: to } },
      _sum: { amountPaise: true },
    });
    return groups.map((g) => ({ storeId: g.storeId, amountPaise: Number(g._sum.amountPaise ?? 0) }));
  } catch (error) {
    throw error;
  }
};

export const RefundQuery = {
  create,
  findById,
  findByKey,
  findByGatewayId,
  sumInFlight,
  claimApproval,
  update,
  search,
  sumProcessedByStore,
};
