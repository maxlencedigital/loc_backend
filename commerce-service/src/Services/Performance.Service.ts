import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, forbidden, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import { IEmployee, IEmployeeRef } from "../Models/Hr/Employee.Interface.js";
import {
  APPRAISAL_OUTCOMES,
  APPRAISAL_STATUSES,
  IAppraisal,
  IPerformanceInputs,
  RATING_MAX,
  RATING_MIN,
} from "../Models/Hr/Performance.Interface.js";
import { AttendanceQuery } from "../Queries/Attendance.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { EmployeeQuery } from "../Queries/Employee.Query.js";
import { HolidayQuery } from "../Queries/Holiday.Query.js";
import { inHrTransaction } from "../Queries/Hr.Transaction.js";
import { LeaveQuery } from "../Queries/Leave.Query.js";
import { PerformanceQuery } from "../Queries/Performance.Query.js";
import { TrainingQuery } from "../Queries/Training.Query.js";
import {
  addDays,
  businessToday,
  clock,
  dayStart,
  daysInclusive,
  formatDate,
  maxDate,
  minDate,
  parseDate,
  parseMonth,
  parseRange,
} from "../Utils/HrDate.js";
import { isCleared, nullableText, parseUuid, parseUuidList, textList } from "../Utils/HrInput.js";
import { oneOf, optionalOneOf, parseBody, queryString, text, wholeNumber } from "../Utils/Input.js";
import { requireSomething } from "../Utils/PeopleInput.js";
import { isUuid } from "../Utils/Uuid.js";
import { narrowScope } from "./Employee.Service.js";
import { EMPLOYEE_NOT_FOUND, assertEmployeeInScope } from "./EmployeeAccess.js";
import { actorName } from "./HrActor.js";
import { countLeaveDays, eachDate, isHoliday } from "./HrCalendar.js";
import { directoryOf, employeeIdsInScope, requireEmployees } from "./PeopleScope.js";
import { measuresOf, scoreOf, toMetrics } from "./PerformanceScore.js";

const APPRAISAL_NOT_FOUND = "Appraisal not found.";
const MAX_RANGE_DAYS = 92;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANKED_PEOPLE = 500;
const MAX_SCHEDULE_PEOPLE = 100;
const MAX_GOALS = 10;
const MAX_BACKDATE_DAYS = 30;
const MAX_AHEAD_DAYS = 366;

// ------------------------------------------------------------------ views

const toAppraisalView = (a: IAppraisal, name?: string) => ({
  id: a.id,
  employeeId: a.employeeId,
  ...(name !== undefined ? { employeeName: name } : {}),
  cycle: a.cycle,
  scheduledFor: formatDate(a.scheduledFor),
  reviewerId: a.reviewerId,
  status: a.status,
  rating: a.rating,
  strengths: a.strengths,
  improvements: a.improvements,
  goals: a.goals,
  conductedAt: a.conductedAt ? a.conductedAt.toISOString() : null,
  outcome: a.outcome,
  outcomeNote: a.outcomeNote,
  completedAt: a.completedAt ? a.completedAt.toISOString() : null,
  createdAt: a.createdAt.toISOString(),
  updatedAt: a.updatedAt.toISOString(),
});

// ------------------------------------------------------------ score inputs

// What a person could have worked in [from, to]: on the books, not in the future.
const windowOf = (employee: IEmployee, from: Date, to: Date, today: Date): { from: Date; to: Date } | null => {
  let end = minDate(to, today);
  if (employee.lastWorkingDay) end = minDate(end, employee.lastWorkingDay);
  const start = maxDate(from, employee.joinDate);
  return start > end ? null : { from: start, to: end };
};

