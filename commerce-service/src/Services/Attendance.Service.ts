import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, forbidden, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import { IAttendance, RecordedAttendanceStatus } from "../Models/Hr/Attendance.Interface.js";
import { IEmployee, IEmployeeRef } from "../Models/Hr/Employee.Interface.js";
import { AttendanceQuery } from "../Queries/Attendance.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { EmployeeQuery } from "../Queries/Employee.Query.js";
import { HolidayQuery } from "../Queries/Holiday.Query.js";
import { inHrTransaction } from "../Queries/Hr.Transaction.js";
import { LeaveQuery } from "../Queries/Leave.Query.js";
import { RosterQuery } from "../Queries/Roster.Query.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import {
  MS_PER_MINUTE,
  addDays,
  businessToday,
  clock,
  dayStart,
  daysInclusive,
  formatDate,
  maxDate,
  minDate,
  minutesOfDay,
  parseDate,
  parseInstant,
  parseMonth,
  parseOptionalDate,
  parseRange,
} from "../Utils/HrDate.js";
import { parseUuid } from "../Utils/HrInput.js";
import { parseBody, queryString, text } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { EMPLOYEE_NOT_FOUND } from "./EmployeeAccess.js";
import { narrowScope } from "./Employee.Service.js";
import { countLeaveDays, dayStatus, eachDate, isHoliday } from "./HrCalendar.js";
import { actorName } from "./HrActor.js";

// A clock-in later than the shift start by more than this is "late".
export const LATE_GRACE_MINUTES = 10;
// An open day older than this is no longer "the current shift": the person forgot to clock out.
export const MAX_SHIFT_HOURS = 20;
const MAX_SUMMARY_DAYS = 92;
const SKEW_MS = 5 * MS_PER_MINUTE;

const iso = (value: Date | null) => (value ? value.toISOString() : null);

const toDayView = (record: IAttendance) => ({
  date: formatDate(record.date),
  status: record.status,
  clockIn: iso(record.clockIn),
  clockOut: iso(record.clockOut),
});

const recordedStatus = async (
  employeeId: string,
  date: Date,
  clockIn: Date | null
): Promise<RecordedAttendanceStatus> => {
  if (!clockIn) return "present";
  const shiftStart = await RosterQuery.firstShiftStart(employeeId, date);
  return shiftStart !== null && minutesOfDay(clockIn) > shiftStart + LATE_GRACE_MINUTES ? "late" : "present";
};

