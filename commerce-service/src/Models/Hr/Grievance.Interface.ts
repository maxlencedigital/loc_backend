// Plain domain types for grievances and HR requests. No ORM types in here.

export const GRIEVANCE_CATEGORIES = ["harassment", "pay", "workload", "safety", "management", "discrimination", "other"] as const;
export type GrievanceCategory = (typeof GRIEVANCE_CATEGORIES)[number];

export const GRIEVANCE_STATUSES = ["open", "assigned", "in_progress", "escalated", "closed"] as const;
export type GrievanceStatus = (typeof GRIEVANCE_STATUSES)[number];

export const NOTE_KINDS = ["comment", "assignment", "escalation", "closure"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const REQUEST_CATEGORIES = ["leave_policy", "payroll", "documents", "benefits", "other"] as const;
export type RequestCategory = (typeof REQUEST_CATEGORIES)[number];

export const REQUEST_STATUSES = ["open", "answered", "closed"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface IGrievance {
  id: string;
  employeeId: string;
  againstEmployeeId: string | null;
  category: GrievanceCategory;
  description: string;
  anonymous: boolean;
  confidential: boolean;
  status: GrievanceStatus;
  assigneeId: string | null;
  assignedAt: Date | null;
  raisedAt: Date;
  firstResponseDueAt: Date;
  resolutionDueAt: Date;
  firstResponseAt: Date | null;
  escalatedAt: Date | null;
  escalationReason: string | null;
  closedAt: Date | null;
  outcome: string | null;
  closedByName: string | null;
}

export type IGrievanceCreate = Pick<
  IGrievance,
  | "employeeId"
  | "againstEmployeeId"
  | "category"
  | "description"
  | "anonymous"
  | "confidential"
  | "firstResponseDueAt"
  | "resolutionDueAt"
>;

/** Which cases a viewer may see. `null` fields mean "no restriction on that field". */
export interface IGrievanceVisibility {
  /** Only cases raised by these employees (a store's people, or the person themself). */
  employeeIds: string[] | null;
  /** Hide confidential cases. */
  nonConfidentialOnly: boolean;
  /** Hide cases filed against this employee. */
  notAgainst: string | null;
}

export interface IGrievanceFilter {
  visibility: IGrievanceVisibility;
  status?: GrievanceStatus;
  category?: GrievanceCategory;
  assigneeId?: string;
  from?: Date;
  to?: Date;
  offset: number;
  limit: number;
}

export interface IGrievanceNote {
  id: string;
  grievanceId: string;
  kind: NoteKind;
  message: string;
  internal: boolean;
  authorName: string;
  createdAt: Date;
}

export interface INoteCreate {
  grievanceId: string;
  kind: NoteKind;
  message: string;
  internal: boolean;
  authorName: string;
  authorUserId: string | null;
}

export interface IHrRequest {
  id: string;
  employeeId: string;
  category: RequestCategory;
  message: string;
  status: RequestStatus;
  response: string | null;
  respondedAt: Date | null;
  respondedByName: string | null;
  closedAt: Date | null;
  closeNote: string | null;
  createdAt: Date;
}

export interface IRequestFilter {
  employeeIds: string[] | null;
  employeeId?: string;
  status?: RequestStatus;
  category?: RequestCategory;
  offset: number;
  limit: number;
}
