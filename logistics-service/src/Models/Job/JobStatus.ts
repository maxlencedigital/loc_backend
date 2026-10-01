import { JobStatus, JobType } from "./Job.Interface.js";

// The single definition of a job's journey. Every transition in the service goes through
// canMove, and every write is additionally a conditional UPDATE on the status that was read.
//
//   pickup:   pending > assigned > en_route > arrived > picked_up > at_store
//   delivery: pending > assigned > out_for_delivery > arrived > delivered
//   any live job can end as failed (rider reports it) or cancelled (dispatch);
//   a job that fails with a reschedule goes back to pending with a new slot.
const NEXT: Record<JobStatus, JobStatus[]> = {
  pending: ["assigned", "cancelled"],
  assigned: ["en_route", "out_for_delivery", "cancelled"],
  en_route: ["arrived", "failed", "cancelled", "pending"],
  out_for_delivery: ["arrived", "failed", "cancelled", "pending"],
  arrived: ["picked_up", "delivered", "failed", "cancelled", "pending"],
  picked_up: ["at_store"],
  at_store: [],
  delivered: [],
  failed: [],
  cancelled: [],
};

// Statuses that only make sense for one kind of job.
const PICKUP_ONLY: JobStatus[] = ["en_route", "picked_up", "at_store"];
const DELIVERY_ONLY: JobStatus[] = ["out_for_delivery", "delivered"];

export const canMove = (type: JobType, from: JobStatus, to: JobStatus): boolean => {
  if (!NEXT[from].includes(to)) return false;
  if (type === "pickup" && DELIVERY_ONLY.includes(to)) return false;
  if (type === "delivery" && PICKUP_ONLY.includes(to)) return false;
  return true;
};

/** What "set off" means for each kind of job. */
export const startedStatus = (type: JobType): JobStatus => (type === "pickup" ? "en_route" : "out_for_delivery");

export const isStarted = (status: JobStatus): boolean => status === "en_route" || status === "out_for_delivery";

/** Dispatch may cancel a job until the garments are in the rider's hands. */
export const CANCELLABLE: JobStatus[] = ["pending", "assigned", "en_route", "out_for_delivery", "arrived"];

/** A job can change rider until the rider has the garments. */
export const REASSIGNABLE: JobStatus[] = ["assigned", "en_route", "out_for_delivery", "arrived"];

/** A rider can report a problem only once they have set off and before the handover. */
export const REPORTABLE: JobStatus[] = ["en_route", "out_for_delivery", "arrived"];

/** Dispatch can still change slot, address or priority until the rider sets off. */
export const EDITABLE: JobStatus[] = ["pending", "assigned"];

export const isTerminal = (status: JobStatus): boolean => NEXT[status].length === 0;

/** Finished successfully: the pickup reached the store, or the delivery reached the customer. */
export const isCompleted = (status: JobStatus): boolean => status === "at_store" || status === "delivered";
