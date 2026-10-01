import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict } from "../../commons/Utils/StatusCode.js";
import { IJob, JOB_STATUSES, JOB_TYPES } from "../Models/Job/Job.Interface.js";
import { REPORTABLE, isStarted, startedStatus } from "../Models/Job/JobStatus.js";
import { IRider } from "../Models/Rider/Rider.Interface.js";
import { Actor } from "../Middleware/StoreScope.js";
import { JobQuery } from "../Queries/Job.Query.js";
import { RiderQuery } from "../Queries/Rider.Query.js";
import { DateRange, dayFromQuery, dayRange, istDateOf, dateTime } from "../Utils/Dates.js";
import { round1 } from "../Utils/Geo.js";
import { coordinates, isBlank, object, oneOf, optionalOneOf, optionalBool, text } from "../Utils/Input.js";
import { MAX_ROUTE_STOPS, LocationService } from "./Location.Service.js";
import { moveJob, ownedJob, riderForActor, actorName } from "./JobFlow.js";
import { ORDER_STATUS, OrderSyncService } from "./OrderSync.Service.js";
import { toJobCard, toRiderJobDetail } from "./JobPresenter.js";

// A location older than this says nothing about where the rider is now.
const FRESH_LOCATION_MS = 30 * 60_000;
const MAX_RESCHEDULE_DAYS = 14;

export const ISSUE_REASONS = [
  "customer_unavailable",
  "address_wrong",
  "customer_refused",
  "vehicle_breakdown",
  "unsafe",
  "other",
] as const;

const riderPoint = (rider: IRider) =>
  rider.lastLatitude !== null &&
  rider.lastLongitude !== null &&
  rider.lastLocationAt &&
  Date.now() - rider.lastLocationAt.getTime() <= FRESH_LOCATION_MS
    ? { latitude: rider.lastLatitude, longitude: rider.lastLongitude }
    : null;

// Drive times through the day's unfinished jobs, from the rider's last known position.
// Empty (not an error) when Maps is unavailable or the rider's position is unknown.
const planFor = async (rider: IRider, range: DateRange, jobs?: IJob[]) => {
  const active = jobs ?? (await JobQuery.listActiveForRider(rider.id, range, MAX_ROUTE_STOPS));
  const plan = await LocationService.planRoute(rider.id, riderPoint(rider), active);
  return { active, plan };
};

