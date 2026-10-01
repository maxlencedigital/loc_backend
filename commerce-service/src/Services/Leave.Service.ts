import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, forbidden, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import { IEmployee, IEmployeeRef } from "../Models/Hr/Employee.Interface.js";
import {
  ILeaveBalance,
  ILeavePolicy,
  ILeaveRequest,
  LEAVE_STATUSES,
  LEAVE_TYPES,
  LeaveType,
} from "../Models/Hr/Leave.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { EmployeeQuery } from "../Queries/Employee.Query.js";
import { HolidayQuery } from "../Queries/Holiday.Query.js";
import { Db, inHrTransaction } from "../Queries/Hr.Transaction.js";
import { LeaveQuery } from "../Queries/Leave.Query.js";
import { addDays, businessToday, clock, daysInclusive, formatDate, parseDate, parseMonth, parseOptionalDate } from "../Utils/HrDate.js";
import { parseBoolean } from "../Utils/HrInput.js";
import { oneOf, optionalOneOf, optionalText, parseBody, queryString, text, wholeNumber } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { EMPLOYEE_NOT_FOUND, findEmployeeByUserId } from "./EmployeeAccess.js";
import { narrowScope } from "./Employee.Service.js";
import { chargeableByYear, totalHalfDays } from "./HrCalendar.js";
import { actorName } from "./HrActor.js";

const NOT_FOUND = "Leave request not found.";
const MAX_LEAVE_DAYS = 60;
const MAX_BACKDATE_DAYS = 30;
const MAX_AHEAD_DAYS = 366;
const MAX_POLICY_DAYS = 366;
// Unpaid leave is never limited by a balance; every other type is.
const UNLIMITED_TYPE: LeaveType = "unpaid";

const days = (halfDays: number) => halfDays / 2;

export const toLeaveView = (request: ILeaveRequest) => ({
  id: request.id,
  employeeId: request.employeeId,
  employeeName: request.employeeName,
  type: request.type,
  from: formatDate(request.fromDate),
  to: formatDate(request.toDate),
  halfDay: request.halfDay,
  days: days(request.chargeableHalfDays),
  status: request.status,
  reason: request.reason,
  decidedBy: request.decidedByName,
  decidedAt: request.decidedAt ? request.decidedAt.toISOString() : null,
  ...(request.decisionNote ? { decisionNote: request.decisionNote } : {}),
});

// ---------------------------------------------------------------- balances
interface BalanceFigures {
  entitledHalfDays: number;
  takenHalfDays: number;
}

// The yearly entitlement, plus last year's unused leave when the policy carries forward.
// Carry-forward looks one year back; with no row last year a person who was already
// employed carries the whole annual quota, since they cannot have used any.
const entitlementFor = (
  policy: ILeavePolicy,
  year: number,
  joinYear: number,
  previous: BalanceFigures | null
): number => {
  if (!policy.carryForward) return policy.annualHalfDays;
  const carried = previous
    ? Math.max(0, previous.entitledHalfDays - previous.takenHalfDays)
    : joinYear < year ? policy.annualHalfDays : 0;
  return policy.annualHalfDays + carried;
};

const ensureBalance = async (employee: Pick<IEmployee, "id" | "joinDate">, type: LeaveType, year: number, db: Db) => {
  const policy = (await LeaveQuery.listPolicies(db)).find((p) => p.type === type);
  if (!policy) throw new CustomException(`There is no ${type} leave policy.`, conflict);
  const previous = policy.carryForward ? await LeaveQuery.findBalance(employee.id, type, year - 1, db) : null;
  const entitled = entitlementFor(policy, year, employee.joinDate.getUTCFullYear(), previous);
  // Created and granted together, once: a concurrent creation inserts nothing and grants nothing.
  if (await LeaveQuery.createBalanceIfMissing(employee.id, type, year, entitled, db)) {
    await LeaveQuery.appendLedger(
      { employeeId: employee.id, type, year, kind: "grant", deltaHalfDays: entitled, requestId: null, note: "Entitlement for the year" },
      db
    );
  }
};