// Used by employee self-service as well: one record per day, a second clock-in is a 409.
const clockIn = async (employee: IEmployeeRef, input: unknown) => {
  try {
    const body = parseBody(input);
    if (employee.status !== "active" && employee.status !== "notice") {
      throw new CustomException("Your employment record is not active.", forbidden);
    }
    let storeId = employee.storeId;
    if (body.storeId !== undefined) {
      const requested = parseUuid(body.storeId, "storeId");
      if (storeId && requested !== storeId) throw new CustomException("You can only clock in at your own store.", badRequest);
      if (!storeId) {
        if (!(await StoreQuery.findById(requested, null))) throw new CustomException("That store does not exist.", badRequest);
        storeId = requested;
      }
    }
    const now = clock.now();
    const date = businessToday(now);
    const status = await recordedStatus(employee.id, date, now);
    try {
      const saved = await inHrTransaction(async (tx) => {
        // Serialises this person's clock events, so two taps cannot both pass the checks below.
        await EmployeeQuery.lockById(employee.id, null, tx);
        const open = await AttendanceQuery.findOpen(employee.id, new Date(now.getTime() - MAX_SHIFT_HOURS * 60 * MS_PER_MINUTE), tx);
        if (open || (await AttendanceQuery.findDay(employee.id, date, tx))) {
          throw new CustomException("Already clocked in.", conflict);
        }
        return await AttendanceQuery.create(
          { employeeId: employee.id, storeId, date, status, clockIn: now, clockOut: null, corrected: false },
          tx
        );
      });
      return toDayView(saved);
    } catch (error) {
      // The unique (employee, date) index is the last word if the checks were raced.
      if (isUniqueViolation(error)) throw new CustomException("Already clocked in.", conflict);
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const clockOut = async (employee: IEmployeeRef) => {
  try {
    const now = clock.now();
    const saved = await inHrTransaction(async (tx) => {
      await EmployeeQuery.lockById(employee.id, null, tx);
      const open = await AttendanceQuery.findOpen(employee.id, new Date(now.getTime() - MAX_SHIFT_HOURS * 60 * MS_PER_MINUTE), tx);
      if (!open || !open.clockIn) throw new CustomException("Not clocked in.", conflict);
      const at = now > open.clockIn ? now : new Date(open.clockIn.getTime() + 1000);
      return await AttendanceQuery.update(open.id, { clockOut: at }, tx);
    });
    return toDayView(saved);
  } catch (error) {
    throw toCustomException(error);
  }
};

const parseDay = (value: unknown, today: Date): Date => {
  const date = parseDate(value, "date");
  if (date > today) throw new CustomException("date cannot be in the future.", badRequest);
  return date;
};

const getForDay = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const today = businessToday();
    const date = parseDay(query.date, today);
    const page = parsePage(query);
    const { items: employees, total } = await EmployeeQuery.listInPeriod(
      narrowScope(scope, query.storeId),
      date,
      date,
      page.offset,
      page.limit
    );
    const ids = employees.map((employee) => employee.id);
    const [records, leave, holidays] = await Promise.all([
      AttendanceQuery.listForEmployees(ids, date, date),
      LeaveQuery.approvedForEmployees(ids, date, date),
      HolidayQuery.inRange(date, date),
    ]);
    const recordOf = new Map(records.map((record) => [record.employeeId, record]));
    const people = employees.map((employee) => {
      const record = recordOf.get(employee.id);
      const spans = leave.filter((span) => span.employeeId === employee.id);
      return {
        employeeId: employee.id,
        name: employee.name,
        status: dayStatus(record, spans, holidays, date, employee.storeId),
        clockIn: iso(record?.clockIn ?? null),
        clockOut: iso(record?.clockOut ?? null),
      };
    });
    return { date: formatDate(date), people, page: page.page, limit: page.limit, total };
  } catch (error) {
    throw toCustomException(error);
  }
};

// The days an employee could have worked inside [from, to]: on the books, not yet in the future.
const workWindow = (employee: IEmployee, from: Date, to: Date, today: Date): { from: Date; to: Date } | null => {
  let end = minDate(to, today);
  if (employee.lastWorkingDay) end = minDate(end, employee.lastWorkingDay);
  const start = maxDate(from, employee.joinDate);
  return start > end ? null : { from: start, to: end };
};

const getSummary = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const today = businessToday();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const { from, to } = parseRange(query.from, query.to, { from: monthStart, to: today }, MAX_SUMMARY_DAYS);
    const page = parsePage(query);
    const { items: employees, total } = await EmployeeQuery.listInPeriod(
      narrowScope(scope, query.storeId),
      from,
      to,
      page.offset,
      page.limit
    );
    const ids = employees.map((employee) => employee.id);
    const [counts, leave, holidays] = await Promise.all([
      AttendanceQuery.countByEmployee(ids, from, to),
      LeaveQuery.approvedForEmployees(ids, from, to),
      HolidayQuery.inRange(from, to),
    ]);
    const countOf = new Map(counts.map((count) => [count.employeeId, count]));
    const rows = employees.map((employee) => {
      const window = workWindow(employee, from, to, today);
      const present = countOf.get(employee.id)?.present ?? 0;
      const late = countOf.get(employee.id)?.late ?? 0;
      const spans = leave.filter((span) => span.employeeId === employee.id);
      const holidayDays = window
        ? eachDate(window.from, window.to).filter((date) => isHoliday(holidays, date, employee.storeId)).length
        : 0;
      const workingDays = window ? daysInclusive(window.from, window.to) - holidayDays : 0;
      const leaveDays = window ? countLeaveDays(spans, window.from, window.to, holidays, employee.storeId) : 0;
      return {
        employeeId: employee.id,
        name: employee.name,
        present,
        late,
        absent: Math.max(0, workingDays - present - late - leaveDays),
        leave: leaveDays,
        workingDays,
        attendanceRatePct: workingDays > 0 ? Math.round(((present + late) / workingDays) * 1000) / 10 : null,
      };
    });
    return { from: formatDate(from), to: formatDate(to), employees: rows, page: page.page, limit: page.limit, total };
  } catch (error) {
    throw toCustomException(error);
  }
};

const getEmployeeMonth = async (employeeId: string, scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const today = businessToday();
    const monthRaw = queryString(query.month, "month");
    const { from, to } = parseMonth(monthRaw ?? formatDate(today).slice(0, 7), "month");
    const employee = isUuid(employeeId) ? await EmployeeQuery.findById(employeeId, scope) : null;
    if (!employee) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
    const window = workWindow(employee, from, to, today);
    if (!window) return { employeeId: employee.id, month: formatDate(from).slice(0, 7), days: [] };
    const [records, leave, holidays] = await Promise.all([
      AttendanceQuery.listForEmployees([employee.id], window.from, window.to),
      LeaveQuery.approvedForEmployees([employee.id], window.from, window.to),
      HolidayQuery.inRange(window.from, window.to),
    ]);
    const recordOf = new Map(records.map((record) => [record.date.getTime(), record]));
    const days = eachDate(window.from, window.to).map((date) => {
      const record = recordOf.get(date.getTime());
      return {
        date: formatDate(date),
        status: dayStatus(record, leave, holidays, date, employee.storeId),
        clockIn: iso(record?.clockIn ?? null),
        clockOut: iso(record?.clockOut ?? null),
      };
    });
    return { employeeId: employee.id, month: formatDate(from).slice(0, 7), days };
  } catch (error) {
    throw toCustomException(error);
  }
};

