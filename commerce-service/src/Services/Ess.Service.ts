import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { EssOperation } from "../Models/Ess/Ess.Interface.js";
import { IEmployeeRef } from "../Models/Hr/Employee.Interface.js";
import { EmployeeQuery } from "../Queries/Employee.Query.js";
import { EssIdempotencyQuery } from "../Queries/EssIdempotency.Query.js";
import { EssIncidentQuery } from "../Queries/EssIncident.Query.js";
import { AttendanceService } from "./Attendance.Service.js";
import { CareerService } from "./Career.Service.js";
import { CoverReportService } from "./CoverReport.Service.js";
import { EmployeeAccess } from "./EmployeeAccess.js";
import { EmployeeService } from "./Employee.Service.js";
import { toEmployeeView } from "./EmployeeView.js";
import { GrievanceService } from "./Grievance.Service.js";
import { HrRequestService } from "./HrRequest.Service.js";
import { LeaveService } from "./Leave.Service.js";
import { PayService } from "./Pay.Service.js";
import { PerformanceService } from "./Performance.Service.js";
import { TrainingService } from "./Training.Service.js";
import { formatDate } from "../Utils/HrDate.js";
import { idempotencyKeyOf } from "../Utils/PeopleInput.js";
import { parseBody } from "../Utils/Input.js";

// Employee self-service: every call resolves the caller's own employee record from their login and
// hands only that record to the HR services, which apply the rules. No id of a person is ever taken
// from the request, so there is nothing to forge: other people's rows are simply not reachable.

export const NO_EMPLOYEE_RECORD = "No employee record is linked to your login. Please ask HR to link it.";
const STALE_CLAIM_MS = 2 * 60 * 1000;
const MY_APPRAISALS_CAP = 50;
const PROFILE_FIELDS = ["phone", "email", "address", "emergencyContact"] as const;

const resolveSelf = async (userId: string): Promise<IEmployeeRef> => {
  const employee = await EmployeeAccess.findEmployeeByUserId(userId);
  if (!employee) throw new CustomException(NO_EMPLOYEE_RECORD, notFound);
  return employee;
};

// Only the named keys of a query reach the HR services (never an employeeId or storeId from the client).
const pick = (query: Record<string, unknown> | undefined, keys: string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (query?.[key] !== undefined) out[key] = query[key];
  return out;
};

const coordinate = (value: unknown, field: string, limit: number) => {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) {
    throw new CustomException(`${field} must be a number between -${limit} and ${limit}.`, badRequest);
  }
};

// The position is checked but not stored: the HR attendance record has no place for it.
const checkPosition = (body: Record<string, unknown>) => {
  coordinate(body.latitude, "latitude", 90);
  coordinate(body.longitude, "longitude", 180);
};

// Runs `create` once per (employee, operation, key). A replay returns the original record through `fetch`;
// a retry that arrives while the first is still running is a 409; a failed first attempt frees the key.
const createOnce = async <T>(
  employeeId: string,
  operation: EssOperation,
  rawKey: unknown,
  create: () => Promise<{ id: string }>,
  fetch: (id: string) => Promise<T>
): Promise<{ replayed: boolean; result: T | { id: string } }> => {
  const key = idempotencyKeyOf(rawKey);
  if (key === null) return { replayed: false, result: await create() };

  let claim = await EssIdempotencyQuery.insert(employeeId, operation, key);
  if (!claim) {
    const existing = await EssIdempotencyQuery.find(employeeId, operation, key);
    if (existing?.resourceId) return { replayed: true, result: await fetch(existing.resourceId) };
    const freed = await EssIdempotencyQuery.releaseStale(employeeId, operation, key, new Date(Date.now() - STALE_CLAIM_MS));
    claim = freed ? await EssIdempotencyQuery.insert(employeeId, operation, key) : null;
    if (!claim) throw new CustomException("The first request with this Idempotency-Key is still being processed.", conflict);
  }
  try {
    const created = await create();
    await EssIdempotencyQuery.setResource(claim.id, created.id);
    return { replayed: false, result: created };
  } catch (error) {
    await EssIdempotencyQuery.release(claim.id);
    throw error;
  }
};

// ------------------------------------------------------------ attendance and leave
const getMyAttendance = async (userId: string, query: Record<string, unknown>) => {
  try {
    const me = await resolveSelf(userId);
    return await AttendanceService.getEmployeeMonth(me.id, null, pick(query, ["month"]));
  } catch (error) {
    throw toCustomException(error);
  }
};

