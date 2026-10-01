export const LEAVE_TYPES = ["casual", "sick", "earned", "unpaid", "other"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const HOLIDAY_TYPES = ["public", "company", "store"] as const;
export type HolidayType = (typeof HOLIDAY_TYPES)[number];

export interface ILeavePolicy {
  type: LeaveType;
  annualHalfDays: number;
  carryForward: boolean;
}

export interface ILeaveBalance {
  id: string;
  employeeId: string;
  type: LeaveType;
  year: number;
  entitledHalfDays: number;
  takenHalfDays: number;
}

export interface ILeaveLedgerCreate {
  employeeId: string;
  type: LeaveType;
  year: number;
  kind: "grant" | "debit";
  deltaHalfDays: number;
  requestId: string | null;
  note: string | null;
}

export interface ILeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeStoreId: string | null;
  type: LeaveType;
  fromDate: Date;
  toDate: Date;
  halfDay: boolean;
  chargeableHalfDays: number;
  status: LeaveStatus;
  reason: string | null;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
}

export interface ILeaveRequestCreate {
  employeeId: string;
  type: LeaveType;
  fromDate: Date;
  toDate: Date;
  halfDay: boolean;
  chargeableHalfDays: number;
  reason: string | null;
}

export interface ILeaveDecision {
  status: "approved" | "rejected";
  decidedByUserId: string;
  decidedByName: string;
  decidedAt: Date;
  decisionNote: string | null;
  chargeableHalfDays: number;
}

export interface ILeaveRequestFilter {
  storeId: string | null;
  status?: LeaveStatus;
  employeeId?: string;
  from?: Date;
  to?: Date;
  offset: number;
  limit: number;
}

export interface IHoliday {
  id: string;
  date: Date;
  name: string;
  type: HolidayType;
  storeIds: string[];
}

export type IHolidayCreate = Omit<IHoliday, "id">;
