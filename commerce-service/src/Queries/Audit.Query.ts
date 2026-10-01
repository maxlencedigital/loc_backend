import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  AuditStatus,
  FindingStatus,
  IAudit,
  IAuditChecklistEntry,
  IAuditCreate,
  IAuditFilter,
  IAuditPlanUpdate,
  IFinding,
  IFindingClose,
  IFindingCreate,
  IFindingUpdate,
  IOpenFindingFilter,
} from "../Models/Ops/Audit.Interface.js";
import { Db, visibleStores } from "./OpsCompliance.Db.js";

const OPEN_FINDING: FindingStatus[] = ["open", "in_progress"];

const toAudit = (row: Prisma.AuditGetPayload<object>): IAudit => ({
  ...row,
  checklist: row.checklist as unknown as IAuditChecklistEntry[],
});

/** What a guarded audit change may write; every field is optional. */
export type AuditChange = IAuditPlanUpdate & {
  status?: AuditStatus;
  startedAt?: Date;
  completedAt?: Date;
  summary?: string | null;
  waiverReason?: string | null;
  cancelReason?: string;
  cancelledAt?: Date;
};

const create = async (data: IAuditCreate, db: Db = prisma): Promise<IAudit> => {
  try {
    const checklist = data.checklist as unknown as Prisma.InputJsonValue;
    return toAudit(await db.audit.create({ data: { ...data, checklist } }));
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, scope: string | null, db: Db = prisma): Promise<IAudit | null> => {
  try {
    const row = await db.audit.findFirst({ where: { id, ...visibleStores(scope) } });
    return row ? toAudit(row) : null;
  } catch (error) {
    throw error;
  }
};

// Completing an audit and recording a finding both lock the audit first, so a critical
// finding cannot slip in between the "any critical left open?" check and the completion.
const lockById = async (id: string, scope: string | null, db: Db): Promise<IAudit | null> => {
  try {
    const { count } = await db.audit.updateMany({
      where: { id, ...visibleStores(scope) },
      data: { updatedAt: new Date() },
    });
    return count === 0 ? null : await findById(id, scope, db);
  } catch (error) {
    throw error;
  }
};

// Applies only while the audit still has one of the statuses the caller read; null means
// someone else moved it first.
const changeIfStatus = async (
  id: string,
  expected: AuditStatus[],
  change: AuditChange,
  db: Db
): Promise<IAudit | null> => {
  try {
    const { checklist, ...rest } = change;
    const { count } = await db.audit.updateMany({
      where: { id, status: { in: expected } },
      data: { ...rest, ...(checklist ? { checklist: checklist as unknown as Prisma.InputJsonValue } : {}) },
    });
    return count === 0 ? null : await findById(id, null, db);
  } catch (error) {
    throw error;
  }
};

const search = async (
  filter: IAuditFilter,
  page: { offset: number; limit: number },
  db: Db = prisma
): Promise<{ items: IAudit[]; total: number }> => {
  try {
    const where: Prisma.AuditWhereInput = {
      AND: [
        visibleStores(filter.scope),
        ...(filter.storeId ? [{ storeId: filter.storeId }] : []),
        ...(filter.status ? [{ status: filter.status }] : []),
        ...(filter.type ? [{ type: filter.type }] : []),
      ],
    };
    const [rows, total] = await Promise.all([
      db.audit.findMany({
        where,
        orderBy: [{ scheduledFor: "desc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.audit.count({ where }),
    ]);
    return { items: rows.map(toAudit), total };
  } catch (error) {
    throw error;
  }
};

// One grouped query for a whole page of audits.
const openFindingCounts = async (auditIds: string[], db: Db = prisma): Promise<Map<string, number>> => {
  try {
    if (auditIds.length === 0) return new Map();
    const groups = await db.auditFinding.groupBy({
      by: ["auditId"],
      where: { auditId: { in: auditIds }, status: { in: OPEN_FINDING } },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.auditId, group._count._all]));
  } catch (error) {
    throw error;
  }
};

const countFindings = async (auditId: string, db: Db = prisma): Promise<number> => {
  try {
    return await db.auditFinding.count({ where: { auditId } });
  } catch (error) {
    throw error;
  }
};

const MAX_WAIVED_IDS = 200;

const openCriticalFindingIds = async (auditId: string, db: Db = prisma): Promise<string[]> => {
  try {
    const rows = await db.auditFinding.findMany({
      where: { auditId, severity: "critical", status: { in: OPEN_FINDING } },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }],
      take: MAX_WAIVED_IDS,
    });
    return rows.map((row) => row.id);
  } catch (error) {
    throw error;
  }
};

const createFinding = async (data: IFindingCreate, db: Db): Promise<IFinding> => {
  try {
    return await db.auditFinding.create({ data });
  } catch (error) {
    throw error;
  }
};

const findFindingById = async (id: string, scope: string | null, db: Db = prisma): Promise<IFinding | null> => {
  try {
    return await db.auditFinding.findFirst({ where: { id, ...visibleStores(scope) } });
  } catch (error) {
    throw error;
  }
};

export type FindingChange = IFindingUpdate | (IFindingClose & { status: "closed"; closedAt: Date });

// Applies only while the finding still has the status the caller read.
const changeFindingIfStatus = async (
  id: string,
  expected: FindingStatus,
  change: FindingChange,
  db: Db
): Promise<IFinding | null> => {
  try {
    const { count } = await db.auditFinding.updateMany({ where: { id, status: expected }, data: change });
    return count === 0 ? null : await findFindingById(id, null, db);
  } catch (error) {
    throw error;
  }
};

const searchFindings = async (
  auditId: string,
  page: { offset: number; limit: number },
  db: Db = prisma
): Promise<{ items: IFinding[]; total: number }> => {
  try {
    const where: Prisma.AuditFindingWhereInput = { auditId };
    const [items, total] = await Promise.all([
      db.auditFinding.findMany({
        where,
        orderBy: [{ severity: "desc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.auditFinding.count({ where }),
    ]);
    return { items, total };
  } catch (error) {
    throw error;
  }
};

const searchOpenFindings = async (
  filter: IOpenFindingFilter,
  page: { offset: number; limit: number },
  db: Db = prisma
): Promise<{ items: IFinding[]; total: number }> => {
  try {
    const where: Prisma.AuditFindingWhereInput = {
      AND: [
        visibleStores(filter.scope),
        { status: { in: OPEN_FINDING } },
        ...(filter.severity ? [{ severity: filter.severity }] : []),
        ...(filter.ownerId ? [{ ownerId: filter.ownerId }] : []),
        ...(filter.overdueBefore ? [{ dueDate: { lt: filter.overdueBefore } }] : []),
      ],
    };
    const [items, total] = await Promise.all([
      db.auditFinding.findMany({
        where,
        orderBy: [{ severity: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.auditFinding.count({ where }),
    ]);
    return { items, total };
  } catch (error) {
    throw error;
  }
};

export const AuditQuery = {
  create,
  findById,
  lockById,
  changeIfStatus,
  search,
  openFindingCounts,
  countFindings,
  openCriticalFindingIds,
  createFinding,
  findFindingById,
  changeFindingIfStatus,
  searchFindings,
  searchOpenFindings,
};
