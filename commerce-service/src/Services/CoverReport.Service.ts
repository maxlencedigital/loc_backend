import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, forbidden, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import { IDailyReport } from "../Models/Hr/Career.Interface.js";
import { IEmployee, IEmployeeRef } from "../Models/Hr/Employee.Interface.js";
import { AttendanceQuery } from "../Queries/Attendance.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { DailyReportQuery } from "../Queries/DailyReport.Query.js";
import { EmployeeQuery } from "../Queries/Employee.Query.js";
import { HolidayQuery } from "../Queries/Holiday.Query.js";
import { LeaveQuery } from "../Queries/Leave.Query.js";
import { addDays, businessToday, formatDate, parseDate, parseOptionalDate, parseRange } from "../Utils/HrDate.js";
import { normaliseKey, parseUuid, parseUuidList, textList } from "../Utils/HrInput.js";
import { optionalText, parseBody, queryString, text } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { EMPLOYEE_NOT_FOUND } from "./EmployeeAccess.js";
import { narrowScope } from "./Employee.Service.js";
import { dayStatus } from "./HrCalendar.js";
import { actorName } from "./HrActor.js";

const NOT_FOUND = "Daily report not found.";
const MAX_REPORT_RANGE_DAYS = 92;
const MAX_REPORT_AGE_DAYS = 7;
const MAX_HOURS = 24;
const BLOCKER_KEY_MAX = 120;
const SCAN_PAGE = 100;
const SCAN_PAGES = 5;
const MAX_ABSENT_LISTED = 200;
const MAX_COVER_LISTED = 50;
const MAX_WORK_ITEMS = 100;
const MAX_PATTERN_WEEKS = 8;
const MIN_PATTERN_COUNT = 2;
const MAX_PATTERNS = 20;
const EXAMPLES_PER_THEME = 3;
const EXAMPLE_ROWS = 200;

const toReportView = (report: IDailyReport) => ({
  id: report.id,
  employeeId: report.employeeId,
  name: report.employeeName,
  date: formatDate(report.date),
  summary: report.summary,
  completed: report.completed,
  blockers: report.blockers,
  hoursWorked: report.minutesWorked === null ? null : report.minutesWorked / 60,
});

