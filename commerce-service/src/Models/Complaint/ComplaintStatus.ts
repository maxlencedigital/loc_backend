import { ComplaintStatus, ComplaintType } from "./Complaint.Interface.js";

// What a complaint can be asked to do. The table below is the whole state machine; a pair that
// is not listed is refused, so a new rule is one new line here and one new test.
export type ComplaintAction =
  | "assign"
  | "staffReply"
  | "staffNote"
  | "customerReply"
  | "photos"
  | "escalate"
  | "resolve"
  | "decide"
  | "close";

const NEXT: Record<ComplaintAction, Partial<Record<ComplaintStatus, ComplaintStatus>>> = {
  // Reassigning keeps the stage; an escalated complaint is with management, not the store.
  assign: { open: "assigned", assigned: "assigned", in_progress: "in_progress" },
  // The first visible reply means work has started.
  staffReply: {
    open: "in_progress",
    assigned: "in_progress",
    in_progress: "in_progress",
    escalated: "escalated",
    resolved: "resolved",
  },
  staffNote: {
    open: "open",
    assigned: "assigned",
    in_progress: "in_progress",
    escalated: "escalated",
    resolved: "resolved",
  },
  // A customer writing back on a resolved complaint reopens it.
  customerReply: {
    open: "open",
    assigned: "assigned",
    in_progress: "in_progress",
    escalated: "escalated",
    resolved: "in_progress",
  },
  photos: {
    open: "open",
    assigned: "assigned",
    in_progress: "in_progress",
    escalated: "escalated",
    resolved: "resolved",
  },
  escalate: { open: "escalated", assigned: "escalated", in_progress: "escalated" },
  // A store settles its own complaints; an escalated one waits for management's decision.
  resolve: { open: "resolved", assigned: "resolved", in_progress: "resolved" },
  decide: { escalated: "resolved" },
  close: { resolved: "closed" },
};

/** The status after the action, or null when the action is not allowed from `current`. */
export const nextComplaintStatus = (current: ComplaintStatus, action: ComplaintAction): ComplaintStatus | null =>
  NEXT[action][current] ?? null;

const ACTIVE: ComplaintStatus[] = ["open", "assigned", "in_progress", "escalated"];

export const isActiveComplaint = (status: ComplaintStatus): boolean => ACTIVE.includes(status);

/** The unique key held while a complaint is live: one live complaint per order and type. */
export const activeKeyFor = (orderId: string, type: ComplaintType): string => `${orderId}:${type}`;

export const COMPLAINT_STATUS_LABEL: Record<ComplaintStatus, string> = {
  open: "open",
  assigned: "assigned",
  in_progress: "in progress",
  resolved: "resolved",
  escalated: "escalated to management",
  closed: "closed",
};
