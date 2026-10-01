// Plain domain types for appraisals and the performance record. No ORM types in here.

export const APPRAISAL_STATUSES = ["scheduled", "in_progress", "completed"] as const;
export type AppraisalStatus = (typeof APPRAISAL_STATUSES)[number];

export const APPRAISAL_OUTCOMES = ["promoted", "increment", "no_change", "improvement_plan", "other"] as const;
export type AppraisalOutcome = (typeof APPRAISAL_OUTCOMES)[number];

export const RATING_MIN = 1;
export const RATING_MAX = 5;

export interface IAppraisal {
  id: string;
  employeeId: string;
  cycle: string;
  scheduledFor: Date;
  reviewerId: string | null;
  status: AppraisalStatus;
  rating: number | null;
  strengths: string | null;
  improvements: string | null;
  goals: string[];
  conductedAt: Date | null;
  conductedByName: string | null;
  outcome: AppraisalOutcome | null;
  outcomeNote: string | null;
  completedAt: Date | null;
  completedByName: string | null;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAppraisalCreate {
  employeeId: string;
  cycle: string;
  scheduledFor: Date;
  reviewerId: string | null;
  createdByName: string;
}

export interface IAppraisalFilter {
  employeeIds: string[] | null;
  employeeId?: string;
  status?: AppraisalStatus;
  cycle?: string;
  offset: number;
  limit: number;
}

export interface IConduct {
  rating: number;
  strengths: string | null;
  improvements: string | null;
  goals: string[];
  conductedAt: Date;
  conductedByName: string;
}

/** A rated appraisal reduced to what scoring needs. */
export interface IRatingRow {
  employeeId: string;
  rating: number;
  conductedAt: Date;
}

/** Everything the score of one person for one period is computed from. */
export interface IPerformanceInputs {
  employeeId: string;
  present: number;
  late: number;
  /** Working days in the period less holidays and approved leave. */
  expectedDays: number;
  trainingDue: number;
  trainingDone: number;
  /** Ratings of appraisals conducted in the period, newest first. */
  ratings: number[];
}

export interface IMetric {
  name: string;
  target: number;
  actual: number;
  trend: "up" | "flat" | "down";
}