const clockIn = async (userId: string, input: unknown) => {
  try {
    const body = parseBody(input ?? {});
    checkPosition(body);
    const me = await resolveSelf(userId);
    return await AttendanceService.clockIn(me, pick(body, ["storeId"]));
  } catch (error) {
    throw toCustomException(error);
  }
};

const clockOut = async (userId: string, input: unknown) => {
  try {
    checkPosition(parseBody(input ?? {}));
    const me = await resolveSelf(userId);
    return await AttendanceService.clockOut(me);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getMyLeaveBalance = async (userId: string) => {
  try {
    const me = await resolveSelf(userId);
    return { balances: await LeaveService.balancesFor(me) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const ownLeave = async (me: IEmployeeRef, id: string) => {
  const request = await LeaveService.getById(id, null);
  if (request.employeeId !== me.id) throw new CustomException("Leave request not found.", notFound);
  return request;
};

/** `replayed` tells the controller to answer 200 instead of 201. */
const requestLeave = async (userId: string, input: unknown, idempotencyKey: unknown) => {
  try {
    const me = await resolveSelf(userId);
    return await createOnce(me.id, "leave_request", idempotencyKey, () => LeaveService.createRequest(me, input), (id) => ownLeave(me, id));
  } catch (error) {
    throw toCustomException(error);
  }
};

const listMyLeaveRequests = async (userId: string, query: Record<string, unknown>) => {
  try {
    const me = await resolveSelf(userId);
    return await LeaveService.list(null, { ...pick(query, ["status", "page", "limit"]), employeeId: me.id });
  } catch (error) {
    throw toCustomException(error);
  }
};

const withdrawMyLeaveRequest = async (userId: string, id: string) => {
  try {
    const me = await resolveSelf(userId);
    return await LeaveService.withdraw(me, id);
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------ pay, performance, profile
const listMyAppraisals = async (userId: string, query: Record<string, unknown>) => {
  try {
    const me = await resolveSelf(userId);
    const page = parsePage(query);
    const { items } = await PerformanceService.listMine(me);
    return toPage(items.slice(page.offset, page.offset + page.limit), Math.min(items.length, MY_APPRAISALS_CAP), page);
  } catch (error) {
    throw toCustomException(error);
  }
};

// The plan and the changes to their own role, store and status. Pay grade changes, reasons and who made them stay with HR.
const getMyCareerPlan = async (userId: string) => {
  try {
    const me = await resolveSelf(userId);
    const { history, ...plan } = await CareerService.getPlan(me.id, null);
    return {
      ...plan,
      history: history.filter((h) => h.field !== "pay_grade").map(({ field, from, to, effectiveDate }) => ({ field, from, to, effectiveDate })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const getMyCompensation = async (userId: string) => {
  try {
    return await PayService.getMyCompensation(await resolveSelf(userId));
  } catch (error) {
    throw toCustomException(error);
  }
};

const getMyEarnings = async (userId: string, query: Record<string, unknown>) => {
  try {
    return await PayService.getMyEarnings(await resolveSelf(userId), pick(query, ["month"]));
  } catch (error) {
    throw toCustomException(error);
  }
};

const listMyPayouts = async (userId: string, query: Record<string, unknown>) => {
  try {
    return await PayService.listMyPayouts(await resolveSelf(userId), pick(query, ["page", "limit", "from", "to"]));
  } catch (error) {
    throw toCustomException(error);
  }
};

const getMyPerformance = async (userId: string, query: Record<string, unknown>) => {
  try {
    return await PerformanceService.getMine(await resolveSelf(userId), pick(query, ["from", "to"]));
  } catch (error) {
    throw toCustomException(error);
  }
};

// Own details, bank account masked, no pay grade or exit reason (those are HR's).
const profileOf = async (employeeId: string) => {
  const employee = await EmployeeQuery.findById(employeeId, null);
  if (!employee) throw new CustomException(NO_EMPLOYEE_RECORD, notFound);
  const view = toEmployeeView(employee, false);
  return {
    id: view.id,
    code: view.code,
    name: view.name,
    employeeType: view.employeeType,
    role: view.role,
    designation: view.designation,
    storeId: view.storeId,
    joinDate: view.joinDate,
    status: view.status,
    phone: view.phone,
    email: view.email,
    address: employee.address,
    dateOfBirth: employee.dateOfBirth ? formatDate(employee.dateOfBirth) : null,
    emergencyContact: view.emergencyContact,
    bankAccount: view.bankAccount,
  };
};

const getMyEmploymentProfile = async (userId: string) => {
  try {
    return await profileOf((await resolveSelf(userId)).id);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Whitelist: only contact details. Anything else (role, store, pay, bank, status) is refused, not ignored.
const updateMyEmploymentProfile = async (user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input ?? {});
    const unknown = Object.keys(body).filter((k) => !(PROFILE_FIELDS as readonly string[]).includes(k));
    if (unknown.length > 0) throw new CustomException(`${unknown.join(", ")} cannot be changed here. Ask HR.`, badRequest);
    const patch = pick(body, [...PROFILE_FIELDS]);
    if (Object.keys(patch).length === 0) throw new CustomException("Nothing to update.", badRequest);
    const me = await resolveSelf(user.id);
    await EmployeeService.update(me.id, null, user, patch);
    return await profileOf(me.id);
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------ reports and training
const submitMyDailyReport = async (userId: string, input: unknown) => {
  try {
    return await CoverReportService.submitDaily(await resolveSelf(userId), input);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listMyDailyReports = async (userId: string, query: Record<string, unknown>) => {
  try {
    const me = await resolveSelf(userId);
    return await CoverReportService.listForEmployee(me.id, pick(query, ["page", "limit", "from", "to"]));
  } catch (error) {
    throw toCustomException(error);
  }
};

const listMyTraining = async (userId: string) => {
  try {
    return await TrainingService.listMine(await resolveSelf(userId));
  } catch (error) {
    throw toCustomException(error);
  }
};

const startMyTraining = async (userId: string, assignmentId: string) => {
  try {
    return await TrainingService.startMine(await resolveSelf(userId), assignmentId);
  } catch (error) {
    throw toCustomException(error);
  }
};

const completeMyTraining = async (userId: string, assignmentId: string, input: unknown) => {
  try {
    return await TrainingService.completeMine(await resolveSelf(userId), assignmentId, pick(parseBody(input ?? {}), ["score"]));
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------ support and safety
// The body is limited to what the catalogue offers; who it is about and how confidential it is are not the client's to set.
const raiseMyGrievance = async (userId: string, input: unknown, idempotencyKey: unknown) => {
  try {
    const me = await resolveSelf(userId);
    const body = pick(parseBody(input), ["category", "description", "anonymous"]);
    return await createOnce(me.id, "grievance", idempotencyKey, () => GrievanceService.raise(me, body), (id) => GrievanceService.getMine(me, id));
  } catch (error) {
    throw toCustomException(error);
  }
};

const listMyGrievances = async (userId: string, query: Record<string, unknown>) => {
  try {
    return await GrievanceService.listMine(await resolveSelf(userId), pick(query, ["page", "limit", "status"]));
  } catch (error) {
    throw toCustomException(error);
  }
};

const getMyGrievance = async (userId: string, id: string) => {
  try {
    return await GrievanceService.getMine(await resolveSelf(userId), id);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listMyIncidents = async (userId: string, query: Record<string, unknown>) => {
  try {
    await resolveSelf(userId);
    const page = parsePage(query);
    const { items, total } = await EssIncidentQuery.listReportedBy(userId, page);
    return toPage(items.map((i) => ({ ...i, occurredAt: i.occurredAt.toISOString(), createdAt: i.createdAt.toISOString() })), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const sendMyHrRequest = async (userId: string, input: unknown, idempotencyKey: unknown) => {
  try {
    const me = await resolveSelf(userId);
    const body = pick(parseBody(input), ["category", "message"]);
    return await createOnce(me.id, "hr_request", idempotencyKey, () => HrRequestService.send(me, body), (id) => HrRequestService.getMine(me, id));
  } catch (error) {
    throw toCustomException(error);
  }
};

const listMyHrRequests = async (userId: string, query: Record<string, unknown>) => {
  try {
    return await HrRequestService.listMine(await resolveSelf(userId), pick(query, ["page", "limit", "status"]));
  } catch (error) {
    throw toCustomException(error);
  }
};

const getMyHrRequest = async (userId: string, id: string) => {
  try {
    return await HrRequestService.getMine(await resolveSelf(userId), id);
  } catch (error) {
    throw toCustomException(error);
  }
};

export const EssService = {
  getMyAttendance,
  clockIn,
  clockOut,
  getMyLeaveBalance,
  requestLeave,
  listMyLeaveRequests,
  withdrawMyLeaveRequest,
  listMyAppraisals,
  getMyCareerPlan,
  getMyCompensation,
  getMyEarnings,
  listMyPayouts,
  getMyPerformance,
  getMyEmploymentProfile,
  updateMyEmploymentProfile,
  submitMyDailyReport,
  listMyDailyReports,
  listMyTraining,
  startMyTraining,
  completeMyTraining,
  raiseMyGrievance,
  listMyGrievances,
  getMyGrievance,
  listMyIncidents,
  sendMyHrRequest,
  listMyHrRequests,
  getMyHrRequest,
};