// A fixed number of batch queries for any number of people (at most a few hundred).
const collectInputs = async (employees: IEmployee[], from: Date, to: Date, today: Date): Promise<Map<string, IPerformanceInputs>> => {
  const ids = employees.map((e) => e.id);
  const last = minDate(to, today);
  const [counts, leave, holidays, training, ratings] = await Promise.all([
    AttendanceQuery.countByEmployee(ids, from, last),
    LeaveQuery.approvedForEmployees(ids, from, last),
    HolidayQuery.inRange(from, last),
    TrainingQuery.countDueAndDone(ids, from, to),
    PerformanceQuery.ratingsFor(ids, dayStart(from), dayStart(addDays(to, 1))),
  ]);
  const countOf = new Map(counts.map((c) => [c.employeeId, c]));
  const trainingOf = new Map(training.map((t) => [t.employeeId, t]));
  return new Map(
    employees.map((employee) => {
      const window = windowOf(employee, from, to, today);
      const spans = leave.filter((span) => span.employeeId === employee.id);
      const holidayDays = window ? eachDate(window.from, window.to).filter((d) => isHoliday(holidays, d, employee.storeId)).length : 0;
      const leaveDays = window ? countLeaveDays(spans, window.from, window.to, holidays, employee.storeId) : 0;
      const expectedDays = window ? Math.max(0, daysInclusive(window.from, window.to) - holidayDays - leaveDays) : 0;
      const inputs: IPerformanceInputs = {
        employeeId: employee.id,
        present: countOf.get(employee.id)?.present ?? 0,
        late: countOf.get(employee.id)?.late ?? 0,
        expectedDays,
        trainingDue: trainingOf.get(employee.id)?.due ?? 0,
        trainingDone: trainingOf.get(employee.id)?.done ?? 0,
        ratings: ratings.filter((r) => r.employeeId === employee.id).map((r) => r.rating),
      };
      return [employee.id, inputs];
    })
  );
};

const performanceOf = async (employee: IEmployee, query: Record<string, unknown>) => {
  const today = businessToday();
  const { from, to } = parseRange(query.from, query.to, { from: addDays(today, 1 - DEFAULT_RANGE_DAYS), to: today }, MAX_RANGE_DAYS);
  const length = daysInclusive(from, to);
  const previousTo = addDays(from, -1);
  const [current, previous] = await Promise.all([
    collectInputs([employee], from, to, today),
    collectInputs([employee], addDays(previousTo, 1 - length), previousTo, today),
  ]);
  const now = measuresOf(current.get(employee.id) as IPerformanceInputs);
  const before = measuresOf(previous.get(employee.id) as IPerformanceInputs);
  return {
    employeeId: employee.id,
    name: employee.name,
    from: formatDate(from),
    to: formatDate(to),
    score: scoreOf(now),
    metrics: toMetrics(now, before),
  };
};

const getEmployeePerformance = async (id: string, scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const employee = isUuid(id) ? await EmployeeQuery.findById(id, scope) : null;
    if (!employee) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
    return await performanceOf(employee, query);
  } catch (error) {
    throw toCustomException(error);
  }
};

/** The signed-in person's own performance (self-service). */
const getMine = async (ref: IEmployeeRef, query: Record<string, unknown>) => {
  try {
    const employee = await EmployeeQuery.findById(ref.id, null);
    if (!employee) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
    const { score, metrics } = await performanceOf(employee, query);
    return { score, metrics };
  } catch (error) {
    throw toCustomException(error);
  }
};

// Rank 1 is the highest score; equal scores share a rank; people with nothing to measure are unranked.
export const rankScores = <T extends { score: number | null }>(rows: T[]): (T & { rank: number | null })[] => {
  const scored = rows.filter((r) => r.score !== null).sort((a, b) => (b.score as number) - (a.score as number));
  const rankOf = (score: number) => 1 + scored.filter((r) => (r.score as number) > score).length;
  return [
    ...scored.map((r) => ({ ...r, rank: rankOf(r.score as number) })),
    ...rows.filter((r) => r.score === null).map((r) => ({ ...r, rank: null })),
  ];
};

