export type EssOperation = "leave_request" | "grievance" | "hr_request";

export interface IIdempotencyClaim {
  id: string;
  /** Set once the first request finished; null while it is still running. */
  resourceId: string | null;
}

export interface IMyIncident {
  id: string;
  type: string;
  severity: string;
  status: string;
  occurredAt: Date;
  location: string | null;
  createdAt: Date;
}
