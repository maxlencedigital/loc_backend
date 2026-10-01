import { CustomException } from "../../commons/Exception/CustomException.js";
import { notFound } from "../../commons/Utils/StatusCode.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import { EmployeeStatus, IEmployeeRef } from "../Models/Hr/Employee.Interface.js";
import { EmployeeQuery } from "../Queries/Employee.Query.js";
import { EMPLOYEE_NOT_FOUND, EmployeeAccess, toEmployeeRef } from "./EmployeeAccess.js";

// The people-modules tables hold only an employeeId, so "this store's rows" is answered
// by asking HR core which employees the store has and filtering on `employeeId in (...)`.
// A store is small; the cap keeps even a company-wide "active people only" view bounded.
const ID_PAGE = 1000;
const MAX_ID_PAGES = 5;
export const MAX_SCOPED_EMPLOYEES = ID_PAGE * MAX_ID_PAGES;

export const ACTIVE_STATUSES: EmployeeStatus[] = ["active", "on_leave", "notice"];

export interface ScopedIds {
  /** null means no restriction (every employee). */
  ids: string[] | null;
  /** True when the cap cut the list short. */
  truncated: boolean;
}

/**
 * The employees a caller may see rows of. A company-wide caller gets `null` (no filter)
 * unless `activeOnly` asks to leave out people who have left.
 */
export const employeeIdsInScope = async (scope: StoreScope, options: { activeOnly?: boolean } = {}): Promise<ScopedIds> => {
  if (!scope && !options.activeOnly) return { ids: null, truncated: false };
  const ids: string[] = [];
  for (let pageNo = 0; pageNo < MAX_ID_PAGES; pageNo += 1) {
    const page = await EmployeeAccess.listEmployeeIds(scope, {
      statuses: options.activeOnly ? ACTIVE_STATUSES : undefined,
      limit: ID_PAGE,
      offset: pageNo * ID_PAGE,
    });
    ids.push(...page);
    if (page.length < ID_PAGE) return { ids, truncated: false };
  }
  return { ids, truncated: true };
};

/** Names and placement for a page of employee ids: one query, no matter how many. */
export const directoryOf = async (ids: string[]): Promise<Map<string, IEmployeeRef>> => {
  const unique = [...new Set(ids)];
  const employees = await EmployeeQuery.findByIds(unique, null);
  return new Map(employees.map((employee) => [employee.id, toEmployeeRef(employee)]));
};

/** Every id must exist inside the caller's scope, else 404 (nothing is revealed about which one). */
export const requireEmployees = async (ids: string[], scope: StoreScope): Promise<IEmployeeRef[]> => {
  const unique = [...new Set(ids)];
  const found = await EmployeeQuery.findByIds(unique, scope);
  if (found.length !== unique.length) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
  return found.map(toEmployeeRef);
};
