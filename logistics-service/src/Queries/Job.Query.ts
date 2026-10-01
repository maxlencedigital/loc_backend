import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IJob,
  IJobAssignmentCreate,
  IJobCreate,
  IJobEvent,
  IJobEventCreate,
  IJobExpect,
  IJobFilter,
  IJobInspection,
  IJobPatch,
  IJobPhoto,
  IJobProof,
  IJobProofPatch,
  IRiderStat,
  IRouteSummary,
  ItemCondition,
  JobStatus,
  JobType,
} from "../Models/Job/Job.Interface.js";

// A query accepts the transaction it runs in, so a status change, its timeline event,
// its assignment row and its outbox row commit or roll back together.
export type Db = Prisma.TransactionClient;

export interface PageWindow {
  offset: number;
  limit: number;
}

// Jobs a rider is holding right now: assigned but not yet finished.
export const ACTIVE_JOB_STATUSES: JobStatus[] = ["assigned", "en_route", "arrived", "out_for_delivery", "picked_up"];
export const COMPLETED_JOB_STATUSES: JobStatus[] = ["at_store", "delivered"];

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

const asJob = (row: unknown): IJob => row as IJob;

const filterWhere = (filter: IJobFilter): Prisma.JobWhereInput => ({
  ...(filter.storeId ? { storeId: filter.storeId } : {}),
  ...(filter.riderId ? { riderId: filter.riderId } : {}),
  ...(filter.status ? { status: filter.status } : {}),
  ...(filter.type ? { type: filter.type } : {}),
  ...(filter.from || filter.to
    ? { slotFrom: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } }
    : {}),
});

const create = async (data: IJobCreate, db: Db = prisma): Promise<IJob> => {
  try {
    return asJob(await db.job.create({ data: { ...data, items: data.items as unknown as Prisma.InputJsonValue } }));
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, db: Db = prisma): Promise<IJob | null> => {
  try {
    const row = await db.job.findUnique({ where: { id } });
    return row ? asJob(row) : null;
  } catch (error) {
    throw error;
  }
};

const findByOrderAndType = async (orderId: string, type: JobType, db: Db = prisma): Promise<IJob | null> => {
  try {
    const row = await db.job.findUnique({ where: { orderId_type: { orderId, type } } });
    return row ? asJob(row) : null;
  } catch (error) {
    throw error;
  }
};

// One order has at most one job per type, so this is at most two rows.
const listByOrder = async (orderId: string): Promise<IJob[]> => {
  try {
    const rows = await prisma.job.findMany({ where: { orderId }, orderBy: { createdAt: "asc" }, take: 10 });
    return rows.map(asJob);
  } catch (error) {
    throw error;
  }
};

// A no-op UPDATE is the row lock (raw SQL would not get the per-service schema).
const lockById = async (id: string, db: Db): Promise<IJob | null> => {
  try {
    await db.job.updateMany({ where: { id }, data: { updatedAt: new Date() } });
    return await findById(id, db);
  } catch (error) {
    throw error;
  }
};

const list = async (filter: IJobFilter, page: PageWindow): Promise<{ items: IJob[]; total: number }> => {
  try {
    const where = filterWhere(filter);
    const [rows, total] = await Promise.all([
      prisma.job.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: page.offset, take: page.limit }),
      prisma.job.count({ where }),
    ]);
    return { items: rows.map(asJob), total };
  } catch (error) {
    throw error;
  }
};

