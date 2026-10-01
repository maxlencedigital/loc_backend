import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import type {
  ICustomerPackage,
  ICustomerPackageCreate,
  ICustomerPackageFilter,
  IPackageCreate,
  IPackageUpdate,
  IPrepaidPackage,
} from "../Models/Package/Package.Interface.js";

const createPackage = async (data: IPackageCreate): Promise<IPrepaidPackage> => {
  try {
    return (await prisma.prepaidPackage.create({ data })) as IPrepaidPackage;
  } catch (error) {
    throw error;
  }
};

const findPackage = async (id: string): Promise<IPrepaidPackage | null> => {
  try {
    return (await prisma.prepaidPackage.findUnique({ where: { id } })) as IPrepaidPackage | null;
  } catch (error) {
    throw error;
  }
};

const updatePackage = async (id: string, data: IPackageUpdate): Promise<IPrepaidPackage | null> => {
  try {
    const { count } = await prisma.prepaidPackage.updateMany({ where: { id }, data });
    return count === 0 ? null : await findPackage(id);
  } catch (error) {
    throw error;
  }
};

const listPackages = async (
  filter: { isActive?: boolean },
  paging: { offset: number; limit: number }
): Promise<{ items: IPrepaidPackage[]; total: number }> => {
  try {
    const where: Prisma.PrepaidPackageWhereInput = filter.isActive === undefined ? {} : { isActive: filter.isActive };
    const [items, total] = await prisma.$transaction([
      prisma.prepaidPackage.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: paging.offset, take: paging.limit }),
      prisma.prepaidPackage.count({ where }),
    ]);
    return { items: items as IPrepaidPackage[], total };
  } catch (error) {
    throw error;
  }
};

// An active row past its expiry is reported as expired without waiting for a job to flip it.
const statusWhere = (filter: ICustomerPackageFilter): Prisma.CustomerPackageWhereInput => {
  switch (filter.status) {
    case "active":
      return { status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: filter.now } }] };
    case "expired":
      return { OR: [{ status: "expired" }, { status: "active", expiresAt: { lte: filter.now } }] };
    case "exhausted":
      return { status: "exhausted" };
    default:
      // Unpaid (pending) purchases are not packages yet.
      return { status: { not: "pending" } };
  }
};

const listCustomerPackages = async (
  filter: ICustomerPackageFilter,
  paging: { offset: number; limit: number }
): Promise<{ items: ICustomerPackage[]; total: number }> => {
  try {
    const where: Prisma.CustomerPackageWhereInput = {
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.packageId ? { packageId: filter.packageId } : {}),
      ...statusWhere(filter),
    };
    const [items, total] = await prisma.$transaction([
      prisma.customerPackage.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: paging.offset, take: paging.limit }),
      prisma.customerPackage.count({ where }),
    ]);
    return { items: items as ICustomerPackage[], total };
  } catch (error) {
    throw error;
  }
};

const findCustomerPackage = async (id: string): Promise<ICustomerPackage | null> => {
  try {
    return (await prisma.customerPackage.findUnique({ where: { id } })) as ICustomerPackage | null;
  } catch (error) {
    throw error;
  }
};

const findCustomerPackageByRef = async (orderRef: string): Promise<ICustomerPackage | null> => {
  try {
    return (await prisma.customerPackage.findUnique({ where: { orderRef } })) as ICustomerPackage | null;
  } catch (error) {
    throw error;
  }
};

const createCustomerPackage = async (data: ICustomerPackageCreate): Promise<ICustomerPackage> => {
  try {
    return (await prisma.customerPackage.create({
      data: { ...data, remainingCreditPaise: data.creditPaise, status: "pending" },
    })) as ICustomerPackage;
  } catch (error) {
    throw error;
  }
};

const countPending = async (customerId: string, since: Date): Promise<number> => {
  try {
    return await prisma.customerPackage.count({ where: { customerId, status: "pending", createdAt: { gte: since } } });
  } catch (error) {
    throw error;
  }
};

/** pending -> active, once: the status in the WHERE makes a repeated activation a no-op. */
const activate = async (orderRef: string, expiresAt: Date, activatedAt: Date): Promise<boolean> => {
  try {
    const { count } = await prisma.customerPackage.updateMany({
      where: { orderRef, status: "pending" },
      data: { status: "active", expiresAt, activatedAt },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

export const PackageQuery = {
  createPackage,
  findPackage,
  updatePackage,
  listPackages,
  listCustomerPackages,
  findCustomerPackage,
  findCustomerPackageByRef,
  createCustomerPackage,
  countPending,
  activate,
};
