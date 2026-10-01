import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import { IRoster } from "../Models/Hr/Attendance.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { EmployeeQuery } from "../Queries/Employee.Query.js";
import { inHrTransaction } from "../Queries/Hr.Transaction.js";
import { RosterQuery } from "../Queries/Roster.Query.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { addDays, businessToday, formatDate, formatTime, parseDate, parseRange, parseTime } from "../Utils/HrDate.js";
import { parseUuid } from "../Utils/HrInput.js";
import { parseBody, queryString } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { EMPLOYEE_NOT_FOUND } from "./EmployeeAccess.js";
import { narrowScope } from "./Employee.Service.js";

const PAST_DAYS = 7;
const FUTURE_DAYS = 180;
const MAX_LIST_DAYS = 62;
// "Required" headcount is what the same shift usually has: the busiest of the same weekday
// over the previous four weeks (see the module note).
const HISTORY_WEEKS = 4;

const toRosterView = (roster: IRoster) => ({
  id: roster.id,
  employeeId: roster.employeeId,
  storeId: roster.storeId,
  date: formatDate(roster.date),
  shiftStart: formatTime(roster.shiftStartMin),
  shiftEnd: formatTime(roster.shiftEndMin),
});

// A store the caller may roster for: a pinned scope allows only that store, and anything
// else is simply not found.
const requireStore = async (storeId: string, scope: StoreScope) => {
  const store = isUuid(storeId) && (!scope || scope === storeId) ? await StoreQuery.findById(storeId, scope) : null;
  if (!store) throw new CustomException("Store not found.", notFound);
  return store;
};

const create = async (scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const today = businessToday();
    const date = parseDate(body.date, "date");
    if (date < addDays(today, -PAST_DAYS) || date > addDays(today, FUTURE_DAYS)) {
      throw new CustomException(`date must be within ${PAST_DAYS} days back and ${FUTURE_DAYS} days ahead.`, badRequest);
    }
    const shiftStartMin = parseTime(body.shiftStart, "shiftStart");
    const shiftEndMin = parseTime(body.shiftEnd, "shiftEnd");
    if (shiftEndMin <= shiftStartMin) throw new CustomException("shiftEnd must be after shiftStart on the same day.", badRequest);
    const employeeId = parseUuid(body.employeeId, "employeeId");
    const storeId = parseUuid(body.storeId, "storeId");
    await requireStore(storeId, scope);

    try {
      const created = await inHrTransaction(async (tx) => {
        // A pinned scope reaches only their own store's people, so another store's employee is a 404.
        const employee = await EmployeeQuery.lockById(employeeId, scope, tx);
        if (!employee) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
        if (employee.status === "exited") throw new CustomException("This employee has left.", badRequest);
        if (employee.storeId && employee.storeId !== storeId) {
          throw new CustomException("This employee belongs to another store.", badRequest);
        }
        if ((await RosterQuery.findOverlapping(employee.id, date, shiftStartMin, shiftEndMin, tx)) > 0) {
          throw new CustomException("This person already has an overlapping shift that day.", conflict);
        }
        return await RosterQuery.create(
          { employeeId: employee.id, storeId, date, shiftStartMin, shiftEndMin, createdByUserId: user.id },
          tx
        );
      });
      return toRosterView(created);
    } catch (error) {
      if (isUniqueViolation(error)) throw new CustomException("This person already has that shift.", conflict);
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const list = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const today = businessToday();
    const page = parsePage(query);
    const { from, to } = parseRange(query.from, query.to, { from: today, to: addDays(today, 13) }, MAX_LIST_DAYS);
    const { items, total } = await RosterQuery.list({
      storeId: narrowScope(scope, query.storeId),
      from,
      to,
      offset: page.offset,
      limit: page.limit,
    });
    return toPage(items.map(toRosterView), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const remove = async (id: string, scope: StoreScope) => {
  try {
    const roster = isUuid(id) ? await RosterQuery.findById(id, scope) : null;
    if (!roster) throw new CustomException("Roster entry not found.", notFound);
    await RosterQuery.remove(roster.id);
    return { id: roster.id, removed: true };
  } catch (error) {
    throw toCustomException(error);
  }
};

const coverage = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const storeId = parseUuid(queryString(query.storeId, "storeId"), "storeId");
    const date = parseDate(queryString(query.date, "date"), "date");
    await requireStore(storeId, scope);
    const history = Array.from({ length: HISTORY_WEEKS }, (_, week) => addDays(date, -7 * (week + 1)));
    const counts = await RosterQuery.shiftCounts(storeId, [date, ...history]);

    const key = (c: { shiftStartMin: number; shiftEndMin: number }) => `${c.shiftStartMin}-${c.shiftEndMin}`;
    const shifts = new Map<string, { start: number; end: number; rostered: number; usual: number | null }>();
    for (const c of counts) {
      const entry = shifts.get(key(c)) ?? { start: c.shiftStartMin, end: c.shiftEndMin, rostered: 0, usual: null };
      if (c.date.getTime() === date.getTime()) entry.rostered = c.rostered;
      else entry.usual = Math.max(entry.usual ?? 0, c.rostered);
      shifts.set(key(c), entry);
    }
    const rows = [...shifts.values()]
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .map((shift) => {
        const required = shift.usual ?? shift.rostered;
        return {
          start: formatTime(shift.start),
          end: formatTime(shift.end),
          rostered: shift.rostered,
          required,
          gap: Math.max(0, required - shift.rostered),
        };
      });
    return { shifts: rows };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const RosterService = { create, list, remove, coverage };
