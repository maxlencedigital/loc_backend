import type { HrGrievance, HrGrievanceNote, HrRequest, Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IGrievance,
  IGrievanceCreate,
  IGrievanceFilter,
  IGrievanceNote,
  IGrievanceVisibility,
  IHrRequest,
  INoteCreate,
  IRequestFilter,
  RequestCategory,
} from "../Models/Hr/Grievance.Interface.js";
import type { Db } from "./Hr.Transaction.js";

const MAX_NOTES = 200;
const LIVE = ["open", "assigned", "in_progress", "escalated"] as const;

const toGrievance = (row: HrGrievance): IGrievance => ({
  id: row.id,
  employeeId: row.employeeId,
  againstEmployeeId: row.againstEmployeeId,
  category: row.category,
  description: row.description,
  anonymous: row.anonymous,
  confidential: row.confidential,
  status: row.status,
  assigneeId: row.assigneeId,
  assignedAt: row.assignedAt,
  raisedAt: row.raisedAt,
  firstResponseDueAt: row.firstResponseDueAt,
  resolutionDueAt: row.resolutionDueAt,
  firstResponseAt: row.firstResponseAt,
  escalatedAt: row.escalatedAt,
  escalationReason: row.escalationReason,
  closedAt: row.closedAt,
  outcome: row.outcome,
  closedByName: row.closedByName,
});

const toNote = (row: HrGrievanceNote): IGrievanceNote => ({
  id: row.id,
  grievanceId: row.grievanceId,
  kind: row.kind,
  message: row.message,
  internal: row.internal,
  authorName: row.authorName,
  createdAt: row.createdAt,
});

const toRequest = (row: HrRequest): IHrRequest => ({
  id: row.id,
  employeeId: row.employeeId,
  category: row.category,
  message: row.message,
  status: row.status,
  response: row.response,
  respondedAt: row.respondedAt,
  respondedByName: row.respondedByName,
  closedAt: row.closedAt,
  closeNote: row.closeNote,
  createdAt: row.createdAt,
});

// What the viewer may see, as a WHERE clause: their people, confidentiality, and never a
// case filed against them (a NULL "against" counts as not against anyone).
const visibleWhere = (v: IGrievanceVisibility): Prisma.HrGrievanceWhereInput => ({
  ...(v.employeeIds ? { employeeId: { in: v.employeeIds } } : {}),
  ...(v.nonConfidentialOnly ? { confidential: false } : {}),
  ...(v.notAgainst ? { OR: [{ againstEmployeeId: null }, { againstEmployeeId: { not: v.notAgainst } }] } : {}),
});

