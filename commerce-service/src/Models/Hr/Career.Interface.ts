export const GOAL_STATUSES = ["planned", "in_progress", "done"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export interface ICareerGoal {
  title: string;
  targetDate: string | null;
  status: GoalStatus;
}

export interface IAgreedAction {
  action: string;
  owner: string | null;
  dueDate: string | null;
}

export interface ICareerPlan {
  employeeId: string;
  targetRole: string | null;
  goals: ICareerGoal[];
  skillGaps: string[];
  agreedActions: IAgreedAction[];
  lastReviewedAt: Date | null;
}

export interface ICareerPath {
  role: string;
  nextRoles: string[];
  requirements: string[];
}

export interface IDailyReportCreate {
  employeeId: string;
  storeId: string | null;
  date: Date;
  summary: string;
  completed: string[];
  blockers: string | null;
  blockerKey: string | null;
  minutesWorked: number | null;
}

export interface IDailyReport extends IDailyReportCreate {
  id: string;
  employeeName: string;
  createdAt: Date;
}

export interface IDailyReportFilter {
  storeId: string | null;
  employeeId?: string;
  from?: Date;
  to?: Date;
  offset: number;
  limit: number;
}

export interface IBlockerTheme {
  key: string;
  count: number;
}

export interface IReassignmentCreate {
  fromEmployeeId: string;
  toEmployeeId: string;
  date: Date;
  workItemIds: string[];
  byUserId: string | null;
  byName: string;
}
