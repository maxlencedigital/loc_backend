import { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IStockAlertRow,
  IStockFlagWrite,
  IStockMovement,
  IStockMovementWrite,
  MovementKind,
  StockFlagLevel,
} from "../Models/StoreAdmin/StoreAdmin.Interface.js";
import { qualified } from "./RawSql.js";

export type Db = Prisma.TransactionClient;

export interface IStockSelect {
  storeId: string;
  category?: string;
  itemId?: string;
  // Only items at or below their reorder level.
  lowOnly?: boolean;
  // Items at or below their reorder level, or with an open flag from the floor.
  alertsOnly?: boolean;
  offset: number;
  limit: number;
  newestAlertFirst?: boolean;
}

interface RawStockRow {
  id: string;
  name: string;
  unit: string;
  category: string;
  quantityMilli: number;
  reorderLevelMilli: number;
  updatedAt: Date;
  flagLevel: StockFlagLevel | null;
  flagNote: string | null;
  flagRaisedBy: string | null;
  flagRaisedAt: Date | null;
  total: number;
}

// Stock quantities are the purchasing module's commerce_material_stock rows (a missing row
// means the store has never held the material). Comparing quantity with the reorder level is
// a column-to-column test Prisma cannot express, hence the one raw query for every stock read.
// A floor flag stays open until the stock row has been updated after it and is back above its
// reorder level; the CASE below is that rule.
const select = async (query: IStockSelect, db: Db = prisma): Promise<{ rows: IStockAlertRow[]; total: number }> => {
  try {
    const conditions: Prisma.Sql[] = [];
    if (query.lowOnly) conditions.push(Prisma.sql`"quantityMilli" <= "reorderLevelMilli"`);
    if (query.alertsOnly) conditions.push(Prisma.sql`("quantityMilli" <= "reorderLevelMilli" OR "flagLevel" IS NOT NULL)`);
    const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
    const inner: Prisma.Sql[] = [Prisma.sql`s."storeId" = ${query.storeId}::uuid`];
    if (query.category) inner.push(Prisma.sql`m."category"::text = ${query.category}`);
    if (query.itemId) inner.push(Prisma.sql`m."id" = ${query.itemId}::uuid`);
    const order = query.newestAlertFirst
      ? Prisma.sql`ORDER BY COALESCE("flagRaisedAt", "updatedAt") DESC, "id"`
      : Prisma.sql`ORDER BY "name", "id"`;

    const rows = await db.$queryRaw<RawStockRow[]>`
      SELECT *, count(*) OVER()::int AS "total" FROM (
        SELECT m."id", m."name", m."unit", m."category"::text AS "category",
               s."quantityMilli", m."reorderLevelMilli", s."updatedAt",
               CASE WHEN f."id" IS NOT NULL AND NOT (s."updatedAt" > f."raisedAt" AND s."quantityMilli" > m."reorderLevelMilli")
                    THEN f."level" END AS "flagLevel",
               CASE WHEN f."id" IS NOT NULL AND NOT (s."updatedAt" > f."raisedAt" AND s."quantityMilli" > m."reorderLevelMilli")
                    THEN f."note" END AS "flagNote",
               CASE WHEN f."id" IS NOT NULL AND NOT (s."updatedAt" > f."raisedAt" AND s."quantityMilli" > m."reorderLevelMilli")
                    THEN f."raisedByName" END AS "flagRaisedBy",
               CASE WHEN f."id" IS NOT NULL AND NOT (s."updatedAt" > f."raisedAt" AND s."quantityMilli" > m."reorderLevelMilli")
                    THEN f."raisedAt" END AS "flagRaisedAt"
        FROM ${qualified("commerce_material_stock")} s
        JOIN ${qualified("commerce_materials")} m ON m."id" = s."materialId"
        LEFT JOIN ${qualified("commerce_stock_flags")} f ON f."storeId" = s."storeId" AND f."itemId" = m."id"
        WHERE ${Prisma.join(inner, " AND ")}
      ) base
      ${where}
      ${order}
      LIMIT ${query.limit} OFFSET ${query.offset}`;
    return { rows: rows.map(({ total: _total, ...row }) => row), total: rows[0]?.total ?? 0 };
  } catch (error) {
    throw error;
  }
};

