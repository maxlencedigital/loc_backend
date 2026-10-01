import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import { AttendanceQuery } from "../Queries/Attendance.Query.js";
import { EmployeeQuery, UNASSIGNED_STORE } from "../Queries/Employee.Query.js";
import { HolidayQuery } from "../Queries/Holiday.Query.js";
import { LeaveQuery } from "../Queries/Leave.Query.js";
import { addDays, businessToday } from "../Utils/HrDate.js";
import { narrowScope } from "./Employee.Service.js";
import { countOpenGrievances, countOverdueTraining } from "./PeopleSummary.js";

const ATTRITION_WINDOW_DAYS = 90;

// Everything is a SQL aggregate over the caller's scope; no employee rows are loaded.
const getSummary = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const effective = narrowScope(scope, query.storeId);
    const today = businessToday();
    const since = addDays(today, -ATTRITION_WINDOW_DAYS);
    const [headcount, expected, holidays, present, onLeave, pending, exits, openGrievances, overdueTraining] = await Promise.all([
      EmployeeQuery.headcount(effective),
      EmployeeQuery.countExpectedByStore(effective, today),
      HolidayQuery.inRange(today, today),
      AttendanceQuery.countRecorded(effective, today),
      LeaveQuery.countOnLeave(effective, today),
      LeaveQuery.countByStatus(effective, "pending"),
      EmployeeQuery.countExitsSince(effective, since),
      countOpenGrievances(effective),
      countOverdueTraining(effective),
    ]);

    // Expected at work: everyone on the books, less stores a holiday closes today.
    const closedAll = holidays.some((h) => h.type !== "store");
    const closedStores = new Set(holidays.filter((h) => h.type === "store").flatMap((h) => h.storeIds));
    const expectedToday = closedAll
      ? 0
      : Object.entries(expected).reduce((sum, [store, n]) => sum + (closedStores.has(store) && store !== UNASSIGNED_STORE ? 0 : n), 0);
    const total = Object.values(headcount.byType).reduce((sum, n) => sum + n, 0);

    return {
      headcount: total,
      presentToday: present,
      onLeave,
      absentToday: Math.max(0, expectedToday - present - onLeave),
      openGrievances,
      overdueTraining,
      pendingLeaveRequests: pending,
      byType: headcount.byType,
      byStatus: headcount.byStatus,
      ...(effective ? {} : { byStore: headcount.byStore }),
      exitsLast90Days: exits,
      attritionRate90dPct: total + exits > 0 ? Math.round((exits / (total + exits)) * 1000) / 10 : 0,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const HrSummaryService = { getSummary };
