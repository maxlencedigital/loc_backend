import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import { IEmployeeRef } from "../Models/Hr/Employee.Interface.js";
import {
  IAssignment,
  ICourse,
  TRAINING_CATEGORIES,
  TRAINING_STATUSES,
  TrainingStatus,
} from "../Models/Hr/Training.Interface.js";
import { inHrTransaction } from "../Queries/Hr.Transaction.js";
import { TrainingQuery } from "../Queries/Training.Query.js";
import { MS_PER_DAY, addDays, businessToday, clock, formatDate, parseDate, parseOptionalDate } from "../Utils/HrDate.js";
import { isCleared, nullableText, normaliseKey, parseHttpsUrl, parseUuid, parseUuidList } from "../Utils/HrInput.js";
import { oneOf, optionalOneOf, parseBody, queryString, text, wholeNumber } from "../Utils/Input.js";
import { fromHundredths, parseScore, requireSomething } from "../Utils/PeopleInput.js";
import { isUuid } from "../Utils/Uuid.js";
import { narrowScope } from "./Employee.Service.js";
import { assertEmployeeInScope } from "./EmployeeAccess.js";
import { actorName } from "./HrActor.js";
import { directoryOf, employeeIdsInScope, requireEmployees } from "./PeopleScope.js";

const COURSE_NOT_FOUND = "Course not found.";
const ASSIGNMENT_NOT_FOUND = "Training assignment not found.";
const DEFAULT_DUE_DAYS = 30;
const MAX_DUE_AHEAD_DAYS = 366;
const MAX_ASSIGN_PEOPLE = 100;
const MAX_REQUIREMENT_COURSES = 50;
const MAX_REFRESHER_WINDOW_DAYS = 180;
const DEFAULT_REFRESHER_WINDOW_DAYS = 30;
const CLOCK_SKEW_MS = 5 * 60_000;

// ------------------------------------------------------------------ views

export const toCourseView = (course: ICourse) => ({
  id: course.id,
  title: course.title,
  category: course.category,
  description: course.description,
  durationMinutes: course.durationMinutes,
  materialUrl: course.materialUrl,
  validForDays: course.validForDays,
  createdAt: course.createdAt.toISOString(),
  updatedAt: course.updatedAt.toISOString(),
});

/** What a person's training needs now: overdue when open past its date or a completion that lapsed. */
export const derivedStatus = (assignment: Pick<IAssignment, "status" | "nextDueOn">, today: Date): TrainingStatus | "overdue" =>
  assignment.nextDueOn && assignment.nextDueOn < today ? "overdue" : assignment.status;

/** The date a completion on `completedAt` stops counting, or null when the course never expires. */
export const expiryOf = (completedAt: Date, validForDays: number | null): Date | null =>
  validForDays ? addDays(businessToday(completedAt), validForDays) : null;

const toAssignmentView = (assignment: IAssignment, today: Date, name?: string) => ({
  id: assignment.id,
  employeeId: assignment.employeeId,
  ...(name !== undefined ? { employeeName: name } : {}),
  courseId: assignment.courseId,
  courseTitle: assignment.courseTitle,
  status: derivedStatus(assignment, today),
  dueDate: formatDate(assignment.dueDate),
  startedAt: assignment.startedAt ? assignment.startedAt.toISOString() : null,
  completedAt: assignment.completedAt ? assignment.completedAt.toISOString() : null,
  score: assignment.scoreHundredths === null ? null : fromHundredths(assignment.scoreHundredths),
  expiresAt: assignment.expiresAt ? formatDate(assignment.expiresAt) : null,
});

// ---------------------------------------------------------------- courses

// Patch semantics: undefined leaves a field alone, null or "" clears an optional one.
const patchWhole = (value: unknown, field: string, min: number, max: number): number | null | undefined =>
  value === undefined ? undefined : value === null ? null : wholeNumber(value, field, min, max);

const parseCourseFields = (body: Record<string, unknown>, partial: boolean) => ({
  title: partial && body.title === undefined ? undefined : text(body.title, "title", 120),
  category: partial && body.category === undefined ? undefined : oneOf(body.category, TRAINING_CATEGORIES, "category"),
  description: nullableText(body.description, "description", 2000),
  durationMinutes: patchWhole(body.durationMinutes, "durationMinutes", 1, 1440),
  materialUrl:
    body.materialUrl === undefined ? undefined : isCleared(body.materialUrl) ? null : parseHttpsUrl(body.materialUrl, "materialUrl", 500),
  validForDays: patchWhole(body.validForDays, "validForDays", 1, 3650),
});

