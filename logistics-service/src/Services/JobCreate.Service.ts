import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import { IJob, IJobCreate, IJobItem, JobPriority, JobType } from "../Models/Job/Job.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { JobQuery } from "../Queries/Job.Query.js";
import { coordinates, integer, isBlank, object, text } from "../Utils/Input.js";
import { LocationService } from "./Location.Service.js";
import { newHandoverCode } from "./Proof.js";

// The one way a job comes into being, whoever asks (dispatch or commerce): one job per
// (order, type), the address geocoded when it has no coordinates, and the same answer on a replay.

export interface AddressInput {
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  city: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface NewJob {
  orderId: string;
  orderNumber: string;
  type: JobType;
  storeId: string;
  address: AddressInput;
  customerName: string;
  customerPhone: string;
  slotFrom: Date | null;
  slotTo: Date | null;
  priority: JobPriority;
  notes: string | null;
  isPremium: boolean;
  isDelicate: boolean;
  requiresInspection: boolean | null;
  amountToCollectPaise: number;
  careNotes: string | null;
  items: IJobItem[];
  createdByUserId: string | null;
  createdByName: string | null;
}

const MAX_ITEMS = 100;

/** An address as a person or another service writes it: an object, or one line of text. */
export const parseAddress = (value: unknown, name = "address"): AddressInput => {
  if (typeof value === "string") {
    return { addressLine1: text(value, name, { max: 200, required: true }) as string, addressLine2: null, landmark: null, city: null, pincode: null, latitude: null, longitude: null };
  }
  const input = object(value, name);
  const pincode = text(input.pincode, `${name}.pincode`, { max: 6 });
  if (pincode !== null && !/^\d{6}$/.test(pincode)) throw new CustomException(`${name}.pincode must be 6 digits.`, badRequest);
  const where = coordinates(input, `${name}.`);
  return {
    addressLine1: text(input.line1, `${name}.line1`, { max: 200, required: true }) as string,
    addressLine2: text(input.line2, `${name}.line2`, { max: 200 }),
    landmark: text(input.landmark, `${name}.landmark`, { max: 200 }),
    city: text(input.city, `${name}.city`, { max: 80 }),
    pincode,
    latitude: where?.latitude ?? null,
    longitude: where?.longitude ?? null,
  };
};

/** Care details the order's owner may send along; all optional, all bounded. */
export const parseItems = (value: unknown): IJobItem[] => {
  if (isBlank(value)) return [];
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    throw new CustomException(`items must be a list of at most ${MAX_ITEMS} items.`, badRequest);
  }
  return value.map((raw, index) => {
    const row = object(raw, `items[${index}]`);
    const flags = isBlank(row.careFlags) ? [] : row.careFlags;
    if (!Array.isArray(flags) || flags.length > 20 || flags.some((f) => typeof f !== "string" || f.length > 40)) {
      throw new CustomException(`items[${index}].careFlags must be a short list of short words.`, badRequest);
    }
    return {
      id: text(row.id, `items[${index}].id`, { max: 64, required: true }) as string,
      name: text(row.name, `items[${index}].name`, { max: 120, required: true }) as string,
      careFlags: flags as string[],
      customerNote: text(row.customerNote, `items[${index}].customerNote`, { max: 300 }),
    };
  });
};

export const parsePaise = (value: unknown, name: string): number =>
  isBlank(value) ? 0 : integer(value, name, 0, 2_000_000_000);

const create = async (input: NewJob): Promise<{ job: IJob; created: boolean }> => {
  const existing = await JobQuery.findByOrderAndType(input.orderId, input.type);
  if (existing) return { job: existing, created: false };

  let { latitude, longitude } = input.address;
  let source: string | null = latitude !== null ? "provided" : null;
  if (latitude === null || longitude === null) {
    // Best effort: with no Maps (or no answer) the job exists without coordinates and still works.
    const found = await LocationService.resolveCoordinates(input.address);
    if (found) {
      latitude = found.latitude;
      longitude = found.longitude;
      source = "geocoded";
    }
  }

  const data: IJobCreate = {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    type: input.type,
    priority: input.priority,
    storeId: input.storeId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    addressLine1: input.address.addressLine1,
    addressLine2: input.address.addressLine2,
    landmark: input.address.landmark,
    city: input.address.city,
    pincode: input.address.pincode,
    latitude,
    longitude,
    coordinatesSource: source,
    slotFrom: input.slotFrom ?? new Date(),
    slotTo: input.slotTo,
    isPremium: input.isPremium,
    isDelicate: input.isDelicate,
    // Premium and delicate garments are inspected at the door unless the owner says otherwise.
    requiresInspection: input.requiresInspection ?? (input.isPremium || input.isDelicate),
    amountToCollectPaise: input.amountToCollectPaise,
    careNotes: input.careNotes,
    items: input.items,
    notes: input.notes,
    handoverCode: newHandoverCode(),
    createdByUserId: input.createdByUserId,
  };
  const { createdByName } = input;
  try {
    const job = await JobQuery.inTransaction(async (tx) => {
      const made = await JobQuery.create(data, tx);
      await JobQuery.addEvent({ jobId: made.id, status: "pending", byUserId: input.createdByUserId, byName: createdByName, note: "Job created" }, tx);
      return made;
    });
    return { job, created: true };
  } catch (error) {
    // Two requests for the same order and type at once: the unique index let one in; the other gets that job.
    if (isUniqueViolation(error)) {
      const winner = await JobQuery.findByOrderAndType(input.orderId, input.type);
      if (winner) return { job: winner, created: false };
    }
    throw error;
  }
};

export const JobCreateService = { create };
