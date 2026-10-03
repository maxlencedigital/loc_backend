import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope, StoreScope } from "../Middleware/StoreScope.js";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  IIncident,
  IIncidentAccess,
  IIncidentChange,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
} from "../Models/Ops/Incident.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { OpsActivityQuery } from "../Queries/OpsActivity.Query.js";
import { inTransaction } from "../Queries/OpsCompliance.Db.js";
import { SafetyIncidentQuery } from "../Queries/SafetyIncident.Query.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { oneOf, optionalOneOf, optionalText, parseBody, queryString, text } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { OpsClaimService } from "./OpsClaim.Service.js";
import {
  STORE_NOT_FOUND,
  activityRow,
  boundedArray,
  dayString,
  nullableText,
  optionalDay,
  parseDayRange,
  parseFileRef,
  parseInstant,
  requireActiveUsers,
  storeFilter,
  storeForWrite,
  todayInIst,
  uuidField,
} from "./OpsCompliance.Shared.js";

const MAX_PEOPLE = 20;
const MAX_ACTIONS = 50;
const MAX_PHOTOS = 20;
const MAX_PHOTOS_PER_CALL = 10;
const TIMELINE_SHOWN = 200;
const MAX_ESCALATED_ACTIONS = 100 * MAX_ACTIONS;
const FUTURE_SKEW_MS = 5 * 60_000;
const MAX_AGE_MS = 2 * 366 * 86_400_000;
const NOT_FOUND = "Incident not found.";

// What severity a report gets when the reporter does not say.
const DEFAULT_SEVERITY: Record<IncidentType, IncidentSeverity> = {
  hospitalisation: "critical",
  injury: "high",
  fire_risk: "high",
  vehicle_accident: "high",
  security: "medium",
  property_damage: "medium",
  other: "medium",
  near_miss: "low",
  unsafe_condition: "low",
};

const CLAIM_TYPE: Record<IncidentType, string> = {
  injury: "accident",
  hospitalisation: "medical",
  fire_risk: "fire",
  security: "theft",
  vehicle_accident: "vehicle_damage",
  property_damage: "other",
  near_miss: "other",
  unsafe_condition: "other",
  other: "other",
};

const stale = () => new CustomException("This was changed by someone else just now. Reload and try again.", conflict);
const wrongState = (message: string) => new CustomException(message, conflict);
const rank = (severity: IncidentSeverity) => INCIDENT_SEVERITIES.indexOf(severity);

const requireId = (id: string) => {
  if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
};

/** Reporting is open to riders, who are not store-bound and so have no store scope. */
export const reporterScope = (req: IdentifiedRequest): StoreScope =>
  req.user?.role === "driver" ? null : resolveStoreScope(req);

const toListItem = (incident: IIncident) => ({
  id: incident.id,
  type: incident.type,
  severity: incident.severity,
  status: incident.status,
  storeId: incident.storeId,
  occurredAt: incident.occurredAt.toISOString(),
  location: incident.location,
  assigneeId: incident.assigneeId,
  createdAt: incident.createdAt.toISOString(),
});

const toDetail = (incident: IIncident, timeline: Awaited<ReturnType<typeof OpsActivityQuery.forEntity>>) => ({
  ...toListItem(incident),
  description: incident.description,
  peopleInvolved: incident.peopleInvolved,
  immediateAction: incident.immediateAction,
  reportedBy: incident.reportedBy,
  reportedByName: incident.reportedByName,
  assignedAt: incident.assignedAt?.toISOString() ?? null,
  escalatedAt: incident.escalatedAt?.toISOString() ?? null,
  escalationReason: incident.escalationReason,
  photos: incident.photos,
  closedAt: incident.closedAt?.toISOString() ?? null,
  closedBy: incident.closedBy,
  outcome: incident.outcome,
  rootCause: incident.rootCause,
  preventiveMeasures: incident.preventiveMeasures,
  claimId: incident.claimId,
  timeline: timeline.map((row) => ({
    at: row.at.toISOString(),
    action: row.action,
    by: row.actorName,
    byUserId: row.actorId,
    from: row.fromStatus,
    to: row.toStatus,
    detail: row.detail,
  })),
});

const detailOf = async (incident: IIncident) =>
  toDetail(incident, await OpsActivityQuery.forEntity("incident", incident.id, TIMELINE_SHOWN));

const parseKey = (value: unknown): string | null => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^[\x21-\x7e]{8,100}$/.test(value)) {
    throw new CustomException("Idempotency-Key must be 8 to 100 visible characters.", badRequest);
  }
  return value;
};

