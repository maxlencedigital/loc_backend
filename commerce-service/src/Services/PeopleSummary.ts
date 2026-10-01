import type { StoreScope } from "../Middleware/StoreScope.js";
import { TrainingQuery } from "../Queries/Training.Query.js";
import { businessToday } from "../Utils/HrDate.js";
import { GrievanceService } from "./Grievance.Service.js";
import { employeeIdsInScope } from "./PeopleScope.js";

// The two counters the HR summary shows for the people modules. Both are single SQL counts.

/** Assignments past their date (or a lapsed completion) for people still working in scope. */
export const countOverdueTraining = async (scope: StoreScope): Promise<number> => {
  const { ids } = await employeeIdsInScope(scope, { activeOnly: true });
  return await TrainingQuery.countOverdue(ids, businessToday());
};

/** Grievances not yet closed; a store-bound view counts only the non-confidential ones. */
export const countOpenGrievances = (scope: StoreScope): Promise<number> => GrievanceService.countOpen(scope);
