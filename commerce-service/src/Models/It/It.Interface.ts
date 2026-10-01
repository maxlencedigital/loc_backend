export const DEVICE_TYPES = ["laptop", "phone", "tablet", "printer", "scanner", "router", "other"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const DEVICE_STATUSES = ["in_stock", "assigned", "in_repair", "retired"] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const DEVICE_CONDITIONS = ["new", "good", "fair", "poor"] as const;
export type DeviceCondition = (typeof DEVICE_CONDITIONS)[number];

export type DeviceEventKind = "registered" | "assigned" | "returned" | "status_changed";

// Moves made with PATCH. `assigned` is entered only through assign and left only through
// return, so an assignment can never be lost without a history row naming who held it.
export const DEVICE_PATCH_TRANSITIONS: Record<DeviceStatus, readonly DeviceStatus[]> = {
  in_stock: ["in_repair", "retired"],
  in_repair: ["in_stock", "retired"],
  assigned: [],
  retired: [],
};

export interface IDevice {
  id: string;
  assetTag: string;
  type: DeviceType;
  make: string | null;
  model: string | null;
  serialNumber: string | null;
  purchasedOn: Date | null;
  warrantyUntil: Date | null;
  condition: DeviceCondition;
  status: DeviceStatus;
  assignedToEmployeeId: string | null;
  assignedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDeviceCreate {
  assetTag: string;
  type: DeviceType;
  make: string | null;
  model: string | null;
  serialNumber: string | null;
  purchasedOn: Date | null;
  warrantyUntil: Date | null;
  condition: DeviceCondition;
  status: DeviceStatus;
}

export interface IDeviceUpdate {
  assetTag?: string;
  type?: DeviceType;
  make?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  purchasedOn?: Date | null;
  warrantyUntil?: Date | null;
  condition?: DeviceCondition;
  status?: DeviceStatus;
  assignedToEmployeeId?: string | null;
  assignedAt?: Date | null;
}

export interface IDeviceEventCreate {
  kind: DeviceEventKind;
  fromStatus: DeviceStatus | null;
  toStatus: DeviceStatus;
  employeeId: string | null;
  condition: DeviceCondition | null;
  note: string | null;
  byUserId: string | null;
  byName: string;
}

export interface IDeviceEvent {
  id: string;
  kind: DeviceEventKind;
  fromStatus: DeviceStatus | null;
  toStatus: DeviceStatus;
  employeeId: string | null;
  condition: DeviceCondition | null;
  note: string | null;
  byName: string;
  at: Date;
}

export interface IDeviceFilter {
  type?: DeviceType;
  status?: DeviceStatus;
  assignedTo?: string;
}

export interface IDeviceRepairCreate {
  issue: string;
  costPaise: number | null;
  repairedOn: Date;
  createdByUserId: string | null;
}

export interface IDeviceRepair {
  id: string;
  deviceId: string;
  issue: string;
  costPaise: number | null;
  repairedOn: Date;
}

export interface ILicence {
  id: string;
  software: string;
  vendor: string | null;
  seats: number;
  seatsUsed: number;
  validUntil: Date | null;
  costPaise: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILicenceCreate {
  software: string;
  vendor: string | null;
  seats: number;
  validUntil: Date | null;
  costPaise: number | null;
}

export interface ILicenceUpdate {
  software?: string;
  vendor?: string | null;
  seats?: number;
  validUntil?: Date | null;
  costPaise?: number | null;
}

export type LicenceEventKind = "assigned" | "revoked";

export interface ILicenceEventCreate {
  kind: LicenceEventKind;
  employeeId: string;
  byUserId: string | null;
  byName: string;
}

export interface ILicenceEvent {
  id: string;
  kind: LicenceEventKind;
  employeeId: string;
  byName: string;
  at: Date;
}

export interface ISeatHolder {
  employeeId: string;
  assignedAt: Date;
}

export const REQUEST_CATEGORIES = ["device_problem", "software_issue", "access_request", "new_device", "other"] as const;
export type RequestCategory = (typeof REQUEST_CATEGORIES)[number];

export const REQUEST_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];

// Moves made with PATCH. `closed` only through the close action, which needs a resolution,
// and nothing leaves it.
export const REQUEST_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  open: ["in_progress", "resolved"],
  in_progress: ["open", "resolved"],
  resolved: ["in_progress"],
  closed: [],
};

export interface IRequest {
  id: string;
  category: RequestCategory;
  description: string;
  priority: RequestPriority;
  status: RequestStatus;
  deviceId: string | null;
  raisedByUserId: string;
  raisedByName: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  resolution: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRequestCreate {
  category: RequestCategory;
  description: string;
  priority: RequestPriority;
  deviceId: string | null;
  raisedByUserId: string;
  raisedByName: string;
}

export interface IRequestUpdate {
  status?: RequestStatus;
  priority?: RequestPriority;
  assigneeUserId?: string | null;
  assigneeName?: string | null;
  resolution?: string;
  closedAt?: Date;
  closedByUserId?: string | null;
}

export type RequestEventKind = "raised" | "status_changed" | "assigned" | "priority_changed" | "closed";

export interface IRequestEventCreate {
  kind: RequestEventKind;
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus | null;
  detail: string | null;
  byUserId: string | null;
  byName: string;
}

export interface IRequestEvent {
  id: string;
  kind: RequestEventKind;
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus | null;
  detail: string | null;
  byName: string;
  at: Date;
}

export interface IRequestComment {
  id: string;
  requestId: string;
  authorName: string;
  message: string;
  createdAt: Date;
}

export interface IRequestFilter {
  raisedByUserId?: string;
  status?: RequestStatus;
  category?: RequestCategory;
}
