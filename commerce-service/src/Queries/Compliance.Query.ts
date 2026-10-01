import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IChecklistEntry,
  IComplianceCounts,
  IComplianceCreate,
  IComplianceFilter,
  IComplianceItem,
  IComplianceRenewal,
  IComplianceUpdate,
  IFileRef,
} from "../Models/Ops/Compliance.Interface.js";
import { Db, visibleStores } from "./OpsCompliance.Db.js";

const toItem = (row: Prisma.ComplianceItemGetPayload<object>): IComplianceItem => ({
  ...row,
  checklist: row.checklist as unknown as IChecklistEntry[],
  documents: row.documents as unknown as IFileRef[],
});

const scopedWhere = (scope: string | null, storeId?: string): Prisma.ComplianceItemWhereInput => ({
  AND: [visibleStores(scope), ...(storeId ? [{ storeId }] : [])],
});

// The three derived statuses are date windows on expiresOn, so the status filter and the
// counts use the expiry indexes and never read a stored status that could be stale.
const statusWindow = (filter: Pick<IComplianceFilter, "status" | "today" | "expiringUntil">) => {
  if (filter.status === "expired") return { expiresOn: { lt: filter.today } };
  if (filter.status === "expiring") return { expiresOn: { gte: filter.today, lte: filter.expiringUntil } };
  if (filter.status === "valid") return { expiresOn: { gt: filter.expiringUntil } };
  return {};
};

const create = async (data: IComplianceCreate, db: Db = prisma): Promise<IComplianceItem> => {
  try {
    return toItem(await db.complianceItem.create({ data }));
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, scope: string | null, db: Db = prisma): Promise<IComplianceItem | null> => {
  try {
    const row = await db.complianceItem.findFirst({ where: { id, ...scopedWhere(scope) } });
    return row ? toItem(row) : null;
  } catch (error) {
    throw error;
  }
};

// A no-op UPDATE takes the row lock until the transaction ends, so two renewals or two
// checklist edits for one item queue instead of both reading the old value.
const lockById = async (id: string, scope: string | null, db: Db): Promise<IComplianceItem | null> => {
  try {
    const { count } = await db.complianceItem.updateMany({
      where: { id, ...scopedWhere(scope) },
      data: { updatedAt: new Date() },
    });
    return count === 0 ? null : await findById(id, scope, db);
  } catch (error) {
    throw error;
  }
};

const update = async (id: string, data: IComplianceUpdate, db: Db): Promise<IComplianceItem> => {
  try {
    return toItem(await db.complianceItem.update({ where: { id }, data }));
  } catch (error) {
    throw error;
  }
};

const setChecklist = async (id: string, checklist: IChecklistEntry[], db: Db): Promise<IComplianceItem> => {
  try {
    return toItem(
      await db.complianceItem.update({ where: { id }, data: { checklist: checklist as unknown as Prisma.InputJsonValue } })
    );
  } catch (error) {
    throw error;
  }
};

const setDocuments = async (id: string, documents: IFileRef[], db: Db): Promise<IComplianceItem> => {
  try {
    return toItem(
      await db.complianceItem.update({ where: { id }, data: { documents: documents as unknown as Prisma.InputJsonValue } })
    );
  } catch (error) {
    throw error;
  }
};

const renew = async (
  id: string,
  change: { newExpiresOn: Date; referenceNumber: string | null | undefined },
  db: Db
): Promise<IComplianceItem> => {
  try {
    return toItem(
      await db.complianceItem.update({
        where: { id },
        data: {
          expiresOn: change.newExpiresOn,
          ...(change.referenceNumber !== undefined ? { referenceNumber: change.referenceNumber } : {}),
        },
      })
    );
  } catch (error) {
    throw error;
  }
};

const addRenewal = async (data: Omit<IComplianceRenewal, "id" | "renewedAt">, db: Db): Promise<IComplianceRenewal> => {
  try {
    return await db.complianceRenewal.create({ data });
  } catch (error) {
    throw error;
  }
};

const listRenewals = async (itemId: string, limit: number, db: Db = prisma): Promise<IComplianceRenewal[]> => {
  try {
    return await db.complianceRenewal.findMany({
      where: { itemId },
      orderBy: [{ renewedAt: "desc" }, { id: "desc" }],
      take: limit,
    });
  } catch (error) {
    throw error;
  }
};

const search = async (
  filter: IComplianceFilter,
  page: { offset: number; limit: number },
  db: Db = prisma
): Promise<{ items: IComplianceItem[]; total: number }> => {
  try {
    const where: Prisma.ComplianceItemWhereInput = {
      AND: [
        scopedWhere(filter.scope, filter.storeId),
        statusWindow(filter),
        ...(filter.type ? [{ type: filter.type }] : []),
      ],
    };
    const [rows, total] = await Promise.all([
      db.complianceItem.findMany({
        where,
        orderBy: [{ expiresOn: "asc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.complianceItem.count({ where }),
    ]);
    return { items: rows.map(toItem), total };
  } catch (error) {
    throw error;
  }
};

// Everything that has expired or will within the window, most urgent first.
const searchDue = async (
  filter: { scope: string | null; storeId?: string; until: Date },
  page: { offset: number; limit: number },
  db: Db = prisma
): Promise<{ items: IComplianceItem[]; total: number }> => {
  try {
    const where: Prisma.ComplianceItemWhereInput = {
      AND: [scopedWhere(filter.scope, filter.storeId), { expiresOn: { lte: filter.until } }],
    };
    const [rows, total] = await Promise.all([
      db.complianceItem.findMany({
        where,
        orderBy: [{ expiresOn: "asc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.complianceItem.count({ where }),
    ]);
    return { items: rows.map(toItem), total };
  } catch (error) {
    throw error;
  }
};

const countByStatus = async (
  scope: string | null,
  storeId: string | undefined,
  today: Date,
  expiringUntil: Date,
  db: Db = prisma
): Promise<IComplianceCounts> => {
  try {
    const base = scopedWhere(scope, storeId);
    const count = (status: "expired" | "expiring" | "valid") =>
      db.complianceItem.count({ where: { AND: [base, statusWindow({ status, today, expiringUntil })] } });
    const [expired, expiring, valid] = await Promise.all([count("expired"), count("expiring"), count("valid")]);
    return { expired, expiring, valid };
  } catch (error) {
    throw error;
  }
};

export const ComplianceQuery = {
  create,
  findById,
  lockById,
  update,
  setChecklist,
  setDocuments,
  renew,
  addRenewal,
  listRenewals,
  search,
  searchDue,
  countByStatus,
};
