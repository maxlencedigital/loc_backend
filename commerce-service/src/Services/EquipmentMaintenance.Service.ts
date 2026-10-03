import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { StoreScope } from "../Middleware/StoreScope.js";
import { ISchedulePlan, ITask, ITaskDraft } from "../Models/Equipment/Equipment.Interface.js";
import { EquipmentQuery } from "../Queries/Equipment.Query.js";
import { EquipmentMaintenanceQuery } from "../Queries/EquipmentMaintenance.Query.js";
import { addDays, businessToday, dateOut, daysBetween, notInFuture, parseDate } from "../Utils/AssetDates.js";
import { actorId, actorName, amountToPaise } from "../Utils/AssetInput.js";
import { optionalText, parseBody, queryString, text, wholeNumber } from "../Utils/Input.js";
import { toRupees } from "../Utils/Money.js";
import { isUuid } from "../Utils/Uuid.js";
import { NOT_FOUND, resolveStoreFilter } from "./OpsEquipment.Service.js";

const MAX_TASKS = 50;
const MAX_EVERY_DAYS = 3650;
const DEFAULT_WITHIN_DAYS = 7;
const MAX_WITHIN_DAYS = 365;
const TASK_NOT_FOUND = "Maintenance task not found.";

const toTaskView = (t: ITask) => ({
  id: t.id,
  name: t.name,
  everyDays: t.everyDays,
  lastDoneOn: dateOut(t.lastDoneOn),
  nextDueOn: dateOut(t.nextDueOn),
});

const key = (name: string) => name.toLowerCase();

// Matches the submitted tasks to the stored ones by name so ids and history survive an edit.
// The anchor of a task is its last service date; with none yet, the day it was first
// scheduled, so saving the same schedule again never pushes a due date further away.
export const planSchedule = (existing: ITask[], tasks: { name: string; everyDays: number; lastDoneOn: Date | null }[], today: Date): ISchedulePlan => {
  const byName = new Map(existing.map((t) => [key(t.name), t]));
  const plan: ISchedulePlan = { create: [], update: [], removeIds: [] };
  const kept = new Set<string>();
  for (const task of tasks) {
    const found = byName.get(key(task.name));
    const anchor = task.lastDoneOn ?? found?.lastDoneOn ?? (found ? addDays(found.nextDueOn, -found.everyDays) : today);
    const draft: ITaskDraft = {
      name: task.name,
      everyDays: task.everyDays,
      lastDoneOn: task.lastDoneOn ?? found?.lastDoneOn ?? null,
      nextDueOn: addDays(anchor, task.everyDays),
    };
    if (!found) {
      plan.create.push(draft);
      continue;
    }
    kept.add(found.id);
    const same =
      found.everyDays === draft.everyDays &&
      found.lastDoneOn?.getTime() === draft.lastDoneOn?.getTime() &&
      found.nextDueOn.getTime() === draft.nextDueOn.getTime();
    if (!same) plan.update.push({ ...draft, id: found.id });
  }
  plan.removeIds = existing.filter((t) => !kept.has(t.id)).map((t) => t.id);
  return plan;
};

