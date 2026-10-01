import type { HrTrainingAssignment, HrTrainingCourse, Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IAssignment,
  IAssignmentCreate,
  IAssignmentFilter,
  ICompletion,
  ICourse,
  ICourseWrite,
  IDueRow,
  IRequirementRow,
} from "../Models/Hr/Training.Interface.js";
import type { Db } from "./Hr.Transaction.js";

const OPEN = ["assigned", "in_progress"] as const;

const toCourse = (row: HrTrainingCourse): ICourse => ({
  id: row.id,
  title: row.title,
  category: row.category,
  description: row.description,
  durationMinutes: row.durationMinutes,
  materialUrl: row.materialUrl,
  validForDays: row.validForDays,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

type AssignmentRow = HrTrainingAssignment & { course: { title: string; materialUrl: string | null } };
const withCourse = { course: { select: { title: true, materialUrl: true } } } satisfies Prisma.HrTrainingAssignmentInclude;

const toAssignment = (row: AssignmentRow): IAssignment => ({
  id: row.id,
  employeeId: row.employeeId,
  courseId: row.courseId,
  courseTitle: row.course.title,
  courseMaterialUrl: row.course.materialUrl,
  status: row.status,
  dueDate: row.dueDate,
  validForDays: row.validForDays,
  startedAt: row.startedAt,
  completedAt: row.completedAt,
  scoreHundredths: row.scoreHundredths,
  expiresAt: row.expiresAt,
  nextDueOn: row.nextDueOn,
  assignedByName: row.assignedByName,
  createdAt: row.createdAt,
});

const createCourse = async (data: ICourseWrite, db: Db = prisma): Promise<ICourse> => {
  try {
    return toCourse(await db.hrTrainingCourse.create({ data }));
  } catch (error) {
    throw error;
  }
};

const findCourse = async (id: string, db: Db = prisma): Promise<ICourse | null> => {
  try {
    const row = await db.hrTrainingCourse.findFirst({ where: { id, deletedAt: null } });
    return row ? toCourse(row) : null;
  } catch (error) {
    throw error;
  }
};

const listCourses = async (offset: number, limit: number, db: Db = prisma): Promise<{ items: ICourse[]; total: number }> => {
  try {
    const where = { deletedAt: null };
    const [rows, total] = await Promise.all([
      db.hrTrainingCourse.findMany({ where, orderBy: [{ title: "asc" }, { id: "asc" }], skip: offset, take: limit }),
      db.hrTrainingCourse.count({ where }),
    ]);
    return { items: rows.map(toCourse), total };
  } catch (error) {
    throw error;
  }
};

// A no-op UPDATE on a live course takes its row lock until the transaction ends, so an
// assignment and the course's retirement queue behind each other. Null when retired.
const lockCourse = async (id: string, db: Db): Promise<ICourse | null> => {
  try {
    const { count } = await db.hrTrainingCourse.updateMany({ where: { id, deletedAt: null }, data: { updatedAt: new Date() } });
    return count === 0 ? null : await findCourse(id, db);
  } catch (error) {
    throw error;
  }
};

const updateCourse = async (id: string, data: Partial<ICourseWrite>, db: Db = prisma): Promise<ICourse | null> => {
  try {
    const { count } = await db.hrTrainingCourse.updateMany({ where: { id, deletedAt: null }, data });
    return count === 0 ? null : await findCourse(id, db);
  } catch (error) {
    throw error;
  }
};

const retireCourse = async (id: string, at: Date, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.hrTrainingCourse.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: at } });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

const liveCourseIds = async (ids: string[], db: Db = prisma): Promise<string[]> => {
  try {
    if (ids.length === 0) return [];
    const rows = await db.hrTrainingCourse.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } });
    return rows.map((row) => row.id);
  } catch (error) {
    throw error;
  }
};

const countOpenForCourse = async (courseId: string, db: Db): Promise<number> => {
  try {
    return await db.hrTrainingAssignment.count({ where: { courseId, status: { in: [...OPEN] } } });
  } catch (error) {
    throw error;
  }
};