const list = async (actor: Actor, query: { date?: unknown; status?: unknown; type?: unknown; page?: unknown; limit?: unknown }) => {
  try {
    const { range } = dayFromQuery(query.date);
    const status = optionalOneOf(isBlank(query.status) ? null : query.status, JOB_STATUSES, "status");
    const type = optionalOneOf(isBlank(query.type) ? null : query.type, JOB_TYPES, "type");
    const page = parsePage(query);
    const rider = await riderForActor(actor);

    const [{ items, total }, { plan }] = await Promise.all([
      JobQuery.listForRider(rider.id, { ...range, status, type }, page),
      planFor(rider, range),
    ]);
    return toPage(
      items.map((job) => toJobCard(job, plan?.etaMinutes[job.id] ?? null)),
      total,
      page
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

const getOne = async (actor: Actor, id: string) => {
  try {
    const rider = await riderForActor(actor);
    const job = await ownedJob(rider, id);
    const { plan } = await planFor(rider, dayRange(istDateOf(job.slotFrom)));
    return toRiderJobDetail(job, plan?.etaMinutes[job.id] ?? null);
  } catch (error) {
    throw toCustomException(error);
  }
};

const route = async (actor: Actor, query: { date?: unknown }) => {
  try {
    const { range } = dayFromQuery(query.date);
    const rider = await riderForActor(actor);
    const { active, plan } = await planFor(rider, range);
    const located = active.filter((job) => job.latitude !== null && job.longitude !== null);
    const knownMeters = active.reduce((sum, job) => sum + (job.distanceMeters ?? 0), 0);
    return {
      stops: located.map((job, index) => ({
        jobId: job.id,
        sequence: job.sequence ?? index + 1,
        latitude: job.latitude,
        longitude: job.longitude,
        etaMinutes: plan?.etaMinutes[job.id] ?? null,
      })),
      totalDistanceKm: round1((plan?.totalMeters ?? knownMeters) / 1000),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const requireWorking = (rider: IRider) => {
  if (rider.status !== "active") throw new CustomException("Your account cannot take jobs right now.", conflict);
};

const touchLocation = async (rider: IRider, body: Record<string, unknown>) => {
  const where = coordinates(body);
  if (where) {
    await RiderQuery.updateRider(rider.id, { lastLatitude: where.latitude, lastLongitude: where.longitude, lastLocationAt: new Date() });
  }
};

const start = async (actor: Actor, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    coordinates(input);
    const rider = await riderForActor(actor);
    const job = await ownedJob(rider, id);
    requireWorking(rider);
    if (rider.openShiftId === null) throw new CustomException("Start your shift before starting a job.", conflict);

    const target = startedStatus(job.type);
    const { moved, rows } = await JobQuery.inTransaction(async (tx) => {
      const moved = await moveJob(
        tx,
        job,
        target,
        { startedAt: new Date(), shiftId: rider.openShiftId },
        { userId: actor.id, name: actorName(actor, rider.name), note: null }
      );
      // Commerce shows "out for delivery" to the customer; a pickup has no order status of its own yet.
      const rows =
        job.type === "delivery"
          ? [await OrderSyncService.enqueueStatus(job, ORDER_STATUS.outForDelivery, `Rider ${rider.name} has set off with the order`, tx)]
          : [];
      return { moved, rows };
    });
    await touchLocation(rider, input);
    await OrderSyncService.flush(rows);
    return toJobCard(moved);
  } catch (error) {
    throw toCustomException(error);
  }
};

const arrived = async (actor: Actor, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    coordinates(input);
    const rider = await riderForActor(actor);
    const job = await ownedJob(rider, id);
    if (!isStarted(job.status)) throw new CustomException("Set off for this job before marking it arrived.", conflict);

    const moved = await JobQuery.inTransaction((tx) =>
      moveJob(tx, job, "arrived", { arrivedAt: new Date() }, { userId: actor.id, name: actorName(actor, rider.name), note: null })
    );
    await touchLocation(rider, input);
    return toJobCard(moved);
  } catch (error) {
    throw toCustomException(error);
  }
};

const reportIssue = async (actor: Actor, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const reason = oneOf(input.reason, ISSUE_REASONS, "reason");
    const note = text(input.note, "note", { max: 500 });
    const reschedule = optionalBool(input.reschedule, "reschedule") ?? false;
    const now = new Date();

    let rescheduleFor: Date | null = null;
    if (reschedule) {
      rescheduleFor = dateTime(input.rescheduleFor, "rescheduleFor");
      if (rescheduleFor.getTime() <= now.getTime()) throw new CustomException("rescheduleFor must be in the future.", badRequest);
      if (rescheduleFor.getTime() > now.getTime() + MAX_RESCHEDULE_DAYS * 86_400_000) {
        throw new CustomException(`rescheduleFor must be within ${MAX_RESCHEDULE_DAYS} days.`, badRequest);
      }
    }

    const rider = await riderForActor(actor);
    const job = await ownedJob(rider, id);
    if (!REPORTABLE.includes(job.status)) {
      throw new CustomException("You can report a problem once you have set off and before the handover.", conflict);
    }
    const by = { userId: actor.id, name: actorName(actor, rider.name), note: `${reason.replace(/_/g, " ")}${note ? `: ${note}` : ""}` };

    await JobQuery.inTransaction(async (tx) => {
      if (rescheduleFor) {
        // Back in the queue for a new slot; the rider is released and dispatch will give it to someone.
        await moveJob(
          tx,
          job,
          "pending",
          {
            riderId: null,
            sequence: null,
            assignedAt: null,
            startedAt: null,
            arrivedAt: null,
            slotFrom: rescheduleFor,
            slotTo: null,
            rescheduleCount: job.rescheduleCount + 1,
            failureReason: reason,
            failureNote: note,
          },
          { ...by, note: `Rescheduled. ${by.note}` }
        );
      } else {
        await moveJob(tx, job, "failed", { failedAt: now, failureReason: reason, failureNote: note }, by);
      }
      await JobQuery.releaseAssignment(job.id, `rider reported: ${reason}`, tx);
    });
    return { status: rescheduleFor ? "pending" : "failed", rescheduled: rescheduleFor !== null };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const RiderJobService = { list, getOne, route, start, arrived, reportIssue };

// Exposed for the dispatch route planner, which builds on the same rider-position rule.
export { riderPoint };
