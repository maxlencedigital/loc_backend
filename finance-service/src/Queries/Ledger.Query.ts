import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { PageRequest } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { dayToDate } from "../Utils/Dates.js";
import { ILedgerAccountTotal, ILedgerEntry, ILedgerFilter, ILedgerPosting } from "../Models/Ledger/Ledger.Interface.js";
import { Db, toDay } from "./Db.js";

/**
 * Writes a posting's lines under one journal id. (sourceType, sourceId, lineNo) is unique and
 * duplicates are skipped, so posting the same event again writes nothing. Returns whether it wrote.
 */
const post = async (posting: ILedgerPosting, db: Db = prisma): Promise<boolean> => {
  try {
    const journalId = crypto.randomUUID();
    const { count } = await db.ledgerEntry.createMany({
      data: posting.lines.map((line, index) => ({
        journalId,
        lineNo: index + 1,
        date: dayToDate(posting.date),
        account: line.account,
        debitPaise: line.debitPaise,
        creditPaise: line.creditPaise,
        reference: posting.reference,
        storeId: posting.storeId,
        sourceType: posting.sourceType,
        sourceId: posting.sourceId,
      })),
      skipDuplicates: true,
    });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

const whereOf = (filter: ILedgerFilter): Prisma.LedgerEntryWhereInput => ({
  ...(filter.storeId ? { storeId: filter.storeId } : {}),
  ...(filter.account ? { account: filter.account } : {}),
  ...(filter.from || filter.to
    ? { date: { ...(filter.from ? { gte: dayToDate(filter.from) } : {}), ...(filter.to ? { lte: dayToDate(filter.to) } : {}) } }
    : {}),
});

const search = async (filter: ILedgerFilter, page: PageRequest): Promise<{ items: ILedgerEntry[]; total: number }> => {
  try {
    const where = whereOf(filter);
    const [rows, total] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: page.offset,
        take: page.limit,
      }),
      prisma.ledgerEntry.count({ where }),
    ]);
    return { items: rows.map((row) => ({ ...row, date: toDay(row.date) })), total };
  } catch (error) {
    throw error;
  }
};

const totalsByAccount = async (filter: ILedgerFilter): Promise<ILedgerAccountTotal[]> => {
  try {
    const groups = await prisma.ledgerEntry.groupBy({
      by: ["account"],
      where: whereOf(filter),
      _sum: { debitPaise: true, creditPaise: true },
      orderBy: { account: "asc" },
    });
    return groups.map((g) => ({
      account: g.account,
      debitPaise: Number(g._sum.debitPaise ?? 0),
      creditPaise: Number(g._sum.creditPaise ?? 0),
    }));
  } catch (error) {
    throw error;
  }
};

export const LedgerQuery = { post, search, totalsByAccount };