// -------------------------------------------------------------------- report
const report = async (user: RequestUser, scope: StoreScope, input: unknown, idempotencyKey?: string) => {
  try {
    const body = parseBody(input);
    const key = parseKey(idempotencyKey);
    const type = oneOf(body.type, INCIDENT_TYPES, "type");
    const description = text(body.description, "description", 4000);
    const occurredAt = parseInstant(body.occurredAt, "occurredAt");
    const now = Date.now();
    if (occurredAt.getTime() > now + FUTURE_SKEW_MS) throw new CustomException("occurredAt cannot be in the future.", badRequest);
    if (occurredAt.getTime() < now - MAX_AGE_MS) throw new CustomException("occurredAt is too long ago to report.", badRequest);
    const severity = optionalOneOf(body.severity, INCIDENT_SEVERITIES, "severity") ?? DEFAULT_SEVERITY[type];
    const location = optionalText(body.location, "location", 200) ?? null;
    const immediateAction = optionalText(body.immediateAction, "immediateAction", 2000) ?? null;
    const peopleInvolved =
      body.peopleInvolved === undefined
        ? []
        : [...new Set(boundedArray(body.peopleInvolved, "peopleInvolved", MAX_PEOPLE).map((id) => uuidField(id, "peopleInvolved")))];

    // A store-bound reporter's store comes from their account, never from the request.
    let storeId: string | null;
    if (user.role === "driver") {
      storeId = isUuid(user.storeId) ? user.storeId : null;
      if (body.storeId !== undefined && body.storeId !== storeId) throw new CustomException(STORE_NOT_FOUND, notFound);
    } else {
      storeId = await storeForWrite(scope, body.storeId);
    }

    if (key) {
      const earlier = await SafetyIncidentQuery.findByKey(user.id, key);
      if (earlier) return { id: earlier.id, status: earlier.status, severity: earlier.severity };
    }
    try {
      const incident = await inTransaction(async (tx) => {
        const created = await SafetyIncidentQuery.create(
          {
            type, description, occurredAt, severity, storeId, location, peopleInvolved, immediateAction,
            reportedBy: user.id,
            reportedByName: user.name,
            idempotencyKey: key,
          },
          tx
        );
        await OpsActivityQuery.append(
          activityRow(user, {
            entity: "incident",
            entityId: created.id,
            action: "reported",
            storeId,
            toStatus: "open",
            detail: { type, severity },
          }),
          tx
        );
        return created;
      });
      return { id: incident.id, status: incident.status, severity: incident.severity };
    } catch (error) {
      // Two simultaneous submissions of one key: the loser returns the winner's incident.
      if (key && isUniqueViolation(error)) {
        const winner = await SafetyIncidentQuery.findByKey(user.id, key);
        if (winner) return { id: winner.id, status: winner.status, severity: winner.severity };
      }
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------- reads
const list = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await SafetyIncidentQuery.search(
      {
        storeId: storeFilter(scope, query) ?? scope,
        status: optionalOneOf(queryString(query.status, "status"), INCIDENT_STATUSES, "status"),
        type: optionalOneOf(queryString(query.type, "type"), INCIDENT_TYPES, "type"),
        severity: optionalOneOf(queryString(query.severity, "severity"), INCIDENT_SEVERITIES, "severity"),
        ...parseDayRange(query),
      },
      page
    );
    return toPage(items.map(toListItem), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getById = async (id: string, scope: StoreScope) => {
  try {
    requireId(id);
    const incident = await SafetyIncidentQuery.findById(id, { storeId: scope });
    if (!incident) throw new CustomException(NOT_FOUND, notFound);
    return await detailOf(incident);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Incidents currently escalated to management; one query fetches every incident's actions.
const escalated = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await SafetyIncidentQuery.searchEscalated(scope, page);
    const actions = await OpsActivityQuery.forEntities(
      "incident",
      items.map((i) => i.id),
      "action_recorded",
      MAX_ESCALATED_ACTIONS
    );
    const byIncident = new Map<string, string[]>();
    for (const row of actions) {
      const list = byIncident.get(row.entityId) ?? [];
      list.push(String(row.detail?.action ?? ""));
      byIncident.set(row.entityId, list);
    }
    return {
      incidents: items.map((i) => ({
        id: i.id,
        type: i.type,
        severity: i.severity,
        storeId: i.storeId,
        escalatedAt: i.escalatedAt?.toISOString() ?? null,
        escalationReason: i.escalationReason,
        actionsTaken: byIncident.get(i.id) ?? [],
      })),
      page: page.page,
      limit: page.limit,
      total,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const summary = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const result = await SafetyIncidentQuery.summarise({
      storeId: storeFilter(scope, query) ?? scope,
      ...parseDayRange(query),
    });
    const codes =
      result.repeats.length > 0 ? new Map((await StoreQuery.list(null)).map((s) => [s.id, s.code])) : new Map<string, string>();
    const toObject = (rows: { key: string; count: number }[]) => Object.fromEntries(rows.map((r) => [r.key, r.count]));
    return {
      total: result.byType.reduce((sum, row) => sum + row.count, 0),
      open: result.open,
      byType: toObject(result.byType),
      bySeverity: toObject(result.bySeverity),
      repeatPatterns: result.repeats.map((r) => ({
        pattern: `${r.type} at ${r.storeId ? (codes.get(r.storeId) ?? r.storeId) : "no store"}`,
        count: r.count,
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------- transitions
interface IMove {
  action: string;
  to: IncidentStatus;
  change: IIncidentChange["data"];
  detail?: Record<string, unknown>;
  expectedSeverity?: IncidentSeverity;
  addAction?: boolean;
  /** A second history row written in the same transaction (a severity change). */
  also?: { action: string; detail: Record<string, unknown> };
}

// One guarded write plus its history row, in one transaction. The guarded UPDATE is what
// settles two conflicting requests: the second finds the status already moved.
const applyMove = async (current: IIncident, user: RequestUser, move: IMove) => {
  const updated = await inTransaction(async (tx) => {
    const changed = await SafetyIncidentQuery.change(
      current.id,
      {
        expectedStatus: current.status,
        expectedSeverity: move.expectedSeverity,
        data: { status: move.to, ...move.change },
        ...(move.addAction ? { addAction: { cap: MAX_ACTIONS } } : {}),
      },
      tx
    );
    if (!changed) {
      if (move.addAction && current.actionCount >= MAX_ACTIONS) {
        throw wrongState(`At most ${MAX_ACTIONS} actions can be recorded on one incident.`);
      }
      throw stale();
    }
    await OpsActivityQuery.append(
      activityRow(user, {
        entity: "incident",
        entityId: current.id,
        action: move.action,
        storeId: current.storeId,
        fromStatus: current.status,
        toStatus: changed.status,
        detail: move.detail ?? null,
      }),
      tx
    );
    if (move.also) {
      await OpsActivityQuery.append(
        activityRow(user, { entity: "incident", entityId: current.id, action: move.also.action, storeId: current.storeId, detail: move.also.detail }),
        tx
      );
    }
    return changed;
  });
  return await detailOf(updated);
};

const load = async (id: string, scope: StoreScope): Promise<IIncident> => {
  requireId(id);
  const incident = await SafetyIncidentQuery.findById(id, { storeId: scope });
  if (!incident) throw new CustomException(NOT_FOUND, notFound);
  if (incident.status === "closed") throw wrongState("This incident is closed.");
  return incident;
};

const assign = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const assigneeId = uuidField(parseBody(input).assigneeId, "assigneeId");
    await requireActiveUsers([assigneeId], "assigneeId");
    const current = await load(id, scope);
    return await applyMove(current, user, {
      action: current.assigneeId ? "reassigned" : "assigned",
      to: current.status === "open" ? "assigned" : current.status,
      change: { assigneeId, assignedAt: new Date() },
      detail: { assigneeId, previousAssigneeId: current.assigneeId },
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const recordAction = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const action = text(body.action, "action", 1000);
    const doneBy = body.doneBy === undefined || body.doneBy === null ? null : uuidField(body.doneBy, "doneBy");
    const doneOn = optionalDay(body.doneOn, "doneOn") ?? null;
    if (doneOn && doneOn > todayInIst()) throw new CustomException("doneOn cannot be in the future.", badRequest);
    const severity = optionalOneOf(body.severity, INCIDENT_SEVERITIES, "severity");
    const reason = nullableText(body.severityReason, "severityReason", 500) ?? null;
    if (doneBy) await requireActiveUsers([doneBy], "doneBy");

    const current = await load(id, scope);
    // Severity only rises silently; lowering it needs a reason, and both are recorded.
    const changesSeverity = severity !== undefined && severity !== current.severity;
    if (changesSeverity && rank(severity) < rank(current.severity) && !reason) {
      throw new CustomException("severityReason is required to lower an incident's severity.", badRequest);
    }
    return await applyMove(current, user, {
      action: "action_recorded",
      to: current.status === "open" || current.status === "assigned" ? "in_progress" : current.status,
      change: changesSeverity ? { severity } : {},
      expectedSeverity: changesSeverity ? current.severity : undefined,
      addAction: true,
      detail: { action, doneBy, doneOn: doneOn ? dayString(doneOn) : null },
      ...(changesSeverity ? { also: { action: "severity_changed", detail: { from: current.severity, to: severity, reason } } } : {}),
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const escalate = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const reason = text(parseBody(input).reason, "reason", 500);
    const current = await load(id, scope);
    if (current.status === "escalated") throw wrongState("This incident is already escalated.");
    return await applyMove(current, user, {
      action: "escalated",
      to: "escalated",
      change: { escalatedAt: new Date(), escalationReason: reason },
      detail: { reason },
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const close = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const outcome = text(body.outcome, "outcome", 2000);
    const preventiveMeasures = text(body.preventiveMeasures, "preventiveMeasures", 2000);
    const rootCause = optionalText(body.rootCause, "rootCause", 2000) ?? null;
    const current = await load(id, scope);
    if (current.status === "open") throw wrongState("Assign the incident or record an action before closing it.");
    return await applyMove(current, user, {
      action: "closed",
      to: "closed",
      change: { closedAt: new Date(), closedBy: user.id, outcome, rootCause, preventiveMeasures },
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------ photos
// A reporter (staff, rider) may add to what they reported; a manager to their store's.
const photoAccess = (user: RequestUser, scope: StoreScope): IIncidentAccess =>
  user.role === "staff" || user.role === "driver" ? { storeId: null, reportedBy: user.id } : { storeId: scope };

// References to photos kept elsewhere (https link + metadata); this service stores no files.
const addPhotos = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    requireId(id);
    const body = parseBody(input);
    if (body.photos === undefined) {
      throw new CustomException("Send JSON with photos: a list of { url, name?, caption? } (https links).", badRequest);
    }
    const parsed = boundedArray(body.photos, "photos", MAX_PHOTOS_PER_CALL).map((p, i) => parseFileRef(p, `photos[${i}]`));
    if (parsed.length === 0) throw new CustomException("photos must not be empty.", badRequest);
    const access = photoAccess(user, scope);

    return await inTransaction(async (tx) => {
      const current = await SafetyIncidentQuery.lockById(id, access, tx);
      if (!current) throw new CustomException(NOT_FOUND, notFound);
      if (current.photos.length + parsed.length > MAX_PHOTOS) {
        throw wrongState(`An incident can hold at most ${MAX_PHOTOS} photos.`);
      }
      const added = parsed.map(({ contentType: _c, ...p }) => ({ ...p, addedBy: user.id, addedAt: new Date().toISOString() }));
      await SafetyIncidentQuery.setPhotos(id, [...current.photos, ...added], tx);
      await OpsActivityQuery.append(
        activityRow(user, {
          entity: "incident",
          entityId: id,
          action: "photos_added",
          storeId: current.storeId,
          detail: { count: added.length },
        }),
        tx
      );
      return { photos: added };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------- claim
// The insurance module owns claims; this raises one from the incident's own facts and
// remembers its id. The claim call is idempotent per incident, so a retry cannot double it.
const raiseClaim = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    requireId(id);
    const body = parseBody(input);
    const policyId = uuidField(body.policyId, "policyId");
    if (body.claimAmount === undefined || body.claimAmount === null) {
      throw new CustomException("claimAmount is required.", badRequest);
    }
    const incident = await SafetyIncidentQuery.findById(id, { storeId: scope });
    if (!incident) throw new CustomException(NOT_FOUND, notFound);
    if (incident.claimId) return { claimId: incident.claimId };

    const claim = (await OpsClaimService.create(
      user,
      {
        policyId,
        type: CLAIM_TYPE[incident.type],
        description: incident.description.slice(0, 2000),
        incidentDate: dayString(todayInIst(incident.occurredAt)),
        claimAmount: body.claimAmount,
        incidentId: incident.id,
        ...(incident.storeId ? { storeId: incident.storeId } : {}),
      },
      `incident-claim-${incident.id}`
    )) as { id: string };

    const claimId = await inTransaction(async (tx) => {
      if (await SafetyIncidentQuery.recordClaim(id, claim.id, new Date(), tx)) {
        await OpsActivityQuery.append(
          activityRow(user, {
            entity: "incident",
            entityId: id,
            action: "claim_raised",
            storeId: incident.storeId,
            detail: { claimId: claim.id, policyId },
          }),
          tx
        );
        return claim.id;
      }
      return (await SafetyIncidentQuery.findById(id, { storeId: null }, tx))?.claimId ?? claim.id;
    });
    return { claimId };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const IncidentService = {
  report,
  list,
  escalated,
  summary,
  getById,
  recordAction,
  assign,
  raiseClaim,
  close,
  escalate,
  addPhotos,
};