// Used by employee self-service as well. One report per person per day (409 on a second).
const submitDaily = async (employee: IEmployeeRef, input: unknown) => {
  try {
    const body = parseBody(input);
    const today = businessToday();
    const date = parseDate(body.date, "date");
    if (date > today || date < addDays(today, -MAX_REPORT_AGE_DAYS)) {
      throw new CustomException(`date must be today or within the last ${MAX_REPORT_AGE_DAYS} days.`, badRequest);
    }
    if (employee.status === "exited") throw new CustomException("Your employment record is not active.", forbidden);
    const blockers = optionalText(body.blockers, "blockers", 500) ?? null;
    let minutesWorked: number | null = null;
    if (body.hoursWorked !== undefined && body.hoursWorked !== null) {
      if (typeof body.hoursWorked !== "number" || !(body.hoursWorked >= 0 && body.hoursWorked <= MAX_HOURS)) {
        throw new CustomException(`hoursWorked must be from 0 to ${MAX_HOURS}.`, badRequest);
      }
      minutesWorked = Math.round(body.hoursWorked * 60);
    }
    const blockerKey = blockers ? normaliseKey(blockers).slice(0, BLOCKER_KEY_MAX) || null : null;
    try {
      return toReportView(
        await DailyReportQuery.create({
          employeeId: employee.id,
          storeId: employee.storeId,
          date,
          summary: text(body.summary, "summary", 1000),
          completed: body.completed === undefined ? [] : textList(body.completed, "completed", 20, 200),
          blockers,
          blockerKey,
          minutesWorked,
        })
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new CustomException("A report for this date was already submitted.", conflict);
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const dailyFilter = (scope: StoreScope, query: Record<string, unknown>, today: Date) => {
  const date = parseOptionalDate(queryString(query.date, "date"), "date");
  const { from, to } = date
    ? { from: date, to: date }
    : parseRange(queryString(query.from, "from"), queryString(query.to, "to"), { from: addDays(today, -6), to: today }, MAX_REPORT_RANGE_DAYS);
  const employeeId = queryString(query.employeeId, "employeeId");
  if (employeeId !== undefined && !isUuid(employeeId)) throw new CustomException("employeeId must be a valid id.", badRequest);
  return { storeId: narrowScope(scope, query.storeId), employeeId, from, to };
};

const listDaily = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await DailyReportQuery.list({
      ...dailyFilter(scope, query, businessToday()),
      offset: page.offset,
      limit: page.limit,
    });
    return toPage(items.map(toReportView), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

/** One person's own reports, newest first; used by employee self-service. */
const listForEmployee = async (employeeId: string, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const today = businessToday();
    const { from, to } = parseRange(queryString(query.from, "from"), queryString(query.to, "to"), { from: addDays(today, -29), to: today }, MAX_REPORT_RANGE_DAYS);
    const { items, total } = await DailyReportQuery.list({ storeId: null, employeeId, from, to, offset: page.offset, limit: page.limit });
    return toPage(items.map(toReportView), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getDaily = async (id: string, scope: StoreScope) => {
  try {
    const report = isUuid(id) ? await DailyReportQuery.findById(id, scope) : null;
    if (!report) throw new CustomException(NOT_FOUND, notFound);
    return toReportView(report);
  } catch (error) {
    throw toCustomException(error);
  }
};

const patterns = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const weeksRaw = queryString(query.weeks, "weeks");
    const weeks = weeksRaw === undefined ? 1 : Number(weeksRaw);
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_PATTERN_WEEKS) {
      throw new CustomException(`weeks must be a whole number from 1 to ${MAX_PATTERN_WEEKS}.`, badRequest);
    }
    const effective = narrowScope(scope, query.storeId);
    const to = businessToday();
    const from = addDays(to, -(weeks * 7 - 1));
    const themes = await DailyReportQuery.blockerThemes(effective, from, to, MIN_PATTERN_COUNT, MAX_PATTERNS);
    const rows = await DailyReportQuery.blockerExamples(effective, themes.map((t) => t.key), from, to, EXAMPLE_ROWS);
    return {
      recurringBlockers: themes.map((theme) => ({
        theme: theme.key,
        count: theme.count,
        examples: [...new Set(rows.filter((r) => r.blockerKey === theme.key).map((r) => r.blockers))].slice(0, EXAMPLES_PER_THEME),
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ----------------------------------------------------------------- absence cover
const parsePastDate = (value: unknown, today: Date): Date => {
  const date = parseDate(value, "date");
  if (date > today) throw new CustomException("date cannot be in the future.", badRequest);
  return date;
};

// People on the books that day who were neither in nor excused by a holiday: absent or on
// leave. Scans a bounded number of employees, a page at a time.
const scanAbsent = async (scope: StoreScope, date: Date) => {
  const absent: { employee: IEmployee; reason: string }[] = [];
  for (let page = 0; page < SCAN_PAGES && absent.length < MAX_ABSENT_LISTED; page += 1) {
    const { items } = await EmployeeQuery.listInPeriod(scope, date, date, page * SCAN_PAGE, SCAN_PAGE);
    if (items.length === 0) break;
    const ids = items.map((employee) => employee.id);
    const [records, leave, holidays] = await Promise.all([
      AttendanceQuery.listForEmployees(ids, date, date),
      LeaveQuery.approvedForEmployees(ids, date, date),
      HolidayQuery.inRange(date, date),
    ]);
    const recordOf = new Map(records.map((record) => [record.employeeId, record]));
    for (const employee of items) {
      const status = dayStatus(
        recordOf.get(employee.id),
        leave.filter((span) => span.employeeId === employee.id),
        holidays,
        date,
        employee.storeId
      );
      if (status === "absent") absent.push({ employee, reason: "No clock-in recorded" });
      if (status === "on_leave") absent.push({ employee, reason: "On approved leave" });
    }
    if (items.length < SCAN_PAGE) break;
  }
  return absent.slice(0, MAX_ABSENT_LISTED);
};

const absenceCover = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const date = parsePastDate(queryString(query.date, "date"), businessToday());
    const effective = narrowScope(scope, query.storeId);
    const absent = await scanAbsent(effective, date);
    const inRows = await AttendanceQuery.listStillIn(effective, date, MAX_COVER_LISTED);
    const cover = await EmployeeQuery.findByIds(inRows.map((row) => row.employeeId), effective);
    return {
      date: formatDate(date),
      absent: absent.map(({ employee, reason }) => ({
        employeeId: employee.id,
        name: employee.name,
        reason,
        // No other module records who is assigned which order, batch or route yet.
        assigned: { orders: 0, batches: 0, routes: 0 },
      })),
      availableCover: cover
        .filter((employee) => employee.status === "active")
        .map((employee) => ({
          employeeId: employee.id,
          name: employee.name,
          skills: [employee.role, ...(employee.designation ? [employee.designation] : [])],
        })),
      assignmentsTracked: false,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// Records the hand-over. Applying it to orders, batches and routes belongs to the services
// that own them; until they track assignments, the log is the record.
const reassign = async (scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const fromId = parseUuid(body.fromEmployeeId, "fromEmployeeId");
    const toId = parseUuid(body.toEmployeeId, "toEmployeeId");
    const date = parsePastDate(body.date, businessToday());
    const workItemIds = body.workItemIds === undefined ? [] : parseUuidList(body.workItemIds, "workItemIds", MAX_WORK_ITEMS);
    if (fromId === toId) throw new CustomException("Choose someone other than the absent person.", badRequest);

    const people = await EmployeeQuery.findByIds([fromId, toId], scope);
    const from = people.find((p) => p.id === fromId);
    const to = people.find((p) => p.id === toId);
    if (!from || !to) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
    if (from.storeId && to.storeId && from.storeId !== to.storeId) {
      throw new CustomException("Work can only be handed to someone at the same store.", badRequest);
    }
    const [fromRecord, toRecord] = await Promise.all([AttendanceQuery.findDay(from.id, date), AttendanceQuery.findDay(to.id, date)]);
    if (fromRecord) throw new CustomException(`${from.name} was in that day, so there is no absence to cover.`, conflict);
    if (!toRecord?.clockIn || to.status !== "active") throw new CustomException(`${to.name} is not in that day.`, conflict);

    const saved = await DailyReportQuery.createReassignment({
      fromEmployeeId: from.id,
      toEmployeeId: to.id,
      date,
      workItemIds,
      byUserId: user.id,
      byName: actorName(user),
    });
    return {
      id: saved.id,
      fromEmployeeId: from.id,
      toEmployeeId: to.id,
      date: formatDate(date),
      workItemIds,
      status: "recorded",
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const CoverReportService = { submitDaily, listForEmployee, listDaily, getDaily, patterns, absenceCover, reassign };
