// Plain domain types for training. No ORM types in here.

export const TRAINING_CATEGORIES = ["software", "customer_handling", "safety", "compliance", "other"] as const;
export type TrainingCategory = (typeof TRAINING_CATEGORIES)[number];

export const TRAINING_STATUSES = ["assigned", "in_progress", "completed"] as const;
export type TrainingStatus = (typeof TRAINING_STATUSES)[number];

export interface ICourse {
  id: string;
  title: string;
  category: TrainingCategory;
  description: string | null;
  durationMinutes: number | null;
  materialUrl: string | null;
  validForDays: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ICourseWrite = Omit<ICourse, "id" | "createdAt" | "updatedAt">;

export interface IAssignment {
  id: string;
  employeeId: string;
  courseId: string;
  courseTitle: string;
  courseMaterialUrl: string | null;
  status: TrainingStatus;
  dueDate: Date;
  validForDays: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  scoreHundredths: number | null;
  expiresAt: Date | null;
  nextDueOn: Date | null;
  assignedByName: string;
  createdAt: Date;
}

export interface IAssignmentCreate {
  employeeId: string;
  courseId: string;
  dueDate: Date;
  validForDays: number | null;
  nextDueOn: Date;
  assignedByName: string;
}

export interface IAssignmentFilter {
  /** Employees the caller may see; null means every employee. */
  employeeIds: string[] | null;
  employeeId?: string;
  courseId?: string;
  status?: TrainingStatus;
  /** Only assignments needing attention before this date (the "overdue" filter). */
  overdueBefore?: Date;
  offset: number;
  limit: number;
}

export interface ICompletion {
  completedAt: Date;
  scoreHundredths: number | null;
  expiresAt: Date | null;
}

export interface IRequirementRow {
  roleKey: string;
  courseId: string;
}

/** A row of the overdue and refresher lists: who, which course and the date it fell due. */
export interface IDueRow {
  employeeId: string;
  courseTitle: string;
  dueOn: Date;
}
