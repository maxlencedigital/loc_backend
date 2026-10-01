import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import type { ISlotConfig, ISlotWindow } from "../Models/CustomerAccount/CustomerAccount.Interface.js";

// Every store is in India, which has one fixed offset and no daylight saving.
export const IST_OFFSET_MINUTES = 330;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 1440;

export const DEFAULT_SLOT_CONFIG: ISlotConfig = {
  slotMinutes: 120,
  capacityPerSlot: 8,
  leadMinutes: 120,
  horizonDays: 7,
};

export interface IOpeningHours {
  openMinute: number;
  closeMinute: number;
}

const HOURS = /^\s*(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})\s*$/;

/** "07:00 – 21:00" as minutes since midnight; null when the text is not a usable range. */
export const parseOpeningHours = (value: string): IOpeningHours | null => {
  const match = HOURS.exec(value);
  if (!match) return null;
  const open = Number(match[1]) * 60 + Number(match[2]);
  const close = Number(match[3]) * 60 + Number(match[4]);
  const valid = Number(match[2]) < 60 && Number(match[4]) < 60 && open < close && close <= MINUTES_PER_DAY;
  return valid ? { openMinute: open, closeMinute: close } : null;
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date as YYYY-MM-DD, or a 400. */
export const parseDateOnly = (value: unknown, field: string): string => {
  const match = typeof value === "string" ? DATE_ONLY.exec(value) : null;
  const probe = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!match || !probe || probe.toISOString().slice(0, 10) !== value) {
    throw new CustomException(`${field} must be a date like 2026-10-05.`, badRequest);
  }
  return value as string;
};

/** The UTC instant at which the given Indian calendar day begins. */
export const dayStart = (date: string): Date =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) - IST_OFFSET_MINUTES * MS_PER_MINUTE);

/** The Indian calendar day (YYYY-MM-DD) an instant falls on. */
export const istDateOf = (at: Date): string => new Date(at.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE).toISOString().slice(0, 10);

/** The slot windows of one day: back-to-back from opening, the last one ending by closing. */
export const buildWindows = (date: string, hours: IOpeningHours, slotMinutes: number): ISlotWindow[] => {
  const start = dayStart(date).getTime();
  const windows: ISlotWindow[] = [];
  for (let minute = hours.openMinute; minute + slotMinutes <= hours.closeMinute; minute += slotMinutes) {
    windows.push({
      startsAt: new Date(start + minute * MS_PER_MINUTE),
      endsAt: new Date(start + (minute + slotMinutes) * MS_PER_MINUTE),
    });
  }
  return windows;
};

/** A window can be booked from `leadMinutes` before it starts until it is full. */
export const isBookableAt = (startsAt: Date, now: Date, leadMinutes: number): boolean =>
  startsAt.getTime() - now.getTime() >= leadMinutes * MS_PER_MINUTE;
