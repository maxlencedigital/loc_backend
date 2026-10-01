import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IApplicationCreate,
  IApplicationDocument,
  IApplicationFilter,
  IApplicationPatch,
  IRating,
  IRider,
  IRiderApplication,
  IRiderCreate,
  IRiderFilter,
  IRiderPatch,
  IShift,
  ApplicationStatus,
  DocumentType,
} from "../Models/Rider/Rider.Interface.js";
import type { Db, PageWindow } from "./Job.Query.js";

// The shift in progress is looked up with the rider: nearly every rider call needs it.
const riderInclude = {
  shifts: { where: { openRiderId: { not: null } }, select: { id: true }, take: 1 },
} satisfies Prisma.RiderInclude;

const toRider = (row: { shifts: Array<{ id: string }> } & Record<string, unknown>): IRider => {
  const { shifts, ...rest } = row;
  return { ...rest, openShiftId: shifts[0]?.id ?? null } as unknown as IRider;
};

// ----------------------------------------------------------------- applications

const createApplication = async (data: IApplicationCreate & { openPhone: string }, db: Db = prisma): Promise<IRiderApplication> => {
  try {
    return (await db.riderApplication.create({ data })) as unknown as IRiderApplication;
  } catch (error) {
    throw error;
  }
};

const findApplicationById = async (id: string, db: Db = prisma): Promise<IRiderApplication | null> => {
  try {
    return (await db.riderApplication.findUnique({ where: { id } })) as unknown as IRiderApplication | null;
  } catch (error) {
    throw error;
  }
};

const lockApplication = async (id: string, db: Db): Promise<IRiderApplication | null> => {
  try {
    await db.riderApplication.updateMany({ where: { id }, data: { updatedAt: new Date() } });
    return await findApplicationById(id, db);
  } catch (error) {
    throw error;
  }
};

const listApplications = async (
  filter: IApplicationFilter,
  page: PageWindow
): Promise<{ items: IRiderApplication[]; total: number }> => {
  try {
    const where: Prisma.RiderApplicationWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.city ? { city: { equals: filter.city, mode: "insensitive" } } : {}),
      ...(filter.from || filter.to
        ? { submittedAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.riderApplication.findMany({ where, orderBy: [{ submittedAt: "desc" }, { id: "asc" }], skip: page.offset, take: page.limit }),
      prisma.riderApplication.count({ where }),
    ]);
    return { items: rows as unknown as IRiderApplication[], total };
  } catch (error) {
    throw error;
  }
};