const listForRider = async (
  riderId: string,
  filter: { from: Date; to: Date; status?: JobStatus | null; type?: JobType | null },
  page: PageWindow
): Promise<{ items: IJob[]; total: number }> => {
  try {
    const where: Prisma.JobWhereInput = {
      riderId,
      slotFrom: { gte: filter.from, lt: filter.to },
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.type ? { type: filter.type } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: [{ sequence: { sort: "asc", nulls: "last" } }, { slotFrom: "asc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      prisma.job.count({ where }),
    ]);
    return { items: rows.map(asJob), total };
  } catch (error) {
    throw error;
  }
};

// The rider's unfinished jobs for a day, in route order. Capped: a route has at most 25 stops.
const listActiveForRider = async (
  riderId: string,
  range: { from: Date; to: Date },
  limit: number,
  storeId: string | null = null
): Promise<IJob[]> => {
  try {
    const rows = await prisma.job.findMany({
      where: {
        riderId,
        status: { in: ACTIVE_JOB_STATUSES },
        slotFrom: { gte: range.from, lt: range.to },
        ...(storeId ? { storeId } : {}),
      },
      orderBy: [{ sequence: { sort: "asc", nulls: "last" } }, { slotFrom: "asc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(asJob);
  } catch (error) {
    throw error;
  }
};

const listUnassigned = async (
  filter: { storeId?: string | null; from?: Date | null; to?: Date | null },
  limit: number
): Promise<IJob[]> => {
  try {
    const rows = await prisma.job.findMany({
      where: { status: "pending", ...filterWhere({ storeId: filter.storeId, from: filter.from, to: filter.to }) },
      orderBy: [{ priority: "desc" }, { slotFrom: "asc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(asJob);
  } catch (error) {
    throw error;
  }
};

const countUnassigned = async (filter: { storeId?: string | null; from?: Date | null; to?: Date | null }): Promise<number> => {
  try {
    return await prisma.job.count({
      where: { status: "pending", ...filterWhere({ storeId: filter.storeId, from: filter.from, to: filter.to }) },
    });
  } catch (error) {
    throw error;
  }
};

/** Active job count per rider, as one grouped query. Riders with none are absent. */
const activeCounts = async (riderIds: string[], db: Db = prisma): Promise<Map<string, number>> => {
  try {
    if (riderIds.length === 0) return new Map();
    const rows = await db.job.groupBy({
      by: ["riderId"],
      where: { riderId: { in: riderIds }, status: { in: ACTIVE_JOB_STATUSES } },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.riderId as string, row._count._all]));
  } catch (error) {
    throw error;
  }
};

const countByStatusForRider = async (riderId: string, status: JobStatus): Promise<number> => {
  try {
    return await prisma.job.count({ where: { riderId, status } });
  } catch (error) {
    throw error;
  }
};

/**
 * Applies a patch only if the row is still in the state the caller read. False means
 * somebody else moved it first; nothing was written.
 */
const transition = async (id: string, expect: IJobExpect, patch: IJobPatch, db: Db = prisma): Promise<boolean> => {
  try {
    const { count } = await db.job.updateMany({
      where: {
        id,
        status: { in: expect.status },
        ...(expect.riderId === undefined ? {} : { riderId: expect.riderId }),
      },
      data: patch,
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

/** Claims a batch of pending jobs for one rider in one statement; returns the ids actually won. */
const claimPending = async (jobIds: string[], riderId: string, at: Date, db: Db): Promise<string[]> => {
  try {
    if (jobIds.length === 0) return [];
    await db.job.updateMany({
      where: { id: { in: jobIds }, status: "pending", riderId: null },
      data: { status: "assigned", riderId, assignedAt: at, sequence: null },
    });
    const won = await db.job.findMany({
      where: { id: { in: jobIds }, riderId, status: "assigned", assignedAt: at },
      select: { id: true },
    });
    return won.map((row) => row.id);
  } catch (error) {
    throw error;
  }
};

/** Takes the next code-attempt number atomically and returns it. */
const bumpCodeAttempts = async (id: string): Promise<number> => {
  try {
    const row = await prisma.job.update({ where: { id }, data: { codeAttempts: { increment: 1 } }, select: { codeAttempts: true } });
    return row.codeAttempts;
  } catch (error) {
    throw error;
  }
};

// Compare-and-set on the collected total: two door payments racing cannot both pass the "still owed" check.
const addCollected = async (id: string, expected: number, amountPaise: number, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.job.updateMany({
      where: { id, collectedPaise: expected },
      data: { collectedPaise: expected + amountPaise },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const addEvent = async (event: IJobEventCreate, db: Db = prisma): Promise<void> => {
  try {
    await db.jobEvent.create({ data: event });
  } catch (error) {
    throw error;
  }
};

const addEvents = async (events: IJobEventCreate[], db: Db = prisma): Promise<void> => {
  try {
    if (events.length > 0) await db.jobEvent.createMany({ data: events });
  } catch (error) {
    throw error;
  }
};

const listEvents = async (jobId: string, limit: number): Promise<IJobEvent[]> => {
  try {
    return (await prisma.jobEvent.findMany({ where: { jobId }, orderBy: [{ at: "asc" }, { id: "asc" }], take: limit })) as IJobEvent[];
  } catch (error) {
    throw error;
  }
};

const releaseAssignment = async (jobId: string, reason: string, db: Db): Promise<void> => {
  try {
    await db.jobAssignment.updateMany({
      where: { activeJobId: jobId },
      data: { activeJobId: null, releasedAt: new Date(), releaseReason: reason },
    });
  } catch (error) {
    throw error;
  }
};

const createAssignments = async (rows: IJobAssignmentCreate[], db: Db): Promise<void> => {
  try {
    if (rows.length === 0) return;
    await db.jobAssignment.createMany({ data: rows.map((row) => ({ ...row, activeJobId: row.jobId })) });
  } catch (error) {
    throw error;
  }
};

const findProof = async (jobId: string, db: Db = prisma): Promise<IJobProof | null> => {
  try {
    return (await db.jobProof.findUnique({ where: { jobId } })) as IJobProof | null;
  } catch (error) {
    throw error;
  }
};

const upsertProof = async (jobId: string, patch: IJobProofPatch, db: Db): Promise<void> => {
  try {
    await db.jobProof.upsert({ where: { jobId }, create: { jobId, ...patch }, update: patch });
  } catch (error) {
    throw error;
  }
};

/** True when the tag was new; a second scan of the same tag changes nothing. */
const addScan = async (jobId: string, tagId: string, condition: ItemCondition): Promise<boolean> => {
  try {
    const { count } = await prisma.jobScan.createMany({ data: [{ jobId, tagId, condition }], skipDuplicates: true });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const countScans = async (jobId: string, db: Db = prisma): Promise<number> => {
  try {
    return await db.jobScan.count({ where: { jobId } });
  } catch (error) {
    throw error;
  }
};

const replaceInspections = async (jobId: string, items: IJobInspection[], db: Db): Promise<void> => {
  try {
    await db.jobInspection.deleteMany({ where: { jobId, itemId: { in: items.map((item) => item.itemId) } } });
    await db.jobInspection.createMany({ data: items.map((item) => ({ jobId, ...item })) });
  } catch (error) {
    throw error;
  }
};

const listInspections = async (jobId: string, db: Db = prisma): Promise<IJobInspection[]> => {
  try {
    const rows = await db.jobInspection.findMany({ where: { jobId }, orderBy: { createdAt: "asc" }, take: 200 });
    return rows.map((row) => ({ itemId: row.itemId, condition: row.condition as ItemCondition, note: row.note }));
  } catch (error) {
    throw error;
  }
};

const addPhoto = async (
  data: { jobId: string; kind: "pickup" | "delivery"; itemId: string | null; url: string; caption: string | null; uploadedByUserId: string | null }
): Promise<IJobPhoto> => {
  try {
    return (await prisma.jobPhoto.create({ data })) as IJobPhoto;
  } catch (error) {
    throw error;
  }
};

const countPhotos = async (jobId: string, kind: "pickup" | "delivery"): Promise<number> => {
  try {
    return await prisma.jobPhoto.count({ where: { jobId, kind } });
  } catch (error) {
    throw error;
  }
};

const listPhotos = async (jobId: string, limit: number): Promise<IJobPhoto[]> => {
  try {
    return (await prisma.jobPhoto.findMany({ where: { jobId }, orderBy: { createdAt: "asc" }, take: limit })) as IJobPhoto[];
  } catch (error) {
    throw error;
  }
};

/** Completed-job figures per rider over a period, aggregated in SQL. */
const riderStats = async (
  range: { from: Date; to: Date },
  filter: { riderId?: string | null; storeId?: string | null },
  limit: number
): Promise<IRiderStat[]> => {
  try {
    const rows = await prisma.job.groupBy({
      by: ["riderId", "onTime"],
      where: {
        status: { in: COMPLETED_JOB_STATUSES },
        completedAt: { gte: range.from, lt: range.to },
        riderId: filter.riderId ? filter.riderId : { not: null },
        ...(filter.storeId ? { storeId: filter.storeId } : {}),
      },
      _count: { _all: true },
      _sum: { distanceMeters: true },
      _avg: { durationMinutes: true },
    });
    const byRider = new Map<string, IRiderStat & { durationWeight: number }>();
    for (const row of rows) {
      const id = row.riderId as string;
      const stat = byRider.get(id) ?? {
        riderId: id,
        jobsCompleted: 0,
        distanceMeters: 0,
        avgDurationMinutes: null,
        onTimeJobs: 0,
        measuredJobs: 0,
        durationWeight: 0,
      };
      stat.jobsCompleted += row._count._all;
      stat.distanceMeters += row._sum.distanceMeters ?? 0;
      if (row._avg.durationMinutes !== null) {
        stat.avgDurationMinutes = (stat.avgDurationMinutes ?? 0) + row._avg.durationMinutes * row._count._all;
        stat.durationWeight += row._count._all;
      }
      if (row.onTime !== null) stat.measuredJobs += row._count._all;
      if (row.onTime === true) stat.onTimeJobs += row._count._all;
      byRider.set(id, stat);
    }
    return [...byRider.values()]
      .map(({ durationWeight, ...stat }) => ({
        ...stat,
        avgDurationMinutes: durationWeight > 0 ? (stat.avgDurationMinutes as number) / durationWeight : null,
      }))
      .sort((a, b) => b.jobsCompleted - a.jobsCompleted)
      .slice(0, limit);
  } catch (error) {
    throw error;
  }
};

const shiftStats = async (shiftId: string, db: Db = prisma): Promise<{ jobsCompleted: number; distanceMeters: number }> => {
  try {
    const result = await db.job.aggregate({
      where: { shiftId, status: { in: COMPLETED_JOB_STATUSES } },
      _count: { _all: true },
      _sum: { distanceMeters: true },
    });
    return { jobsCompleted: result._count._all, distanceMeters: result._sum.distanceMeters ?? 0 };
  } catch (error) {
    throw error;
  }
};

/** One rider's finished work in a period (for the earnings summary). */
const completedTotals = async (
  riderId: string,
  range: { from: Date; to: Date }
): Promise<{ jobsCompleted: number; distanceMeters: number }> => {
  try {
    const result = await prisma.job.aggregate({
      where: { riderId, status: { in: COMPLETED_JOB_STATUSES }, completedAt: { gte: range.from, lt: range.to } },
      _count: { _all: true },
      _sum: { distanceMeters: true },
    });
    return { jobsCompleted: result._count._all, distanceMeters: result._sum.distanceMeters ?? 0 };
  } catch (error) {
    throw error;
  }
};

/** Stops and kilometres per rider for one day, limited to the jobs still in play. */
const routeSummaries = async (
  range: { from: Date; to: Date },
  filter: { riderId?: string | null; storeId?: string | null },
  limit: number
): Promise<IRouteSummary[]> => {
  try {
    const rows = await prisma.job.groupBy({
      by: ["riderId"],
      where: {
        slotFrom: { gte: range.from, lt: range.to },
        status: { notIn: ["pending", "failed", "cancelled"] },
        riderId: filter.riderId ? filter.riderId : { not: null },
        ...(filter.storeId ? { storeId: filter.storeId } : {}),
      },
      _count: { _all: true },
      _sum: { distanceMeters: true },
      orderBy: { riderId: "asc" },
      take: limit,
    });
    return rows.map((row) => ({ riderId: row.riderId as string, stops: row._count._all, distanceMeters: row._sum.distanceMeters ?? 0 }));
  } catch (error) {
    throw error;
  }
};

/** Writes each job's place in the route in one transaction. Bounded by the 25-stop route limit. */
const setSequences = async (
  updates: Array<{ id: string; sequence: number; distanceMeters: number | null }>,
  db: Db
): Promise<void> => {
  try {
    for (const update of updates) {
      await db.job.updateMany({ where: { id: update.id }, data: { sequence: update.sequence, distanceMeters: update.distanceMeters } });
    }
  } catch (error) {
    throw error;
  }
};

export const JobQuery = {
  inTransaction,
  create,
  findById,
  findByOrderAndType,
  listByOrder,
  lockById,
  list,
  listForRider,
  listActiveForRider,
  listUnassigned,
  countUnassigned,
  activeCounts,
  countByStatusForRider,
  transition,
  claimPending,
  bumpCodeAttempts,
  addCollected,
  addEvent,
  addEvents,
  listEvents,
  releaseAssignment,
  createAssignments,
  findProof,
  upsertProof,
  addScan,
  countScans,
  replaceInspections,
  listInspections,
  addPhoto,
  countPhotos,
  listPhotos,
  riderStats,
  shiftStats,
  completedTotals,
  routeSummaries,
  setSequences,
};
