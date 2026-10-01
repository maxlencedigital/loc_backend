import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { ServiceClient } from "../../commons/Http/ServiceClient.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import {
  APPLICATION_STATUSES,
  DOCUMENT_TYPES,
  DocumentType,
  IRider,
  IRiderApplication,
} from "../Models/Rider/Rider.Interface.js";
import { Actor } from "../Middleware/StoreScope.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { JobQuery } from "../Queries/Job.Query.js";
import { RiderQuery } from "../Queries/Rider.Query.js";
import { DateRange, dayRange, istDateOf, parseDate, rangeFromQuery, toDateColumn, todayIst } from "../Utils/Dates.js";
import { round1 } from "../Utils/Geo.js";
import { bool, isBlank, object, optionalOneOf, optionalUuid, queryText, requiredText, text } from "../Utils/Input.js";
import { eligibilityBlockers } from "./Eligibility.js";
import { REQUIRED_DOCUMENTS, missingDocuments } from "./RiderOnboarding.Service.js";
import { isUuid } from "../Utils/Uuid.js";

const OPEN = ["submitted", "documents_requested", "under_review"] as const;
const PERFORMANCE_LIMIT = 200;

const applicationNotFound = () => new CustomException("Application not found.", notFound);
const riderNotFound = () => new CustomException("Rider not found.", notFound);

const loadApplication = async (id: string): Promise<IRiderApplication> => {
  const application = isUuid(id) ? await RiderQuery.findApplicationById(id) : null;
  if (!application) throw applicationNotFound();
  return application;
};

const loadRider = async (id: string): Promise<IRider> => {
  const rider = isUuid(id) ? await RiderQuery.findRiderById(id) : null;
  if (!rider) throw riderNotFound();
  return rider;
};

const iso = (value: Date | null) => (value ? value.toISOString() : null);

// ----------------------------------------------------------------- applications

