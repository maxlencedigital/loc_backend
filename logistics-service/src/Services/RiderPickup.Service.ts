import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, conflict } from "../../commons/Utils/StatusCode.js";
import { IJob, ITEM_CONDITIONS, IJobInspection, JobStatus } from "../Models/Job/Job.Interface.js";
import { IRider } from "../Models/Rider/Rider.Interface.js";
import { Actor } from "../Middleware/StoreScope.js";
import { EarningsQuery } from "../Queries/Earnings.Query.js";
import { JobQuery } from "../Queries/Job.Query.js";
import { integer, object, oneOf, optionalOneOf, optionalUuid, requiredText, text, uuid, isBlank } from "../Utils/Input.js";
import { earningsForJob } from "./Earnings.Rules.js";
import { actorName, moveJob, ownedJob, riderForActor } from "./JobFlow.js";
import { toJobCard } from "./JobPresenter.js";
import { ORDER_STATUS, OrderSyncService } from "./OrderSync.Service.js";
import {
  MAX_PHOTOS_PER_KIND,
  MAX_SCANS_PER_JOB,
  checkHandoverCode,
  completionPatch,
  photoReference,
  signatureImage,
} from "./Proof.js";

const MAX_ITEMS = 500;

// A pickup job the rider holds, in one of the statuses the step is allowed in.
const pickupJob = async (actor: Actor, id: string, allowed: JobStatus[], step: string): Promise<{ rider: IRider; job: IJob }> => {
  const rider = await riderForActor(actor);
  const job = await ownedJob(rider, id);
  if (job.type !== "pickup") throw new CustomException("This is not a pickup job.", conflict);
  if (!allowed.includes(job.status)) {
    throw new CustomException(`You can ${step} only when the job is ${allowed.map((s) => s.replace(/_/g, " ")).join(" or ")}.`, conflict);
  }
  return { rider, job };
};

const scan = async (actor: Actor, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const tagId = requiredText(input.tagId, "tagId", 64);
    const condition = optionalOneOf(isBlank(input.condition) ? null : input.condition, ITEM_CONDITIONS, "condition") ?? "ok";
    const { job } = await pickupJob(actor, id, ["arrived"], "scan items");

    if ((await JobQuery.countScans(job.id)) >= MAX_SCANS_PER_JOB) {
      throw new CustomException("Too many items scanned for one pickup.", conflict);
    }
    const added = await JobQuery.addScan(job.id, tagId, condition);
    return { tagId, scanned: await JobQuery.countScans(job.id), duplicate: !added };
  } catch (error) {
    throw toCustomException(error);
  }
};

const inspection = async (actor: Actor, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) {
      throw new CustomException("items must list 1 to 100 inspected items.", badRequest);
    }
    const seen = new Set<string>();
    const items: IJobInspection[] = input.items.map((raw, index) => {
      const row = object(raw, `items[${index}]`);
      const itemId = uuid(row.itemId, `items[${index}].itemId`);
      if (seen.has(itemId)) throw new CustomException("Each item can be inspected only once.", badRequest);
      seen.add(itemId);
      return {
        itemId,
        condition: oneOf(row.condition, ITEM_CONDITIONS, `items[${index}].condition`),
        note: text(row.note, `items[${index}].note`, { max: 500 }),
      };
    });
    const overallNote = text(input.overallNote, "overallNote", { max: 1000 });
    const { job } = await pickupJob(actor, id, ["arrived"], "record an inspection");

    // When the order's items are known, an inspection of something else is a mistake.
    if (job.items.length > 0) {
      const known = new Set(job.items.map((item) => item.id));
      if (items.some((item) => !known.has(item.itemId))) {
        throw new CustomException("An inspected item does not belong to this order.", badRequest);
      }
    }
    await JobQuery.inTransaction(async (tx) => {
      await JobQuery.replaceInspections(job.id, items, tx);
      if (overallNote !== null) await JobQuery.upsertProof(job.id, { overallNote }, tx);
    });
    return { recorded: items.length };
  } catch (error) {
    throw toCustomException(error);
  }
};

