import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { ServiceClient } from "../../commons/Http/ServiceClient.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import { IJob, IJobPatch, JOB_PRIORITIES, JOB_STATUSES, JOB_TYPES } from "../Models/Job/Job.Interface.js";
import { CANCELLABLE, EDITABLE, REASSIGNABLE } from "../Models/Job/JobStatus.js";
import { IRider } from "../Models/Rider/Rider.Interface.js";
import { Actor, StoreScope } from "../Middleware/StoreScope.js";
import { JobQuery } from "../Queries/Job.Query.js";
import { RiderQuery } from "../Queries/Rider.Query.js";
import { dateTime, dayFromQuery, todayIst, toDateColumn } from "../Utils/Dates.js";
import { haversineKm, round1 } from "../Utils/Geo.js";
import { isBlank, object, oneOf, optionalOneOf, optionalUuid, requiredText, text, uuid } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { eligibilityBlockers } from "./Eligibility.js";
import { JobCreateService, parseAddress } from "./JobCreate.Service.js";
import { actorName, jobNotFound, moveJob, staleJob } from "./JobFlow.js";
import { toDispatchJob } from "./JobPresenter.js";
import { MAX_ROUTE_STOPS, LocationService } from "./Location.Service.js";
import { riderPoint } from "./RiderJob.Service.js";

export const MAX_ACTIVE_JOBS_PER_RIDER = 15;
const UNASSIGNED_LIMIT = 200;
const AUTO_ASSIGN_JOB_LIMIT = 100;
const AUTO_ASSIGN_RIDER_LIMIT = 200;
const ROUTE_LIST_LIMIT = 200;
const TIMELINE_LIMIT = 200;

/** A store-bound caller names only their own store; anyone else's is a 404, not a 403. */
const checkStore = (scope: StoreScope, storeId: string | null): void => {
  if (scope !== null && storeId !== null && storeId !== scope) throw new CustomException("Store not found.", notFound);
};

const scopedJob = async (scope: StoreScope, id: string): Promise<IJob> => {
  const job = isUuid(id) ? await JobQuery.findById(id) : null;
  if (!job || (scope !== null && job.storeId !== scope)) throw jobNotFound();
  return job;
};

const notReady = (blockers: Array<{ code: string; message: string }>) =>
  new CustomException("That rider is not available or not eligible.", conflict, { blockers });

const workingRider = async (riderId: string): Promise<IRider> => {
  const rider = await RiderQuery.findRiderById(riderId);
  if (!rider) throw new CustomException("Rider not found.", notFound);
  const blockers = eligibilityBlockers(rider);
  if (!rider.available) blockers.push({ code: "not_available", message: "The rider has marked themselves unavailable." });
  if (blockers.length > 0) throw notReady(blockers);
  return rider;
};

const dispatchBy = (actor: Actor) => ({ userId: actor.id, name: actorName(actor, "Dispatch") });

// ------------------------------------------------------------------------ create

interface CommerceOrder {
  ref: string;
  storeId: string;
  customerName: string;
  customerPhone: string;
  priority?: string;
  paymentStatus?: string;
  amountPaise: number;
  paidPaise: number;
  address?: string;
  deliveryAddress?: string;
  pickupWindow?: { from?: string; to?: string } | null;
}

const lookupOrder = async (orderId: string): Promise<CommerceOrder> => {
  try {
    return await ServiceClient.get<CommerceOrder>("commerce", `/internal/orders/${orderId}`);
  } catch (error) {
    if (error instanceof CustomException && error.errorCode === notFound) throw new CustomException("Order not found.", notFound);
    throw error;
  }
};

