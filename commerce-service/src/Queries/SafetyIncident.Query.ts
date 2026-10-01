import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IIncident,
  IIncidentAccess,
  IIncidentChange,
  IIncidentCreate,
  IIncidentFilter,
  IIncidentPhoto,
  IIncidentSummaryRow,
  IRepeatPattern,
} from "../Models/Ops/Incident.Interface.js";
import { Db } from "./OpsCompliance.Db.js";

const toIncident = ({ idempotencyKey: _key, ...row }: Prisma.SafetyIncidentGetPayload<object>): IIncident => ({
  ...row,
  peopleInvolved: row.peopleInvolved as unknown as string[],
  photos: row.photos as unknown as IIncidentPhoto[],
});

const accessWhere = (access: IIncidentAccess): Prisma.SafetyIncidentWhereInput => ({
  ...(access.storeId ? { storeId: access.storeId } : {}),
  ...(access.reportedBy ? { reportedBy: access.reportedBy } : {}),
});

const create = async (data: IIncidentCreate, db: Db = prisma): Promise<IIncident> => {
  try {
    const peopleInvolved = data.peopleInvolved as unknown as Prisma.InputJsonValue;
    return toIncident(await db.safetyIncident.create({ data: { ...data, peopleInvolved } }));
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, access: IIncidentAccess, db: Db = prisma): Promise<IIncident | null> => {
  try {
    const row = await db.safetyIncident.findFirst({ where: { id, ...accessWhere(access) } });
    return row ? toIncident(row) : null;
  } catch (error) {
    throw error;
  }
};

const findByKey = async (reportedBy: string, key: string, db: Db = prisma): Promise<IIncident | null> => {
  try {
    const row = await db.safetyIncident.findFirst({ where: { reportedBy, idempotencyKey: key } });
    return row ? toIncident(row) : null;
  } catch (error) {
    throw error;
  }
};

// A no-op UPDATE takes the row lock until the transaction ends (photos are a JSON array
// that is read, extended and written back, so two uploads must queue).
const lockById = async (id: string, access: IIncidentAccess, db: Db): Promise<IIncident | null> => {
  try {
    const { count } = await db.safetyIncident.updateMany({
      where: { id, ...accessWhere(access) },
      data: { updatedAt: new Date() },
    });
    return count === 0 ? null : await findById(id, access, db);
  } catch (error) {
    throw error;
  }
};

const setPhotos = async (id: string, photos: IIncidentPhoto[], db: Db): Promise<IIncident> => {
  try {
    const row = await db.safetyIncident.update({
      where: { id },
      data: { photos: photos as unknown as Prisma.InputJsonValue },
    });
    return toIncident(row);
  } catch (error) {
    throw error;
  }
};

// One guarded UPDATE: it applies only while the incident still has the status (and, when
// given, the severity) the caller read, so two conflicting transitions cannot both win.
// Null means the guard failed and nothing was written.
const change = async (id: string, change: IIncidentChange, db: Db): Promise<IIncident | null> => {
  try {
    const { count } = await db.safetyIncident.updateMany({
      where: {
        id,
        status: change.expectedStatus,
        ...(change.expectedSeverity ? { severity: change.expectedSeverity } : {}),
        ...(change.addAction ? { actionCount: { lt: change.addAction.cap } } : {}),
      },
      data: { ...change.data, ...(change.addAction ? { actionCount: { increment: 1 } } : {}) },
    });
    return count === 0 ? null : await findById(id, { storeId: null }, db);
  } catch (error) {
    throw error;
  }
};

// The claim id is written once: a second writer finds it already set and gets false.
const recordClaim = async (id: string, claimId: string, claimedAt: Date, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.safetyIncident.updateMany({
      where: { id, claimId: null },
      data: { claimId, claimedAt },
    });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

const filterWhere = (filter: IIncidentFilter): Prisma.SafetyIncidentWhereInput => ({
  ...(filter.storeId ? { storeId: filter.storeId } : {}),
  ...(filter.status ? { status: filter.status } : {}),
  ...(filter.type ? { type: filter.type } : {}),
  ...(filter.severity ? { severity: filter.severity } : {}),
  ...(filter.from || filter.to ? { occurredAt: { gte: filter.from, lt: filter.to } } : {}),
});

const search = async (
  filter: IIncidentFilter,
  page: { offset: number; limit: number },
  db: Db = prisma
): Promise<{ items: IIncident[]; total: number }> => {
  try {
    const where = filterWhere(filter);
    const [rows, total] = await Promise.all([
      db.safetyIncident.findMany({
        where,
        orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.safetyIncident.count({ where }),
    ]);
    return { items: rows.map(toIncident), total };
  } catch (error) {
    throw error;
  }
};

const searchEscalated = async (
  storeId: string | null,
  page: { offset: number; limit: number },
  db: Db = prisma
): Promise<{ items: IIncident[]; total: number }> => {
  try {
    const where: Prisma.SafetyIncidentWhereInput = { status: "escalated", ...(storeId ? { storeId } : {}) };
    const [rows, total] = await Promise.all([
      db.safetyIncident.findMany({
        where,
        orderBy: [{ escalatedAt: "desc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.safetyIncident.count({ where }),
    ]);
    return { items: rows.map(toIncident), total };
  } catch (error) {
    throw error;
  }
};

const REPEAT_THRESHOLD = 2;
const REPEAT_LIMIT = 10;

// All of it is SQL aggregates: counts by type, by severity, and the (type, store) pairs
// that keep recurring. No incident rows are loaded.
const summarise = async (
  filter: IIncidentFilter,
  db: Db = prisma
): Promise<{ open: number; byType: IIncidentSummaryRow[]; bySeverity: IIncidentSummaryRow[]; repeats: IRepeatPattern[] }> => {
  try {
    const where = filterWhere(filter);
    const [open, byType, bySeverity, repeats] = await Promise.all([
      db.safetyIncident.count({ where: { ...where, status: { not: "closed" } } }),
      db.safetyIncident.groupBy({ by: ["type"], where, _count: { _all: true } }),
      db.safetyIncident.groupBy({ by: ["severity"], where, _count: { _all: true } }),
      db.safetyIncident.groupBy({
        by: ["type", "storeId"],
        where,
        _count: { _all: true },
        having: { type: { _count: { gte: REPEAT_THRESHOLD } } },
        orderBy: { _count: { type: "desc" } },
        take: REPEAT_LIMIT,
      }),
    ]);
    return {
      open,
      byType: byType.map((row) => ({ key: row.type, count: row._count._all })),
      bySeverity: bySeverity.map((row) => ({ key: row.severity, count: row._count._all })),
      repeats: repeats.map((row) => ({ type: row.type, storeId: row.storeId, count: row._count._all })),
    };
  } catch (error) {
    throw error;
  }
};

export const SafetyIncidentQuery = {
  create,
  findById,
  findByKey,
  lockById,
  setPhotos,
  change,
  recordClaim,
  search,
  searchEscalated,
  summarise,
};
