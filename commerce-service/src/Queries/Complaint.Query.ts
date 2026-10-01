import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IComplaint,
  IComplaintCreate,
  IComplaintDetail,
  IComplaintFilter,
  IComplaintOwner,
  IComplaintPatch,
  IComplaintPhoto,
  INewComplaintEvent,
} from "../Models/Complaint/Complaint.Interface.js";

export type Db = Prisma.TransactionClient;

const detailInclude = {
  events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.ComplaintInclude;

type ComplaintRow = Prisma.ComplaintGetPayload<object>;
type DetailRow = Prisma.ComplaintGetPayload<{ include: typeof detailInclude }>;

const toComplaint = ({ photos, ...row }: ComplaintRow): IComplaint => ({
  ...row,
  photos: photos as unknown as IComplaintPhoto[],
});

const toDetail = ({ events, ...row }: DetailRow): IComplaintDetail => ({
  ...toComplaint(row),
  events: events.map(({ complaintId: _complaintId, ...event }) => event),
});

// Every read and write of a single complaint goes through this one filter, so a customer
// reaching for another customer's id, or a store for another store's, simply finds nothing.
const ownerWhere = (owner: IComplaintOwner): Prisma.ComplaintWhereInput => ({
  ...(owner.storeId ? { storeId: owner.storeId } : {}),
  ...(owner.customerUserId ? { customerUserId: owner.customerUserId } : {}),
  ...(owner.escalatedOnly ? { escalatedAt: { not: null } } : {}),
});

const eventData = (event: INewComplaintEvent) => ({
  kind: event.kind,
  actorRole: event.actorRole,
  actorUserId: event.actorUserId,
  actorName: event.actorName,
  message: event.message,
  internal: event.internal,
  fromStatus: event.fromStatus,
  toStatus: event.toStatus,
});

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

const create = async (data: IComplaintCreate, db: Db = prisma): Promise<IComplaintDetail> => {
  try {
    const { firstEvent, ...complaint } = data;
    const row = await db.complaint.create({
      data: { ...complaint, events: { create: [eventData(firstEvent)] } },
      include: detailInclude,
    });
    return toDetail(row);
  } catch (error) {
    throw error;
  }
};

const findDetail = async (id: string, owner: IComplaintOwner, db: Db = prisma): Promise<IComplaintDetail | null> => {
  try {
    const row = await db.complaint.findFirst({ where: { id, ...ownerWhere(owner) }, include: detailInclude });
    return row ? toDetail(row) : null;
  } catch (error) {
    throw error;
  }
};

// Takes a row lock until the transaction ends, so two replies or two resolutions of one
// complaint run one after the other and the second sees the first's status. A no-op UPDATE
// is the lock: raw SQL would not get the per-service schema the driver adapter applies.
const lock = async (id: string, owner: IComplaintOwner, db: Db): Promise<IComplaint | null> => {
  try {
    const { count } = await db.complaint.updateMany({
      where: { id, ...ownerWhere(owner) },
      data: { updatedAt: new Date() },
    });
    if (count === 0) return null;
    const row = await db.complaint.findUnique({ where: { id } });
    return row ? toComplaint(row) : null;
  } catch (error) {
    throw error;
  }
};

const apply = async (
  id: string,
  patch: IComplaintPatch,
  events: INewComplaintEvent[],
  db: Db
): Promise<void> => {
  try {
    const { photos, ...rest } = patch;
    await db.complaint.update({
      where: { id },
      data: {
        ...rest,
        ...(photos ? { photos: photos as unknown as Prisma.InputJsonValue } : {}),
        events: { create: events.map(eventData) },
      },
    });
  } catch (error) {
    throw error;
  }
};

const countEvents = async (id: string, db: Db): Promise<number> => {
  try {
    return await db.complaintEvent.count({ where: { complaintId: id } });
  } catch (error) {
    throw error;
  }
};

const findByCreatorKey = async (
  createdByUserId: string,
  idempotencyKey: string,
  db: Db = prisma
): Promise<IComplaintDetail | null> => {
  try {
    const row = await db.complaint.findFirst({
      where: { createdByUserId, idempotencyKey },
      include: detailInclude,
    });
    return row ? toDetail(row) : null;
  } catch (error) {
    throw error;
  }
};

const findByActiveKey = async (activeKey: string, db: Db = prisma): Promise<IComplaintDetail | null> => {
  try {
    const row = await db.complaint.findUnique({ where: { activeKey }, include: detailInclude });
    return row ? toDetail(row) : null;
  } catch (error) {
    throw error;
  }
};

const filterWhere = (filter: IComplaintFilter): Prisma.ComplaintWhereInput => ({
  ...ownerWhere({ storeId: filter.storeId, customerUserId: filter.customerUserId, escalatedOnly: filter.escalatedOnly }),
  ...(filter.statuses ? { status: { in: filter.statuses } } : {}),
  ...(filter.type ? { type: filter.type } : {}),
  ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
  ...(filter.from || filter.to ? { createdAt: { gte: filter.from, lte: filter.to } } : {}),
});

// One page of rows and the total, with no events loaded: a list never reads the threads.
const search = async (
  filter: IComplaintFilter,
  sortBy: "createdAt" | "escalatedAt",
  db: Db = prisma
): Promise<{ items: IComplaint[]; total: number }> => {
  try {
    const where = filterWhere(filter);
    const [rows, total] = await Promise.all([
      db.complaint.findMany({
        where,
        orderBy: [{ [sortBy]: "desc" }, { id: "asc" }],
        skip: filter.page.offset,
        take: filter.page.limit,
      }),
      db.complaint.count({ where }),
    ]);
    return { items: rows.map(toComplaint), total };
  } catch (error) {
    throw error;
  }
};

// Resolved complaints older than the cutoff become closed, with one event each. The status
// guard and the shared closedAt stamp make the batch safe against a customer reopening one
// between the select and the update.
const closeResolved = async (cutoff: Date, limit: number, now: Date, db: Db): Promise<number> => {
  try {
    const candidates = await db.complaint.findMany({
      where: { status: "resolved", resolvedAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { resolvedAt: "asc" },
      take: limit,
    });
    if (candidates.length === 0) return 0;
    const { count } = await db.complaint.updateMany({
      where: { id: { in: candidates.map((c) => c.id) }, status: "resolved" },
      data: { status: "closed", closedAt: now },
    });
    if (count === 0) return 0;
    const closed = await db.complaint.findMany({
      where: { id: { in: candidates.map((c) => c.id) }, status: "closed", closedAt: now },
      select: { id: true },
    });
    await db.complaintEvent.createMany({
      data: closed.map((c) => ({
        complaintId: c.id,
        ...eventData({
          kind: "closed",
          actorRole: "system",
          actorUserId: null,
          actorName: "System",
          message: "Closed automatically after the resolution went unchallenged.",
          internal: false,
          fromStatus: "resolved",
          toStatus: "closed",
        }),
      })),
    });
    return closed.length;
  } catch (error) {
    throw error;
  }
};

export const ComplaintQuery = {
  inTransaction,
  create,
  findDetail,
  lock,
  apply,
  countEvents,
  findByCreatorKey,
  findByActiveKey,
  search,
  closeResolved,
};
