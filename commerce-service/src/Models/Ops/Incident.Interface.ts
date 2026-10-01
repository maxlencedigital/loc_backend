export type IncidentType =
  | "injury"
  | "near_miss"
  | "fire_risk"
  | "security"
  | "hospitalisation"
  | "property_damage"
  | "vehicle_accident"
  | "unsafe_condition"
  | "other";
export type IncidentStatus = "open" | "assigned" | "in_progress" | "escalated" | "closed";
export type IncidentSeverity = "low" | "medium" | "high" | "critical";

export const INCIDENT_TYPES: IncidentType[] = [
  "injury",
  "near_miss",
  "fire_risk",
  "security",
  "hospitalisation",
  "property_damage",
  "vehicle_accident",
  "unsafe_condition",
  "other",
];
export const INCIDENT_STATUSES: IncidentStatus[] = ["open", "assigned", "in_progress", "escalated", "closed"];
// Ascending: a later entry is more severe.
export const INCIDENT_SEVERITIES: IncidentSeverity[] = ["low", "medium", "high", "critical"];

export interface IIncidentPhoto {
  id: string;
  url: string;
  name?: string;
  caption?: string;
  addedBy: string;
  addedAt: string;
}

export interface IIncident {
  id: string;
  type: IncidentType;
  description: string;
  occurredAt: Date;
  severity: IncidentSeverity;
  status: IncidentStatus;
  storeId: string | null;
  location: string | null;
  peopleInvolved: string[];
  immediateAction: string | null;
  reportedBy: string;
  reportedByName: string | null;
  assigneeId: string | null;
  assignedAt: Date | null;
  escalatedAt: Date | null;
  escalationReason: string | null;
  photos: IIncidentPhoto[];
  actionCount: number;
  closedAt: Date | null;
  closedBy: string | null;
  outcome: string | null;
  rootCause: string | null;
  preventiveMeasures: string | null;
  claimId: string | null;
  claimedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IIncidentCreate = Pick<
  IIncident,
  | "type"
  | "description"
  | "occurredAt"
  | "severity"
  | "storeId"
  | "location"
  | "peopleInvolved"
  | "immediateAction"
  | "reportedBy"
  | "reportedByName"
> & { idempotencyKey: string | null };

/** Who may see an incident: the store scope, and for non-managers only what they reported. */
export interface IIncidentAccess {
  storeId: string | null;
  reportedBy?: string;
}

export interface IIncidentFilter {
  storeId: string | null;
  status?: IncidentStatus;
  type?: IncidentType;
  severity?: IncidentSeverity;
  from?: Date;
  /** Exclusive upper bound. */
  to?: Date;
}

/** One guarded write: it applies only while the incident still has `expectedStatus`. */
export interface IIncidentChange {
  expectedStatus: IncidentStatus;
  /** Set when the change moves severity, so a concurrent change to it is not overwritten. */
  expectedSeverity?: IncidentSeverity;
  data: Partial<
    Pick<
      IIncident,
      | "status"
      | "severity"
      | "assigneeId"
      | "assignedAt"
      | "escalatedAt"
      | "escalationReason"
      | "closedAt"
      | "closedBy"
      | "outcome"
      | "rootCause"
      | "preventiveMeasures"
    >
  >;
  /** Counts one more recorded action; refused once the cap is reached. */
  addAction?: { cap: number };
}

export interface IIncidentSummaryRow {
  key: string;
  count: number;
}

export interface IRepeatPattern {
  type: IncidentType;
  storeId: string | null;
  count: number;
}