const photos = async (actor: Actor, id: string, body: unknown) => {
  try {
    const photo = photoReference(body);
    const itemId = optionalUuid((body as Record<string, unknown> | undefined)?.itemId, "itemId");
    const { job } = await pickupJob(actor, id, ["arrived", "picked_up"], "add photos");
    if ((await JobQuery.countPhotos(job.id, "pickup")) >= MAX_PHOTOS_PER_KIND) {
      throw new CustomException(`A pickup can have at most ${MAX_PHOTOS_PER_KIND} photos.`, conflict);
    }
    const saved = await JobQuery.addPhoto({ jobId: job.id, kind: "pickup", itemId, url: photo.url, caption: photo.caption, uploadedByUserId: actor.id });
    return { id: saved.id, url: saved.url, caption: saved.caption };
  } catch (error) {
    throw toCustomException(error);
  }
};

const confirm = async (actor: Actor, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const itemCount = integer(input.itemCount, "itemCount", 1, MAX_ITEMS);
    const confirmation = oneOf(input.confirmation, ["otp", "signature"] as const, "confirmation");
    const signature = confirmation === "signature" ? signatureImage(input.signature) : null;
    const { rider, job } = await pickupJob(actor, id, ["arrived"], "confirm the pickup");

    if (confirmation === "otp") await checkHandoverCode(job, input.otp);

    const scanned = await JobQuery.countScans(job.id);
    if (scanned > 0 && scanned !== itemCount) {
      throw new CustomException(`You scanned ${scanned} items but confirmed ${itemCount}. Check the count.`, conflict);
    }
    if (job.requiresInspection && (await JobQuery.listInspections(job.id)).length === 0) {
      throw new CustomException("This pickup needs an inspection before it can be confirmed.", conflict);
    }

    const now = new Date();
    const { moved, rows } = await JobQuery.inTransaction(async (tx) => {
      const moved = await moveJob(
        tx,
        job,
        "picked_up",
        // On time is judged when the garments leave the customer, not when they reach the store.
        { pickedUpAt: now, onTime: job.slotTo ? now.getTime() <= job.slotTo.getTime() : null },
        { userId: actor.id, name: actorName(actor, rider.name), note: `${itemCount} items, confirmed by ${confirmation}` }
      );
      await JobQuery.upsertProof(job.id, { confirmation, otpVerified: confirmation === "otp", signature, itemCount }, tx);
      const row = await OrderSyncService.enqueueStatus(job, ORDER_STATUS.pickedUp, `Rider ${rider.name} collected ${itemCount} items`, tx);
      return { moved, rows: [row] };
    });
    await OrderSyncService.flush(rows);
    return { status: moved.status, pickedUpAt: now, itemCount };
  } catch (error) {
    throw toCustomException(error);
  }
};

const handOff = async (actor: Actor, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const storeId = uuid(input.storeId, "storeId");
    const itemCount = integer(input.itemCount, "itemCount", 1, MAX_ITEMS);
    const receiverId = optionalUuid(input.receiverId, "receiverId");
    const notes = text(input.notes, "notes", { max: 500 });
    const { rider, job } = await pickupJob(actor, id, ["picked_up"], "hand garments over");

    if (storeId !== job.storeId) throw new CustomException("This pickup belongs to a different store.", conflict);
    const proof = await JobQuery.findProof(job.id);
    if (!proof || proof.itemCount !== itemCount) {
      throw new CustomException("The store's count does not match what you collected.", conflict);
    }

    const now = new Date();
    const { moved, rows } = await JobQuery.inTransaction(async (tx) => {
      const { onTime: _kept, ...completion } = completionPatch(job, now);
      const moved = await moveJob(tx, job, "at_store", completion, {
        userId: actor.id,
        name: actorName(actor, rider.name),
        note: `${itemCount} items handed to the store`,
      });
      await JobQuery.upsertProof(job.id, { handoffStoreId: storeId, handoffItemCount: itemCount, handoffReceiverId: receiverId, handoffNotes: notes, handoffAt: now }, tx);
      await JobQuery.releaseAssignment(job.id, "completed", tx);
      await EarningsQuery.addEntries(earningsForJob(job, rider.id, job.shiftId), tx);
      const row = await OrderSyncService.enqueueStatus(job, ORDER_STATUS.receivedAtStore, `Rider ${rider.name} handed ${itemCount} items to the store`, tx);
      return { moved, rows: [row] };
    });
    await OrderSyncService.flush(rows);
    return toJobCard(moved);
  } catch (error) {
    throw toCustomException(error);
  }
};

export const RiderPickupService = { scan, inspection, photos, confirm, handOff };
