import { prisma } from "../DB/Prisma.Connection.Db.js";
import type { IQualityCheck, IQualityResult, QcOutcome } from "../Models/StoreFloor/StoreFloor.Interface.js";
import type { Db } from "./Floor.Transaction.js";

const toCheck = ({ results, ...row }: any): IQualityCheck => ({
  id: row.id,
  orderId: row.orderId,
  outcome: row.outcome,
  byName: row.byName,
  createdAt: row.createdAt,
  results: results.map((r: any): IQualityResult => ({
    pieceId: r.pieceId,
    passed: r.passed,
    note: r.note,
    comparedWithPickupNotes: r.comparedWithPickupNotes,
  })),
});

const create = async (
  data: { orderId: string; storeId: string; outcome: QcOutcome; byName: string; byUserId: string; results: IQualityResult[] },
  db: Db
): Promise<IQualityCheck> => {
  try {
    const { results, ...check } = data;
    const row = await db.qualityCheck.create({ data: { ...check, results: { create: results } }, include: { results: true } });
    return toCheck(row);
  } catch (error) {
    throw error;
  }
};

const latestForOrder = async (orderId: string, storeId: string | null, db: Db = prisma): Promise<IQualityCheck | null> => {
  try {
    const row = await db.qualityCheck.findFirst({
      where: { orderId, ...(storeId ? { storeId } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      include: { results: true },
    });
    return row ? toCheck(row) : null;
  } catch (error) {
    throw error;
  }
};

export const QualityQuery = { create, latestForOrder };