const getSummary = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const effective = narrowScope(scope, query.storeId);
    const page = parsePage(query);
    const today = businessToday();
    const periodRaw = queryString(query.period, "period");
    const { from, to } = parseMonth(periodRaw ?? formatDate(today).slice(0, 7), "period");
    const [{ items: employees, total }, scoped] = await Promise.all([
      EmployeeQuery.listInPeriod(effective, from, to, 0, MAX_RANKED_PEOPLE),
      employeeIdsInScope(effective),
    ]);
    const inputs = await collectInputs(employees, from, to, today);
    const rows = employees.map((e) => ({
      employeeId: e.id,
      name: e.name,
      score: scoreOf(measuresOf(inputs.get(e.id) as IPerformanceInputs)),
    }));
    const ranked = rankScores(rows).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.name.localeCompare(b.name));
    const distribution = await PerformanceQuery.ratingDistribution(scoped.ids, dayStart(from), dayStart(addDays(to, 1)));
    return {
      period: formatDate(from).slice(0, 7),
      employees: ranked.slice(page.offset, page.offset + page.limit),
      ratingDistribution: Object.fromEntries(
        Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => [String(RATING_MIN + i), distribution[RATING_MIN + i] ?? 0])
      ),
      page: page.page,
      limit: page.limit,
      total: employees.length,
      ...(total > employees.length ? { truncated: true } : {}),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// -------------------------------------------------------------- appraisals

const cycleOf = (scheduledFor: Date): string => `${scheduledFor.getUTCFullYear()}-H${scheduledFor.getUTCMonth() < 6 ? 1 : 2}`;

const parseCycle = (value: unknown): string => {
  const cycle = text(value, "cycle", 20);
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.\-]*$/.test(cycle)) throw new CustomException("cycle may use letters, digits, spaces and - _ . only.", badRequest);
  return cycle;
};

const parseScheduledFor = (value: unknown, today: Date): Date => {
  const date = parseDate(value, "scheduledFor");
  if (date < addDays(today, -MAX_BACKDATE_DAYS) || date > addDays(today, MAX_AHEAD_DAYS)) {
    throw new CustomException(`scheduledFor must be within ${MAX_BACKDATE_DAYS} days back and ${MAX_AHEAD_DAYS} days ahead.`, badRequest);
  }
  return date;
};

const requireReviewer = async (reviewerId: string, subjectId: string): Promise<void> => {
  if (reviewerId === subjectId) throw new CustomException("Nobody can be their own reviewer.", badRequest);
  const [reviewer] = await requireEmployees([reviewerId], null).catch(() => {
    throw new CustomException("reviewerId must be an existing employee.", badRequest);
  });
  if (reviewer.status === "exited") throw new CustomException("The reviewer has left.", badRequest);
};

const requireReviewable = (employee: IEmployeeRef) => {
  if (employee.status === "exited") throw new CustomException("Someone who has left cannot be appraised.", badRequest);
};

const createAppraisal = async (user: RequestUser, scope: StoreScope, body: unknown) => {
  try {
    const input = parseBody(body);
    const employee = await assertEmployeeInScope(parseUuid(input.employeeId, "employeeId"), scope);
    requireReviewable(employee);
    if (input.status !== undefined && input.status !== "scheduled") {
      throw new CustomException("An appraisal starts as scheduled; conduct and complete move it on.", badRequest);
    }
    const reviewerId = input.reviewerId === undefined || isCleared(input.reviewerId) ? employee.reportingTo : parseUuid(input.reviewerId, "reviewerId");
    if (reviewerId) await requireReviewer(reviewerId, employee.id);
    const created = await PerformanceQuery.create({
      employeeId: employee.id,
      cycle: parseCycle(input.cycle),
      scheduledFor: parseScheduledFor(input.scheduledFor, businessToday()),
      reviewerId,
      createdByName: actorName(user),
    }).catch((error) => {
      if (isUniqueViolation(error)) throw new CustomException("This person already has an appraisal for that cycle.", conflict);
      throw error;
    });
    return toAppraisalView(created, employee.name);
  } catch (error) {
    throw toCustomException(error);
  }
};

