import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import type { IPhoto, IPhotoInput, PhotoOwner } from "../Models/CustomerAccount/CustomerAccount.Interface.js";

export type Db = Prisma.TransactionClient;

const toPhoto = (row: { ownerType: string } & Omit<IPhoto, "ownerType">): IPhoto => ({
  ...row,
  ownerType: row.ownerType as PhotoOwner,
});

const count = async (ownerType: PhotoOwner, ownerId: string, db: Db = prisma): Promise<number> => {
  try {
    return await db.customerPhoto.count({ where: { ownerType, ownerId } });
  } catch (error) {
    throw error;
  }
};

// One query for a whole page of owners, so a list of profiles is not a query per profile.
const listByOwners = async (ownerType: PhotoOwner, ownerIds: string[], db: Db = prisma): Promise<IPhoto[]> => {
  try {
    if (ownerIds.length === 0) return [];
    const rows = await db.customerPhoto.findMany({
      where: { ownerType, ownerId: { in: ownerIds } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toPhoto);
  } catch (error) {
    throw error;
  }
};

const createMany = async (
  customerId: string,
  ownerType: PhotoOwner,
  ownerId: string,
  photos: IPhotoInput[],
  db: Db
): Promise<IPhoto[]> => {
  try {
    const rows = await db.customerPhoto.createManyAndReturn({
      data: photos.map((photo) => ({ ...photo, customerId, ownerType, ownerId })),
    });
    return rows.map(toPhoto);
  } catch (error) {
    throw error;
  }
};

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

export const CustomerPhotoQuery = { inTransaction, count, listByOwners, createMany };