// ---------------------------------------------------------------- requests
// Used by employee self-service too. Overlapping requests are refused under the
// employee's row lock; the balance is checked when a manager approves.
const createRequest = async (employee: IEmployeeRef, input: unknown) => {
  try {
    const body = parseBody(input);
    const today = businessToday();
    if (employee.status === "exited") throw new CustomException("Your employment record is not active.", forbidden);
    const type = oneOf(body.type, LEAVE_TYPES, "type");
    const fromDate = parseDate(body.from, "from");
    const toDate = parseDate(body.to, "to");
    const halfDay = body.halfDay === undefined ? false : parseBoolean(body.halfDay, "halfDay");
    const reason = optionalText(body.reason, "reason", 300) ?? null;
    if (toDate < fromDate) throw new CustomException("from must not be after to.", badRequest);
    if (halfDay && fromDate.getTime() !== toDate.getTime()) throw new CustomException("A half-day is a single day.", badRequest);
    if (daysInclusive(fromDate, toDate) > MAX_LEAVE_DAYS) {
      throw new CustomException(`A request can cover at most ${MAX_LEAVE_DAYS} days.`, badRequest);
    }
    if (fromDate < addDays(today, -MAX_BACKDATE_DAYS) || toDate > addDays(today, MAX_AHEAD_DAYS)) {
      throw new CustomException(`Leave can start at most ${MAX_BACKDATE_DAYS} days back and end within a year.`, badRequest);
    }
    if (fromDate < employee.joinDate) throw new CustomException("Leave cannot start before the join date.", badRequest);

    const holidays = await HolidayQuery.inRange(fromDate, toDate);
    const chargeableHalfDays = totalHalfDays(chargeableByYear({ fromDate, toDate, halfDay }, holidays, employee.storeId));
    if (chargeableHalfDays === 0) throw new CustomException("Those days are all holidays.", badRequest);

    const created = await inHrTransaction(async (tx) => {
      // One request at a time per person, so two submissions cannot both pass the overlap check.
      if (!(await EmployeeQuery.lockById(employee.id, null, tx))) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
      if ((await LeaveQuery.countOverlapping(employee.id, fromDate, toDate, tx)) > 0) {
        throw new CustomException("You already have leave requested or approved for some of those days.", conflict);
      }
      return await LeaveQuery.createRequest(
        { employeeId: employee.id, type, fromDate, toDate, halfDay, chargeableHalfDays, reason },
        tx
      );
    });
    return toLeaveView(created);
  } catch (error) {
    throw toCustomException(error);
  }
};

const withdraw = async (employee: IEmployeeRef, requestId: string) => {
  try {
    const withdrawn = await inHrTransaction(async (tx) => {
      const request = isUuid(requestId) ? await LeaveQuery.lockRequest(requestId, null, tx) : null;
      if (!request || request.employeeId !== employee.id) throw new CustomException(NOT_FOUND, notFound);
      if (request.status !== "pending") throw new CustomException(`This request is already ${request.status}.`, conflict);
      return await LeaveQuery.withdrawRequest(request.id, tx);
    });
    return toLeaveView(withdrawn);
  } catch (error) {
    throw toCustomException(error);
  }
};

// A manager decides for their own store (others are 404); nobody decides their own request.
const assertNotSelf = async (user: RequestUser, request: ILeaveRequest) => {
  const own = await findEmployeeByUserId(user.id);
  if (own && own.id === request.employeeId) {
    throw new CustomException("You cannot decide your own leave request.", forbidden);
  }
};

const approve = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const note = optionalText(body.note, "note", 300) ?? null;
    const visible = isUuid(id) ? await LeaveQuery.findRequest(id, scope) : null;
    if (!visible) throw new CustomException(NOT_FOUND, notFound);
    await assertNotSelf(user, visible);

    const approved = await inHrTransaction(async (tx) => {
      // The request row lock makes "pending, so decide" atomic; the balance lock below
      // makes "enough left, so debit" atomic. Both are held until commit.
      const request = await LeaveQuery.lockRequest(id, scope, tx);
      if (!request) throw new CustomException(NOT_FOUND, notFound);
      if (request.status !== "pending") throw new CustomException(`This request is already ${request.status}.`, conflict);
      const employee = await EmployeeQuery.findById(request.employeeId, null, tx);
      if (!employee || employee.status === "exited") throw new CustomException("This employee has left.", conflict);

      const holidays = await HolidayQuery.inRange(request.fromDate, request.toDate, tx);
      const byYear = chargeableByYear(request, holidays, employee.storeId);
      const total = totalHalfDays(byYear);
      if (total === 0) throw new CustomException("Those days are all holidays now.", conflict);

      if (request.type !== UNLIMITED_TYPE) {
        // Ascending years, so two approvals touching the same years lock in the same order.
        for (const year of [...byYear.keys()].sort((a, b) => a - b)) {
          const halves = byYear.get(year) as number;
          await ensureBalance(employee, request.type, year, tx);
          const balance = await LeaveQuery.lockBalance(employee.id, request.type, year, tx);
          if (!balance) throw new CustomException("No leave balance is set up.", conflict);
          const remaining = balance.entitledHalfDays - balance.takenHalfDays;
          if (halves > remaining) {
            throw new CustomException(
              `Not enough ${request.type} leave for ${year}: ${days(remaining)} day(s) left, ${days(halves)} requested.`,
              conflict
            );
          }
          await LeaveQuery.addTaken(balance.id, halves, tx);
          await LeaveQuery.appendLedger(
            { employeeId: employee.id, type: request.type, year, kind: "debit", deltaHalfDays: -halves, requestId: request.id, note: null },
            tx
          );
        }
      }
      return await LeaveQuery.decideRequest(
        request.id,
        {
          status: "approved",
          decidedByUserId: user.id,
          decidedByName: actorName(user),
          decidedAt: clock.now(),
          decisionNote: note,
          chargeableHalfDays: total,
        },
        tx
      );
    });
    return toLeaveView(approved);
  } catch (error) {
    // A repeated debit for one request and year means two approvals raced past the locks.
    throw toCustomException(isUniqueViolation(error) ? new CustomException("This request is already approved.", conflict) : error);
  }
};

