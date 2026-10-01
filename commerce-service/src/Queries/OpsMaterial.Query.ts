import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IMaterial, IMaterialUpdate, IMaterialWrite, IPage } from "../Models/OpsVendors/Vendor.Interface.js";
import { IStockRow } from "../Models/OpsVendors/PurchaseOrder.Interface.js";

export type Db = Prisma.TransactionClient;

const toMaterial = (row: Prisma.OpsMaterialGetPayload<object>): IMaterial => row;

const create = async (data: IMaterialWrite, db: Db = prisma): Promise<IMaterial> => {
  try {
    return toMaterial(await db.opsMaterial.create({ data }));
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, db: Db = prisma): Promise<IMaterial | null> => {
  try {
    const row = await db.opsMaterial.findUnique({ where: { id } });
    return row ? toMaterial(row) : null;
  } catch (error) {
    throw error;
  }
};

// One query for a whole order's lines, never one per line.
const findByIds = async (ids: string[], db: Db = prisma): Promise<IMaterial[]> => {
  try {
    return (await db.opsMaterial.findMany({ where: { id: { in: ids } } })).map(toMaterial);
  } catch (error) {
    throw error;
  }
};

const list = async (offset: number, limit: number, db: Db = prisma): Promise<IPage<IMaterial>> => {
  try {
    const [rows, total] = await Promise.all([
      db.opsMaterial.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }], skip: offset, take: limit }),
      db.opsMaterial.count(),
    ]);
    return { items: rows.map(toMaterial), total };
  } catch (error) {
    throw error;
  }
};

const update = async (id: string, data: IMaterialUpdate, db: Db = prisma): Promise<IMaterial> => {
  try {
    return toMaterial(await db.opsMaterial.update({ where: { id }, data }));
  } catch (error) {
    throw error;
  }
};

// Materials that have a reorder level, which is all the requirements report looks at.
const listWithReorderLevel = async (limit: number, db: Db = prisma): Promise<IMaterial[]> => {
  try {
    const rows = await db.opsMaterial.findMany({
      where: { reorderLevelMilli: { gt: 0 } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(toMaterial);
  } catch (error) {
    throw error;
  }
};

const stockFor = async (materialIds: string[], storeIds: string[], db: Db = prisma): Promise<IStockRow[]> => {
  try {
    return await db.opsMaterialStock.findMany({
      where: { materialId: { in: materialIds }, storeId: { in: storeIds } },
      select: { materialId: true, storeId: true, quantityMilli: true },
    });
  } catch (error) {
    throw error;
  }
};

// Native INSERT .. ON CONFLICT DO UPDATE: two deliveries of the same material to the same
// store add up instead of one overwriting the other.
const addStock = async (materialId: string, storeId: string, quantityMilli: number, db: Db): Promise<void> => {
  try {
    await db.opsMaterialStock.upsert({
      where: { materialId_storeId: { materialId, storeId } },
      create: { materialId, storeId, quantityMilli },
      update: { quantityMilli: { increment: quantityMilli } },
    });
  } catch (error) {
    throw error;
  }
};

export const OpsMaterialQuery = { create, findById, findByIds, list, update, listWithReorderLevel, stockFor, addStock };
