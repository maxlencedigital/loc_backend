export const JOB_TYPES = ["pickup", "delivery"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = [
  "pending",
  "assigned",
  "en_route",
  "arrived",
  "picked_up",
  "at_store",
  "out_for_delivery",
  "delivered",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_PRIORITIES = ["normal", "express"] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];

export const ITEM_CONDITIONS = ["ok", "stain", "tear", "loose_button", "colour_fade", "damaged", "other"] as const;
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];

export interface IJobItem {
  id: string;
  name: string;
  careFlags: string[];
  customerNote: string | null;
}

export interface IJob {
  id: string;
  orderId: string;
  orderNumber: string;
  type: JobType;
  status: JobStatus;
  priority: JobPriority;
  storeId: string;
  riderId: string | null;
  shiftId: string | null;
  customerName: string;
  customerPhone: string;
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  city: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  coordinatesSource: string | null;
  slotFrom: Date;
  slotTo: Date | null;
  sequence: number | null;
  distanceMeters: number | null;
  isPremium: boolean;
  isDelicate: boolean;
  requiresInspection: boolean;
  amountToCollectPaise: number;
  collectedPaise: number;
  careNotes: string | null;
  items: IJobItem[];
  notes: string | null;
  handoverCode: string;
  codeAttempts: number;
  assignedAt: Date | null;
  startedAt: Date | null;
  arrivedAt: Date | null;
  pickedUpAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  failureReason: string | null;
  failureNote: string | null;
  cancelReason: string | null;
  rescheduleCount: number;
  durationMinutes: number | null;
  onTime: boolean | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IJobCreate = Omit<
  IJob,
  | "id"
  | "status"
  | "riderId"
  | "shiftId"
  | "sequence"
  | "distanceMeters"
  | "collectedPaise"
  | "codeAttempts"
  | "assignedAt"
  | "startedAt"
  | "arrivedAt"
  | "pickedUpAt"
  | "completedAt"
  | "failedAt"
  | "cancelledAt"
  | "failureReason"
  | "failureNote"
  | "cancelReason"
  | "rescheduleCount"
  | "durationMinutes"
  | "onTime"
  | "createdAt"
  | "updatedAt"
>;

/** The columns a transition may write; anything not listed here is never changed by one. */
export type IJobPatch = Partial<
  Pick<
    IJob,
    | "status"
    | "riderId"
    | "shiftId"
    | "sequence"
    | "distanceMeters"
    | "assignedAt"
    | "startedAt"
    | "arrivedAt"
    | "pickedUpAt"
    | "completedAt"
    | "failedAt"
    | "cancelledAt"
    | "failureReason"
    | "failureNote"
    | "cancelReason"
    | "rescheduleCount"
    | "durationMinutes"
    | "onTime"
    | "slotFrom"
    | "slotTo"
    | "latitude"
    | "longitude"
    | "coordinatesSource"
    | "addressLine1"
    | "addressLine2"
    | "landmark"
    | "city"
    | "pincode"
    | "priority"
    | "notes"
  >
>;

/** What a transition requires to still be true when it is applied. */
export interface IJobExpect {
  status: JobStatus[];
  /** undefined: any rider; null: no rider; a string: exactly that rider. */
  riderId?: string | null;
}

export interface IJobEvent {
  id: string;
  jobId: string;
  status: JobStatus;
  byUserId: string | null;
  byName: string | null;
  note: string | null;
  at: Date;
}
export type IJobEventCreate = Omit<IJobEvent, "id" | "at"> & { at?: Date };

export interface IJobAssignmentCreate {
  jobId: string;
  riderId: string;
  assignedByUserId: string | null;
  assignedAt: Date;
}

export interface IJobProof {
  id: string;
  jobId: string;
  confirmation: string | null;
  otpVerified: boolean;
  signature: string | null;
  receivedBy: string | null;
  itemCount: number | null;
  overallNote: string | null;
  notes: string | null;
  handoffStoreId: string | null;
  handoffItemCount: number | null;
  handoffReceiverId: string | null;
  handoffNotes: string | null;
  handoffAt: Date | null;
}
export type IJobProofPatch = Partial<Omit<IJobProof, "id" | "jobId">>;

export interface IJobInspection {
  itemId: string;
  condition: ItemCondition;
  note: string | null;
}

export interface IJobPhoto {
  id: string;
  jobId: string;
  kind: "pickup" | "delivery";
  itemId: string | null;
  url: string;
  caption: string | null;
  createdAt: Date;
}

export interface IJobFilter {
  storeId?: string | null;
  riderId?: string | null;
  status?: JobStatus | null;
  type?: JobType | null;
  from?: Date | null;
  to?: Date | null;
}

export interface IRiderStat {
  riderId: string;
  jobsCompleted: number;
  distanceMeters: number;
  avgDurationMinutes: number | null;
  onTimeJobs: number;
  measuredJobs: number;
}

export interface IRouteSummary {
  riderId: string;
  stops: number;
  distanceMeters: number;
}
