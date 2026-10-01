import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { notFound } from "../../commons/Utils/StatusCode.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import { EmployeeStatus, EmployeeType, IEmployee, IEmployeeRef } from "../Models/Hr/Employee.Interface.js";
import { EmployeeQuery } from "../Queries/Employee.Query.js";
import { isUuid } from "../Utils/Uuid.js";

export const EMPLOYEE_NOT_FOUND = "Employee not found.";
const DEFAULT_ID_LIMIT = 500;
const MAX_ID_LIMIT = 1000;

export const toEmployeeRef = (employee: IEmployee): IEmployeeRef => ({
  id: employee.id,
  code: employee.code,
  name: employee.name,
  employeeType: employee.employeeType,
  storeId: employee.storeId,
  role: employee.role,
  designation: employee.designation,
  status: employee.status,
  gatewayUserId: employee.gatewayUserId,
  reportingTo: employee.reportingTo,
  joinDate: employee.joinDate,
});

/** The employee record linked to a login (gateway user id), or null when there is none. */
const findEmployeeByUserId = async (userId: string): Promise<IEmployeeRef | null> => {
  try {
    if (!isUuid(userId)) return null;
    const employee = await EmployeeQuery.findByGatewayUserId(userId);
    return employee ? toEmployeeRef(employee) : null;
  } catch (error) {
    throw toCustomException(error);
  }
};

/** The employee, or a 404 when the id is unknown or outside the caller's store scope. */
const assertEmployeeInScope = async (employeeId: string, scope: StoreScope): Promise<IEmployeeRef> => {
  try {
    const employee = isUuid(employeeId) ? await EmployeeQuery.findById(employeeId, scope) : null;
    if (!employee) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
    return toEmployeeRef(employee);
  } catch (error) {
    throw toCustomException(error);
  }
};

interface ListOptions {
  statuses?: EmployeeStatus[];
  types?: EmployeeType[];
  /** Default 500, at most 1000: callers page through with `offset`. */
  limit?: number;
  offset?: number;
}

/** Employee ids in scope, ordered by id so paging is stable. Bounded: never the whole table. */
const listEmployeeIds = async (scope: StoreScope, options: ListOptions = {}): Promise<string[]> => {
  try {
    return await EmployeeQuery.listIds(scope, {
      statuses: options.statuses,
      types: options.types,
      offset: Math.max(0, options.offset ?? 0),
      limit: Math.min(Math.max(1, options.limit ?? DEFAULT_ID_LIMIT), MAX_ID_LIMIT),
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

// The small, stable surface other HR packages (training, performance, pay, grievances,
// employee self-service) build on. Everything else about an employee stays in this package.
export const EmployeeAccess = { findEmployeeByUserId, assertEmployeeInScope, listEmployeeIds };
export { findEmployeeByUserId, assertEmployeeInScope, listEmployeeIds };
