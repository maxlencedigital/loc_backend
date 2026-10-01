import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import {
  EMPLOYEE_STATUSES,
  EMPLOYEE_TYPES,
  EmployeeStatus,
  IEmployee,
  IEmployeeCreate,
  IEmployeeUpdate,
  IHistoryEntryCreate,
} from "../Models/Hr/Employee.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { EmployeeQuery } from "../Queries/Employee.Query.js";
import { inHrTransaction } from "../Queries/Hr.Transaction.js";
import { OnboardingQuery } from "../Queries/Onboarding.Query.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { encryptField } from "../Utils/FieldCipher.js";
import { addDays, businessToday, parseDate } from "../Utils/HrDate.js";
import { isCleared, nullableText, parseEmail, parsePhone, parseUuid } from "../Utils/HrInput.js";
import { oneOf, optionalOneOf, optionalText, parseBody, queryString, text } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { EMPLOYEE_NOT_FOUND } from "./EmployeeAccess.js";
import { toEmployeeView } from "./EmployeeView.js";
import { GatewayUsers } from "./GatewayUsers.js";
import { actorName, canSeeSensitive } from "./HrActor.js";
import { resolveTemplate } from "./Onboarding.Service.js";

const CODE_PREFIX = "EMP-";
const MAX_JOIN_AHEAD_DAYS = 90;
const MIN_AGE_YEARS = 14;
const MAX_AGE_YEARS = 80;
const REPORTING_CHAIN_LIMIT = 10;
const STORE_REQUIRED: readonly string[] = ["staff", "manager"];
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_PATTERN = /^\d{6,20}$/;

// Where a person may move by editing. Leaving (exited) has its own action, and coming
// back has another, because both touch the login account as well.
const TRANSITIONS: Record<EmployeeStatus, readonly EmployeeStatus[]> = {
  active: ["on_leave", "notice"],
  on_leave: ["active", "notice"],
  notice: ["active", "on_leave"],
  exited: [],
};

export const canMoveStatus = (from: EmployeeStatus, to: EmployeeStatus): boolean =>
  from === to || TRANSITIONS[from].includes(to);

type Viewer = Pick<RequestUser, "role">;

interface BankInput {
  holderName: string;
  last4: string;
  encrypted: string;
  ifsc: string;
}

const parseBank = (value: unknown): BankInput => {
  const bank = parseBody(value);
  const accountNumber = text(bank.accountNumber, "bankAccount.accountNumber", 20).replace(/\s/g, "");
  const ifsc = text(bank.ifsc, "bankAccount.ifsc", 11).toUpperCase();
  if (!ACCOUNT_PATTERN.test(accountNumber)) throw new CustomException("bankAccount.accountNumber must be 6 to 20 digits.", badRequest);
  if (!IFSC_PATTERN.test(ifsc)) throw new CustomException("bankAccount.ifsc is not a valid IFSC code.", badRequest);
  return {
    holderName: text(bank.holderName, "bankAccount.holderName", 80),
    last4: accountNumber.slice(-4),
    encrypted: encryptField(accountNumber),
    ifsc,
  };
};

const bankColumns = (bank: BankInput | null) => ({
  bankHolderName: bank?.holderName ?? null,
  bankAccountLast4: bank?.last4 ?? null,
  bankAccountEnc: bank?.encrypted ?? null,
  bankIfsc: bank?.ifsc ?? null,
});

const emergencyColumns = (value: unknown) => {
  if (value === null) return { emergencyName: null, emergencyPhone: null, emergencyRelation: null };
  const contact = parseBody(value);
  return {
    emergencyName: text(contact.name, "emergencyContact.name", 80),
    emergencyPhone: parsePhone(contact.phone, "emergencyContact.phone"),
    emergencyRelation: optionalText(contact.relation, "emergencyContact.relation", 40) ?? null,
  };
};

const parseJoinDate = (value: unknown, today: Date): Date => {
  const joinDate = parseDate(value, "joinDate");
  if (joinDate > addDays(today, MAX_JOIN_AHEAD_DAYS) || joinDate.getUTCFullYear() < 1990) {
    throw new CustomException(`joinDate must be a recent date, at most ${MAX_JOIN_AHEAD_DAYS} days ahead.`, badRequest);
  }
  return joinDate;
};

const parseBirthDate = (value: unknown, today: Date): Date => {
  const born = parseDate(value, "dateOfBirth");
  const age = (today.getTime() - born.getTime()) / (365.25 * 86_400_000);
  if (age < MIN_AGE_YEARS || age > MAX_AGE_YEARS) {
    throw new CustomException(`dateOfBirth must make the employee ${MIN_AGE_YEARS} to ${MAX_AGE_YEARS} years old.`, badRequest);
  }
  return born;
};