const createCourse = async (body: unknown) => {
  try {
    const f = parseCourseFields(parseBody(body), false);
    const course = await TrainingQuery.createCourse({
      title: f.title as string,
      category: f.category as ICourse["category"],
      description: f.description ?? null,
      durationMinutes: f.durationMinutes ?? null,
      materialUrl: f.materialUrl ?? null,
      validForDays: f.validForDays ?? null,
    });
    return toCourseView(course);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listCourses = async (query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await TrainingQuery.listCourses(page.offset, page.limit);
    return toPage(items.map(toCourseView), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getCourse = async (id: string) => {
  try {
    const course = isUuid(id) ? await TrainingQuery.findCourse(id) : null;
    if (!course) throw new CustomException(COURSE_NOT_FOUND, notFound);
    return toCourseView(course);
  } catch (error) {
    throw toCustomException(error);
  }
};

const updateCourse = async (id: string, body: unknown) => {
  try {
    const f = parseCourseFields(parseBody(body), true);
    requireSomething(f);
    const changes = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
    const course = isUuid(id) ? await TrainingQuery.updateCourse(id, changes) : null;
    if (!course) throw new CustomException(COURSE_NOT_FOUND, notFound);
    return toCourseView(course);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Retired, not erased: past assignments keep their course. Refused while anyone still has
// it open. The retirement takes the course lock first, so an assignment racing it either
// lands before (and blocks the delete) or finds the course gone.
const deleteCourse = async (id: string) => {
  try {
    if (!isUuid(id)) throw new CustomException(COURSE_NOT_FOUND, notFound);
    await inHrTransaction(async (tx) => {
      if (!(await TrainingQuery.retireCourse(id, clock.now(), tx))) throw new CustomException(COURSE_NOT_FOUND, notFound);
      if ((await TrainingQuery.countOpenForCourse(id, tx)) > 0) {
        throw new CustomException("People still have this course open. Close those assignments first.", conflict);
      }
      await TrainingQuery.removeRequirementsForCourse(id, tx);
    });
    return { id, deleted: true };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ----------------------------------------------------------- requirements

const listRequirements = async () => {
  try {
    const rows = await TrainingQuery.listRequirements();
    const byRole = new Map<string, string[]>();
    for (const row of rows) byRole.set(row.roleKey, [...(byRole.get(row.roleKey) ?? []), row.courseId]);
    return { roles: [...byRole].map(([role, courseIds]) => ({ role, courseIds })) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const setRequirements = async (roleParam: string, body: unknown) => {
  try {
    const role = normaliseKey(text(roleParam, "role", 60));
    if (!role) throw new CustomException("role is required.", badRequest);
    const raw = parseBody(body).courseIds;
    const courseIds = Array.isArray(raw) && raw.length === 0 ? [] : parseUuidList(raw, "courseIds", MAX_REQUIREMENT_COURSES);
    await inHrTransaction(async (tx) => {
      const live = await TrainingQuery.liveCourseIds(courseIds, tx);
      if (live.length !== courseIds.length) throw new CustomException(COURSE_NOT_FOUND, notFound);
      await TrainingQuery.replaceRequirements(role, courseIds, tx);
    });
    return { role, courseIds };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------ assignments

const assign = async (user: RequestUser, scope: StoreScope, body: unknown) => {
  try {
    const input = parseBody(body);
    const courseId = parseUuid(input.courseId, "courseId");
    const employeeIds = parseUuidList(input.employeeIds, "employeeIds", MAX_ASSIGN_PEOPLE);
    const today = businessToday();
    const dueDate = parseOptionalDate(input.dueDate, "dueDate") ?? addDays(today, DEFAULT_DUE_DAYS);
    if (dueDate < today || dueDate > addDays(today, MAX_DUE_AHEAD_DAYS)) {
      throw new CustomException(`dueDate must be from today to ${MAX_DUE_AHEAD_DAYS} days ahead.`, badRequest);
    }
    const people = await requireEmployees(employeeIds, scope);
    if (people.some((p) => p.status === "exited")) {
      throw new CustomException("Training cannot be assigned to someone who has left.", badRequest);
    }
    const by = actorName(user);
    const result = await inHrTransaction(async (tx) => {
      const course = await TrainingQuery.lockCourse(courseId, tx);
      if (!course) throw new CustomException(COURSE_NOT_FOUND, notFound);
      const alreadyOpen = new Set((await TrainingQuery.findOpenFor(courseId, employeeIds, tx)).map((a) => a.employeeId));
      const toCreate = employeeIds.filter((id) => !alreadyOpen.has(id));
      await TrainingQuery.createAssignments(
        toCreate.map((employeeId) => ({
          employeeId,
          courseId,
          dueDate,
          validForDays: course.validForDays,
          nextDueOn: dueDate,
          assignedByName: by,
        })),
        tx
      );
      return { created: await TrainingQuery.findOpenFor(courseId, toCreate, tx), skipped: [...alreadyOpen] };
    });
    return {
      assigned: result.created.length,
      skipped: result.skipped,
      // in the order the caller listed the people
      assignments: [...result.created].sort((a, b) => employeeIds.indexOf(a.employeeId) - employeeIds.indexOf(b.employeeId)).map((a) => toAssignmentView(a, today)),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const ASSIGNMENT_FILTER_STATUSES = [...TRAINING_STATUSES, "overdue"] as const;

const listAssignments = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const today = businessToday();
    const employeeId = queryString(query.employeeId, "employeeId");
    const courseIdRaw = queryString(query.courseId, "courseId");
    const status = optionalOneOf(queryString(query.status, "status"), ASSIGNMENT_FILTER_STATUSES, "status");
    if (employeeId) await assertEmployeeInScope(employeeId, scope);
    const { ids } = employeeId ? { ids: null } : await employeeIdsInScope(scope, { activeOnly: status === "overdue" });
    const { items, total } = await TrainingQuery.listAssignments({
      employeeIds: ids,
      employeeId,
      courseId: courseIdRaw ? parseUuid(courseIdRaw, "courseId") : undefined,
      status: status && status !== "overdue" ? status : undefined,
      overdueBefore: status === "overdue" ? today : undefined,
      offset: page.offset,
      limit: page.limit,
    });
    const names = await directoryOf(items.map((a) => a.employeeId));
    return toPage(items.map((a) => toAssignmentView(a, today, names.get(a.employeeId)?.name ?? "Unknown")), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const parseCompletedAt = (value: unknown, employee: IEmployeeRef, now: Date): Date => {
  if (value === undefined || value === null) return now;
  const at = new Date(typeof value === "string" ? value : Number.NaN);
  if (typeof value !== "string" || Number.isNaN(at.getTime())) {
    throw new CustomException("completedAt must be an ISO date and time.", badRequest);
  }
  if (at.getTime() > now.getTime() + CLOCK_SKEW_MS) throw new CustomException("completedAt cannot be in the future.", badRequest);
  if (businessToday(at) < employee.joinDate) throw new CustomException("completedAt cannot be before the person joined.", badRequest);
  return at;
};

// The one completion path (HR records it, or the person marks their own course done):
// conditional on "still open" so two simultaneous completions leave exactly one.
const complete = async (assignment: IAssignment, employee: IEmployeeRef, completedAtRaw: unknown, scoreRaw: unknown) => {
  const now = clock.now();
  const completedAt = parseCompletedAt(completedAtRaw, employee, now);
  const scoreHundredths = scoreRaw === undefined || scoreRaw === null ? null : parseScore(scoreRaw, "score");
  await inHrTransaction(async (tx) => {
    const won = await TrainingQuery.completeAssignment(
      assignment.id,
      { completedAt, scoreHundredths, expiresAt: expiryOf(completedAt, assignment.validForDays) },
      tx
    );
    if (!won) throw new CustomException("This training is already completed.", conflict);
    await TrainingQuery.supersedePrevious(assignment.employeeId, assignment.courseId, assignment.id, now, tx);
  });
};

const start = async (assignment: IAssignment) => {
  if (assignment.status === "in_progress") return;
  const started = await inHrTransaction((tx) => TrainingQuery.startAssignment(assignment.id, clock.now(), tx));
  if (!started) throw new CustomException("This training can no longer be started.", conflict);
};

const loadAssignment = async (id: string): Promise<IAssignment> => {
  const assignment = isUuid(id) ? await TrainingQuery.findAssignment(id) : null;
  if (!assignment) throw new CustomException(ASSIGNMENT_NOT_FOUND, notFound);
  return assignment;
};

const FORBIDDEN_CHANGE = "A completed training record cannot be changed.";

const updateAssignment = async (scope: StoreScope, id: string, body: unknown) => {
  try {
    const input = parseBody(body);
    const status = optionalOneOf(input.status, TRAINING_STATUSES, "status");
    if (status === undefined && input.completedAt === undefined && input.score === undefined) requireSomething({});
    const assignment = await loadAssignment(id);
    const employee = await assertEmployeeInScope(assignment.employeeId, scope);
    if (assignment.status === "completed") throw new CustomException(FORBIDDEN_CHANGE, conflict);
    if (status !== "completed" && (input.completedAt !== undefined || input.score !== undefined)) {
      throw new CustomException("completedAt and score are recorded together with the status completed.", badRequest);
    }
    if (status === "assigned" && assignment.status === "in_progress") {
      throw new CustomException("Training that has started cannot go back to assigned.", conflict);
    }
    if (status === "in_progress") await start(assignment);
    if (status === "completed") await complete(assignment, employee, input.completedAt, input.score);
    return toAssignmentView(await loadAssignment(id), businessToday());
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------- overdue and refreshers

const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);

const listOverdue = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const today = businessToday();
    const { ids, truncated } = await employeeIdsInScope(narrowScope(scope, query.storeId), { activeOnly: true });
    const { items, total } = await TrainingQuery.listOverdue(ids, today, page.offset, page.limit);
    const names = await directoryOf(items.map((row) => row.employeeId));
    return {
      overdue: items.map((row) => ({
        employeeId: row.employeeId,
        name: names.get(row.employeeId)?.name ?? "Unknown",
        courseTitle: row.courseTitle,
        dueDate: formatDate(row.dueOn),
        daysOverdue: daysBetween(row.dueOn, today),
      })),
      page: page.page,
      limit: page.limit,
      total,
      ...(truncated ? { truncated: true } : {}),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const listRefreshersDue = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const raw = queryString(query.withinDays, "withinDays");
    const withinDays =
      raw === undefined ? DEFAULT_REFRESHER_WINDOW_DAYS : wholeNumber(Number(raw), "withinDays", 1, MAX_REFRESHER_WINDOW_DAYS);
    const today = businessToday();
    const { ids, truncated } = await employeeIdsInScope(narrowScope(scope, query.storeId), { activeOnly: true });
    const { items, total } = await TrainingQuery.listRefreshers(ids, today, addDays(today, withinDays), page.offset, page.limit);
    const names = await directoryOf(items.map((row) => row.employeeId));
    return {
      refreshers: items.map((row) => ({
        employeeId: row.employeeId,
        name: names.get(row.employeeId)?.name ?? "Unknown",
        courseTitle: row.courseTitle,
        dueOn: formatDate(row.dueOn),
      })),
      page: page.page,
      limit: page.limit,
      total,
      ...(truncated ? { truncated: true } : {}),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// -------------------------------------------- self-service (used by the ESS routes)

/** The person's own assignments, newest first (at most 100). */
const listMine = async (employee: IEmployeeRef) => {
  try {
    const { items } = await TrainingQuery.listAssignments({ employeeIds: null, employeeId: employee.id, offset: 0, limit: 100 });
    const today = businessToday();
    return {
      assignments: items.map((a) => ({
        id: a.id,
        courseTitle: a.courseTitle,
        status: derivedStatus(a, today),
        dueDate: formatDate(a.dueDate),
        materialUrl: a.courseMaterialUrl,
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const loadOwn = async (employee: IEmployeeRef, id: string): Promise<IAssignment> => {
  const assignment = await loadAssignment(id);
  if (assignment.employeeId !== employee.id) throw new CustomException(ASSIGNMENT_NOT_FOUND, notFound);
  return assignment;
};

const startMine = async (employee: IEmployeeRef, id: string) => {
  try {
    const assignment = await loadOwn(employee, id);
    if (assignment.status === "completed") throw new CustomException(FORBIDDEN_CHANGE, conflict);
    await start(assignment);
    return toAssignmentView(await loadAssignment(id), businessToday());
  } catch (error) {
    throw toCustomException(error);
  }
};

const completeMine = async (employee: IEmployeeRef, id: string, body: unknown) => {
  try {
    const assignment = await loadOwn(employee, id);
    await complete(assignment, employee, undefined, parseBody(body).score);
    return toAssignmentView(await loadAssignment(id), businessToday());
  } catch (error) {
    throw toCustomException(error);
  }
};

export const TrainingService = {
  createCourse,
  listCourses,
  getCourse,
  updateCourse,
  deleteCourse,
  listRequirements,
  setRequirements,
  assign,
  listAssignments,
  updateAssignment,
  listOverdue,
  listRefreshersDue,
  listMine,
  startMine,
  completeMine,
};
