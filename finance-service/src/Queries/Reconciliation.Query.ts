import { PageRequest } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { dayToDate } from "../Utils/Dates.js";
import {
  IBankLine,
  IBankLineInput,
  IBankStatement,
  IReconciliationException,
  IReconciliationRun,
  IReconciliationRunCreate,
} from "../Models/Reconciliation/Reconciliation.Interface.js";
import { toDay } from "./Db.js";

type RunRow = {
  id: string;
  source: "bank" | "razorpay";
  fromDate: Date;
  toDate: Date;
  matched: number;
  exceptionCount: number;
  truncated: boolean;
  ranByUserId: string;
  ranAt: Date;
};

const toRun = (row: RunRow): IReconciliationRun => ({
  id: row.id,
  source: row.source,
  from: toDay(row.fromDate),
  to: toDay(row.toDate),
  matched: row.matched,
  exceptions: row.exceptionCount,
  truncated: row.truncated,
  ranByUserId: row.ranByUserId,
  ranAt: row.ranAt,
});

/** Saves a run and its exception rows together. */
const createRun = async (data: IReconciliationRunCreate): Promise<IReconciliationRun> => {
  try {
    const run = await prisma.reconciliationRun.create({
      data: {
        source: data.source,
        fromDate: dayToDate(data.from),
        toDate: dayToDate(data.to),
        matched: data.matched,
        exceptionCount: data.exceptionCount,
        truncated: data.truncated,
        ranByUserId: data.ranByUserId,
        exceptions: { create: data.exceptions },
      },
    });
    return toRun(run);
  } catch (error) {
    throw error;
  }
};

const searchRuns = async (page: PageRequest): Promise<{ items: IReconciliationRun[]; total: number }> => {
  try {
    const [rows, total] = await Promise.all([
      prisma.reconciliationRun.findMany({
        orderBy: [{ ranAt: "desc" }, { id: "desc" }],
        skip: page.offset,
        take: page.limit,
      }),
      prisma.reconciliationRun.count(),
    ]);
    return { items: rows.map(toRun), total };
  } catch (error) {
    throw error;
  }
};

const findRun = async (id: string): Promise<IReconciliationRun | null> => {
  try {
    const row = await prisma.reconciliationRun.findUnique({ where: { id } });
    return row ? toRun(row) : null;
  } catch (error) {
    throw error;
  }
};

const listExceptions = async (runId: string, limit: number): Promise<IReconciliationException[]> => {
  try {
    return await prisma.reconciliationException.findMany({
      where: { runId },
      select: { id: true, reference: true, expectedPaise: true, actualPaise: true, reason: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
    });
  } catch (error) {
    throw error;
  }
};

/** Stores a statement with its lines; lines already stored by an earlier upload are skipped. */
const createStatement = async (
  meta: { bank: string | null; fileName: string; uploadedByUserId: string },
  lines: IBankLineInput[]
): Promise<IBankStatement> => {
  try {
    return await prisma.$transaction(async (tx) => {
      const statement = await tx.bankStatement.create({
        data: { ...meta, lineCount: 0, skippedCount: 0 },
      });
      const { count } = await tx.bankStatementLine.createMany({
        data: lines.map((line) => ({
          statementId: statement.id,
          date: dayToDate(line.date),
          description: line.description,
          reference: line.reference,
          amountPaise: line.amountPaise,
          lineHash: line.lineHash,
        })),
        skipDuplicates: true,
      });
      return await tx.bankStatement.update({
        where: { id: statement.id },
        data: { lineCount: count, skippedCount: lines.length - count },
      });
    });
  } catch (error) {
    throw error;
  }
};

/** Bank lines dated in the window, oldest first, capped at `take`. */
const listBankLines = async (from: string, to: string, take: number): Promise<IBankLine[]> => {
  try {
    const rows = await prisma.bankStatementLine.findMany({
      where: { date: { gte: dayToDate(from), lte: dayToDate(to) } },
      select: { id: true, date: true, description: true, reference: true, amountPaise: true },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take,
    });
    return rows.map((row) => ({ ...row, date: toDay(row.date) }));
  } catch (error) {
    throw error;
  }
};

export const ReconciliationQuery = {
  createRun,
  searchRuns,
  findRun,
  listExceptions,
  createStatement,
  listBankLines,
};
