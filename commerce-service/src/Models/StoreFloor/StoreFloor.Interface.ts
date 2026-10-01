import type { Colour, OrderPriority, RiskClass, SoilLevel } from "../Order/Order.Interface.js";

export type PieceStage = "received" | "sorted" | "washing" | "drying" | "quality_check" | "packed";
// The order in which a piece moves; each stage name is also the order status it drives.
export const PIECE_STAGES: PieceStage[] = ["received", "sorted", "washing", "drying", "quality_check", "packed"];

export type MachineType = "washer" | "dryer" | "press" | "iron" | "other";
export type MachineState = "idle" | "reserved" | "running" | "maintenance" | "faulted";
// What the contract calls a machine's state; `finishing` is a running machine close to done.
export type MachineStatus = "free" | "running" | "finishing" | "reserved" | "out_of_service";
export type BatchStage = "washing" | "drying";
export type BatchStatus = "planned" | "in_machine" | "finished" | "cancelled";
export type FaultSeverity = "low" | "medium" | "high" | "stopped";
export type CheckStatus = "ok" | "needs_attention";
export type QcOutcome = "pass" | "fail";

export const MACHINE_TYPES: MachineType[] = ["washer", "dryer", "press", "iron", "other"];
export const MACHINE_STATUSES: MachineStatus[] = ["free", "running", "finishing", "reserved", "out_of_service"];
export const BATCH_STATUSES: BatchStatus[] = ["planned", "in_machine", "finished", "cancelled"];
export const FAULT_SEVERITIES: FaultSeverity[] = ["low", "medium", "high", "stopped"];
export const CHECK_STATUSES: CheckStatus[] = ["ok", "needs_attention"];
export const FABRICS = ["cotton", "linen", "wool", "silk", "synthetic", "blend", "denim", "leather", "unknown"] as const;
export const ITEM_CONDITIONS = ["ok", "stain", "tear", "loose_button", "colour_fade", "damaged", "other"] as const;
export const RECEIVED_FROM = ["rider", "customer"] as const;

export interface IFabricRule {
  id: string;
  fabric: string;
  risk: RiskClass;
  handling: string;
  washProgramme: string;
  dryProgramme: string;
  maxTemperatureC: number;
  cycle: string;
}

export interface IPiece {
  id: string;
  storeId: string;
  orderId: string;
  orderRef: string;
  serviceId: string;
  garmentTypeId: string | null;
  tagCode: string;
  garment: string;
  condition: string;
  fabric: string;
  colour: Colour;
  soilLevel: SoilLevel;
  riskClass: RiskClass;
  careFlags: string[];
  note: string | null;
  priority: OrderPriority;
  dueAt: Date;
  stage: PieceStage;
  activeBatchId: string | null;
  processWash: string | null;
  processDry: string | null;
  processTemperatureC: number | null;
  processCycle: string | null;
  suggestedWash: string | null;
  suggestedDry: string | null;
  overrideReason: string | null;
  processSetBy: string | null;
  processSetAt: Date | null;
  qcPassedAt: Date | null;
  reworkCount: number;
  receivedFrom: string;
  receivedByName: string;
  createdAt: Date;
}

export type IPieceCreate = Omit<
  IPiece,
  | "id"
  | "stage"
  | "activeBatchId"
  | "processWash"
  | "processDry"
  | "processTemperatureC"
  | "processCycle"
  | "suggestedWash"
  | "suggestedDry"
  | "overrideReason"
  | "processSetBy"
  | "processSetAt"
  | "qcPassedAt"
  | "reworkCount"
  | "createdAt"
>;

/** The columns an edit may change; everything else about a piece is set by the workflow. */
export type IPieceEdit = Partial<
  Pick<
    IPiece,
    | "condition"
    | "fabric"
    | "careFlags"
    | "note"
    | "riskClass"
    | "stage"
    | "processWash"
    | "processDry"
    | "processTemperatureC"
    | "processCycle"
    | "suggestedWash"
    | "suggestedDry"
    | "overrideReason"
    | "processSetBy"
    | "processSetAt"
    | "qcPassedAt"
    | "reworkCount"
  >
>;

/** A write that only applies while the piece is still in the state the caller read. */
export interface IPieceGuard {
  stage?: PieceStage;
  noBatch?: boolean;
}

export interface IMachine {
  id: string;
  storeId: string;
  code: string;
  name: string;
  type: MachineType;
  capacityGrams: number;
  cycleMinutes: number;
  state: MachineState;
  currentBatchId: string | null;
  reservedUntil: Date | null;
  freeAt: Date | null;
}

export interface IMachineCreate {
  storeId: string;
  code: string;
  name: string;
  type: MachineType;
  capacityGrams: number;
  cycleMinutes: number;
}

export interface IMachineFilter {
  storeId: string | null;
  /** Raw states that satisfy the requested contract status, if one was asked for. */
  states?: MachineState[];
  finishingBefore?: Date;
  finishingAfter?: Date;
  type?: MachineType;
}

export interface IMachineCheck {
  id: string;
  machineId: string;
  checkDate: Date;
  status: CheckStatus;
  checklist: { item: string; ok: boolean; note?: string }[];
  note: string | null;
  checkedByName: string;
}

export interface IMachineFault {
  id: string;
  machineId: string;
  description: string;
  severity: FaultSeverity;
  status: "open" | "resolved";
  reportedByName: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface IBatch {
  id: string;
  storeId: string;
  serviceId: string;
  stage: BatchStage;
  status: BatchStatus;
  machineId: string | null;
  dueAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  loadWeightGrams: number | null;
  notes: string | null;
  createdByName: string;
  createdAt: Date;
  pieceCount: number;
}

export interface IBatchCreate {
  storeId: string;
  serviceId: string;
  stage: BatchStage;
  dueAt: Date | null;
  createdByName: string;
  createdByUserId: string;
}

export interface IBatchFilter {
  storeId: string | null;
  status?: BatchStatus;
  serviceId?: string;
  dueBefore?: Date;
}

export interface IQualityResult {
  pieceId: string;
  passed: boolean;
  note: string | null;
  comparedWithPickupNotes: boolean;
}

export interface IQualityCheck {
  id: string;
  orderId: string;
  outcome: QcOutcome;
  byName: string;
  createdAt: Date;
  results: IQualityResult[];
}

export interface IOrderNote {
  id: string;
  orderId: string;
  note: string;
  byName: string;
  createdAt: Date;
}

export interface ICollection {
  orderId: string;
  collectedBy: string;
  paymentOutstanding: boolean;
  collectedAt: Date;
}

/** The few order columns the floor needs, read in bulk so no list does a lookup per row. */
export interface IOrderSummary {
  id: string;
  storeId: string;
  ref: string;
  status: string;
}

export interface ICapacitySetting {
  storeId: string;
  dailyKg: number | null;
  expressReservePct: number;
}

export interface IDayLoad {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  orders: number;
  committedGrams: number;
  expressGrams: number;
}

export interface IExpressCandidate {
  orderId: string;
  ref: string;
  storeId: string;
  status: string;
  promisedAt: Date;
}

export interface IMachineAggregate {
  type: MachineType;
  state: MachineState;
  count: number;
  capacityGrams: number;
}
