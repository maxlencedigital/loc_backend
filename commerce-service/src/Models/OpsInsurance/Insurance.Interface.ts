import type { DateString } from "../../Utils/OpsDates.js";
import type { IDocumentRef } from "../../Utils/OpsInput.js";

export const POLICY_TYPES = [
  "property",
  "equipment",
  "public_liability",
  "rider_vehicle",
  "staff_medical",
  "staff_accident",
  "other",
] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

// What the API calls a policy's status. Only cancelled is stored; the rest follow endDate.
export const POLICY_STATUSES = ["active", "expiring", "expired", "cancelled"] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export const CLAIM_STATUSES = ["raised", "submitted", "under_review", "settled", "rejected"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_OUTCOMES = ["paid", "partially_paid", "rejected"] as const;
export type ClaimOutcome = (typeof CLAIM_OUTCOMES)[number];

// settled and rejected are final and are reached only through the settle action.
export const CLAIM_TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  raised: ["submitted"],
  submitted: ["under_review", "settled", "rejected"],
  under_review: ["settled", "rejected"],
  settled: [],
  rejected: [],
};

export interface IPolicy {
  id: string;
  type: PolicyType;
  insurer: string;
  policyNumber: string;
  coverageAmountPaise: number | null;
  premiumPaise: number | null;
  startDate: DateString;
  endDate: DateString;
  covers: string | null;
  storeIds: string[];
  employeeIds: string[];
  cancelledAt: Date | null;
  cancelReason: string | null;
  documents: IDocumentRef[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IPolicyWrite {
  type: PolicyType;
  insurer: string;
  policyNumber: string;
  coverageAmountPaise: number | null;
  premiumPaise: number | null;
  startDate: DateString;
  endDate: DateString;
  covers: string | null;
  storeIds: string[];
  employeeIds: string[];
}

export interface IPolicyCreate extends IPolicyWrite {
  createdBy: string;
}

export interface IPolicyRenewal {
  previousEndDate: DateString;
  newEndDate: DateString;
  previousPolicyNumber: string;
  newPolicyNumber: string;
  previousPremiumPaise: number | null;
  newPremiumPaise: number | null;
  byName: string;
  at: Date;
}

export interface IRenewalWrite extends Omit<IPolicyRenewal, "at" | "byName"> {
  byUserId: string;
  byName: string;
}

export interface IPolicyFilter {
  storeId: string | null;
  type?: PolicyType;
  // Resolved by the service into date and cancellation conditions.
  cancelled?: boolean;
  endFrom?: DateString;
  endTo?: DateString;
  offset: number;
  limit: number;
}

export interface IClaim {
  id: string;
  number: string;
  policyId: string;
  type: string;
  description: string;
  incidentDate: DateString;
  claimAmountPaise: number;
  incidentId: string | null;
  storeId: string | null;
  employeeId: string | null;
  orderId: string | null;
  status: ClaimStatus;
  insurerReference: string | null;
  outcome: ClaimOutcome | null;
  settledAmountPaise: number | null;
  settledAt: Date | null;
  documents: IDocumentRef[];
  raisedAt: Date;
  createdBy: string;
  updatedAt: Date;
}

export interface IClaimEvent {
  fromStatus: ClaimStatus | null;
  toStatus: ClaimStatus;
  note: string | null;
  byName: string;
  at: Date;
}

export interface IClaimDetail extends IClaim {
  events: IClaimEvent[];
}

export interface IClaimCreate {
  policyId: string;
  type: string;
  description: string;
  incidentDate: DateString;
  claimAmountPaise: number;
  incidentId: string | null;
  storeId: string | null;
  employeeId: string | null;
  orderId: string | null;
  createdBy: string;
  idempotencyKey: string | null;
  firstEvent: { byUserId: string; byName: string };
}

export interface IClaimFilter {
  status?: ClaimStatus;
  policyId?: string;
  from?: Date;
  to?: Date;
  offset: number;
  limit: number;
}

export interface IClaimChange {
  status?: ClaimStatus;
  insurerReference?: string | null;
  outcome?: ClaimOutcome;
  settledAmountPaise?: number;
  settledAt?: Date;
  decisionSeconds?: number;
}

export interface IClaimEventWrite {
  fromStatus: ClaimStatus;
  toStatus: ClaimStatus;
  note: string | null;
  byUserId: string;
  byName: string;
}

export interface IClaimHistoryRow {
  type: string;
  status: ClaimStatus;
  count: number;
  claimedPaise: number;
  paidPaise: number;
}

export interface IClaimHistory {
  rows: IClaimHistoryRow[];
  averageDecisionSeconds: number | null;
}