const assertAssignableStore = async (storeId: string): Promise<void> => {
  const store = await StoreQuery.findById(storeId, null);
  if (!store) throw new CustomException("That store does not exist.", badRequest);
  if (store.status === "closed") throw new CustomException("That store is closed.", badRequest);
};

const assertReportingLine = async (employeeId: string | null, managerId: string, db?: Parameters<typeof EmployeeQuery.findById>[2]) => {
  let cursor: string | null = managerId;
  for (let hop = 0; cursor && hop < REPORTING_CHAIN_LIMIT; hop += 1) {
    if (cursor === employeeId) throw new CustomException("An employee cannot report to themself, directly or through others.", badRequest);
    const boss: IEmployee | null = await EmployeeQuery.findById(cursor, null, db);
    if (!boss) throw new CustomException("reportingTo is not an employee.", badRequest);
    if (hop === 0 && boss.status === "exited") throw new CustomException("reportingTo has left the company.", badRequest);
    cursor = boss.reportingTo;
  }
};

const translateConflict = (error: unknown): never => {
  if (isUniqueViolation(error, "phone")) throw new CustomException("An employee with this phone number already exists.", conflict);
  if (isUniqueViolation(error, "gatewayUserId")) {
    throw new CustomException("That login account is already linked to another employee.", conflict);
  }
  throw error;
};

const requireStoreForType = (employeeType: string, storeId: string | null) => {
  if (STORE_REQUIRED.includes(employeeType) && !storeId) {
    throw new CustomException("storeId is required for staff and manager employees.", badRequest);
  }
};

// One search/list effective scope: a store-bound caller is pinned to their store; HR and
// admins may narrow with ?storeId. A store outside a pinned scope simply does not exist.
export const narrowScope = (scope: StoreScope, requested: unknown): StoreScope => {
  const storeId = queryString(requested, "storeId");
  if (storeId === undefined) return scope;
  if (!isUuid(storeId) || (scope && scope !== storeId)) throw new CustomException("Store not found.", notFound);
  return storeId;
};

