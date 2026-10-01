export const ATTENDANCE_STATUSES = ["present", "late", "absent", "on_leave", "off"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Only these two are ever stored; the rest are derived at read time. */
export type RecordedAttendanceStatus = "present" | "late";

export interface IAttendance {
  id: string;
  employeeId: string;
  storeId: string | null;
  date: Date;
  status: RecordedAttendanceStatus;
  clockIn: Date | null;
  clockOut: Date | null;
  corrected: boolean;
}

export interface IAttendanceWrite {
  employeeId: string;
  storeId: string | null;
  date: Date;
  status: RecordedAttendanceStatus;
  clockIn: Date | null;
  clockOut: Date | null;
  corrected: boolean;
}

export interface IAttendanceCorrectionCreate {
  employeeId: string;
  storeId: string | null;
  date: Date;
  previousClockIn: Date | null;
  previousClockOut: Date | null;
  newClockIn: Date | null;
  newClockOut: Date | null;
  reason: string;
  correctedByUserId: string | null;
  correctedByName: string;
}

export interface IAttendanceCorrection extends IAttendanceCorrectionCreate {
  id: string;
  createdAt: Date;
}

export interface IAttendanceCorrectionFilter {
  storeId: string | null;
  employeeId?: string;
  from?: Date;
  to?: Date;
  offset: number;
  limit: number;
}

/** Per-employee counts of recorded days over a range. */
export interface IAttendanceCount {
  employeeId: string;
  present: number;
  late: number;
}

export interface IRoster {
  id: string;
  employeeId: string;
  storeId: string;
  date: Date;
  shiftStartMin: number;
  shiftEndMin: number;
}

export type IRosterCreate = Omit<IRoster, "id"> & { createdByUserId: string | null };

export interface IRosterFilter {
  storeId: string | null;
  from?: Date;
  to?: Date;
  offset: number;
  limit: number;
}

/** Headcount rostered on one shift of one day. */
export interface IShiftCount {
  date: Date;
  shiftStartMin: number;
  shiftEndMin: number;
  rostered: number;
}