const scheduleAppraisals = async (user: RequestUser, scope: StoreScope, body: unknown) => {
  try {
    const input = parseBody(body);
    const employeeIds = parseUuidList(input.employeeIds, "employeeIds", MAX_SCHEDULE_PEOPLE);
    const scheduledFor = parseScheduledFor(input.scheduledFor, businessToday());
    const cycle = input.cycle === undefined ? cycleOf(scheduledFor) : parseCycle(input.cycle);
    const people = await requireEmployees(employeeIds, scope);
    people.forEach(requireReviewable);
    const existing = new Set((await PerformanceQuery.findByCycle(cycle, employeeIds)).map((a) => a.employeeId));
    const toCreate = people.filter((p) => !existing.has(p.id));
    await PerformanceQuery.createMany(
      toCreate.map((p) => ({ employeeId: p.id, cycle, scheduledFor, reviewerId: p.reportingTo, createdByName: actorName(user) }))
    );
    const created = await PerformanceQuery.findByCycle(cycle, toCreate.map((p) => p.id));
    const createdIds = new Set(created.map((a) => a.employeeId));
    const names = new Map(people.map((p) => [p.id, p.name]));
    return {
      cycle,
      scheduled: created.length,
      skipped: employeeIds.filter((id) => !createdIds.has(id)),
      appraisals: created.map((a) => toAppraisalView(a, names.get(a.employeeId))),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const listAppraisals = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const employeeId = queryString(query.employeeId, "employeeId");
    if (employeeId) await assertEmployeeInScope(employeeId, scope);
    const { ids } = employeeId ? { ids: null } : await employeeIdsInScope(scope);
    const { items, total } = await PerformanceQuery.list({
      employeeIds: ids,
      employeeId,
      status: optionalOneOf(queryString(query.status, "status"), APPRAISAL_STATUSES, "status"),
      cycle: queryString(query.cycle, "cycle"),
      offset: page.offset,
      limit: page.limit,
    });
    const names = await directoryOf(items.map((a) => a.employeeId));
    return toPage(items.map((a) => toAppraisalView(a, names.get(a.employeeId)?.name ?? "Unknown")), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const loadInScope = async (id: string, scope: StoreScope): Promise<{ appraisal: IAppraisal; employee: IEmployeeRef }> => {
  const appraisal = isUuid(id) ? await PerformanceQuery.findById(id) : null;
  if (!appraisal) throw new CustomException(APPRAISAL_NOT_FOUND, notFound);
  // An appraisal outside the caller's stores is as good as absent.
  const employee = await assertEmployeeInScope(appraisal.employeeId, scope).catch(() => {
    throw new CustomException(APPRAISAL_NOT_FOUND, notFound);
  });
  return { appraisal, employee };
};

const getAppraisal = async (id: string, scope: StoreScope) => {
  try {
    const { appraisal, employee } = await loadInScope(id, scope);
    return toAppraisalView(appraisal, employee.name);
  } catch (error) {
    throw toCustomException(error);
  }
};

const updateAppraisal = async (id: string, scope: StoreScope, body: unknown) => {
  try {
    const input = parseBody(body);
    if (input.employeeId !== undefined) throw new CustomException("employeeId cannot be changed.", badRequest);
    const status = optionalOneOf(input.status, APPRAISAL_STATUSES, "status");
    if (status === "completed") throw new CustomException("Use the complete action to finish an appraisal.", badRequest);
    const changes = {
      cycle: input.cycle === undefined ? undefined : parseCycle(input.cycle),
      scheduledFor: input.scheduledFor === undefined ? undefined : parseScheduledFor(input.scheduledFor, businessToday()),
      reviewerId: input.reviewerId === undefined ? undefined : isCleared(input.reviewerId) ? null : parseUuid(input.reviewerId, "reviewerId"),
    };
    requireSomething({ ...changes, status });
    const { appraisal, employee } = await loadInScope(id, scope);
    if (changes.reviewerId) await requireReviewer(changes.reviewerId, employee.id);
    if (status === "scheduled" && appraisal.status !== "scheduled") {
      throw new CustomException("An appraisal that has started cannot go back to scheduled.", conflict);
    }
    const edits = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    await inHrTransaction(async (tx) => {
      if (Object.keys(edits).length > 0 && !(await PerformanceQuery.reschedule(id, edits, tx))) {
        throw new CustomException("The schedule can only be edited before the appraisal starts.", conflict);
      }
      if (status === "in_progress" && appraisal.status === "scheduled" && !(await PerformanceQuery.start(id, tx))) {
        throw new CustomException("This appraisal has already started.", conflict);
      }
    }).catch((error) => {
      if (isUniqueViolation(error)) throw new CustomException("This person already has an appraisal for that cycle.", conflict);
      throw error;
    });
    return toAppraisalView((await PerformanceQuery.findById(id)) as IAppraisal, employee.name);
  } catch (error) {
    throw toCustomException(error);
  }
};

const conductAppraisal = async (user: RequestUser, id: string, scope: StoreScope, body: unknown) => {
  try {
    const input = parseBody(body);
    const rating = wholeNumber(input.rating, "rating", RATING_MIN, RATING_MAX);
    const strengths = nullableText(input.strengths, "strengths", 2000);
    const improvements = nullableText(input.improvements, "improvements", 2000);
    const goals = input.goals === undefined ? [] : textList(input.goals, "goals", MAX_GOALS, 200);
    const { appraisal, employee } = await loadInScope(id, scope);
    // Nobody rates themself, whatever their role.
    if (employee.gatewayUserId && employee.gatewayUserId === user.id) {
      throw new CustomException("You cannot conduct your own appraisal.", forbidden);
    }
    const written = await inHrTransaction((tx) =>
      PerformanceQuery.conduct(
        appraisal.id,
        { rating, strengths: strengths ?? null, improvements: improvements ?? null, goals, conductedAt: clock.now(), conductedByName: actorName(user) },
        tx
      )
    );
    if (!written) throw new CustomException("This appraisal has already been conducted or completed; its rating cannot change.", conflict);
    return toAppraisalView((await PerformanceQuery.findById(id)) as IAppraisal, employee.name);
  } catch (error) {
    throw toCustomException(error);
  }
};

const completeAppraisal = async (user: RequestUser, id: string, scope: StoreScope, body: unknown) => {
  try {
    const input = parseBody(body);
    const outcome = oneOf(input.outcome, APPRAISAL_OUTCOMES, "outcome");
    const outcomeNote = nullableText(input.note, "note", 2000);
    const { appraisal, employee } = await loadInScope(id, scope);
    const done = await inHrTransaction((tx) =>
      PerformanceQuery.complete(
        appraisal.id,
        { outcome, outcomeNote: outcomeNote ?? null, completedAt: clock.now(), completedByName: actorName(user) },
        tx
      )
    );
    if (!done) {
      const current = (await PerformanceQuery.findById(id)) as IAppraisal;
      throw new CustomException(
        current.status === "completed" ? "This appraisal is already completed." : "Conduct the appraisal and record a rating before completing it.",
        conflict
      );
    }
    return toAppraisalView((await PerformanceQuery.findById(id)) as IAppraisal, employee.name);
  } catch (error) {
    throw toCustomException(error);
  }
};

/** The person's own appraisals; the rating and outcome appear once the appraisal is completed. */
const listMine = async (ref: IEmployeeRef) => {
  try {
    const rows = await PerformanceQuery.listForEmployee(ref.id, 50);
    return {
      items: rows.map((a) => ({
        id: a.id,
        cycle: a.cycle,
        scheduledFor: formatDate(a.scheduledFor),
        status: a.status,
        rating: a.status === "completed" ? a.rating : null,
        outcome: a.status === "completed" ? a.outcome : null,
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const PerformanceService = {
  getEmployeePerformance,
  getSummary,
  createAppraisal,
  scheduleAppraisals,
  listAppraisals,
  getAppraisal,
  updateAppraisal,
  conductAppraisal,
  completeAppraisal,
  getMine,
  listMine,
};
