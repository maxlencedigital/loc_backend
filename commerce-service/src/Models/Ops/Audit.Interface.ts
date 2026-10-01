export type AuditType = "internal" | "external";
export type AuditStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type FindingStatus = "open" | "in_progress" | "closed";
export type FindingSeverity = "low" | "medium" | "high" | "critical";
export type ChecklistResult = "pass" | "fail" | "na";

export const AUDIT_TYPES: AuditType[] = ["internal", "external"];
export const AUDIT_STATUSES: AuditStatus[] = ["scheduled", "in_progress", "completed", "cancelled"];
export const FINDING_SEVERITIES: FindingSeverity[] = ["low", "medium", "high", "critical"];
export const CHECKLIST_RESULTS: ChecklistResult[] = ["pass", "fail", "na"];

export interface IEvidenceRef {
  url: string;
  name?: string;
}

export interface IAuditChecklistEntry {
  title: string;
  /** Null until the auditor has assessed the line. */
  result: ChecklistResult | null;
  note?: string;
  evidence?: IEvidenceRef[];
}

export interface IAudit {
  id: string;
  type: AuditType;
  title: string;
  scope: string | null;
  auditor: string | null;
  storeId: string | null;
  scheduledFor: Date;
  status: AuditStatus;
  checklist: IAuditChecklistEntry[];
  startedAt: Date | null;
  completedAt: Date | null;
  summary: string | null;
  waiverReason: string | null;
  cancelReason: string | null;
  cancelledAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type IAuditCreate = Pick<
  IAudit,
  "type" | "title" | "scope" | "auditor" | "storeId" | "scheduledFor" | "checklist" | "createdBy"
>;

export type IAuditPlanUpdate = Partial<Pick<IAudit, "title" | "scheduledFor" | "scope" | "auditor" | "checklist">>;

export interface IAuditFilter {
  scope: string | null;
  storeId?: string;
  status?: AuditStatus;
  type?: AuditType;
}

export interface IFinding {
  id: string;
  auditId: string;
  storeId: string | null;
  title: string;
  description: string | null;
  severity: FindingSeverity;
  status: FindingStatus;
  ownerId: string | null;
  dueDate: Date | null;
  correctiveAction: string | null;
  evidence: string | null;
  closedAt: Date | null;
  closedBy: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type IFindingCreate = Pick<
  IFinding,
  "auditId" | "storeId" | "title" | "description" | "severity" | "ownerId" | "dueDate" | "createdBy"
>;

export type IFindingUpdate = Partial<Pick<IFinding, "ownerId" | "dueDate" | "status">>;

export interface IFindingClose {
  correctiveAction: string;
  evidence: string | null;
  closedBy: string;
}

export interface IOpenFindingFilter {
  scope: string | null;
  severity?: FindingSeverity;
  ownerId?: string;
  /** Set to today to keep only findings whose due date has passed. */
  overdueBefore?: Date;
}

export interface IAuditCompletion {
  summary: string | null;
  waiverReason: string | null;
}