const toCorrectionView = (c: Awaited<ReturnType<typeof AttendanceQuery.createCorrection>>) => ({
  id: c.id,
  employeeId: c.employeeId,
  date: formatDate(c.date),
  reason: c.reason,
  correctedBy: c.correctedByName,
  previousClockIn: iso(c.previousClockIn),
  previousClockOut: iso(c.previousClockOut),
  clockIn: iso(c.newClockIn),
  clockOut: iso(c.newClockOut),
  createdAt: c.createdAt.toISOString(),
});

const createCorrection = async (scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const today = businessToday();
    const employeeId = parseUuid(body.employeeId, "employeeId");
    const date = parseDay(body.date, today);
    const reason = text(body.reason, "reason", 300);
    const newIn = body.clockIn === undefined || body.clockIn === null ? undefined : parseInstant(body.clockIn, "clockIn");
    const newOut = body.clockOut === undefined || body.clockOut === null ? undefined : parseInstant(body.clockOut, "clockOut");
    if (!newIn && !newOut) throw new CustomException("Give a clockIn, a clockOut, or both.", badRequest);
    const now = clock.now();

    const saved = await inHrTransaction(async (tx) => {
      const employee = await EmployeeQuery.lockById(employeeId, scope, tx);
      if (!employee) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
      if (date < employee.joinDate) throw new CustomException("date is before the employee joined.", badRequest);
      const existing = await AttendanceQuery.findDay(employee.id, date, tx);
      const clockInAt = newIn ?? existing?.clockIn ?? null;
      const clockOutAt = newOut ?? existing?.clockOut ?? null;
      const dayFrom = dayStart(date);
      if (clockInAt && (clockInAt < dayFrom || clockInAt >= addDays(dayFrom, 1))) {
        throw new CustomException("clockIn must fall on the corrected date.", badRequest);
      }
      if (clockOutAt && clockOutAt.getTime() > now.getTime() + SKEW_MS) {
        throw new CustomException("clockOut cannot be in the future.", badRequest);
      }
      if (clockInAt && clockOutAt) {
        if (clockOutAt <= clockInAt) throw new CustomException("clockOut must be after clockIn.", badRequest);
        if (clockOutAt.getTime() - clockInAt.getTime() > MAX_SHIFT_HOURS * 60 * MS_PER_MINUTE) {
          throw new CustomException(`A shift cannot be longer than ${MAX_SHIFT_HOURS} hours.`, badRequest);
        }
      }
      if (
        existing &&
        existing.clockIn?.getTime() === clockInAt?.getTime() &&
        existing.clockOut?.getTime() === clockOutAt?.getTime()
      ) {
        throw new CustomException("That is already what is recorded.", badRequest);
      }
      const status = await recordedStatus(employee.id, date, clockInAt);
      const write = { clockIn: clockInAt, clockOut: clockOutAt, status, corrected: true };
      const record = existing
        ? await AttendanceQuery.update(existing.id, write, tx)
        : await AttendanceQuery.create({ employeeId: employee.id, storeId: employee.storeId, date, ...write }, tx);
      // Audit row and the change itself commit together or not at all.
      const correction = await AttendanceQuery.createCorrection(
        {
          employeeId: employee.id,
          storeId: record.storeId,
          date,
          previousClockIn: existing?.clockIn ?? null,
          previousClockOut: existing?.clockOut ?? null,
          newClockIn: clockInAt,
          newClockOut: clockOutAt,
          reason,
          correctedByUserId: user.id,
          correctedByName: actorName(user),
        },
        tx
      );
      return { correction, record };
    });
    return { ...toCorrectionView(saved.correction), status: saved.record.status };
  } catch (error) {
    throw toCustomException(error);
  }
};

const listCorrections = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const employeeId = queryString(query.employeeId, "employeeId");
    if (employeeId !== undefined && !isUuid(employeeId)) throw new CustomException("employeeId must be a valid id.", badRequest);
    const from = parseOptionalDate(queryString(query.from, "from"), "from");
    const to = parseOptionalDate(queryString(query.to, "to"), "to");
    if (from && to && to < from) throw new CustomException("from must not be after to.", badRequest);
    const { items, total } = await AttendanceQuery.listCorrections({
      storeId: scope,
      employeeId,
      from,
      to,
      offset: page.offset,
      limit: page.limit,
    });
    return toPage(items.map(toCorrectionView), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

export const AttendanceService = { clockIn, clockOut, getForDay, getSummary, getEmployeeMonth, createCorrection, listCorrections };