const list = async (scope: StoreScope, viewer: Viewer, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await EmployeeQuery.search({
      storeId: narrowScope(scope, query.storeId),
      employeeType: optionalOneOf(queryString(query.employeeType, "employeeType"), EMPLOYEE_TYPES, "employeeType"),
      status: optionalOneOf(queryString(query.status, "status"), EMPLOYEE_STATUSES, "status"),
      q: optionalText(queryString(query.q, "q"), "q", 80),
      offset: page.offset,
      limit: page.limit,
    });
    const sensitive = canSeeSensitive(viewer.role);
    return toPage(items.map((employee) => toEmployeeView(employee, sensitive)), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getById = async (id: string, scope: StoreScope, viewer: Viewer) => {
  try {
    const employee = isUuid(id) ? await EmployeeQuery.findById(id, scope) : null;
    if (!employee) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
    return toEmployeeView(employee, canSeeSensitive(viewer.role));
  } catch (error) {
    throw toCustomException(error);
  }
};

const historyRows = (
  before: Pick<IEmployee, "designation" | "role" | "employeeType" | "storeId" | "payGrade" | "reportingTo" | "status">,
  after: typeof before,
  context: Omit<IHistoryEntryCreate, "field" | "fromValue" | "toValue">
): IHistoryEntryCreate[] => {
  const fields = [
    ["designation", before.designation, after.designation],
    ["role", before.role, after.role],
    ["employee_type", before.employeeType, after.employeeType],
    ["store", before.storeId, after.storeId],
    ["pay_grade", before.payGrade, after.payGrade],
    ["reporting_to", before.reportingTo, after.reportingTo],
    ["status", before.status, after.status],
  ] as const;
  return fields
    .filter(([, from, to]) => from !== to)
    .map(([field, from, to]) => ({ ...context, field, fromValue: from, toValue: to }));
};

// The first rows of the career history: what the person started with.
const startingRows = (
  employee: IEmployee,
  context: Omit<IHistoryEntryCreate, "field" | "fromValue" | "toValue">
): IHistoryEntryCreate[] =>
  (
    [
      ["role", employee.role],
      ["employee_type", employee.employeeType],
      ["store", employee.storeId],
      ["designation", employee.designation],
      ["pay_grade", employee.payGrade],
    ] as const
  )
    .filter(([, value]) => value !== null)
    .map(([field, value]) => ({ ...context, field, fromValue: null, toValue: value }));

const create = async (user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const today = businessToday();
    const employeeType = oneOf(body.employeeType, EMPLOYEE_TYPES, "employeeType");
    const storeId = body.storeId === undefined || isCleared(body.storeId) ? null : parseUuid(body.storeId, "storeId");
    requireStoreForType(employeeType, storeId);
    const status = optionalOneOf(body.status, EMPLOYEE_STATUSES, "status") ?? "active";
    if (status === "exited") throw new CustomException("A new employee cannot start as exited.", badRequest);
    const data: IEmployeeCreate = {
      name: text(body.name, "name", 80),
      employeeType,
      phone: parsePhone(body.phone),
      email: body.email === undefined || isCleared(body.email) ? null : parseEmail(body.email),
      storeId,
      role: text(body.role, "role", 60),
      designation: optionalText(body.designation, "designation", 60) ?? null,
      payGrade: optionalText(body.payGrade, "payGrade", 20) ?? null,
      joinDate: parseJoinDate(body.joinDate, today),
      dateOfBirth: body.dateOfBirth === undefined || isCleared(body.dateOfBirth) ? null : parseBirthDate(body.dateOfBirth, today),
      address: optionalText(body.address, "address", 300) ?? null,
      ...(body.emergencyContact === undefined
        ? { emergencyName: null, emergencyPhone: null, emergencyRelation: null }
        : emergencyColumns(body.emergencyContact)),
      ...bankColumns(body.bankAccount === undefined || body.bankAccount === null ? null : parseBank(body.bankAccount)),
      gatewayUserId: body.gatewayUserId === undefined || isCleared(body.gatewayUserId) ? null : parseUuid(body.gatewayUserId, "gatewayUserId"),
      reportingTo: body.reportingTo === undefined || isCleared(body.reportingTo) ? null : parseUuid(body.reportingTo, "reportingTo"),
      status,
    };
    if (storeId) await assertAssignableStore(storeId);
    if (data.reportingTo) await assertReportingLine(null, data.reportingTo);
    if (data.gatewayUserId) await GatewayUsers.verifyLinkable(data.gatewayUserId);
    const template = await resolveTemplate(data.role);
    const by = { changedByUserId: user.id, changedByName: actorName(user), reason: null };

    try {
      const created = await inHrTransaction(async (tx) => {
        const code = `${CODE_PREFIX}${String(await EmployeeQuery.nextCodeNumber(tx)).padStart(5, "0")}`;
        const employee = await EmployeeQuery.create(data, code, tx);
        await OnboardingQuery.createItems(employee.id, template, tx);
        // The starting values are the first rows of the career history.
        await EmployeeQuery.appendHistory(
          startingRows(employee, { ...by, employeeId: employee.id, effectiveDate: employee.joinDate }),
          tx
        );
        return employee;
      });
      return toEmployeeView(created, canSeeSensitive(user.role));
    } catch (error) {
      return translateConflict(error);
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const update = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    if (!isUuid(id)) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
    const body = parseBody(input);
    const today = businessToday();
    const patch: IEmployeeUpdate = {};
    if (body.name !== undefined) patch.name = text(body.name, "name", 80);
    if (body.employeeType !== undefined) patch.employeeType = oneOf(body.employeeType, EMPLOYEE_TYPES, "employeeType");
    if (body.phone !== undefined) patch.phone = parsePhone(body.phone);
    if (body.email !== undefined) patch.email = isCleared(body.email) ? null : parseEmail(body.email);
    if (body.storeId !== undefined) patch.storeId = isCleared(body.storeId) ? null : parseUuid(body.storeId, "storeId");
    if (body.role !== undefined) patch.role = text(body.role, "role", 60);
    const designation = nullableText(body.designation, "designation", 60);
    if (designation !== undefined) patch.designation = designation;
    const payGrade = nullableText(body.payGrade, "payGrade", 20);
    if (payGrade !== undefined) patch.payGrade = payGrade;
    if (body.joinDate !== undefined) patch.joinDate = parseJoinDate(body.joinDate, today);
    if (body.dateOfBirth !== undefined) patch.dateOfBirth = isCleared(body.dateOfBirth) ? null : parseBirthDate(body.dateOfBirth, today);
    const address = nullableText(body.address, "address", 300);
    if (address !== undefined) patch.address = address;
    if (body.emergencyContact !== undefined) Object.assign(patch, emergencyColumns(isCleared(body.emergencyContact) ? null : body.emergencyContact));
    if (body.bankAccount !== undefined) Object.assign(patch, bankColumns(isCleared(body.bankAccount) ? null : parseBank(body.bankAccount)));
    if (body.gatewayUserId !== undefined) {
      patch.gatewayUserId = isCleared(body.gatewayUserId) ? null : parseUuid(body.gatewayUserId, "gatewayUserId");
    }
    if (body.reportingTo !== undefined) patch.reportingTo = isCleared(body.reportingTo) ? null : parseUuid(body.reportingTo, "reportingTo");
    if (body.status !== undefined) {
      patch.status = oneOf(body.status, EMPLOYEE_STATUSES, "status");
      if (patch.status === "exited") throw new CustomException("Use the deactivate action to record that someone has left.", badRequest);
    }

    if (patch.storeId) await assertAssignableStore(patch.storeId);
    if (patch.gatewayUserId) await GatewayUsers.verifyLinkable(patch.gatewayUserId);

    try {
      const updated = await inHrTransaction(async (tx) => {
        // The lock makes read-compare-write safe: the history rows are computed from
        // exactly the values this update replaces.
        const current = await EmployeeQuery.lockById(id, scope, tx);
        if (!current) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
        if (current.status === "exited") throw new CustomException("This employee has left. Reactivate them before editing.", badRequest);
        if (patch.status && !canMoveStatus(current.status, patch.status)) {
          throw new CustomException(`An employee who is ${current.status.replace("_", " ")} cannot be set to ${patch.status.replace("_", " ")}.`, badRequest);
        }
        const merged = { ...current, ...patch };
        requireStoreForType(merged.employeeType, merged.storeId);
        if (patch.reportingTo) await assertReportingLine(current.id, patch.reportingTo, tx);
        const rows = historyRows(current, merged, {
          employeeId: current.id,
          effectiveDate: today,
          reason: null,
          changedByUserId: user.id,
          changedByName: actorName(user),
        });
        const saved = await EmployeeQuery.update(current.id, patch, tx);
        await EmployeeQuery.appendHistory(rows, tx);
        return saved;
      });
      return toEmployeeView(updated, canSeeSensitive(user.role));
    } catch (error) {
      return translateConflict(error);
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const deactivate = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    if (!isUuid(id)) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
    const body = parseBody(input);
    const lastWorkingDay = parseDate(body.lastWorkingDay, "lastWorkingDay");
    const reason = optionalText(body.reason, "reason", 300) ?? null;
    const today = businessToday();
    const left = await inHrTransaction(async (tx) => {
      const current = await EmployeeQuery.lockById(id, scope, tx);
      if (!current) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
      if (current.status === "exited") throw new CustomException("This employee has already left.", conflict);
      if (lastWorkingDay < current.joinDate) throw new CustomException("lastWorkingDay cannot be before the join date.", badRequest);
      if (lastWorkingDay > today) {
        throw new CustomException("lastWorkingDay is in the future. Set the status to notice until the last day has passed.", badRequest);
      }
      const saved = await EmployeeQuery.update(current.id, { status: "exited", lastWorkingDay, exitReason: reason }, tx);
      await EmployeeQuery.appendHistory(
        [{
          employeeId: current.id,
          field: "status",
          fromValue: current.status,
          toValue: "exited",
          effectiveDate: lastWorkingDay,
          reason,
          changedByUserId: user.id,
          changedByName: actorName(user),
        }],
        tx
      );
      return saved;
    });
    // After the commit: a login that cannot be switched off is reported, never rolled back into HR's record.
    const loginDisabled = left.gatewayUserId ? await GatewayUsers.setLoginActive(left.gatewayUserId, false) : null;
    return { ...toEmployeeView(left, canSeeSensitive(user.role)), loginDisabled };
  } catch (error) {
    throw toCustomException(error);
  }
};

const reactivate = async (id: string, scope: StoreScope, user: RequestUser) => {
  try {
    if (!isUuid(id)) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
    const today = businessToday();
    const back = await inHrTransaction(async (tx) => {
      const current = await EmployeeQuery.lockById(id, scope, tx);
      if (!current) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
      if (current.status !== "exited") throw new CustomException("This employee has not left.", conflict);
      const saved = await EmployeeQuery.update(current.id, { status: "active", lastWorkingDay: null, exitReason: null }, tx);
      await EmployeeQuery.appendHistory(
        [{
          employeeId: current.id,
          field: "status",
          fromValue: "exited",
          toValue: "active",
          effectiveDate: today,
          reason: null,
          changedByUserId: user.id,
          changedByName: actorName(user),
        }],
        tx
      );
      return saved;
    });
    const loginEnabled = back.gatewayUserId ? await GatewayUsers.setLoginActive(back.gatewayUserId, true) : null;
    return { ...toEmployeeView(back, canSeeSensitive(user.role)), loginEnabled };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const EmployeeService = { list, getById, create, update, deactivate, reactivate };