const removeRequirementsForCourse = async (courseId: string, db: Db): Promise<void> => {
  try {
    await db.hrTrainingRequirement.deleteMany({ where: { courseId } });
  } catch (error) {
    throw error;
  }
};

const MAX_REQUIREMENT_ROWS = 2000;

const listRequirements = async (db: Db = prisma): Promise<IRequirementRow[]> => {
  try {
    const rows = await db.hrTrainingRequirement.findMany({
      orderBy: [{ roleKey: "asc" }, { courseId: "asc" }],
      take: MAX_REQUIREMENT_ROWS,
      select: { roleKey: true, courseId: true },
    });
    return rows;
  } catch (error) {
    throw error;
  }
};

const replaceRequirements = async (roleKey: string, courseIds: string[], db: Db): Promise<void> => {
  try {
    await db.hrTrainingRequirement.deleteMany({ where: { roleKey } });
    if (courseIds.length > 0) await db.hrTrainingRequirement.createMany({ data: courseIds.map((courseId) => ({ roleKey, courseId })) });
  } catch (error) {
    throw error;
  }
};

// One INSERT ... ON CONFLICT DO NOTHING: the unique index on (employee, course, open)
// turns a second open assignment into a skipped row, even for concurrent requests.
const createAssignments = async (rows: IAssignmentCreate[], db: Db): Promise<number> => {
  try {
    if (rows.length === 0) return 0;
    const { count } = await db.hrTrainingAssignment.createMany({ data: rows, skipDuplicates: true });
    return count;
  } catch (error) {
    throw error;
  }
};

