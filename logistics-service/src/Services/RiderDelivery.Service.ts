import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, conflict } from "../../commons/Utils/StatusCode.js";
import { IJob, JobStatus } from "../Models/Job/Job.Interface.js";
import { IFieldPayment, PAYMENT_METHODS } from "../Models/Money/Money.Interface.js";
import { IRider } from "../Models/Rider/Rider.Interface.js";
import { Actor } from "../Middleware/StoreScope.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { EarningsQuery } from "../Queries/Earnings.Query.js";
import { JobQuery } from "../Queries/Job.Query.js";
import { decimal, integer, isBlank, object, oneOf, requiredText, text } from "../Utils/Input.js";
import { paiseToRupees, rupeesToPaise } from "../Utils/Geo.js";
import { earningsForJob } from "./Earnings.Rules.js";
import { actorName, moveJob, ownedJob, riderForActor, staleJob } from "./JobFlow.js";
import { ORDER_STATUS, OrderSyncService } from "./OrderSync.Service.js";
import { MAX_PHOTOS_PER_KIND, checkHandoverCode, completionPatch, photoReference, signatureImage } from "./Proof.js";

const MAX_ITEMS = 500;
const MAX_PAYMENT_PAISE = 2_000_000_000;
const KEY_PATTERN = /^[A-Za-z0-9_:.-]{1,64}$/;

const deliveryJob = async (actor: Actor, id: string, allowed: JobStatus[], step: string): Promise<{ rider: IRider; job: IJob }> => {
  const rider = await riderForActor(actor);
  const job = await ownedJob(rider, id);
  if (job.type !== "delivery") throw new CustomException("This is not a delivery job.", conflict);
  if (!allowed.includes(job.status)) {
    throw new CustomException(`You can ${step} only when the job is ${allowed.map((s) => s.replace(/_/g, " ")).join(" or ")}.`, conflict);
  }
  return { rider, job };
};

const confirm = async (actor: Actor, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const signature = signatureImage(input.signature);
    const receivedBy = requiredText(input.receivedBy, "receivedBy", 100);
    const itemCount = integer(input.itemCount, "itemCount", 1, MAX_ITEMS);
    const notes = text(input.notes, "notes", { max: 500 });
    const { rider, job } = await deliveryJob(actor, id, ["arrived"], "confirm the delivery");

    // A code is optional at delivery (the signature is the proof), but one that is offered must be right.
    const codeGiven = !isBlank(input.otp);
    if (codeGiven) await checkHandoverCode(job, input.otp);

    if (job.amountToCollectPaise - job.collectedPaise > 0) {
      throw new CustomException("Collect the payment at the door before completing the delivery.", conflict);
    }

    const now = new Date();
    const { moved, rows } = await JobQuery.inTransaction(async (tx) => {
      const moved = await moveJob(tx, job, "delivered", completionPatch(job, now), {
        userId: actor.id,
        name: actorName(actor, rider.name),
        note: `Received by ${receivedBy}`,
      });
      await JobQuery.upsertProof(
        job.id,
        { confirmation: codeGiven ? "otp+signature" : "signature", otpVerified: codeGiven, signature, receivedBy, itemCount, notes },
        tx
      );
      await JobQuery.releaseAssignment(job.id, "completed", tx);
      await EarningsQuery.addEntries(earningsForJob(job, rider.id, job.shiftId), tx);
      const row = await OrderSyncService.enqueueStatus(job, ORDER_STATUS.delivered, `Delivered to ${receivedBy} by rider ${rider.name}`, tx);
      return { moved, rows: [row] };
    });
    await OrderSyncService.flush(rows);
    return { status: moved.status, deliveredAt: now, itemCount };
  } catch (error) {
    throw toCustomException(error);
  }
};

