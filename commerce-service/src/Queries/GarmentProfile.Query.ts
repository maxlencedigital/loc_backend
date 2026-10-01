import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import type {
  Fabric,
  IGarmentProfile,
  IGarmentProfileInput,
  IGarmentVisit,
} from "../Models/CustomerAccount/CustomerAccount.Interface.js";
import type { ICareProfile } from "../Models/Order/Order.Interface.js";

export type Db = Prisma.TransactionClient;

const toProfile = (row: { fabric: string } & Omit<IGarmentProfile, "fabric">): IGarmentProfile => ({
  ...row,
  fabric: row.fabric as Fabric,
});

const list = async (
  customerId: string,
  offset: number,
  limit: number,
  db: Db = prisma
): Promise<{ items: IGarmentProfile[]; total: number }> => {
  try {
    const [rows, total] = await Promise.all([
      db.customerGarmentProfile.findMany({
        where: { customerId },
        orderBy: [{ isFavourite: "desc" }, { createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      }),
      db.customerGarmentProfile.count({ where: { customerId } }),
    ]);
    return { items: rows.map(toProfile), total };
  } catch (error) {
    throw error;
  }
};

const findOwned = async (customerId: string, id: string, db: Db = prisma): Promise<IGarmentProfile | null> => {
  try {
    const row = await db.customerGarmentProfile.findFirst({ where: { id, customerId } });
    return row ? toProfile(row) : null;
  } catch (error) {
    throw error;
  }
};

// How many of these ids are this customer's own profiles (one query for a whole basket).
const countOwned = async (customerId: string, ids: string[], db: Db = prisma): Promise<number> => {
  try {
    if (ids.length === 0) return 0;
    return await db.customerGarmentProfile.count({ where: { customerId, id: { in: ids } } });
  } catch (error) {
    throw error;
  }
};

const count = async (customerId: string, db: Db = prisma): Promise<number> => {
  try {
    return await db.customerGarmentProfile.count({ where: { customerId } });
  } catch (error) {
    throw error;
  }
};

const create = async (customerId: string, data: IGarmentProfileInput, db: Db = prisma): Promise<IGarmentProfile> => {
  try {
    return toProfile(await db.customerGarmentProfile.create({ data: { ...data, customerId } }));
  } catch (error) {
    throw error;
  }
};

const update = async (
  customerId: string,
  id: string,
  data: Partial<IGarmentProfileInput>,
  db: Db = prisma
): Promise<IGarmentProfile | null> => {
  try {
    const { count: changed } = await db.customerGarmentProfile.updateMany({ where: { id, customerId }, data });
    return changed === 0 ? null : await findOwned(customerId, id, db);
  } catch (error) {
    throw error;
  }
};

// A no-op UPDATE as a row lock: photo counts are checked against the profile under it.
const lock = async (customerId: string, id: string, db: Db): Promise<boolean> => {
  try {
    const { count: locked } = await db.customerGarmentProfile.updateMany({
      where: { id, customerId },
      data: { updatedAt: new Date() },
    });
    return locked > 0;
  } catch (error) {
    throw error;
  }
};

// Deletes the profile with its photos and detaches it from past order lines (no foreign
// keys, so this is the one place that keeps them tidy).
const remove = async (customerId: string, id: string, db: Db): Promise<boolean> => {
  try {
    const { count: removed } = await db.customerGarmentProfile.deleteMany({ where: { id, customerId } });
    if (removed === 0) return false;
    await db.customerPhoto.deleteMany({ where: { ownerType: "garment_profile", ownerId: id } });
    await db.customerOrderLine.updateMany({ where: { garmentProfileId: id }, data: { garmentProfileId: null } });
    return true;
  } catch (error) {
    throw error;
  }
};

// The newest visits of one garment profile: its order lines, then their orders, items and
// stores fetched together (four queries however many visits), cancelled orders left out.
const history = async (customerId: string, profileId: string, limit: number, db: Db = prisma): Promise<IGarmentVisit[]> => {
  try {
    const lines = await db.customerOrderLine.findMany({
      where: { customerId, garmentProfileId: profileId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      select: { orderId: true, orderItemId: true, note: true },
    });
    if (lines.length === 0) return [];
    const orders = await db.order.findMany({
      where: { id: { in: lines.map((l) => l.orderId) }, customerId, status: { not: "cancelled" } },
      select: { id: true, storeId: true, placedAt: true, care: true },
    });
    const [items, stores] = await Promise.all([
      db.orderItem.findMany({
        where: { id: { in: lines.map((l) => l.orderItemId) } },
        select: { id: true, serviceName: true },
      }),
      db.store.findMany({ where: { id: { in: [...new Set(orders.map((o) => o.storeId))] } }, select: { id: true, name: true } }),
    ]);
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const itemById = new Map(items.map((i) => [i.id, i.serviceName]));
    const storeById = new Map(stores.map((s) => [s.id, s.name]));
    return lines.flatMap((line) => {
      const order = orderById.get(line.orderId);
      if (!order) return [];
      const orderNote = (order.care as unknown as ICareProfile).customerNote;
      return [
        {
          orderId: order.id,
          storeId: order.storeId,
          storeName: storeById.get(order.storeId) ?? "",
          placedAt: order.placedAt,
          service: itemById.get(line.orderItemId) ?? "",
          careNote: line.note || orderNote || "",
        },
      ];
    });
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

export const GarmentProfileQuery = { inTransaction, list, findOwned, count, countOwned, create, update, lock, remove, history };