const findOpenFor = async (courseId: string, employeeIds: string[], db: Db = prisma): Promise<IAssignment[]> => {
  try {
    if (employeeIds.length === 0) return [];
    const rows = await db.hrTrainingAssignment.findMany({
      where: { courseId, employeeId: { in: employeeIds }, status: { in: [...OPEN] } },
      include: withCourse,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toAssignment);
  } catch (error) {
    throw error;
  }
};

const findAssignment = async (id: string, db: Db = prisma): Promise<IAssignment | null> => {
  try {
    const row = await db.hrTrainingAssignment.findUnique({ where: { id }, include: withCourse });
    return row ? toAssignment(row) : null;
  } catch (error) {
    throw error;
  }
};

const assignmentWhere = (filter: IAssignmentFilter): Prisma.HrTrainingAssignmentWhereInput => ({
  ...(filter.employeeId ? { employeeId: filter.employeeId } : filter.employeeIds ? { employeeId: { in: filter.employeeIds } } : {}),
  ...(filter.courseId ? { courseId: filter.courseId } : {}),
  ...(filter.status ? { status: filter.status } : {}),
  ...(filter.overdueBefore ? { nextDueOn: { lt: filter.overdueBefore } } : {}),
});

const listAssignments = async (filter: IAssignmentFilter, db: Db = prisma): Promise<{ items: IAssignment[]; total: number }> => {
  try {
    const where = assignmentWhere(filter);
    const [rows, total] = await Promise.all([
      db.hrTrainingAssignment.findMany({
        where,
        include: withCourse,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: filter.offset,
        take: filter.limit,
      }),
      db.hrTrainingAssignment.count({ where }),
    ]);
    return { items: rows.map(toAssignment), total };
  } catch (error) {
    throw error;
  }
};

const startAssignment = async (id: string, at: Date, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.hrTrainingAssignment.updateMany({
      where: { id, status: "assigned" },
      data: { status: "in_progress", startedAt: at },
    });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

// Conditional on "still open": of two simultaneous completions exactly one wins.
const completeAssignment = async (id: string, completion: ICompletion, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.hrTrainingAssignment.updateMany({
      where: { id, status: { in: [...OPEN] } },
      data: {
        status: "completed",
        isOpen: null,
        completedAt: completion.completedAt,
        scoreHundredths: completion.scoreHundredths,
        expiresAt: completion.expiresAt,
        nextDueOn: completion.expiresAt,
      },
    });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

// A newer completion replaces the earlier ones, which stop being "due" for a refresher.
const supersedePrevious = async (employeeId: string, courseId: string, exceptId: string, at: Date, db: Db): Promise<void> => {
  try {
    await db.hrTrainingAssignment.updateMany({
      where: { employeeId, courseId, status: "completed", supersededAt: null, id: { not: exceptId } },
      data: { supersededAt: at, nextDueOn: null },
    });
  } catch (error) {
    throw error;
  }
};

const dueRows = (rows: (HrTrainingAssignment & { course: { title: string } })[]): IDueRow[] =>
  rows.map((row) => ({ employeeId: row.employeeId, courseTitle: row.course.title, dueOn: row.nextDueOn as Date }));

const scopedEmployees = (ids: string[] | null): Prisma.HrTrainingAssignmentWhereInput => (ids ? { employeeId: { in: ids } } : {});

const listOverdue = async (
  employeeIds: string[] | null,
  today: Date,
  offset: number,
  limit: number,
  db: Db = prisma
): Promise<{ items: IDueRow[]; total: number }> => {
  try {
    const where = { ...scopedEmployees(employeeIds), nextDueOn: { lt: today } };
    const [rows, total] = await Promise.all([
      db.hrTrainingAssignment.findMany({
        where,
        include: { course: { select: { title: true } } },
        orderBy: [{ nextDueOn: "asc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      }),
      db.hrTrainingAssignment.count({ where }),
    ]);
    return { items: dueRows(rows), total };
  } catch (error) {
    throw error;
  }
};

const countOverdue = async (employeeIds: string[] | null, today: Date, db: Db = prisma): Promise<number> => {
  try {
    return await db.hrTrainingAssignment.count({ where: { ...scopedEmployees(employeeIds), nextDueOn: { lt: today } } });
  } catch (error) {
    throw error;
  }
};

// Completed courses whose expiry falls in [from, to]: the refresher is due before it lapses.
const listRefreshers = async (
  employeeIds: string[] | null,
  from: Date,
  to: Date,
  offset: number,
  limit: number,
  db: Db = prisma
): Promise<{ items: IDueRow[]; total: number }> => {
  try {
    const where = { ...scopedEmployees(employeeIds), status: "completed" as const, nextDueOn: { gte: from, lte: to } };
    const [rows, total] = await Promise.all([
      db.hrTrainingAssignment.findMany({
        where,
        include: { course: { select: { title: true } } },
        orderBy: [{ nextDueOn: "asc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      }),
      db.hrTrainingAssignment.count({ where }),
    ]);
    return { items: dueRows(rows), total };
  } catch (error) {
    throw error;
  }
};

/** Per employee: assignments due in [from, to] and how many of them are completed. */
const countDueAndDone = async (
  employeeIds: string[],
  from: Date,
  to: Date,
  db: Db = prisma
): Promise<{ employeeId: string; due: number; done: number }[]> => {
  try {
    if (employeeIds.length === 0) return [];
    const groups = await db.hrTrainingAssignment.groupBy({
      by: ["employeeId", "status"],
      where: { employeeId: { in: employeeIds }, dueDate: { gte: from, lte: to } },
      _count: { _all: true },
    });
    const byEmployee = new Map<string, { employeeId: string; due: number; done: number }>();
    for (const g of groups) {
      const entry = byEmployee.get(g.employeeId) ?? { employeeId: g.employeeId, due: 0, done: 0 };
      entry.due += g._count._all;
      if (g.status === "completed") entry.done += g._count._all;
      byEmployee.set(g.employeeId, entry);
    }
    return [...byEmployee.values()];
  } catch (error) {
    throw error;
  }
};

export const TrainingQuery = {
  createCourse,
  findCourse,
  listCourses,
  lockCourse,
  updateCourse,
  retireCourse,
  liveCourseIds,
  countOpenForCourse,
  removeRequirementsForCourse,
  listRequirements,
  replaceRequirements,
  createAssignments,
  findOpenFor,
  findAssignment,
  listAssignments,
  startAssignment,
  completeAssignment,
  supersedePrevious,
  listOverdue,
  countOverdue,
  listRefreshers,
  countDueAndDone,
};