const create = async (data: IGrievanceCreate, db: Db = prisma): Promise<IGrievance> => {
  try {
    return toGrievance(await db.hrGrievance.create({ data }));
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, db: Db = prisma): Promise<IGrievance | null> => {
  try {
    const row = await db.hrGrievance.findUnique({ where: { id } });
    return row ? toGrievance(row) : null;
  } catch (error) {
    throw error;
  }
};

const list = async (f: IGrievanceFilter, db: Db = prisma): Promise<{ items: IGrievance[]; total: number }> => {
  try {
    const where: Prisma.HrGrievanceWhereInput = {
      ...visibleWhere(f.visibility),
      ...(f.status ? { status: f.status } : {}),
      ...(f.category ? { category: f.category } : {}),
      ...(f.assigneeId ? { assigneeId: f.assigneeId } : {}),
      ...(f.from || f.to ? { raisedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      db.hrGrievance.findMany({ where, orderBy: [{ raisedAt: "desc" }, { id: "asc" }], skip: f.offset, take: f.limit }),
      db.hrGrievance.count({ where }),
    ]);
    return { items: rows.map(toGrievance), total };
  } catch (error) {
    throw error;
  }
};

const countOpen = async (visibility: IGrievanceVisibility, db: Db = prisma): Promise<number> => {
  try {
    return await db.hrGrievance.count({ where: { ...visibleWhere(visibility), status: { not: "closed" } } });
  } catch (error) {
    throw error;
  }
};

// Every transition is "update where the status is what we expect": of two racing changes
// exactly one finds its condition true.
const assign = async (id: string, assigneeId: string, at: Date, db: Db): Promise<boolean> => {
  try {
    const first = await db.hrGrievance.updateMany({ where: { id, status: "open" }, data: { status: "assigned", assigneeId, assignedAt: at } });
    if (first.count > 0) return true;
    const again = await db.hrGrievance.updateMany({
      where: { id, status: { in: ["assigned", "in_progress", "escalated"] } },
      data: { assigneeId, assignedAt: at },
    });
    return again.count > 0;
  } catch (error) {
    throw error;
  }
};

const noteFirstResponse = async (id: string, at: Date, db: Db): Promise<void> => {
  try {
    await db.hrGrievance.updateMany({ where: { id, firstResponseAt: null }, data: { firstResponseAt: at } });
  } catch (error) {
    throw error;
  }
};

const startProgress = async (id: string, db: Db): Promise<void> => {
  try {
    await db.hrGrievance.updateMany({ where: { id, status: "assigned" }, data: { status: "in_progress" } });
  } catch (error) {
    throw error;
  }
};

const escalate = async (id: string, reason: string, at: Date, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.hrGrievance.updateMany({
      where: { id, status: { in: ["open", "assigned", "in_progress"] } },
      data: { status: "escalated", escalatedAt: at, escalationReason: reason },
    });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

const close = async (id: string, outcome: string, at: Date, by: string, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.hrGrievance.updateMany({
      where: { id, status: { in: [...LIVE] } },
      data: { status: "closed", closedAt: at, outcome, closedByName: by },
    });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

const addNote = async (note: INoteCreate, db: Db): Promise<void> => {
  try {
    await db.hrGrievanceNote.create({ data: note });
  } catch (error) {
    throw error;
  }
};

/** Oldest first, at most 200; employees get only the notes not marked internal. */
const listNotes = async (grievanceId: string, includeInternal: boolean, db: Db = prisma): Promise<IGrievanceNote[]> => {
  try {
    const rows = await db.hrGrievanceNote.findMany({
      where: { grievanceId, ...(includeInternal ? {} : { internal: false }) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: MAX_NOTES,
    });
    return rows.map(toNote);
  } catch (error) {
    throw error;
  }
};

// ------------------------------------------------------------- HR requests

const createRequest = async (data: { employeeId: string; category: RequestCategory; message: string }, db: Db = prisma): Promise<IHrRequest> => {
  try {
    return toRequest(await db.hrRequest.create({ data }));
  } catch (error) {
    throw error;
  }
};

const findRequest = async (id: string, db: Db = prisma): Promise<IHrRequest | null> => {
  try {
    const row = await db.hrRequest.findUnique({ where: { id } });
    return row ? toRequest(row) : null;
  } catch (error) {
    throw error;
  }
};

const listRequests = async (f: IRequestFilter, db: Db = prisma): Promise<{ items: IHrRequest[]; total: number }> => {
  try {
    const where: Prisma.HrRequestWhereInput = {
      ...(f.employeeId ? { employeeId: f.employeeId } : f.employeeIds ? { employeeId: { in: f.employeeIds } } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.category ? { category: f.category } : {}),
    };
    const [rows, total] = await Promise.all([
      db.hrRequest.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: f.offset, take: f.limit }),
      db.hrRequest.count({ where }),
    ]);
    return { items: rows.map(toRequest), total };
  } catch (error) {
    throw error;
  }
};

const respondToRequest = async (id: string, response: string, at: Date, by: string, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.hrRequest.updateMany({
      where: { id, status: "open" },
      data: { status: "answered", response, respondedAt: at, respondedByName: by },
    });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

const closeRequest = async (id: string, note: string | null, at: Date, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.hrRequest.updateMany({
      where: { id, status: { in: ["open", "answered"] } },
      data: { status: "closed", closedAt: at, closeNote: note },
    });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

export const GrievanceQuery = {
  create,
  findById,
  list,
  countOpen,
  assign,
  noteFirstResponse,
  startProgress,
  escalate,
  close,
  addNote,
  listNotes,
  createRequest,
  findRequest,
  listRequests,
  respondToRequest,
  closeRequest,
};