// The total above is the window count of the page asked for; an offset past the end has no
// rows to carry it, so the caller asks for the count separately in that case.
const count = async (query: Omit<IStockSelect, "offset" | "limit">, db: Db = prisma): Promise<number> => {
  try {
    const result = await select({ ...query, offset: 0, limit: 1 }, db);
    return result.total;
  } catch (error) {
    throw error;
  }
};

const upsertFlag = async (data: IStockFlagWrite, db: Db = prisma): Promise<void> => {
  try {
    const fields = {
      level: data.level,
      note: data.note,
      raisedByUserId: data.byUserId,
      raisedByName: data.byName,
      raisedAt: new Date(),
    };
    await db.stockFlag.upsert({
      where: { storeId_itemId: { storeId: data.storeId, itemId: data.itemId } },
      create: { storeId: data.storeId, itemId: data.itemId, ...fields },
      update: fields,
    });
  } catch (error) {
    throw error;
  }
};

const findMaterial = async (itemId: string, db: Db = prisma): Promise<{ id: string; name: string } | null> => {
  try {
    return await db.opsMaterial.findUnique({ where: { id: itemId }, select: { id: true, name: true } });
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

const toMovement = (row: Prisma.StockMovementGetPayload<object>): IStockMovement => ({
  id: row.id,
  storeId: row.storeId,
  itemId: row.itemId,
  kind: row.kind as MovementKind,
  deltaMilli: row.deltaMilli,
  quantityAfterMilli: row.quantityAfterMilli,
  reason: row.reason,
  byName: row.byName,
  createdAt: row.createdAt,
});

const findMovementByKey = async (
  storeId: string,
  itemId: string,
  key: string,
  db: Db = prisma
): Promise<IStockMovement | null> => {
  try {
    const row = await db.stockMovement.findFirst({ where: { storeId, itemId, idempotencyKey: key } });
    return row ? toMovement(row) : null;
  } catch (error) {
    throw error;
  }
};

// Changes the quantity with one atomic UPDATE and appends the ledger row in the same
// transaction. A decrease only applies while enough is on hand (the WHERE is the guard), so two
// simultaneous consumptions can never take the quantity below zero. Null: not enough stock.
const applyMovement = async (data: IStockMovementWrite, db: Db): Promise<IStockMovement | null> => {
  try {
    const where = { materialId: data.itemId, storeId: data.storeId };
    if (data.deltaMilli < 0) {
      const { count: changed } = await db.opsMaterialStock.updateMany({
        where: { ...where, quantityMilli: { gte: -data.deltaMilli } },
        data: { quantityMilli: { decrement: -data.deltaMilli } },
      });
      if (changed === 0) return null;
    } else {
      await db.opsMaterialStock.createMany({ data: [{ ...where, quantityMilli: 0 }], skipDuplicates: true });
      await db.opsMaterialStock.updateMany({ where, data: { quantityMilli: { increment: data.deltaMilli } } });
    }
    const after = await db.opsMaterialStock.findUniqueOrThrow({
      where: { materialId_storeId: where },
      select: { quantityMilli: true },
    });
    const row = await db.stockMovement.create({
      data: {
        storeId: data.storeId,
        itemId: data.itemId,
        kind: data.kind,
        deltaMilli: data.deltaMilli,
        quantityAfterMilli: after.quantityMilli,
        reason: data.reason,
        byUserId: data.byUserId,
        byName: data.byName,
        idempotencyKey: data.idempotencyKey,
      },
    });
    return toMovement(row);
  } catch (error) {
    throw error;
  }
};

export const StoreStockQuery = {
  select,
  count,
  upsertFlag,
  findMaterial,
  inTransaction,
  findMovementByKey,
  applyMovement,
};
