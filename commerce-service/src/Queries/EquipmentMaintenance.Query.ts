import type { Prisma } from "@prisma/client";
import { Page, PageRequest } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IDueRange,
  IDueTask,
  ILockedTask,
  IMaintenanceLog,
  IMaintenanceLogCreate,
  ISchedulePlan,
  ITask,
} from "../Models/Equipment/Equipment.Interface.js";

export type Db = Prisma.TransactionClient;

const toTask = ({ createdAt: _createdAt, updatedAt: _updatedAt, ...row }: Prisma.EquipmentMaintenanceTaskGetPayload<object>): ITask =>
  row;

const listTasks = async (equipmentId: string, db: Db = prisma): Promise<ITask[]> => {
  try {
    const rows = await db.equipmentMaintenanceTask.findMany({
      where: { equipmentId },
      orderBy: [{ nextDueOn: "asc" }, { name: "asc" }],
    });
    return rows.map(toTask);
  } catch (error) {
    throw error;
  }
};

// One delete, one insert, and an update only for rows that changed; a schedule holds at most 50 tasks.
const applyPlan = async (equipmentId: string, plan: ISchedulePlan, db: Db): Promise<void> => {
  try {
    if (plan.removeIds.length > 0) {
      await db.equipmentMaintenanceTask.deleteMany({ where: { equipmentId, id: { in: plan.removeIds } } });
    }
    for (const { id, ...data } of plan.update) {
      await db.equipmentMaintenanceTask.update({ where: { id }, data });
    }
    if (plan.create.length > 0) {
      await db.equipmentMaintenanceTask.createMany({ data: plan.create.map((task) => ({ ...task, equipmentId })) });
    }
  } catch (error) {
    throw error;
  }
};

const deleteForEquipment = async (equipmentId: string, db: Db): Promise<void> => {
  try {
    await db.equipmentMaintenanceTask.deleteMany({ where: { equipmentId } });
  } catch (error) {
    throw error;
  }
};

const dueWhere = (range: IDueRange): Prisma.EquipmentMaintenanceTaskWhereInput => ({
  nextDueOn: { ...(range.from ? { gte: range.from } : {}), lte: range.to },
  equipment: { status: { not: "retired" }, ...(range.storeId ? { storeId: range.storeId } : {}) },
});

// Oldest due date first; the (nextDueOn) index serves the range and the order.
const listDue = async (range: IDueRange, page: PageRequest, db: Db = prisma): Promise<Page<IDueTask>> => {
  try {
    const where = dueWhere(range);
    const [rows, total] = await Promise.all([
      db.equipmentMaintenanceTask.findMany({
        where,
        include: { equipment: { select: { name: true } } },
        orderBy: [{ nextDueOn: "asc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.equipmentMaintenanceTask.count({ where }),
    ]);
    const items = rows.map(({ equipment, ...row }) => ({ ...toTask(row), equipmentName: equipment.name }));
    return { items, total, page: page.page, limit: page.limit };
  } catch (error) {
    throw error;
  }
};

const countDue = async (range: IDueRange, db: Db = prisma): Promise<number> => {
  try {
    return await db.equipmentMaintenanceTask.count({ where: dueWhere(range) });
  } catch (error) {
    throw error;
  }
};

const findTask = async (taskId: string, scope: string | null, db: Db): Promise<ILockedTask | null> => {
  try {
    const row = await db.equipmentMaintenanceTask.findFirst({
      where: { id: taskId, equipment: scope ? { storeId: scope } : {} },
      include: { equipment: { select: { name: true } } },
    });
    if (!row) return null;
    const { equipment, ...task } = row;
    return { task: toTask(task), equipmentName: equipment.name };
  } catch (error) {
    throw error;
  }
};

// No-op UPDATE as the row lock: two people ticking the same service off queue up, and the
// second sees the first one's date.
const lockTask = async (taskId: string, scope: string | null, db: Db): Promise<ILockedTask | null> => {
  try {
    const { count } = await db.equipmentMaintenanceTask.updateMany({
      where: { id: taskId, equipment: scope ? { storeId: scope } : {} },
      data: { updatedAt: new Date() },
    });
    return count === 0 ? null : await findTask(taskId, scope, db);
  } catch (error) {
    throw error;
  }
};

const recordCompletion = async (
  task: ITask,
  doneOn: Date,
  nextDueOn: Date,
  log: IMaintenanceLogCreate,
  db: Db
): Promise<{ task: ITask; log: IMaintenanceLog }> => {
  try {
    const updated = await db.equipmentMaintenanceTask.update({
      where: { id: task.id },
      data: { lastDoneOn: doneOn, nextDueOn },
    });
    const row = await db.equipmentMaintenanceLog.create({
      data: { ...log, equipmentId: task.equipmentId, taskId: task.id },
    });
    const { taskId: _taskId, doneByUserId: _doneByUserId, createdAt: _createdAt, ...entry } = row;
    return { task: toTask(updated), log: entry };
  } catch (error) {
    throw error;
  }
};

export const EquipmentMaintenanceQuery = {
  listTasks,
  applyPlan,
  deleteForEquipment,
  listDue,
  countDue,
  lockTask,
  recordCompletion,
};
