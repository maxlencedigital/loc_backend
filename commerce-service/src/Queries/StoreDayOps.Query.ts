import type { Prisma } from "@prisma/client";
import { Page, PageRequest, toPage } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IResourceReading, IResourceReadingCreate } from "../Models/StoreAdmin/StoreAdmin.Interface.js";
import { fromDbDate, toDbDate } from "../Utils/StoreAdminInput.js";

export type Db = Prisma.TransactionClient;

const toReading = (row: Prisma.ResourceReadingGetPayload<object>): IResourceReading => ({
  id: row.id,
  storeId: row.storeId,
  date: fromDbDate(row.date),
  waterMilliLitres: row.waterMilliLitres,
  electricityMilliKwh: row.electricityMilliKwh,
  detergentMilliKg: row.detergentMilliKg,
  notes: row.notes,
  byName: row.byName,
});

// The unique (storeId, date) index makes a second reading for a day a unique violation the
// service turns into a 409; no read-then-write.
const createReading = async (data: IResourceReadingCreate, db: Db = prisma): Promise<IResourceReading> => {
  try {
    return toReading(await db.resourceReading.create({ data: { ...data, date: toDbDate(data.date) } }));
  } catch (error) {
    throw error;
  }
};

const listReadings = async (
  storeId: string,
  from: string,
  to: string,
  page: PageRequest,
  db: Db = prisma
): Promise<Page<IResourceReading>> => {
  try {
    const where = { storeId, date: { gte: toDbDate(from), lte: toDbDate(to) } };
    const [rows, total] = await Promise.all([
      db.resourceReading.findMany({ where, orderBy: [{ date: "desc" }], skip: page.offset, take: page.limit }),
      db.resourceReading.count({ where }),
    ]);
    return toPage(rows.map(toReading), total, page);
  } catch (error) {
    throw error;
  }
};

export const StoreDayOpsQuery = { createReading, listReadings };