const listApplications = async (query: { status?: unknown; city?: unknown; from?: unknown; to?: unknown; page?: unknown; limit?: unknown }) => {
  try {
    const status = optionalOneOf(isBlank(query.status) ? null : query.status, APPLICATION_STATUSES, "status");
    const city = queryText(query.city, "city", 80);
    const from = isBlank(query.from) ? null : dayRange(parseDate(query.from, "from")).from;
    const to = isBlank(query.to) ? null : dayRange(parseDate(query.to, "to")).to;
    const page = parsePage(query);
    const { items, total } = await RiderQuery.listApplications({ status, city, from, to }, page);
    return toPage(
      items.map((a) => ({
        id: a.id,
        name: a.name,
        phone: a.phone,
        city: a.city,
        vehicleType: a.vehicleType,
        status: a.status,
        submittedAt: a.submittedAt.toISOString(),
      })),
      total,
      page
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

const getApplication = async (id: string) => {
  try {
    const a = await loadApplication(id);
    const documents = await RiderQuery.listDocuments(a.id);
    const uploaded = documents.map((d) => d.type);
    return {
      id: a.id,
      name: a.name,
      phone: a.phone,
      email: a.email,
      city: a.city,
      vehicleType: a.vehicleType,
      vehicleNumber: a.vehicleNumber,
      // Masked at the door: only the last four characters were ever stored.
      drivingLicence: a.drivingLicenceMasked,
      idType: a.idType,
      idNumber: a.idNumberMasked,
      preferredStoreId: a.preferredStoreId,
      status: a.status,
      submittedAt: a.submittedAt.toISOString(),
      documents: documents.map((d) => ({ type: d.type, fileUrl: d.fileUrl, uploadedAt: d.updatedAt.toISOString() })),
      missingDocuments: missingDocuments(a, uploaded),
      verification: {
        identityVerified: a.identityVerified,
        vehicleVerified: a.vehicleVerified,
        insuranceValid: a.insuranceValid,
        insuranceExpiry: a.insuranceExpiry ? istDateOf(a.insuranceExpiry) : null,
        notes: a.verifyNotes,
        verifiedAt: iso(a.verifiedAt),
      },
      decision: { decidedAt: iso(a.decidedAt), notes: a.decisionNotes, rejectionReason: a.rejectionReason },
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const requestDocuments = async (_actor: Actor, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    if (!Array.isArray(input.documents) || input.documents.length < 1 || input.documents.length > DOCUMENT_TYPES.length) {
      throw new CustomException(`documents must list 1 to ${DOCUMENT_TYPES.length} of: ${DOCUMENT_TYPES.join(", ")}.`, badRequest);
    }
    const documents = [...new Set(input.documents.map((d) => optionalOneOf(d, DOCUMENT_TYPES, "documents") as DocumentType))];
    const message = text(input.message, "message", { max: 500 });
    const application = await loadApplication(id);

    const ok = await RiderQuery.updateApplication(application.id, [...OPEN], {
      status: "documents_requested",
      requestedDocuments: documents,
      requestMessage: message,
    });
    if (!ok) throw new CustomException("This application has already been decided.", conflict);
    return { status: "documents_requested", requestedDocuments: documents };
  } catch (error) {
    throw toCustomException(error);
  }
};

const verify = async (actor: Actor, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const identityVerified = bool(input.identityVerified, "identityVerified");
    const vehicleVerified = bool(input.vehicleVerified, "vehicleVerified");
    const insuranceValid = bool(input.insuranceValid, "insuranceValid");
    const expiry = isBlank(input.insuranceExpiry) ? null : parseDate(input.insuranceExpiry, "insuranceExpiry");
    if (insuranceValid && !expiry) throw new CustomException("insuranceExpiry is required when the insurance is valid.", badRequest);
    if (insuranceValid && expiry && expiry < todayIst()) {
      throw new CustomException("insuranceExpiry is in the past, so the insurance is not valid.", badRequest);
    }
    const notes = text(input.notes, "notes", { max: 1000 });
    const application = await loadApplication(id);

    const ok = await RiderQuery.updateApplication(application.id, [...OPEN], {
      identityVerified,
      vehicleVerified,
      insuranceValid,
      insuranceExpiry: expiry ? toDateColumn(expiry) : null,
      verifyNotes: notes,
      verifiedByUserId: actor.id,
      verifiedAt: new Date(),
    });
    if (!ok) throw new CustomException("This application has already been decided.", conflict);
    return { identityVerified, vehicleVerified, insuranceValid, insuranceExpiry: expiry };
  } catch (error) {
    throw toCustomException(error);
  }
};

interface GatewayUser {
  id: string;
  role: string;
  isActive: boolean;
}

// The rider's login is a gateway account with the driver role, created by an admin there.
const linkableAccount = async (userId: string): Promise<GatewayUser> => {
  let user: GatewayUser;
  try {
    user = await ServiceClient.get<GatewayUser>("gateway", `/internal/users/${userId}`);
  } catch (error) {
    if (error instanceof CustomException && error.errorCode === notFound) {
      throw new CustomException("No account exists for that userId.", badRequest);
    }
    throw error;
  }
  if (user.role !== "driver") throw new CustomException("That account does not have the driver role.", badRequest);
  if (!user.isActive) throw new CustomException("That account is not active.", badRequest);
  return user;
};

const approve = async (actor: Actor, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const storeId = optionalUuid(input.storeId, "storeId");
    const notes = text(input.notes, "notes", { max: 1000 });
    const userId = optionalUuid(input.userId, "userId");
    const application = await loadApplication(id);

    // Approving again with a userId is how a rider approved without an account gets linked later.
    if (application.status === "approved") {
      const rider = await RiderQuery.findRiderByApplicationId(application.id);
      if (!rider || !userId || rider.userId) throw new CustomException("This application is already approved.", conflict);
      await linkableAccount(userId);
      try {
        await RiderQuery.updateRider(rider.id, { userId, status: "active" });
      } catch (error) {
        if (isUniqueViolation(error)) throw new CustomException("That account is already linked to another rider.", conflict);
        throw error;
      }
      await RiderQuery.addRiderEvent({ riderId: rider.id, kind: "account_linked", note: null, byUserId: actor.id });
      return { riderId: rider.id, loginCreated: false, loginLinked: true };
    }
    if (application.status === "rejected") throw new CustomException("A rejected application cannot be approved.", conflict);

    const documents = (await RiderQuery.listDocuments(application.id)).map((d) => d.type);
    const lacking: string[] = [
      ...REQUIRED_DOCUMENTS.filter((t) => !documents.includes(t)).map((t) => `document:${t}`),
      ...(application.identityVerified ? [] : ["identity"]),
      ...(application.vehicleVerified ? [] : ["vehicle"]),
      ...(application.insuranceValid && application.insuranceExpiry ? [] : ["insurance"]),
    ];
    if (lacking.length > 0) throw new CustomException("Verification is incomplete.", conflict, { missing: lacking });
    const expiry = application.insuranceExpiry as Date;
    if (istDateOf(expiry) < todayIst()) throw new CustomException("The recorded insurance has expired.", conflict, { missing: ["insurance"] });

    if (userId) await linkableAccount(userId);

    try {
      const rider = await JobQuery.inTransaction(async (tx) => {
        const locked = await RiderQuery.lockApplication(application.id, tx);
        if (!locked) throw applicationNotFound();
        const decided = await RiderQuery.updateApplication(
          application.id,
          [...OPEN],
          { status: "approved", decidedByUserId: actor.id, decidedAt: new Date(), decisionNotes: notes },
          tx
        );
        if (!decided) throw new CustomException("This application has already been decided.", conflict);
        const created = await RiderQuery.createRider(
          {
            userId,
            applicationId: application.id,
            name: application.name,
            phone: application.phone,
            email: application.email,
            city: application.city,
            vehicleType: application.vehicleType,
            vehicleNumber: application.vehicleNumber,
            homeStoreId: storeId ?? application.preferredStoreId,
            status: userId ? "active" : "inactive",
            identityVerified: true,
            vehicleVerified: true,
            insuranceValid: true,
            insuranceExpiry: expiry,
            approvedByUserId: actor.id,
            approvedAt: new Date(),
          },
          tx
        );
        await RiderQuery.addRiderEvent({ riderId: created.id, kind: "approved", note: notes, byUserId: actor.id }, tx);
        return created;
      });
      return { riderId: rider.id, loginCreated: false, loginLinked: userId !== null };
    } catch (error) {
      if (isUniqueViolation(error)) throw new CustomException("A rider with this phone number or account already exists.", conflict);
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const reject = async (actor: Actor, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const reason = requiredText(input.reason, "reason", 500);
    const application = await loadApplication(id);
    const ok = await RiderQuery.updateApplication(application.id, [...OPEN], {
      status: "rejected",
      // Frees the phone number so the person can apply again.
      openPhone: null,
      rejectionReason: reason,
      decidedByUserId: actor.id,
      decidedAt: new Date(),
    });
    if (!ok) throw new CustomException("This application has already been decided.", conflict);
    return { status: "rejected" };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ----------------------------------------------------------------- performance

const periodRange = (value: unknown): DateRange => {
  if (isBlank(value)) return rangeFromQuery({}, { defaultDays: 30, maxDays: 366 });
  const period = queryText(value, "period", 10);
  const days = /^(\d{1,3})d$/.exec(period ?? "");
  if (days) return rangeFromQuery({}, { defaultDays: Math.min(Math.max(Number(days[1]), 1), 366), maxDays: 366 });
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period ?? "");
  if (month) {
    const first = `${month[1]}-${month[2]}-01`;
    const nextMonth = Number(month[2]) === 12 ? `${Number(month[1]) + 1}-01-01` : `${month[1]}-${String(Number(month[2]) + 1).padStart(2, "0")}-01`;
    return { from: dayRange(first).from, to: dayRange(nextMonth).from };
  }
  throw new CustomException("period must be like 7d, 30d, 90d or 2026-09.", badRequest);
};

const listPerformance = async (query: { storeId?: unknown; period?: unknown }) => {
  try {
    const range = periodRange(query.period);
    const storeId = optionalUuid(query.storeId, "storeId");
    const stats = await JobQuery.riderStats(range, { storeId }, PERFORMANCE_LIMIT);
    const ids = stats.map((s) => s.riderId);
    const [riders, ratings] = await Promise.all([RiderQuery.findRidersByIds(ids), RiderQuery.ratingAverages(ids, range)]);
    const names = new Map(riders.map((r) => [r.id, r.name]));
    return {
      riders: stats.map((s) => ({
        riderId: s.riderId,
        name: names.get(s.riderId) ?? null,
        jobsCompleted: s.jobsCompleted,
        onTimePct: s.measuredJobs > 0 ? round1((s.onTimeJobs / s.measuredJobs) * 100) : null,
        avgRating: ratings.has(s.riderId) ? Math.round((ratings.get(s.riderId) as number) * 100) / 100 : null,
        distanceKm: round1(s.distanceMeters / 1000),
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const getPerformance = async (id: string, query: { from?: unknown; to?: unknown }) => {
  try {
    const range = rangeFromQuery(query, { defaultDays: 30, maxDays: 366 });
    const rider = await loadRider(id);
    const [stats] = await JobQuery.riderStats(range, { riderId: rider.id }, 1);
    const ratings = await RiderQuery.ratingSummary(rider.id, range);
    return {
      jobsCompleted: stats?.jobsCompleted ?? 0,
      avgTimeMinutes: stats?.avgDurationMinutes != null ? round1(stats.avgDurationMinutes) : null,
      distanceKm: round1((stats?.distanceMeters ?? 0) / 1000),
      onTimePct: stats && stats.measuredJobs > 0 ? round1((stats.onTimeJobs / stats.measuredJobs) * 100) : null,
      avgRating: ratings.average === null ? null : Math.round(ratings.average * 100) / 100,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ---------------------------------------------------------- eligibility and status

const eligibility = async (id: string) => {
  try {
    const blockers = eligibilityBlockers(await loadRider(id));
    return { eligible: blockers.length === 0, blockers };
  } catch (error) {
    throw toCustomException(error);
  }
};

const suspend = async (actor: Actor, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const reason = requiredText(input.reason, "reason", 500);
    const rider = await loadRider(id);

    await JobQuery.inTransaction(async (tx) => {
      const locked = await RiderQuery.lockRider(rider.id, tx);
      if (!locked || locked.status === "suspended") throw new CustomException("This rider is already suspended.", conflict);
      await RiderQuery.updateRider(
        rider.id,
        { status: "suspended", available: false, suspendedReason: reason, suspendedAt: new Date(), suspendedByUserId: actor.id },
        tx
      );
      await RiderQuery.addRiderEvent({ riderId: rider.id, kind: "suspended", note: reason, byUserId: actor.id }, tx);
    });
    // New jobs stop at once; jobs already in hand stay so dispatch can decide what to do with them.
    const active = (await JobQuery.activeCounts([rider.id])).get(rider.id) ?? 0;
    return { status: "suspended", activeJobs: active };
  } catch (error) {
    throw toCustomException(error);
  }
};

const reinstate = async (actor: Actor, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const note = text(input.note, "note", { max: 500 });
    const rider = await loadRider(id);

    const status = await JobQuery.inTransaction(async (tx) => {
      const locked = await RiderQuery.lockRider(rider.id, tx);
      if (!locked || locked.status !== "suspended") throw new CustomException("This rider is not suspended.", conflict);
      // Without a linked login the rider still cannot work: back to inactive until HR links one.
      const next = locked.userId ? "active" : "inactive";
      await RiderQuery.updateRider(rider.id, { status: next, suspendedReason: null, suspendedAt: null, suspendedByUserId: null }, tx);
      await RiderQuery.addRiderEvent({ riderId: rider.id, kind: "reinstated", note, byUserId: actor.id }, tx);
      return next;
    });
    return { status };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const HrRiderService = {
  listApplications,
  getApplication,
  requestDocuments,
  verify,
  approve,
  reject,
  listPerformance,
  getPerformance,
  eligibility,
  suspend,
  reinstate,
};