/** Applies a patch only while the application is still in one of the expected statuses. */
const updateApplication = async (
  id: string,
  expect: ApplicationStatus[],
  patch: IApplicationPatch,
  db: Db = prisma
): Promise<boolean> => {
  try {
    const { count } = await db.riderApplication.updateMany({ where: { id, status: { in: expect } }, data: patch });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const upsertDocument = async (applicationId: string, type: DocumentType, fileUrl: string, db: Db = prisma): Promise<void> => {
  try {
    await db.applicationDocument.upsert({
      where: { applicationId_type: { applicationId, type } },
      create: { applicationId, type, fileUrl },
      update: { fileUrl },
    });
  } catch (error) {
    throw error;
  }
};

// At most one per document type, so at most five rows.
const listDocuments = async (applicationId: string, db: Db = prisma): Promise<IApplicationDocument[]> => {
  try {
    return (await db.applicationDocument.findMany({ where: { applicationId }, orderBy: { type: "asc" }, take: 10 })) as IApplicationDocument[];
  } catch (error) {
    throw error;
  }
};

// ----------------------------------------------------------------------- riders

const createRider = async (data: IRiderCreate, db: Db = prisma): Promise<IRider> => {
  try {
    const row = await db.rider.create({ data, include: riderInclude });
    return toRider(row);
  } catch (error) {
    throw error;
  }
};

const findRiderById = async (id: string, db: Db = prisma): Promise<IRider | null> => {
  try {
    const row = await db.rider.findUnique({ where: { id }, include: riderInclude });
    return row ? toRider(row) : null;
  } catch (error) {
    throw error;
  }
};

const findRiderByUserId = async (userId: string, db: Db = prisma): Promise<IRider | null> => {
  try {
    const row = await db.rider.findUnique({ where: { userId }, include: riderInclude });
    return row ? toRider(row) : null;
  } catch (error) {
    throw error;
  }
};

const findRiderByApplicationId = async (applicationId: string, db: Db = prisma): Promise<IRider | null> => {
  try {
    const row = await db.rider.findUnique({ where: { applicationId }, include: riderInclude });
    return row ? toRider(row) : null;
  } catch (error) {
    throw error;
  }
};

const findRidersByIds = async (ids: string[], db: Db = prisma): Promise<IRider[]> => {
  try {
    if (ids.length === 0) return [];
    const rows = await db.rider.findMany({ where: { id: { in: ids } }, include: riderInclude, take: 500 });
    return rows.map(toRider);
  } catch (error) {
    throw error;
  }
};

// The no-op UPDATE is the row lock: it serialises everything that must decide on a
// rider's state (capacity, availability) without raw SQL.
const lockRider = async (id: string, db: Db): Promise<IRider | null> => {
  try {
    await db.rider.updateMany({ where: { id }, data: { updatedAt: new Date() } });
    return await findRiderById(id, db);
  } catch (error) {
    throw error;
  }
};

const updateRider = async (id: string, patch: IRiderPatch, db: Db = prisma): Promise<void> => {
  try {
    await db.rider.update({ where: { id }, data: patch });
  } catch (error) {
    throw error;
  }
};

const listRiders = async (filter: IRiderFilter, page: PageWindow): Promise<{ items: IRider[]; total: number }> => {
  try {
    const where: Prisma.RiderWhereInput = {
      ...(filter.homeStoreId ? { homeStoreId: filter.homeStoreId } : {}),
      ...(filter.available !== null && filter.available !== undefined ? { available: filter.available } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.rider.findMany({ where, include: riderInclude, orderBy: [{ name: "asc" }, { id: "asc" }], skip: page.offset, take: page.limit }),
      prisma.rider.count({ where }),
    ]);
    return { items: rows.map(toRider), total };
  } catch (error) {
    throw error;
  }
};

/**
 * Riders who could take a job: the same rule as `eligibilityBlockers`, expressed as a
 * filter so the candidate set is bounded in SQL. The service re-checks every row.
 */
const listCandidates = async (options: { today: Date; onShiftOnly: boolean; limit: number }): Promise<IRider[]> => {
  try {
    const rows = await prisma.rider.findMany({
      where: {
        status: "active",
        available: true,
        userId: { not: null },
        identityVerified: true,
        vehicleVerified: true,
        insuranceValid: true,
        insuranceExpiry: { gte: options.today },
        ...(options.onShiftOnly ? { shifts: { some: { openRiderId: { not: null } } } } : {}),
      },
      include: riderInclude,
      orderBy: { id: "asc" },
      take: options.limit,
    });
    return rows.map(toRider);
  } catch (error) {
    throw error;
  }
};

const addRiderEvent = async (
  event: { riderId: string; kind: string; note: string | null; byUserId: string | null },
  db: Db = prisma
): Promise<void> => {
  try {
    await db.riderEvent.create({ data: event });
  } catch (error) {
    throw error;
  }
};

// --------------------------------------------------------------------- shifts

const openShiftOf = async (riderId: string, db: Db = prisma): Promise<IShift | null> => {
  try {
    return (await db.shift.findUnique({ where: { openRiderId: riderId } })) as IShift | null;
  } catch (error) {
    throw error;
  }
};

/** Fails with a unique violation when the rider already has an open shift. */
const startShift = async (
  data: { riderId: string; vehicleChecked: boolean; startLatitude: number | null; startLongitude: number | null },
  db: Db = prisma
): Promise<IShift> => {
  try {
    return (await db.shift.create({ data: { ...data, openRiderId: data.riderId } })) as IShift;
  } catch (error) {
    throw error;
  }
};

/** Closes the shift only if it is still open; false means it was already closed. */
const closeShift = async (
  id: string,
  data: { endedAt: Date; odometerKm: number | null; jobsCompleted: number; distanceMeters: number; earningsPaise: number },
  db: Db
): Promise<boolean> => {
  try {
    const { count } = await db.shift.updateMany({ where: { id, endedAt: null }, data: { ...data, openRiderId: null } });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

// Shifts are sequential for one rider, so a day holds a handful; the cap is a safety net.
const shiftsInRange = async (riderId: string, range: { from: Date; to: Date }): Promise<IShift[]> => {
  try {
    return (await prisma.shift.findMany({
      where: { riderId, startedAt: { gte: range.from, lt: range.to } },
      orderBy: { startedAt: "asc" },
      take: 50,
    })) as IShift[];
  } catch (error) {
    throw error;
  }
};

// -------------------------------------------------------------------- ratings

const addRating = async (data: { jobId: string; riderId: string; rating: number; comment: string | null }): Promise<boolean> => {
  try {
    const { count } = await prisma.riderRating.createMany({ data: [data], skipDuplicates: true });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const ratingSummary = async (riderId: string, range: { from: Date; to: Date }): Promise<{ average: number | null; count: number }> => {
  try {
    const result = await prisma.riderRating.aggregate({
      where: { riderId, createdAt: { gte: range.from, lt: range.to } },
      _avg: { rating: true },
      _count: { _all: true },
    });
    return { average: result._avg.rating, count: result._count._all };
  } catch (error) {
    throw error;
  }
};

const recentRatings = async (riderId: string, range: { from: Date; to: Date }, limit: number): Promise<IRating[]> => {
  try {
    const rows = await prisma.riderRating.findMany({
      where: { riderId, createdAt: { gte: range.from, lt: range.to } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((row) => ({ rating: row.rating, comment: row.comment, at: row.createdAt }));
  } catch (error) {
    throw error;
  }
};

const ratingAverages = async (riderIds: string[], range: { from: Date; to: Date }): Promise<Map<string, number>> => {
  try {
    if (riderIds.length === 0) return new Map();
    const rows = await prisma.riderRating.groupBy({
      by: ["riderId"],
      where: { riderId: { in: riderIds }, createdAt: { gte: range.from, lt: range.to } },
      _avg: { rating: true },
    });
    return new Map(rows.filter((row) => row._avg.rating !== null).map((row) => [row.riderId, row._avg.rating as number]));
  } catch (error) {
    throw error;
  }
};

export const RiderQuery = {
  createApplication,
  findApplicationById,
  lockApplication,
  listApplications,
  updateApplication,
  upsertDocument,
  listDocuments,
  createRider,
  findRiderById,
  findRiderByUserId,
  findRiderByApplicationId,
  findRidersByIds,
  lockRider,
  updateRider,
  listRiders,
  listCandidates,
  addRiderEvent,
  openShiftOf,
  startShift,
  closeShift,
  shiftsInRange,
  addRating,
  ratingSummary,
  recentRatings,
  ratingAverages,
};