const create = async (actor: Actor, scope: StoreScope, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const orderId = uuid(input.orderId, "orderId");
    const type = oneOf(input.type, JOB_TYPES, "type");
    const storeId = uuid(input.storeId, "storeId");
    checkStore(scope, storeId);
    const priorityInput = optionalOneOf(isBlank(input.priority) ? null : input.priority, JOB_PRIORITIES, "priority");
    const notes = text(input.notes, "notes", { max: 500 });
    let slotFrom = isBlank(input.slotFrom) ? null : dateTime(input.slotFrom, "slotFrom");
    let slotTo = isBlank(input.slotTo) ? null : dateTime(input.slotTo, "slotTo");
    if (slotFrom && slotTo && slotTo.getTime() <= slotFrom.getTime()) throw new CustomException("slotTo must be after slotFrom.", badRequest);

    const existing = await JobQuery.findByOrderAndType(orderId, type);
    if (existing) throw new CustomException(`This order already has a ${type} job.`, conflict, { jobId: existing.id });

    // The order, not the dispatcher, is the source of the customer's name, phone and what is still owed.
    const order = await lookupOrder(orderId);
    if (order.storeId !== storeId) throw new CustomException("That order belongs to a different store.", badRequest);

    const fallbackAddress = type === "delivery" ? order.deliveryAddress ?? order.address : order.address;
    if (isBlank(input.address) && isBlank(fallbackAddress)) throw new CustomException("address is required: the order has none on file.", badRequest);
    const address = parseAddress(isBlank(input.address) ? fallbackAddress : input.address);
    if (type === "pickup" && order.pickupWindow?.from && !slotFrom) {
      slotFrom = new Date(order.pickupWindow.from);
      slotTo = slotTo ?? (order.pickupWindow.to ? new Date(order.pickupWindow.to) : null);
    }
    const owed = type === "delivery" && order.paymentStatus !== "paid" ? Math.max(order.amountPaise - order.paidPaise, 0) : 0;

    const { job, created } = await JobCreateService.create({
      orderId,
      orderNumber: order.ref,
      type,
      storeId,
      address,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      slotFrom,
      slotTo,
      priority: priorityInput ?? (order.priority === "express" ? "express" : "normal"),
      notes,
      isPremium: false,
      isDelicate: false,
      requiresInspection: null,
      amountToCollectPaise: owed,
      careNotes: null,
      items: [],
      createdByUserId: actor.id,
      createdByName: actorName(actor, "Dispatch"),
    });
    if (!created) throw new CustomException(`This order already has a ${type} job.`, conflict, { jobId: job.id });
    return toDispatchJob(job);
  } catch (error) {
    throw toCustomException(error);
  }
};

// -------------------------------------------------------------------- read paths