const reject = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const reason = text(body.reason, "reason", 300);
    const visible = isUuid(id) ? await LeaveQuery.findRequest(id, scope) : null;
    if (!visible) throw new CustomException(NOT_FOUND, notFound);
    await assertNotSelf(user, visible);

    const rejected = await inHrTransaction(async (tx) => {
      const request = await LeaveQuery.lockRequest(id, scope, tx);
      if (!request) throw new CustomException(NOT_FOUND, notFound);
      if (request.status !== "pending") throw new CustomException(`This request is already ${request.status}.`, conflict);
      return await LeaveQuery.decideRequest(
        request.id,
        {
          status: "rejected",
          decidedByUserId: user.id,
          decidedByName: actorName(user),
          decidedAt: clock.now(),
          decisionNote: reason,
          chargeableHalfDays: request.chargeableHalfDays,
        },
        tx
      );
    });
    return toLeaveView(rejected);
  } catch (error) {
    throw toCustomException(error);
  }
};

const list = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const employeeId = queryString(query.employeeId, "employeeId");
    if (employeeId !== undefined && !isUuid(employeeId)) throw new CustomException("employeeId must be a valid id.", badRequest);
    const from = parseOptionalDate(queryString(query.from, "from"), "from");
    const to = parseOptionalDate(queryString(query.to, "to"), "to");
    if (from && to && to < from) throw new CustomException("from must not be after to.", badRequest);
    const { items, total } = await LeaveQuery.listRequests({
      storeId: narrowScope(scope, query.storeId),
      status: optionalOneOf(queryString(query.status, "status"), LEAVE_STATUSES, "status"),
      employeeId,
      from,
      to,
      offset: page.offset,
      limit: page.limit,
    });
    return toPage(items.map(toLeaveView), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getById = async (id: string, scope: StoreScope) => {
  try {
    const request = isUuid(id) ? await LeaveQuery.findRequest(id, scope) : null;
    if (!request) throw new CustomException(NOT_FOUND, notFound);
    return toLeaveView(request);
  } catch (error) {
    throw toCustomException(error);
  }
};

const countPending = async (scope: StoreScope) => {
  try {
    return { pending: await LeaveQuery.countByStatus(scope, "pending") };
  } catch (error) {
    throw toCustomException(error);
  }
};

const calendar = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { from, to } = parseMonth(queryString(query.month, "month"), "month");
    const { items, total } = await LeaveQuery.listApprovedInRange(narrowScope(scope, query.storeId), from, to, page.offset, page.limit);
    return {
      month: formatDate(from).slice(0, 7),
      entries: items.map((r) => ({
        employeeId: r.employeeId,
        name: r.employeeName,
        from: formatDate(r.fromDate),
        to: formatDate(r.toDate),
        type: r.type,
      })),
      page: page.page,
      limit: page.limit,
      total,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ---------------------------------------------------------------- balances (read)
interface BalanceRow {
  employeeId: string;
  name: string;
  type: LeaveType;
  entitled: number;
  taken: number;
  remaining: number;
}

// What the balance is or would be: a stored row, else the projection from the policy,
// so a person who never took leave still shows their full entitlement.
const projectBalances = (
  employees: Pick<IEmployee, "id" | "name" | "joinDate">[],
  policies: ILeavePolicy[],
  rows: ILeaveBalance[],
  previous: ILeaveBalance[],
  year: number
): BalanceRow[] => {
  const rowOf = new Map(rows.map((r) => [`${r.employeeId}:${r.type}`, r]));
  const previousOf = new Map(previous.map((r) => [`${r.employeeId}:${r.type}`, r]));
  return employees.flatMap((employee) =>
    policies
      .filter((policy) => policy.type !== UNLIMITED_TYPE)
      .map((policy) => {
        const key = `${employee.id}:${policy.type}`;
        const row = rowOf.get(key);
        const entitled = row
          ? row.entitledHalfDays
          : entitlementFor(policy, year, employee.joinDate.getUTCFullYear(), previousOf.get(key) ?? null);
        const taken = row?.takenHalfDays ?? 0;
        return {
          employeeId: employee.id,
          name: employee.name,
          type: policy.type,
          entitled: days(entitled),
          taken: days(taken),
          remaining: days(entitled - taken),
        };
      })
  );
};

/** Balances of one employee for the current year; used by employee self-service. */
const balancesFor = async (employee: Pick<IEmployee, "id" | "name" | "joinDate">) => {
  try {
    const year = businessToday().getUTCFullYear();
    const [policies, rows, previous] = await Promise.all([
      LeaveQuery.listPolicies(),
      LeaveQuery.listBalances([employee.id], year),
      LeaveQuery.listBalances([employee.id], year - 1),
    ]);
    return projectBalances([employee], policies, rows, previous, year).map(({ employeeId: _e, name: _n, ...b }) => b);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listBalances = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const year = businessToday().getUTCFullYear();
    const employeeId = queryString(query.employeeId, "employeeId");
    let employees: IEmployee[];
    let total: number;
    if (employeeId !== undefined) {
      const one = isUuid(employeeId) ? await EmployeeQuery.findById(employeeId, narrowScope(scope, query.storeId)) : null;
      if (!one) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
      employees = [one];
      total = 1;
    } else {
      const today = businessToday();
      ({ items: employees, total } = await EmployeeQuery.listInPeriod(narrowScope(scope, query.storeId), today, today, page.offset, page.limit));
    }
    const ids = employees.map((e) => e.id);
    const [policies, rows, previous] = await Promise.all([
      LeaveQuery.listPolicies(),
      LeaveQuery.listBalances(ids, year),
      LeaveQuery.listBalances(ids, year - 1),
    ]);
    const balances = projectBalances(employees, policies, rows, previous, year);
    const entitled = balances.reduce((sum, b) => sum + b.entitled, 0);
    const taken = balances.reduce((sum, b) => sum + b.taken, 0);
    return {
      year,
      balances,
      utilisationPct: entitled > 0 ? Math.round((taken / entitled) * 1000) / 10 : 0,
      page: page.page,
      limit: page.limit,
      total,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ---------------------------------------------------------------- policies
const toPolicyView = (policy: ILeavePolicy) => ({
  type: policy.type,
  annualDays: days(policy.annualHalfDays),
  carryForward: policy.carryForward,
});

const getPolicies = async () => {
  try {
    return { policies: (await LeaveQuery.listPolicies()).map(toPolicyView) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const setPolicies = async (input: unknown) => {
  try {
    const body = parseBody(input);
    if (!Array.isArray(body.policies) || body.policies.length === 0 || body.policies.length > LEAVE_TYPES.length) {
      throw new CustomException("policies must list one entry per leave type.", badRequest);
    }
    const seen = new Set<string>();
    const policies: ILeavePolicy[] = body.policies.map((raw: unknown) => {
      const entry = parseBody(raw);
      const type = oneOf(entry.type, LEAVE_TYPES, "type");
      if (seen.has(type)) throw new CustomException(`${type} is listed twice.`, badRequest);
      seen.add(type);
      const annualDays = entry.annualDays;
      if (typeof annualDays !== "number" || !Number.isFinite(annualDays) || annualDays < 0 || annualDays > MAX_POLICY_DAYS || annualDays * 2 !== Math.round(annualDays * 2)) {
        throw new CustomException(`annualDays must be from 0 to ${MAX_POLICY_DAYS}, in steps of half a day.`, badRequest);
      }
      return {
        type,
        annualHalfDays: wholeNumber(annualDays * 2, "annualDays", 0, MAX_POLICY_DAYS * 2),
        carryForward: entry.carryForward === undefined ? false : parseBoolean(entry.carryForward, "carryForward"),
      };
    });
    await inHrTransaction((tx) => LeaveQuery.upsertPolicies(policies, tx));
    return await getPolicies();
  } catch (error) {
    throw toCustomException(error);
  }
};

export const LeaveService = {
  createRequest,
  withdraw,
  approve,
  reject,
  list,
  getById,
  countPending,
  calendar,
  balancesFor,
  listBalances,
  getPolicies,
  setPolicies,
};
