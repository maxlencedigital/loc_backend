export const EQUIPMENT_TYPES = ["washer", "dryer", "press", "iron", "boiler", "generator", "other"] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

export const EQUIPMENT_STATUSES = ["active", "under_repair", "out_of_service", "retired"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const INSPECTION_RESULTS = ["pass", "fail", "needs_attention"] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

// Lifecycle: a machine moves freely between the three working states and can be retired
// from any of them, but a retired machine never comes back (register a new one instead).
export const EQUIPMENT_TRANSITIONS: Record<EquipmentStatus, readonly EquipmentStatus[]> = {
  active: ["under_repair", "out_of_service", "retired"],
  under_repair: ["active", "out_of_service", "retired"],
  out_of_service: ["active", "under_repair", "retired"],
  retired: [],
};

export interface IEquipment {
  id: string;
  assetTag: string;
  name: string;
  type: EquipmentType;
  storeId: string;
  machineId: string | null;
  make: string | null;
  model: string | null;
  serialNumber: string | null;
  purchasedOn: Date | null;
  purchaseCostPaise: number | null;
  capacityGrams: number | null;
  status: EquipmentStatus;
  retiredAt: Date | null;
  retiredReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IEquipmentCreate {
  assetTag: string;
  name: string;
  type: EquipmentType;
  storeId: string;
  machineId: string | null;
  make: string | null;
  model: string | null;
  serialNumber: string | null;
  purchasedOn: Date | null;
  purchaseCostPaise: number | null;
  capacityGrams: number | null;
  status: EquipmentStatus;
  createdByUserId: string | null;
}

export type IEquipmentUpdate = Partial<
  Omit<IEquipmentCreate, "assetTag" | "createdByUserId"> & { retiredAt: Date; retiredReason: string }
>;

export interface IStatusEventCreate {
  fromStatus: EquipmentStatus | null;
  toStatus: EquipmentStatus;
  reason: string | null;
  byUserId: string | null;
  byName: string;
}

export interface IStatusEvent {
  id: string;
  fromStatus: EquipmentStatus | null;
  toStatus: EquipmentStatus;
  reason: string | null;
  byName: string;
  at: Date;
}

// storeId null means every store.
export interface IEquipmentFilter {
  storeId: string | null;
  type?: EquipmentType;
  status?: EquipmentStatus;
}

export interface IChecklistItem {
  item: string;
  ok: boolean;
}

export interface IInspectionCreate {
  inspectedOn: Date;
  result: InspectionResult;
  checklist: IChecklistItem[];
  notes: string | null;
  inspectorUserId: string | null;
  inspectorName: string;
}

export interface IInspection {
  id: string;
  equipmentId: string;
  inspectedOn: Date;
  result: InspectionResult;
  checklist: IChecklistItem[];
  notes: string | null;
  inspectorName: string;
  createdAt: Date;
}

export interface IRepairCreate {
  reportedOn: Date;
  issue: string;
  costPaise: number | null;
  vendorId: string | null;
  downtimeMinutes: number | null;
  createdByUserId: string | null;
}

export interface IRepairUpdate {
  costPaise?: number;
  resolvedOn?: Date;
  downtimeMinutes?: number;
  notes?: string;
}

export interface IRepair {
  id: string;
  equipmentId: string;
  reportedOn: Date;
  issue: string;
  costPaise: number | null;
  vendorId: string | null;
  resolvedOn: Date | null;
  downtimeMinutes: number | null;
  notes: string | null;
  createdAt: Date;
}

export interface IRepairSpend {
  equipmentId: string;
  costPaise: number;
}

export interface ITask {
  id: string;
  equipmentId: string;
  name: string;
  everyDays: number;
  lastDoneOn: Date | null;
  nextDueOn: Date;
}

export interface ITaskDraft {
  name: string;
  everyDays: number;
  lastDoneOn: Date | null;
  nextDueOn: Date;
}

// The schedule replacement: rows to add, rows to change (matched by name), ids to drop.
export interface ISchedulePlan {
  create: ITaskDraft[];
  update: (ITaskDraft & { id: string })[];
  removeIds: string[];
}

export interface IDueTask extends ITask {
  equipmentName: string;
}

// Both ends inclusive; `from` undefined means "from the beginning of time" (overdue).
export interface IDueRange {
  storeId: string | null;
  from?: Date;
  to: Date;
}

export interface ILockedTask {
  task: ITask;
  equipmentName: string;
}

export interface IMaintenanceLogCreate {
  taskName: string;
  doneOn: Date;
  costPaise: number | null;
  notes: string | null;
  doneByUserId: string | null;
  doneByName: string;
}

export interface IMaintenanceLog {
  id: string;
  equipmentId: string;
  taskName: string;
  doneOn: Date;
  costPaise: number | null;
  notes: string | null;
  doneByName: string;
}