const list = async (
  scope: StoreScope,
  query: { storeId?: unknown; riderId?: unknown; status?: unknown; type?: unknown; date?: unknown; page?: unknown; limit?: unknown }
) => {
  try {
    const requested = optionalUuid(query.storeId, "storeId");
    checkStore(scope, requested);
    const riderId = optionalUuid(query.riderId, "riderId");
    const status = optionalOneOf(isBlank(query.status) ? null : query.status, JOB_STATUSES, "status");
    const type = optionalOneOf(isBlank(query.type) ? null : query.type, JOB_TYPES, "type");
    const day = isBlank(query.date) ? null : dayFromQuery(query.date).range;
    const page = parsePage(query);
    const { items, total } = await JobQuery.list(
      { storeId: scope ?? requested, riderId, status, type, from: day?.from ?? null, to: day?.to ?? null },
      page
    );
    return toPage(items.map(toDispatchJob), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const unassigned = async (scope: StoreScope, query: { storeId?: unknown; date?: unknown }) => {
  try {
    const requested = optionalUuid(query.storeId, "storeId");
    checkStore(scope, requested);
    const day = isBlank(query.date) ? null : dayFromQuery(query.date).range;
    const jobs = await JobQuery.listUnassigned({ storeId: scope ?? requested, from: day?.from, to: day?.to }, UNASSIGNED_LIMIT);
    return {
      jobs: jobs.map((job) => ({
        id: job.id,
        type: job.type,
        slotFrom: job.slotFrom.toISOString(),
        priority: job.priority,
        orderNumber: job.orderNumber,
        storeId: job.storeId,
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const get = async (scope: StoreScope, id: string) => {
  try {
    return toDispatchJob(await scopedJob(scope, id));
  } catch (error) {
    throw toCustomException(error);
  }
};

const timeline = async (scope: StoreScope, id: string) => {
  try {
    const job = await scopedJob(scope, id);
    const events = await JobQuery.listEvents(job.id, TIMELINE_LIMIT);
    return { events: events.map((e) => ({ at: e.at.toISOString(), status: e.status, by: e.byName, note: e.note })) };
  } catch (error) {
    throw toCustomException(error);
  }
};

// What settles a "this stain was not there before" dispute: who signed, what the photos show, when.
const proof = async (scope: StoreScope, id: string) => {
  try {
    const job = await scopedJob(scope, id);
    const [stored, photos, inspection] = await Promise.all([
      JobQuery.findProof(job.id),
      JobQuery.listPhotos(job.id, 50),
      JobQuery.listInspections(job.id),
    ]);
    return {
      signature: stored?.signature ?? null,
      receivedBy: stored?.receivedBy ?? null,
      photos: photos.map((p) => p.url),
      inspection,
      pickedUpAt: job.pickedUpAt?.toISOString() ?? null,
      deliveredAt: job.type === "delivery" ? job.completedAt?.toISOString() ?? null : null,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ----------------------------------------------------------------------- change

const update = async (actor: Actor, scope: StoreScope, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const job = await scopedJob(scope, id);
    // Only these fields may change here; the body is never spread into the write.
    const patch: IJobPatch = {};
    const changed: string[] = [];

    if ("slotFrom" in input || "slotTo" in input) {
      const from = "slotFrom" in input && !isBlank(input.slotFrom) ? dateTime(input.slotFrom, "slotFrom") : job.slotFrom;
      const to = "slotTo" in input ? (isBlank(input.slotTo) ? null : dateTime(input.slotTo, "slotTo")) : job.slotTo;
      if (to && to.getTime() <= from.getTime()) throw new CustomException("slotTo must be after slotFrom.", badRequest);
      patch.slotFrom = from;
      patch.slotTo = to;
      changed.push("slot");
    }
    if (!isBlank(input.address)) {
      const address = parseAddress(input.address);
      let { latitude, longitude } = address;
      let source: string | null = latitude !== null ? "provided" : null;
      if (latitude === null || longitude === null) {
        // A changed address makes the old coordinates wrong; look them up again if we can.
        const found = await LocationService.resolveCoordinates(address);
        latitude = found?.latitude ?? null;
        longitude = found?.longitude ?? null;
        source = found ? "geocoded" : null;
      }
      Object.assign(patch, {
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2,
        landmark: address.landmark,
        city: address.city,
        pincode: address.pincode,
        latitude,
        longitude,
        coordinatesSource: source,
      });
      changed.push("address");
    }
    if (!isBlank(input.priority)) {
      patch.priority = oneOf(input.priority, JOB_PRIORITIES, "priority");
      changed.push("priority");
    }
    if ("notes" in input) {
      patch.notes = text(input.notes, "notes", { max: 500 });
      changed.push("notes");
    }
    if (changed.length === 0) throw new CustomException("Send at least one of slotFrom, slotTo, address, priority or notes.", badRequest);

    await JobQuery.inTransaction(async (tx) => {
      // Only until the rider sets off: after that the rider is acting on what they were given.
      const ok = await JobQuery.transition(job.id, { status: EDITABLE, riderId: job.riderId }, patch, tx);
      if (!ok) throw new CustomException("This job can no longer be edited.", conflict);
      await JobQuery.addEvent({ jobId: job.id, status: job.status, byUserId: actor.id, byName: actorName(actor, "Dispatch"), note: `Edited: ${changed.join(", ")}` }, tx);
    });
    return toDispatchJob((await JobQuery.findById(job.id)) as IJob);
  } catch (error) {
    throw toCustomException(error);
  }
};

const assign = async (actor: Actor, scope: StoreScope, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const riderId = uuid(input.riderId, "riderId");
    const job = await scopedJob(scope, id);
    if (job.status !== "pending") throw new CustomException("This job already has a rider. Use reassign to change it.", conflict);
    const rider = await workingRider(riderId);

    const by = dispatchBy(actor);
    const now = new Date();
    await JobQuery.inTransaction(async (tx) => {
      // The rider's row is locked while capacity is counted, so two dispatchers cannot both fill the last slot.
      await RiderQuery.lockRider(rider.id, tx);
      const load = (await JobQuery.activeCounts([rider.id], tx)).get(rider.id) ?? 0;
      if (load >= MAX_ACTIVE_JOBS_PER_RIDER) throw new CustomException("That rider already has the most jobs they can hold.", conflict);

      const won = await JobQuery.transition(job.id, { status: ["pending"], riderId: null }, { status: "assigned", riderId: rider.id, assignedAt: now, sequence: null }, tx);
      if (!won) throw new CustomException("This job is no longer waiting for a rider.", conflict);
      await JobQuery.releaseAssignment(job.id, "replaced", tx);
      await JobQuery.createAssignments([{ jobId: job.id, riderId: rider.id, assignedByUserId: by.userId, assignedAt: now }], tx);
      await JobQuery.addEvent({ jobId: job.id, status: "assigned", byUserId: by.userId, byName: by.name, note: `Assigned to ${rider.name}` }, tx);
    });
    return toDispatchJob((await JobQuery.findById(job.id)) as IJob);
  } catch (error) {
    throw toCustomException(error);
  }
};

const reassign = async (actor: Actor, scope: StoreScope, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const riderId = uuid(input.riderId, "riderId");
    const reason = requiredText(input.reason, "reason", 500);
    const job = await scopedJob(scope, id);
    if (!REASSIGNABLE.includes(job.status)) {
      throw new CustomException("A job can change rider only before the garments are collected or delivered.", conflict);
    }
    if (job.riderId === riderId) throw new CustomException("That rider already has this job.", badRequest);
    const rider = await workingRider(riderId);

    const by = dispatchBy(actor);
    const now = new Date();
    await JobQuery.inTransaction(async (tx) => {
      await RiderQuery.lockRider(rider.id, tx);
      const load = (await JobQuery.activeCounts([rider.id], tx)).get(rider.id) ?? 0;
      if (load >= MAX_ACTIVE_JOBS_PER_RIDER) throw new CustomException("That rider already has the most jobs they can hold.", conflict);

      // Still requires the status and rider that were read: a rider acting at this moment, or another
      // dispatcher, makes this fail cleanly instead of overwriting their change.
      const won = await JobQuery.transition(
        job.id,
        { status: [job.status], riderId: job.riderId },
        { status: "assigned", riderId: rider.id, assignedAt: now, startedAt: null, arrivedAt: null, sequence: null },
        tx
      );
      if (!won) throw staleJob();
      await JobQuery.releaseAssignment(job.id, `reassigned: ${reason}`, tx);
      await JobQuery.createAssignments([{ jobId: job.id, riderId: rider.id, assignedByUserId: by.userId, assignedAt: now }], tx);
      await JobQuery.addEvent({ jobId: job.id, status: "assigned", byUserId: by.userId, byName: by.name, note: `Reassigned to ${rider.name}: ${reason}` }, tx);
    });
    return toDispatchJob((await JobQuery.findById(job.id)) as IJob);
  } catch (error) {
    throw toCustomException(error);
  }
};

const cancel = async (actor: Actor, scope: StoreScope, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const reason = requiredText(input.reason, "reason", 500);
    const job = await scopedJob(scope, id);
    if (!CANCELLABLE.includes(job.status)) {
      throw new CustomException("A job cannot be cancelled once the garments are collected or it has finished.", conflict);
    }
    const by = dispatchBy(actor);
    await JobQuery.inTransaction(async (tx) => {
      await moveJob(tx, job, "cancelled", { cancelledAt: new Date(), cancelReason: reason }, { ...by, note: reason });
      await JobQuery.releaseAssignment(job.id, "cancelled", tx);
    });
    return { status: "cancelled" };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------ assignment at scale

const autoAssign = async (actor: Actor, scope: StoreScope, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const storeId = uuid(input.storeId, "storeId");
    checkStore(scope, storeId);
    const day = isBlank(input.date) ? null : dayFromQuery(input.date).range;
    const filter = { storeId, from: day?.from, to: day?.to };

    // Both candidate sets are bounded, so a busy morning cannot turn into a table scan.
    const jobs = await JobQuery.listUnassigned(filter, AUTO_ASSIGN_JOB_LIMIT);
    if (jobs.length === 0) return { assigned: 0, unassigned: 0 };
    const candidates = await RiderQuery.listCandidates({ today: toDateColumn(todayIst()), onShiftOnly: true, limit: AUTO_ASSIGN_RIDER_LIMIT });
    const riders = candidates.filter((rider) => eligibilityBlockers(rider).length === 0);
    const load = await JobQuery.activeCounts(riders.map((r) => r.id));

    // Fewest jobs first, then nearest; express jobs were listed first so they get the pick of the riders.
    const planned = new Map<string, string[]>();
    const taken = new Map(riders.map((r) => [r.id, load.get(r.id) ?? 0]));
    for (const job of jobs) {
      let best: { rider: IRider; load: number; km: number } | null = null;
      for (const rider of riders) {
        const held = taken.get(rider.id) as number;
        if (held >= MAX_ACTIVE_JOBS_PER_RIDER) continue;
        const km =
          job.latitude !== null && job.longitude !== null && rider.lastLatitude !== null && rider.lastLongitude !== null
            ? haversineKm({ latitude: job.latitude, longitude: job.longitude }, { latitude: rider.lastLatitude, longitude: rider.lastLongitude })
            : Number.POSITIVE_INFINITY;
        if (!best || held < best.load || (held === best.load && km < best.km)) best = { rider, load: held, km };
      }
      if (!best) break;
      taken.set(best.rider.id, best.load + 1);
      planned.set(best.rider.id, [...(planned.get(best.rider.id) ?? []), job.id]);
    }

    const by = dispatchBy(actor);
    let assigned = 0;
    for (const [riderId, jobIds] of planned) {
      const rider = riders.find((r) => r.id === riderId) as IRider;
      const now = new Date();
      assigned += await JobQuery.inTransaction(async (tx) => {
        await RiderQuery.lockRider(riderId, tx);
        const held = (await JobQuery.activeCounts([riderId], tx)).get(riderId) ?? 0;
        // One statement claims the rider's whole batch; jobs someone else took meanwhile are simply not won.
        const won = await JobQuery.claimPending(jobIds.slice(0, Math.max(MAX_ACTIVE_JOBS_PER_RIDER - held, 0)), riderId, now, tx);
        await JobQuery.createAssignments(won.map((jobId) => ({ jobId, riderId, assignedByUserId: by.userId, assignedAt: now })), tx);
        await JobQuery.addEvents(
          won.map((jobId) => ({ jobId, status: "assigned" as const, byUserId: by.userId, byName: by.name, note: `Auto-assigned to ${rider.name}` })),
          tx
        );
        return won.length;
      });
    }
    return { assigned, unassigned: await JobQuery.countUnassigned(filter) };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------------ routes

const listRoutes = async (scope: StoreScope, query: { riderId?: unknown; date?: unknown }) => {
  try {
    const { date, range } = dayFromQuery(query.date);
    const riderId = optionalUuid(query.riderId, "riderId");
    const summaries = await JobQuery.routeSummaries(range, { riderId, storeId: scope }, ROUTE_LIST_LIMIT);
    return { routes: summaries.map((s) => ({ riderId: s.riderId, date, stops: s.stops, distanceKm: round1(s.distanceMeters / 1000) })) };
  } catch (error) {
    throw toCustomException(error);
  }
};

// Re-plans a rider's day: Google picks the order for a round trip from where the rider is, and the
// result is saved as each job's place in the route. Without Maps the order falls back to slot time.
const optimizeRoute = async (_actor: Actor, scope: StoreScope, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const riderId = uuid(input.riderId, "riderId");
    if (isBlank(input.date)) throw new CustomException("date is required.", badRequest);
    const { range } = dayFromQuery(input.date);
    const rider = await RiderQuery.findRiderById(riderId);
    if (!rider) throw new CustomException("Rider not found.", notFound);

    // A store's dispatcher re-plans only the jobs of their own store.
    const jobs = await JobQuery.listActiveForRider(rider.id, range, MAX_ROUTE_STOPS + 1, scope);
    if (jobs.length > MAX_ROUTE_STOPS) {
      throw new CustomException(`A route can be optimised for at most ${MAX_ROUTE_STOPS} stops.`, conflict);
    }
    const located = jobs.filter((job) => job.latitude !== null && job.longitude !== null);
    const origin =
      riderPoint(rider) ??
      (rider.lastLatitude !== null && rider.lastLongitude !== null
        ? { latitude: rider.lastLatitude, longitude: rider.lastLongitude }
        : located[0]
          ? { latitude: located[0].latitude as number, longitude: located[0].longitude as number }
          : null);
    const plan = await LocationService.planRoute(rider.id, origin, jobs, { optimize: true });

    const bySlot = [...jobs].sort((a, b) => a.slotFrom.getTime() - b.slotFrom.getTime() || a.id.localeCompare(b.id));
    const order = plan ? [...plan.order, ...bySlot.map((j) => j.id).filter((jobId) => !plan.order.includes(jobId))] : bySlot.map((j) => j.id);

    await JobQuery.inTransaction((tx) =>
      JobQuery.setSequences(order.map((jobId, index) => ({ id: jobId, sequence: index + 1, distanceMeters: plan?.legMeters[jobId] ?? null })), tx)
    );
    return {
      stops: order.map((jobId, index) => ({ jobId, sequence: index + 1, etaMinutes: plan?.etaMinutes[jobId] ?? null })),
      totalDistanceKm: round1((plan?.totalMeters ?? 0) / 1000),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const DispatchJobService = {
  create,
  list,
  unassigned,
  autoAssign,
  get,
  update,
  assign,
  reassign,
  cancel,
  timeline,
  proof,
  listRoutes,
  optimizeRoute,
};
