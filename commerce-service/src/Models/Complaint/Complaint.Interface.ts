import type { PageRequest } from "../../../commons/Utils/Pagination.js";

export const COMPLAINT_TYPES = [
  "damaged_item",
  "late_delivery",
  "wrong_charge",
  "missing_item",
  "quality",
  "rider_behaviour",
  "other",
] as const;
export const COMPLAINT_SEVERITIES = ["low", "medium", "high"] as const;
export const COMPLAINT_STATUSES = ["open", "assigned", "in_progress", "resolved", "escalated", "closed"] as const;
export const COMPLAINT_DECISIONS = ["refund", "goodwill", "reject", "policy_exception"] as const;

export type ComplaintType = (typeof COMPLAINT_TYPES)[number];
export type ComplaintSeverity = (typeof COMPLAINT_SEVERITIES)[number];
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];
export type ComplaintDecision = (typeof COMPLAINT_DECISIONS)[number];
export type ComplaintSource = "customer" | "store";
export type ComplaintActor = "customer" | "staff" | "system";
export type ComplaintEventKind =
  | "created"
  | "comment"
  | "assigned"
  | "escalated"
  | "resolved"
  | "reopened"
  | "closed"
  | "photos_added";

export interface IComplaintPhoto {
  url: string;
  caption?: string;
  contentType?: string;
  sizeBytes?: number;
  addedAt: string;
}

export interface IComplaint {
  id: string;
  orderId: string;
  orderRef: string;
  storeId: string;
  customerId: string;
  customerUserId: string | null;
  source: ComplaintSource;
  type: ComplaintType;
  severity: ComplaintSeverity;
  description: string;
  itemId: string | null;
  status: ComplaintStatus;
  activeKey: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assignedAt: Date | null;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  escalatedAt: Date | null;
  escalationReason: string | null;
  decision: ComplaintDecision | null;
  resolution: string | null;
  refundAmountPaise: number | null;
  goodwill: string | null;
  photos: IComplaintPhoto[];
  reopenCount: number;
  createdByUserId: string;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IComplaintEvent {
  id: string;
  kind: ComplaintEventKind;
  actorRole: ComplaintActor;
  actorUserId: string | null;
  actorName: string;
  message: string | null;
  internal: boolean;
  fromStatus: ComplaintStatus | null;
  toStatus: ComplaintStatus | null;
  createdAt: Date;
}

export interface IComplaintDetail extends IComplaint {
  events: IComplaintEvent[];
}

export type INewComplaintEvent = Omit<IComplaintEvent, "id" | "createdAt">;

export interface IComplaintCreate {
  orderId: string;
  orderRef: string;
  storeId: string;
  customerId: string;
  customerUserId: string | null;
  source: ComplaintSource;
  type: ComplaintType;
  severity: ComplaintSeverity;
  description: string;
  itemId: string | null;
  activeKey: string;
  createdByUserId: string;
  idempotencyKey: string | null;
  firstEvent: INewComplaintEvent;
}

/** Narrows every read and write of one complaint: a miss on any field is "not found". */
export interface IComplaintOwner {
  storeId?: string | null;
  customerUserId?: string;
  /** Only complaints that went to management (the admin escalation queue). */
  escalatedOnly?: boolean;
}

export interface IComplaintPatch {
  status?: ComplaintStatus;
  activeKey?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  assignedAt?: Date | null;
  firstResponseAt?: Date | null;
  resolvedAt?: Date | null;
  closedAt?: Date | null;
  escalatedAt?: Date | null;
  escalationReason?: string | null;
  decision?: ComplaintDecision | null;
  resolution?: string | null;
  refundAmountPaise?: number | null;
  goodwill?: string | null;
  photos?: IComplaintPhoto[];
  reopenCount?: number;
}

export interface IComplaintFilter {
  storeId?: string | null;
  customerUserId?: string;
  statuses?: ComplaintStatus[];
  type?: ComplaintType;
  assigneeId?: string;
  from?: Date;
  to?: Date;
  escalatedOnly?: boolean;
  page: PageRequest;
}