const getSchedule = async (id: string, scope: StoreScope) => {
  try {
    const machine = isUuid(id) ? await EquipmentQuery.findById(id, scope) : null;
    if (!machine) throw new CustomException(NOT_FOUND, notFound);
    return { tasks: (await EquipmentMaintenanceQuery.listTasks(id)).map(toTaskView) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const setSchedule = async (id: string, scope: StoreScope, input: unknown) => {
  try {
    const body = parseBody(input);
    if (!Array.isArray(body.tasks) || body.tasks.length > MAX_TASKS) {
      throw new CustomException(`tasks must be a list of at most ${MAX_TASKS} tasks.`, badRequest);
    }
    const seen = new Set<string>();
    const tasks = body.tasks.map((entry: unknown) => {
      const row = parseBody(entry);
      const name = text(row.name, "task name", 120);
      if (seen.has(key(name))) throw new CustomException(`The task "${name}" is listed twice.`, badRequest);
      seen.add(key(name));
      return {
        name,
        everyDays: wholeNumber(row.everyDays, "everyDays", 1, MAX_EVERY_DAYS),
        lastDoneOn: row.lastDoneOn === undefined || row.lastDoneOn === null ? null : notInFuture(parseDate(row.lastDoneOn, "lastDoneOn"), "lastDoneOn"),
      };
    });
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);

    const saved = await EquipmentQuery.inTransaction(async (tx) => {
      const machine = await EquipmentQuery.lockById(id, scope, tx);
      if (!machine) throw new CustomException(NOT_FOUND, notFound);
      if (machine.status === "retired") throw new CustomException("A retired machine has no maintenance schedule.", conflict);
      const existing = await EquipmentMaintenanceQuery.listTasks(id, tx);
      await EquipmentMaintenanceQuery.applyPlan(id, planSchedule(existing, tasks, businessToday()), tx);
      return await EquipmentMaintenanceQuery.listTasks(id, tx);
    });
    return { tasks: saved.map(toTaskView) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const parseWithin = (value: unknown): number => {
  const raw = queryString(value, "withinDays");
  if (raw === undefined) return DEFAULT_WITHIN_DAYS;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 0 || days > MAX_WITHIN_DAYS) {
    throw new CustomException(`withinDays must be a whole number from 0 to ${MAX_WITHIN_DAYS}.`, badRequest);
  }
  return days;
};

// Due: from today through today + withinDays. Both lists are paged ranges on the due-date index.
const listDue = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const storeId = resolveStoreFilter(scope, query.storeId);
    const today = businessToday();
    const result = await EquipmentMaintenanceQuery.listDue({ storeId, from: today, to: addDays(today, parseWithin(query.withinDays)) }, page);
    const tasks = result.items.map((t) => ({
      taskId: t.id,
      equipmentId: t.equipmentId,
      equipmentName: t.equipmentName,
      name: t.name,
      dueOn: dateOut(t.nextDueOn),
    }));
    return { tasks, page: page.page, limit: page.limit, total: result.total };
  } catch (error) {
    throw toCustomException(error);
  }
};

const listOverdue = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const storeId = resolveStoreFilter(scope, query.storeId);
    const today = businessToday();
    const result = await EquipmentMaintenanceQuery.listDue({ storeId, to: addDays(today, -1) }, page);
    const tasks = result.items.map((t) => ({
      taskId: t.id,
      equipmentId: t.equipmentId,
      equipmentName: t.equipmentName,
      name: t.name,
      dueOn: dateOut(t.nextDueOn),
      daysOverdue: daysBetween(t.nextDueOn, today),
    }));
    return { tasks, page: page.page, limit: page.limit, total: result.total };
  } catch (error) {
    throw toCustomException(error);
  }
};

// The row lock turns a double-submitted "done" into one record: the second request sees
// the first one's date and is refused. A unique index on (task, date) backs it up.
const completeTask = async (taskId: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const doneOn = notInFuture(parseDate(body.doneOn, "doneOn"), "doneOn");
    const notes = optionalText(body.notes, "notes", 1000) ?? null;
    const costPaise = body.cost === undefined || body.cost === null ? null : amountToPaise(body.cost, "cost");
    if (!isUuid(taskId)) throw new CustomException(TASK_NOT_FOUND, notFound);

    const done = await EquipmentQuery.inTransaction(async (tx) => {
      const locked = await EquipmentMaintenanceQuery.lockTask(taskId, scope, tx);
      if (!locked) throw new CustomException(TASK_NOT_FOUND, notFound);
      const { task } = locked;
      if (task.lastDoneOn && doneOn <= task.lastDoneOn) {
        throw new CustomException(`This service was already recorded on ${dateOut(task.lastDoneOn)}.`, conflict);
      }
      return await EquipmentMaintenanceQuery.recordCompletion(
        task,
        doneOn,
        addDays(doneOn, task.everyDays),
        { taskName: task.name, doneOn, costPaise, notes, doneByUserId: actorId(user), doneByName: actorName(user) },
        tx
      );
    });
    return {
      ...toTaskView(done.task),
      equipmentId: done.task.equipmentId,
      service: {
        id: done.log.id,
        doneOn: dateOut(done.log.doneOn),
        cost: done.log.costPaise === null ? null : toRupees(done.log.costPaise),
        notes: done.log.notes,
        doneBy: done.log.doneByName,
      },
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const EquipmentMaintenanceService = { getSchedule, setSchedule, listDue, listOverdue, completeTask };
