import { IComplaint, IComplaintDetail, IComplaintEvent, ComplaintEventKind } from "../Models/Complaint/Complaint.Interface.js";
import { toRupees } from "../Utils/Money.js";

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);
const money = (paise: number | null): number | null => (paise === null ? null : toRupees(paise));

// ------------------------------------------------------------------- staff
export const toStaffListItem = (c: IComplaint) => ({
  id: c.id,
  orderId: c.orderId,
  orderRef: c.orderRef,
  storeId: c.storeId,
  type: c.type,
  severity: c.severity,
  status: c.status,
  assigneeId: c.assigneeId,
  assigneeName: c.assigneeName,
  createdAt: c.createdAt.toISOString(),
});

const toStaffEvent = (e: IComplaintEvent) => ({
  at: e.createdAt.toISOString(),
  kind: e.kind,
  by: e.actorName,
  byRole: e.actorRole,
  message: e.message,
  internal: e.internal,
  fromStatus: e.fromStatus,
  toStatus: e.toStatus,
});

export const toStaffDetail = (c: IComplaintDetail) => ({
  ...toStaffListItem(c),
  customerId: c.customerId,
  source: c.source,
  description: c.description,
  itemId: c.itemId,
  photos: c.photos,
  decision: c.decision,
  resolution: c.resolution,
  refundAmount: money(c.refundAmountPaise),
  goodwill: c.goodwill,
  escalatedAt: iso(c.escalatedAt),
  escalationReason: c.escalationReason,
  sla: {
    assignedAt: iso(c.assignedAt),
    firstResponseAt: iso(c.firstResponseAt),
    resolvedAt: iso(c.resolvedAt),
    closedAt: iso(c.closedAt),
  },
  reopenCount: c.reopenCount,
  updatedAt: c.updatedAt.toISOString(),
  timeline: c.events.map(toStaffEvent),
});

export const toEscalationItem = (c: IComplaint) => ({
  id: c.id,
  orderId: c.orderId,
  orderRef: c.orderRef,
  storeId: c.storeId,
  type: c.type,
  status: c.status,
  reason: c.escalationReason,
  escalatedAt: iso(c.escalatedAt),
});

// ---------------------------------------------------------------- customer
export const toCustomerListItem = (c: IComplaint) => ({
  id: c.id,
  orderId: c.orderId,
  orderRef: c.orderRef,
  type: c.type,
  status: c.status,
  createdAt: c.createdAt.toISOString(),
});

// The customer sees what happened and what was decided, never staff-only notes, who inside
// the company did it, or why it went to management.
const CUSTOMER_EVENT_LABEL: Record<ComplaintEventKind, string> = {
  created: "Complaint raised",
  comment: "Message",
  assigned: "Assigned to a team member",
  escalated: "Escalated to management",
  resolved: "Resolved",
  reopened: "Reopened",
  closed: "Closed",
  photos_added: "Photos added",
};
const CUSTOMER_VISIBLE_MESSAGE: ComplaintEventKind[] = ["comment", "resolved"];

const toCustomerEvent = (e: IComplaintEvent) => ({
  at: e.createdAt.toISOString(),
  event: CUSTOMER_EVENT_LABEL[e.kind],
  by: e.actorRole === "customer" ? "You" : e.actorRole === "staff" ? "LOC support" : "LOC",
  ...(e.message && CUSTOMER_VISIBLE_MESSAGE.includes(e.kind) ? { message: e.message } : {}),
});

export const toCustomerDetail = (c: IComplaintDetail) => ({
  ...toCustomerListItem(c),
  description: c.description,
  assignedTo: c.assigneeName,
  decision: c.decision,
  resolution: c.resolution,
  refundAmount: money(c.refundAmountPaise),
  photos: c.photos,
  resolvedAt: iso(c.resolvedAt),
  timeline: c.events.filter((e) => !e.internal).map(toCustomerEvent),
});
