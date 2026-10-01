import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import {
  GOAL_STATUSES,
  IAgreedAction,
  ICareerGoal,
  ICareerPath,
  ICareerPlan,
} from "../Models/Hr/Career.Interface.js";
import { IHistoryEntry } from "../Models/Hr/Employee.Interface.js";
import { CareerQuery } from "../Queries/Career.Query.js";
import { EmployeeQuery } from "../Queries/Employee.Query.js";
import { inHrTransaction } from "../Queries/Hr.Transaction.js";
import { clock, formatDate, parseDate } from "../Utils/HrDate.js";
import { isCleared, normaliseKey, textList } from "../Utils/HrInput.js";
import { optionalOneOf, optionalText, parseBody, text } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { EMPLOYEE_NOT_FOUND } from "./EmployeeAccess.js";
import { actorName } from "./HrActor.js";

const MAX_ITEMS = 20;
const HISTORY_IN_PLAN = 50;
const ROLE_KEY_MAX = 40;

const optionalDateString = (value: unknown, field: string): string | null =>
  value === undefined || isCleared(value) ? null : formatDate(parseDate(value, field));

const parseGoals = (value: unknown): ICareerGoal[] => {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new CustomException(`goals must be a list of at most ${MAX_ITEMS}.`, badRequest);
  return value.map((raw) => {
    const goal = parseBody(raw);
    return {
      title: text(goal.title, "goals.title", 120),
      targetDate: optionalDateString(goal.targetDate, "goals.targetDate"),
      status: optionalOneOf(goal.status, GOAL_STATUSES, "goals.status") ?? "planned",
    };
  });
};

const parseActions = (value: unknown): IAgreedAction[] => {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    throw new CustomException(`agreedActions must be a list of at most ${MAX_ITEMS}.`, badRequest);
  }
  return value.map((raw) => {
    const action = parseBody(raw);
    return {
      action: text(action.action, "agreedActions.action", 200),
      owner: optionalText(action.owner, "agreedActions.owner", 60) ?? null,
      dueDate: optionalDateString(action.dueDate, "agreedActions.dueDate"),
    };
  });
};

const toHistoryView = (entry: IHistoryEntry) => ({
  field: entry.field,
  from: entry.fromValue,
  to: entry.toValue,
  effectiveDate: formatDate(entry.effectiveDate),
  reason: entry.reason,
  changedBy: entry.changedByName,
  at: entry.createdAt.toISOString(),
});

const toPlanView = (employeeId: string, plan: ICareerPlan | null) => ({
  employeeId,
  targetRole: plan?.targetRole ?? null,
  goals: plan?.goals ?? [],
  skillGaps: plan?.skillGaps ?? [],
  agreedActions: plan?.agreedActions ?? [],
  lastReviewedAt: plan?.lastReviewedAt ? plan.lastReviewedAt.toISOString() : null,
});

const requireEmployee = async (id: string, scope: StoreScope) => {
  const employee = isUuid(id) ? await EmployeeQuery.findById(id, scope) : null;
  if (!employee) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
  return employee;
};

// The plan, plus the append-only history of designation, store and pay-grade changes
// that the employee record writes as it changes (latest first, capped).
const getPlan = async (id: string, scope: StoreScope) => {
  try {
    const employee = await requireEmployee(id, scope);
    const [plan, history] = await Promise.all([
      CareerQuery.findPlan(employee.id),
      EmployeeQuery.listHistory(employee.id, 0, HISTORY_IN_PLAN),
    ]);
    return { ...toPlanView(employee.id, plan), history: history.items.map(toHistoryView) };
  } catch (error) {
    throw toCustomException(error);
  }
};

// Fields left out keep their current value; a field given replaces it whole.
const setPlan = async (id: string, scope: StoreScope, input: unknown) => {
  try {
    const body = parseBody(input);
    const employee = await requireEmployee(id, scope);
    const current = await CareerQuery.findPlan(employee.id);
    const targetRole = body.targetRole === undefined ? (current?.targetRole ?? null) : isCleared(body.targetRole) ? null : text(body.targetRole, "targetRole", 60);
    const saved = await inHrTransaction((tx) =>
      CareerQuery.savePlan(
        employee.id,
        {
          targetRole,
          goals: body.goals === undefined ? (current?.goals ?? []) : parseGoals(body.goals),
          skillGaps: body.skillGaps === undefined ? (current?.skillGaps ?? []) : textList(body.skillGaps, "skillGaps", MAX_ITEMS, 60),
          agreedActions: body.agreedActions === undefined ? (current?.agreedActions ?? []) : parseActions(body.agreedActions),
        },
        tx
      )
    );
    return toPlanView(employee.id, saved);
  } catch (error) {
    throw toCustomException(error);
  }
};

const reviewPlan = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const note = text(body.note, "note", 500);
    const employee = await requireEmployee(id, scope);
    const plan = await inHrTransaction((tx) =>
      CareerQuery.recordReview(employee.id, { note, byUserId: user.id, byName: actorName(user), at: clock.now() }, tx)
    );
    if (!plan) throw new CustomException("This employee has no career plan yet.", notFound);
    return toPlanView(employee.id, plan);
  } catch (error) {
    throw toCustomException(error);
  }
};

const toPathView = (path: ICareerPath) => ({ role: path.role, nextRoles: path.nextRoles, requirements: path.requirements });

const listPaths = async (query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await CareerQuery.listPaths(page.offset, page.limit);
    const result = toPage(items.map(toPathView), total, page);
    return { paths: result.items, page: result.page, limit: result.limit, total: result.total };
  } catch (error) {
    throw toCustomException(error);
  }
};

const setPath = async (role: string, input: unknown) => {
  try {
    const key = normaliseKey(typeof role === "string" ? role : "");
    if (key === "" || key.length > ROLE_KEY_MAX) {
      throw new CustomException(`role must be 1 to ${ROLE_KEY_MAX} letters or digits.`, badRequest);
    }
    const body = parseBody(input);
    const nextRoles = textList(body.nextRoles, "nextRoles", MAX_ITEMS, 60);
    return toPathView(
      await CareerQuery.savePath({
        role: key,
        nextRoles,
        requirements: body.requirements === undefined ? [] : textList(body.requirements, "requirements", MAX_ITEMS, 120),
      })
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

export const CareerService = { getPlan, setPlan, reviewPlan, listPaths, setPath };
