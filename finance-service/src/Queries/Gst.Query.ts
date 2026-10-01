import type { Prisma } from "@prisma/client";
import { PageRequest } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { GstStatus, IGstFigures, IGstLine, IGstReport } from "../Models/Gst/Gst.Interface.js";
import { Db } from "./Db.js";

type Row = Prisma.GstReportGetPayload<object>;

// Totals are BigInt columns (a month across stores can pass 32 bits of paise); the domain uses numbers.
const toReport = (row: Row): IGstReport => ({
  id: row.id,
  month: row.month,
  status: row.status,
  rateBps: row.rateBps,
  grossPaise: Number(row.grossPaise),
  refundsPaise: Number(row.refundsPaise),
  taxablePaise: Number(row.taxablePaise),
  taxPaise: Number(row.taxPaise),
  cgstPaise: Number(row.cgstPaise),
  sgstPaise: Number(row.sgstPaise),
  orderCount: row.orderCount,
  storeIds: row.storeIds,
  lines: row.lines as unknown as IGstLine[],
  generatedAt: row.generatedAt,
  generatedByUserId: row.generatedByUserId,
  filedAt: row.filedAt,
  filedByUserId: row.filedByUserId,
  acknowledgement: row.acknowledgement,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const figuresData = (figures: IGstFigures) => ({
  rateBps: figures.rateBps,
  grossPaise: BigInt(figures.grossPaise),
  refundsPaise: BigInt(figures.refundsPaise),
  taxablePaise: BigInt(figures.taxablePaise),
  taxPaise: BigInt(figures.taxPaise),
  cgstPaise: BigInt(figures.cgstPaise),
  sgstPaise: BigInt(figures.sgstPaise),
  orderCount: figures.orderCount,
  storeIds: figures.storeIds,
  lines: figures.lines as unknown as Prisma.InputJsonValue,
});

const findByMonth = async (month: string, db: Db = prisma): Promise<IGstReport | null> => {
  try {
    const row = await db.gstReport.findUnique({ where: { month } });
    return row ? toReport(row) : null;
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, db: Db = prisma): Promise<IGstReport | null> => {
  try {
    const row = await db.gstReport.findUnique({ where: { id } });
    return row ? toReport(row) : null;
  } catch (error) {
    throw error;
  }
};

// A no-op UPDATE takes the row lock, so two generate or file calls for a month run one after the other.
const lockByMonth = async (month: string, db: Db): Promise<IGstReport | null> => {
  try {
    await db.gstReport.updateMany({ where: { month }, data: { updatedAt: new Date() } });
    return await findByMonth(month, db);
  } catch (error) {
    throw error;
  }
};

/** Creates the month's report. False means another request created it first (unique month). */
const create = async (
  data: { month: string; status: GstStatus; generatedByUserId: string; acknowledgement: string | null; filedByUserId: string | null; filedAt: Date | null; generatedAt: Date } & IGstFigures,
  db: Db = prisma
): Promise<boolean> => {
  try {
    const { month, status, generatedByUserId, acknowledgement, filedByUserId, filedAt, generatedAt, ...figures } = data;
    const { count } = await db.gstReport.createMany({
      data: [
        { month, status, generatedByUserId, acknowledgement, filedByUserId, filedAt, generatedAt, ...figuresData(figures) },
      ],
      skipDuplicates: true,
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

/** Rewrites an unfiled report. The guard means a report filed in the meantime is never touched. */
const replaceUnfiled = async (
  id: string,
  data: { status: GstStatus; generatedByUserId: string; generatedAt: Date; acknowledgement: string | null; filedByUserId: string | null; filedAt: Date | null } & IGstFigures,
  db: Db = prisma
): Promise<boolean> => {
  try {
    const { status, generatedByUserId, generatedAt, acknowledgement, filedByUserId, filedAt, ...figures } = data;
    const { count } = await db.gstReport.updateMany({
      where: { id, status: { in: ["draft", "ready"] } },
      data: { status, generatedByUserId, generatedAt, acknowledgement, filedByUserId, filedAt, ...figuresData(figures) },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const search = async (year: string | undefined, page: PageRequest): Promise<{ items: IGstReport[]; total: number }> => {
  try {
    const where: Prisma.GstReportWhereInput = year ? { month: { gte: `${year}-01`, lte: `${year}-12` } } : {};
    const [rows, total] = await Promise.all([
      prisma.gstReport.findMany({ where, orderBy: { month: "desc" }, skip: page.offset, take: page.limit }),
      prisma.gstReport.count({ where }),
    ]);
    return { items: rows.map(toReport), total };
  } catch (error) {
    throw error;
  }
};

export const GstQuery = { findByMonth, findById, lockByMonth, create, replaceUnfiled, search };