const photos = async (actor: Actor, id: string, body: unknown) => {
  try {
    const photo = photoReference(body);
    const { job } = await deliveryJob(actor, id, ["arrived", "delivered"], "add photos");
    if ((await JobQuery.countPhotos(job.id, "delivery")) >= MAX_PHOTOS_PER_KIND) {
      throw new CustomException(`A delivery can have at most ${MAX_PHOTOS_PER_KIND} photos.`, conflict);
    }
    const saved = await JobQuery.addPhoto({ jobId: job.id, kind: "delivery", itemId: null, url: photo.url, caption: photo.caption, uploadedByUserId: actor.id });
    return { id: saved.id, url: saved.url, caption: saved.caption };
  } catch (error) {
    throw toCustomException(error);
  }
};

const paymentView = (payment: IFieldPayment, job: IJob, collectedPaise: number) => ({
  paymentId: payment.id,
  amount: paiseToRupees(payment.amountPaise),
  method: payment.method,
  status: payment.status,
  outstanding: paiseToRupees(Math.max(job.amountToCollectPaise - collectedPaise, 0)),
});

const payment = async (actor: Actor, id: string, body: unknown, idempotencyKey: string | null) => {
  try {
    const input = object(body ?? {}, "body");
    const method = oneOf(input.method, PAYMENT_METHODS, "method");
    const amountPaise = rupeesToPaise(decimal(input.amount, "amount", 0.01, MAX_PAYMENT_PAISE / 100));
    const reference = text(input.reference, "reference", { max: 64 });
    if (method !== "cash" && !reference) throw new CustomException("reference is required for card and UPI payments.", badRequest);
    if (idempotencyKey !== null && !KEY_PATTERN.test(idempotencyKey)) {
      throw new CustomException("Idempotency-Key must be 1 to 64 letters, digits or - _ : .", badRequest);
    }
    const { rider, job } = await deliveryJob(actor, id, ["arrived"], "take a payment");

    const replay = async (): Promise<ReturnType<typeof paymentView> | null> => {
      if (idempotencyKey === null) return null;
      const earlier = await EarningsQuery.findFieldPaymentByKey(rider.id, idempotencyKey);
      if (!earlier) return null;
      if (earlier.jobId !== job.id || earlier.amountPaise !== amountPaise || earlier.method !== method) {
        throw new CustomException("This Idempotency-Key was already used for a different payment.", conflict);
      }
      const current = (await JobQuery.findById(job.id)) as IJob;
      return paymentView(earlier, current, current.collectedPaise);
    };
    const first = await replay();
    if (first) return first;

    const owed = job.amountToCollectPaise - job.collectedPaise;
    if (owed <= 0) throw new CustomException("The order is already paid.", conflict);
    if (amountPaise > owed) {
      throw new CustomException(`That is more than is due (${paiseToRupees(owed)}).`, badRequest);
    }

    const now = new Date();
    let saved: IFieldPayment;
    let rows;
    try {
      ({ saved, rows } = await JobQuery.inTransaction(async (tx) => {
        // Compare-and-set on the total: a second payment racing this one cannot pass the same "still owed" check.
        if (!(await JobQuery.addCollected(job.id, job.collectedPaise, amountPaise, tx))) throw staleJob();
        const saved = await EarningsQuery.createFieldPayment(
          {
            jobId: job.id,
            orderId: job.orderId,
            riderId: rider.id,
            storeId: job.storeId,
            amountPaise,
            method,
            reference,
            // Only cash has to be handed over later; card and UPI already reached the business.
            status: method === "cash" ? "collected" : "settled",
            settledAt: method === "cash" ? null : now,
            settledAmountPaise: method === "cash" ? null : amountPaise,
            idempotencyKey,
          },
          tx
        );
        return { saved, rows: [await OrderSyncService.enqueuePayment(job, saved.id, amountPaise, tx)] };
      }));
    } catch (error) {
      // Same key arrived twice at once: the unique index let one through and rolled the other back whole.
      if (isUniqueViolation(error)) {
        const again = await replay();
        if (again) return again;
      }
      throw error;
    }
    await OrderSyncService.flush(rows);
    return paymentView(saved, job, job.collectedPaise + amountPaise);
  } catch (error) {
    throw toCustomException(error);
  }
};

export const RiderDeliveryService = { confirm, photos, payment };
