import { IJob } from "../Models/Job/Job.Interface.js";
import { ILedgerEntryCreate } from "../Models/Money/Money.Interface.js";

// What a rider earns, in paise. These are product decisions, kept in one place so they
// are easy to find and change; the ledger stores what was actually paid, so changing a
// rate never rewrites history.
export const PAY_PER_JOB_PAISE = { pickup: 3_500, delivery: 4_500 } as const;
export const EXPRESS_INCENTIVE_PAISE = 1_000;
export const SHIFT_BONUS_JOBS = 10;
export const SHIFT_BONUS_PAISE = 10_000;

/** The ledger rows a finished job earns. dedupeKey makes finishing the same job twice pay once. */
export const earningsForJob = (job: IJob, riderId: string, shiftId: string | null): ILedgerEntryCreate[] => {
  const entry = (kind: "job_base" | "job_express", amountPaise: number, reason: string): ILedgerEntryCreate => ({
    riderId,
    shiftId,
    jobId: job.id,
    kind,
    amountPaise,
    reason,
    dedupeKey: `${kind}:${job.id}`,
    createdByUserId: null,
  });
  const entries = [entry("job_base", PAY_PER_JOB_PAISE[job.type], `${job.type} ${job.orderNumber}`)];
  if (job.priority === "express") entries.push(entry("job_express", EXPRESS_INCENTIVE_PAISE, `express ${job.orderNumber}`));
  return entries;
};

export const shiftBonus = (riderId: string, shiftId: string, jobsCompleted: number): ILedgerEntryCreate[] =>
  jobsCompleted >= SHIFT_BONUS_JOBS
    ? [
        {
          riderId,
          shiftId,
          jobId: null,
          kind: "shift_bonus",
          amountPaise: SHIFT_BONUS_PAISE,
          reason: `${SHIFT_BONUS_JOBS}+ jobs in one shift`,
          dedupeKey: `shift_bonus:${shiftId}`,
          createdByUserId: null,
        },
      ]
    : [];
