import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import type { Db } from "./Db.js";
import type {
  ICoupon,
  ICouponCreate,
  ICouponRedemption,
  ICouponUpdate,
  ICouponUsage,
  IRedemptionCreate,
} from "../Models/Coupon/Coupon.Interface.js";

const create = async (data: ICouponCreate, db: Db = prisma): Promise<ICoupon> => {
  try {
    return (await db.coupon.create({ data })) as ICoupon;
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, db: Db = prisma): Promise<ICoupon | null> => {
  try {
    return (await db.coupon.findUnique({ where: { id } })) as ICoupon | null;
  } catch (error) {
    throw error;
  }
};

const findByCode = async (code: string, db: Db = prisma): Promise<ICoupon | null> => {
  try {
    return (await db.coupon.findUnique({ where: { code } })) as ICoupon | null;
  } catch (error) {
    throw error;
  }
};

const update = async (id: string, data: ICouponUpdate, db: Db = prisma): Promise<ICoupon | null> => {
  try {
    const { count } = await db.coupon.updateMany({ where: { id }, data });
    return count === 0 ? null : await findById(id, db);
  } catch (error) {
    throw error;
  }
};

const list = async (
  filter: { isActive?: boolean; q?: string },
  paging: { offset: number; limit: number }
): Promise<{ items: ICoupon[]; total: number }> => {
  try {
    const where: Prisma.CouponWhereInput = {
      ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
      ...(filter.q
        ? { OR: [{ code: { contains: filter.q, mode: "insensitive" } }, { title: { contains: filter.q, mode: "insensitive" } }] }
        : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.coupon.findMany({ where, orderBy: { createdAt: "desc" }, skip: paging.offset, take: paging.limit }),
      prisma.coupon.count({ where }),
    ]);
    return { items: items as ICoupon[], total };
  } catch (error) {
    throw error;
  }
};

// Coupons a customer could use right now. The per-customer limit is applied through
// `excludeIds` (computed by exhaustedForCustomer), so paging and the total stay exact.
const listAvailable = async (
  now: Date,
  excludeIds: string[],
  paging: { offset: number; limit: number }
): Promise<{ items: ICoupon[]; total: number }> => {
  try {
    const where: Prisma.CouponWhereInput = {
      isActive: true,
      validFrom: { lte: now },
      validUntil: { gte: now },
      OR: [{ usageLimit: null }, { usedCount: { lt: prisma.coupon.fields.usageLimit } }],
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.coupon.findMany({ where, orderBy: [{ validUntil: "asc" }, { id: "asc" }], skip: paging.offset, take: paging.limit }),
      prisma.coupon.count({ where }),
    ]);
    return { items: items as ICoupon[], total };
  } catch (error) {
    throw error;
  }
};

const CUSTOMER_USAGE_SCAN_LIMIT = 500;

/** Coupons whose per-customer limit this customer has already used up (bounded scan). */
const exhaustedForCustomer = async (customerId: string): Promise<string[]> => {
  try {
    const rows = await prisma.couponCustomerUsage.findMany({
      where: { customerId, coupon: { perCustomerLimit: { not: null } } },
      select: { couponId: true, usedCount: true, coupon: { select: { perCustomerLimit: true } } },
      take: CUSTOMER_USAGE_SCAN_LIMIT,
    });
    return rows
      .filter((r) => r.coupon.perCustomerLimit !== null && r.usedCount >= r.coupon.perCustomerLimit)
      .map((r) => r.couponId);
  } catch (error) {
    throw error;
  }
};

const customerUseCount = async (couponId: string, customerId: string, db: Db = prisma): Promise<number> => {
  try {
    const row = await db.couponCustomerUsage.findUnique({ where: { couponId_customerId: { couponId, customerId } } });
    return row?.usedCount ?? 0;
  } catch (error) {
    throw error;
  }
};

// The global limit: ONE statement that checks and increments, so two callers for the last use
// cannot both pass. It also takes the coupon's row lock until the transaction ends, which
// serialises every redemption of this coupon (the per-customer step below relies on that).
const takeUse = async (couponId: string, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.coupon.updateMany({
      where: {
        id: couponId,
        isActive: true,
        OR: [{ usageLimit: null }, { usedCount: { lt: db.coupon.fields.usageLimit } }],
      },
      data: { usedCount: { increment: 1 } },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const takeCustomerUse = async (
  couponId: string,
  customerId: string,
  limit: number | null,
  db: Db
): Promise<boolean> => {
  try {
    await db.couponCustomerUsage.createMany({ data: [{ couponId, customerId, usedCount: 0 }], skipDuplicates: true });
    const { count } = await db.couponCustomerUsage.updateMany({
      where: { couponId, customerId, ...(limit === null ? {} : { usedCount: { lt: limit } }) },
      data: { usedCount: { increment: 1 } },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const findRedemption = async (couponId: string, orderRef: string, db: Db = prisma): Promise<ICouponRedemption | null> => {
  try {
    return (await db.couponRedemption.findUnique({
      where: { couponId_orderRef: { couponId, orderRef } },
    })) as ICouponRedemption | null;
  } catch (error) {
    throw error;
  }
};

const insertRedemption = async (data: IRedemptionCreate, db: Db): Promise<ICouponRedemption> => {
  try {
    return (await db.couponRedemption.create({ data })) as ICouponRedemption;
  } catch (error) {
    throw error;
  }
};

const usage = async (couponId: string): Promise<ICouponUsage> => {
  try {
    const [sums, uniqueCustomers] = await prisma.$transaction([
      prisma.couponRedemption.aggregate({ where: { couponId }, _count: { _all: true }, _sum: { discountPaise: true } }),
      prisma.couponCustomerUsage.count({ where: { couponId, usedCount: { gt: 0 } } }),
    ]);
    return { redemptions: sums._count._all, totalDiscountPaise: sums._sum.discountPaise ?? 0, uniqueCustomers };
  } catch (error) {
    throw error;
  }
};

export const CouponQuery = {
  create,
  findById,
  findByCode,
  update,
  list,
  listAvailable,
  exhaustedForCustomer,
  customerUseCount,
  takeUse,
  takeCustomerUse,
  findRedemption,
  insertRedemption,
  usage,
};
