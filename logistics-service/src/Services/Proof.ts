import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, conflict } from "../../commons/Utils/StatusCode.js";
import { IJob, IJobPatch } from "../Models/Job/Job.Interface.js";
import { JobQuery } from "../Queries/Job.Query.js";
import { httpsUrl, isBlank, object, text } from "../Utils/Input.js";

// Proof of handover: a customer's code or signature, photos, an item count. Photos and
// signatures arrive as references or small base64 images; the files themselves are not stored here.

export const MAX_CODE_ATTEMPTS = 5;
export const MAX_PHOTOS_PER_KIND = 12;
export const MAX_SCANS_PER_JOB = 300;
// The server caps request bodies near 100 KB, so a signature cannot be bigger than this anyway.
const MAX_SIGNATURE_CHARS = 150_000;
const BASE64_IMAGE = /^(data:image\/(png|jpeg|jpg|webp);base64,)?[A-Za-z0-9+/=\s]+$/;

const digest = (value: string) => crypto.createHash("sha256").update(value).digest();

/** A fresh six-digit code the customer reads out at the door. */
export const newHandoverCode = (): string => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

/**
 * Checks the code the customer gave the rider. Wrong guesses are counted on the job and, after
 * five, the code is locked: a rider cannot walk through a million combinations; a signature still works.
 */
export const checkHandoverCode = async (job: IJob, supplied: unknown): Promise<void> => {
  if (job.codeAttempts >= MAX_CODE_ATTEMPTS) {
    throw new CustomException("Too many wrong codes. Ask the customer to sign instead.", conflict);
  }
  if (typeof supplied !== "string" || !/^\d{4,8}$/.test(supplied.trim())) {
    throw new CustomException("otp must be the 4 to 8 digit code the customer received.", badRequest);
  }
  if (!crypto.timingSafeEqual(digest(supplied.trim()), digest(job.handoverCode))) {
    const attempts = await JobQuery.bumpCodeAttempts(job.id);
    throw new CustomException("That code does not match.", badRequest, { attemptsLeft: Math.max(MAX_CODE_ATTEMPTS - attempts, 0) });
  }
};

export const signatureImage = (value: unknown, name = "signature"): string => {
  if (typeof value !== "string" || !value.trim()) throw new CustomException(`${name} is required.`, badRequest);
  const trimmed = value.trim();
  if (trimmed.length > MAX_SIGNATURE_CHARS || !BASE64_IMAGE.test(trimmed)) {
    throw new CustomException(`${name} must be a base64 image.`, badRequest);
  }
  return trimmed;
};

/** The link the rider's app got from object storage. `photoUrl` is the field; `photo` is accepted as an alias. */
export const photoReference = (body: unknown): { url: string; caption: string | null } => {
  const input = object(body ?? {}, "body");
  const raw = isBlank(input.photoUrl) ? input.photo : input.photoUrl;
  if (isBlank(raw)) {
    throw new CustomException("photoUrl is required: upload the photo first, then send its https link.", badRequest);
  }
  return { url: httpsUrl(raw, "photoUrl"), caption: text(input.caption, "caption", { max: 200 }) };
};

/** Minutes between two instants, never negative. */
export const minutesBetween = (from: Date | null, to: Date): number | null =>
  from ? Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000)) : null;

/** The columns every successful completion writes. */
export const completionPatch = (job: IJob, now: Date): IJobPatch => ({
  completedAt: now,
  durationMinutes: minutesBetween(job.startedAt, now),
  onTime: job.slotTo ? now.getTime() <= job.slotTo.getTime() : null,
});
