import { CustomException } from "../../commons/Exception/CustomException.js";
import { conflict, notFound } from "../../commons/Utils/StatusCode.js";
import { IJob, IJobPatch, JobStatus } from "../Models/Job/Job.Interface.js";
import { canMove } from "../Models/Job/JobStatus.js";
import { IRider } from "../Models/Rider/Rider.Interface.js";
import { Db, JobQuery } from "../Queries/Job.Query.js";
import { RiderQuery } from "../Queries/Rider.Query.js";
import type { Actor } from "../Middleware/StoreScope.js";
import { isUuid } from "../Utils/Uuid.js";

// Shared by the rider and dispatch services: who the rider is, which jobs they may touch,
// and the one way a job changes status.

export const jobNotFound = () => new CustomException("Job not found.", notFound);

export const staleJob = () =>
  new CustomException("This job was just changed by someone else. Refresh and try again.", conflict);

/** The rider profile behind a signed-in driver. A driver with no profile has nothing to see. */
export const riderForActor = async (actor: Actor): Promise<IRider> => {
  const rider = await RiderQuery.findRiderByUserId(actor.id);
  if (!rider) throw new CustomException("Rider profile not found.", notFound);
  return rider;
};

/**
 * A job the rider holds. Someone else's job, a job nobody holds and an unknown id are
 * all the same 404: a rider cannot learn which jobs exist.
 */
export const ownedJob = async (rider: IRider, id: string): Promise<IJob> => {
  const job = isUuid(id) ? await JobQuery.findById(id) : null;
  if (!job || job.riderId !== rider.id) throw jobNotFound();
  return job;
};

export const actorName = (actor: Actor, fallback: string): string => actor.name ?? fallback;

/**
 * Moves a job one legal step and records it on the timeline, inside the caller's
 * transaction. The write only lands if the job is still in the state it was read in
 * (and still with the same rider), so two people acting at once cannot both win.
 */
export const moveJob = async (
  db: Db,
  job: IJob,
  to: JobStatus,
  patch: IJobPatch,
  by: { userId: string | null; name: string | null; note: string | null }
): Promise<IJob> => {
  if (!canMove(job.type, job.status, to)) {
    throw new CustomException(`A ${job.status.replace(/_/g, " ")} job cannot move to ${to.replace(/_/g, " ")}.`, conflict);
  }
  const moved = await JobQuery.transition(job.id, { status: [job.status], riderId: job.riderId }, { ...patch, status: to }, db);
  if (!moved) throw staleJob();
  await JobQuery.addEvent({ jobId: job.id, status: to, byUserId: by.userId, byName: by.name, note: by.note }, db);
  return { ...job, ...patch, status: to } as IJob;
};
