import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";
import { JOB_TYPES } from "../Models/Job/Job.Interface.js";
import { isCompleted } from "../Models/Job/JobStatus.js";
import { JobQuery } from "../Queries/Job.Query.js";
import { RiderQuery } from "../Queries/Rider.Query.js";
import { dateTime } from "../Utils/Dates.js";
import { integer, isBlank, object, oneOf, optionalBool, phone, requiredText, text, uuid } from "../Utils/Input.js";
import { JobCreateService, parseAddress, parseItems, parsePaise } from "./JobCreate.Service.js";
import { toInternalJob } from "./JobPresenter.js";
import { OrderSyncService, RETRY_BATCH } from "./OrderSync.Service.js";

// What other services may ask of logistics. Narrow on purpose: commerce creates and looks up
// jobs for its orders; an operator (or a scheduler) triggers the retry; nothing else is exposed.

const createJob = async (body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const slotFrom = isBlank(input.windowStart) ? null : dateTime(input.windowStart, "windowStart");
    const slotTo = isBlank(input.windowEnd) ? null : dateTime(input.windowEnd, "windowEnd");
    if (slotFrom && slotTo && slotTo.getTime() <= slotFrom.getTime()) {
      throw new CustomException("windowEnd must be after windowStart.", badRequest);
    }
    // Commerce says "standard"; logistics says "normal". Anything else is a mistake worth surfacing.
    const priority = input.priority === "standard" ? "normal" : isBlank(input.priority) ? "normal" : oneOf(input.priority, ["normal", "express"] as const, "priority");

    const { job, created } = await JobCreateService.create({
      orderId: uuid(input.orderId, "orderId"),
      orderNumber: requiredText(input.orderRef, "orderRef", 64),
      type: oneOf(input.type, JOB_TYPES, "type"),
      storeId: uuid(input.storeId, "storeId"),
      address: parseAddress(input.address),
      customerName: requiredText(input.contactName, "contactName", 100),
      customerPhone: phone(input.contactPhone, "contactPhone"),
      slotFrom,
      slotTo,
      priority,
      notes: text(input.notes, "notes", { max: 500 }),
      isPremium: optionalBool(input.isPremium, "isPremium") ?? false,
      isDelicate: optionalBool(input.isDelicate, "isDelicate") ?? false,
      requiresInspection: optionalBool(input.requiresInspection, "requiresInspection"),
      amountToCollectPaise: parsePaise(input.amountToCollectPaise, "amountToCollectPaise"),
      careNotes: text(input.careNotes, "careNotes", { max: 1000 }),
      items: parseItems(input.items),
      createdByUserId: null,
      createdByName: "Commerce",
    });
    return { job: toInternalJob(job), created };
  } catch (error) {
    throw toCustomException(error);
  }
};

const jobsForOrder = async (query: { orderId?: unknown }) => {
  try {
    const orderId = uuid(query.orderId, "orderId");
    return { jobs: (await JobQuery.listByOrder(orderId)).map(toInternalJob) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const retrySync = async (body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const limit = isBlank(input.limit) ? RETRY_BATCH : integer(input.limit, "limit", 1, 200);
    return await OrderSyncService.retryPending(limit);
  } catch (error) {
    throw toCustomException(error);
  }
};

// A customer's rating of a finished job, sent by whichever service collects it. One per job.
const recordRating = async (body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const jobId = uuid(input.jobId, "jobId");
    const rating = integer(input.rating, "rating", 1, 5);
    const comment = text(input.comment, "comment", { max: 500 });
    const job = await JobQuery.findById(jobId);
    if (!job || !job.riderId) throw new CustomException("Job not found.", notFound);
    if (!isCompleted(job.status)) throw new CustomException("Only a finished job can be rated.", 409);
    const recorded = await RiderQuery.addRating({ jobId, riderId: job.riderId, rating, comment });
    return { recorded };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const InternalJobService = { createJob, jobsForOrder, retrySync, recordRating };
