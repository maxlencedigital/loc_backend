import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import {
  AUDIT_STATUSES,
  AUDIT_TYPES,
  CHECKLIST_RESULTS,
  FINDING_SEVERITIES,
  IAudit,
  IAuditChecklistEntry,
  IFinding,
  IFindingUpdate,
} from "../Models/Ops/Audit.Interface.js";
import { AuditQuery } from "../Queries/Audit.Query.js";
import { OpsActivityQuery } from "../Queries/OpsActivity.Query.js";
import { inTransaction } from "../Queries/OpsCompliance.Db.js";
import { oneOf, optionalOneOf, optionalText, parseBody, queryString, text } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import {
  activityRow,
  addDays,
  boundedArray,
  dayString,
  daysBetween,
  istDayStart,
  nullableText,
  optionalDay,
  parseDay,
  parseHttpsUrl,
  queryBoolean,
  queryUuid,
  requireActiveUsers,
  storeFilter,
  storeForWrite,
  todayInIst,
  uuidField,
} from "./OpsCompliance.Shared.js";

const MAX_CHECKLIST = 100;
const MAX_EVIDENCE_PER_LINE = 5;
const MAX_ACTIVITY_SPAN_DAYS = 366;
const DEFAULT_ACTIVITY_DAYS = 90;
const HISTORY_SHOWN = 100;
const NOT_FOUND = "Audit not found.";
const FINDING_NOT_FOUND = "Finding not found.";

const stale = () => new CustomException("This was changed by someone else just now. Reload and try again.", conflict);
const wrongState = (message: string) => new CustomException(message, conflict);

const requireAuditId = (id: string) => {
  if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
};
const requireFindingId = (id: string) => {
  if (!isUuid(id)) throw new CustomException(FINDING_NOT_FOUND, notFound);
};

const checklistView = (checklist: IAuditChecklistEntry[]) => checklist;

const toAuditView = (audit: IAudit, openFindings: number) => ({
  id: audit.id,
  type: audit.type,
  title: audit.title,
  scheduledFor: dayString(audit.scheduledFor),
  status: audit.status,
  storeId: audit.storeId,
  scope: audit.scope,
  auditor: audit.auditor,
  openFindings,
  createdAt: audit.createdAt.toISOString(),
});

const toFindingView = (finding: IFinding, today: Date) => ({
  id: finding.id,
  auditId: finding.auditId,
  title: finding.title,
  description: finding.description,
  severity: finding.severity,
  status: finding.status,
  ownerId: finding.ownerId,
  storeId: finding.storeId,
  dueDate: finding.dueDate ? dayString(finding.dueDate) : null,
  daysOverdue:
    finding.status !== "closed" && finding.dueDate && finding.dueDate < today ? daysBetween(finding.dueDate, today) : 0,
  correctiveAction: finding.correctiveAction,
  evidence: finding.evidence,
  closedAt: finding.closedAt ? finding.closedAt.toISOString() : null,
  closedBy: finding.closedBy,
  createdAt: finding.createdAt.toISOString(),
});

// ---------------------------------------------------------------- checklist
const parseChecklist = (value: unknown): IAuditChecklistEntry[] =>
  boundedArray(value, "checklist", MAX_CHECKLIST).map((raw, index) => {
    const line = parseBody(raw);
    const field = `checklist[${index}]`;
    const result =
      line.result === undefined || line.result === null ? null : oneOf(line.result, CHECKLIST_RESULTS, `${field}.result`);
    const note = optionalText(line.note, `${field}.note`, 1000);
    const evidence =
      line.evidence === undefined
        ? undefined
        : boundedArray(line.evidence, `${field}.evidence`, MAX_EVIDENCE_PER_LINE).map((ref, at) => {
            const item = parseBody(ref);
            const name = optionalText(item.name, `${field}.evidence[${at}].name`, 120);
            return { url: parseHttpsUrl(item.url, `${field}.evidence[${at}].url`), ...(name ? { name } : {}) };
          });
    return {
      title: text(line.title, `${field}.title`, 200),
      result,
      ...(note ? { note } : {}),
      ...(evidence && evidence.length > 0 ? { evidence } : {}),
    };
  });

// ------------------------------------------------------------------ audits
const create = async (scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const type = oneOf(body.type, AUDIT_TYPES, "type");
    const title = text(body.title, "title", 200);
    const scheduledFor = parseDay(body.scheduledFor, "scheduledFor");
    if (scheduledFor < todayInIst()) throw new CustomException("scheduledFor cannot be in the past.", badRequest);
    const auditScope = optionalText(body.scope, "scope", 1000) ?? null;
    const auditor = optionalText(body.auditor, "auditor", 120) ?? null;
    const checklist = body.checklist === undefined ? [] : parseChecklist(body.checklist);
    const storeId = await storeForWrite(scope, body.storeId);

    const audit = await inTransaction(async (tx) => {
      const created = await AuditQuery.create(
        { type, title, scope: auditScope, auditor, storeId, scheduledFor, checklist, createdBy: user.id },
        tx
      );
      await OpsActivityQuery.append(
        activityRow(user, {
          entity: "audit",
          entityId: created.id,
          action: "created",
          storeId,
          toStatus: "scheduled",
          detail: { type, title, scheduledFor: dayString(scheduledFor) },
        }),
        tx
      );
      return created;
    });
    return toAuditView(audit, 0);
  } catch (error) {
    throw toCustomException(error);
  }
};

const list = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await AuditQuery.search(
      {
        scope,
        storeId: storeFilter(scope, query),
        status: optionalOneOf(queryString(query.status, "status"), AUDIT_STATUSES, "status"),
        type: optionalOneOf(queryString(query.type, "type"), AUDIT_TYPES, "type"),
      },
      page
    );
    const open = await AuditQuery.openFindingCounts(items.map((a) => a.id));
    return toPage(
      items.map((a) => toAuditView(a, open.get(a.id) ?? 0)),
      total,
      page
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

const getById = async (id: string, scope: StoreScope) => {
  try {
    requireAuditId(id);
    const audit = await AuditQuery.findById(id, scope);
    if (!audit) throw new CustomException(NOT_FOUND, notFound);
    const [open, findingsTotal, history] = await Promise.all([
      AuditQuery.openFindingCounts([id]),
      AuditQuery.countFindings(id),
      OpsActivityQuery.forEntity("audit", id, HISTORY_SHOWN),
    ]);
    return {
      ...toAuditView(audit, open.get(id) ?? 0),
      findingsTotal,
      checklist: checklistView(audit.checklist),
      startedAt: audit.startedAt?.toISOString() ?? null,
      completedAt: audit.completedAt?.toISOString() ?? null,
      summary: audit.summary,
      waiverReason: audit.waiverReason,
      cancelReason: audit.cancelReason,
      history: history.map((h) => ({
        at: h.at.toISOString(),
        action: h.action,
        by: h.actorName,
        byUserId: h.actorId,
        from: h.fromStatus,
        to: h.toStatus,
        detail: h.detail,
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const EDITABLE: IAudit["status"][] = ["scheduled", "in_progress"];

// PATCH changes the plan, or cancels the audit (status: "cancelled" with cancelReason).
const update = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    requireAuditId(id);
    const body = parseBody(input);
    const plan: Parameters<typeof AuditQuery.changeIfStatus>[2] = {};
    if (body.title !== undefined) plan.title = text(body.title, "title", 200);
    if (body.scheduledFor !== undefined) {
      plan.scheduledFor = parseDay(body.scheduledFor, "scheduledFor");
      if (plan.scheduledFor < todayInIst()) throw new CustomException("scheduledFor cannot be in the past.", badRequest);
    }
    const auditScope = nullableText(body.scope, "scope", 1000);
    if (auditScope !== undefined) plan.scope = auditScope;
    const auditor = nullableText(body.auditor, "auditor", 120);
    if (auditor !== undefined) plan.auditor = auditor;
    if (body.checklist !== undefined) plan.checklist = parseChecklist(body.checklist);
    const cancelling = body.status !== undefined;
    if (cancelling) {
      if (body.status !== "cancelled") throw new CustomException("status can only be set to cancelled here; use start or complete.", badRequest);
      plan.status = "cancelled";
      plan.cancelReason = text(body.cancelReason, "cancelReason", 500);
      plan.cancelledAt = new Date();
    }
    if (Object.keys(plan).length === 0) throw new CustomException("Nothing to update.", badRequest);

    const audit = await inTransaction(async (tx) => {
      const current = await AuditQuery.lockById(id, scope, tx);
      if (!current) throw new CustomException(NOT_FOUND, notFound);
      if (!EDITABLE.includes(current.status)) throw wrongState(`A ${current.status} audit cannot be changed.`);
      if (plan.scheduledFor && current.status !== "scheduled") {
        throw wrongState("The date cannot change once the audit has started.");
      }
      if (cancelling && (await AuditQuery.countFindings(id, tx)) > 0) {
        throw wrongState("An audit with findings cannot be cancelled; complete it instead.");
      }
      const updated = await AuditQuery.changeIfStatus(id, [current.status], plan, tx);
      if (!updated) throw stale();
      await OpsActivityQuery.append(
        activityRow(user, {
          entity: "audit",
          entityId: id,
          action: cancelling ? "cancelled" : "plan_updated",
          storeId: current.storeId,
          fromStatus: current.status,
          toStatus: updated.status,
          detail: cancelling ? { reason: plan.cancelReason } : { fields: Object.keys(plan) },
        }),
        tx
      );
      return updated;
    });
    return toAuditView(audit, (await AuditQuery.openFindingCounts([id])).get(id) ?? 0);
  } catch (error) {
    throw toCustomException(error);
  }
};

const start = async (id: string, scope: StoreScope, user: RequestUser) => {
  try {
    requireAuditId(id);
    const audit = await inTransaction(async (tx) => {
      const current = await AuditQuery.findById(id, scope, tx);
      if (!current) throw new CustomException(NOT_FOUND, notFound);
      if (current.status !== "scheduled") throw wrongState(`A ${current.status} audit cannot be started.`);
      const updated = await AuditQuery.changeIfStatus(id, ["scheduled"], { status: "in_progress", startedAt: new Date() }, tx);
      if (!updated) throw stale();
      await OpsActivityQuery.append(
        activityRow(user, { entity: "audit", entityId: id, action: "started", storeId: current.storeId, fromStatus: "scheduled", toStatus: "in_progress" }),
        tx
      );
      return updated;
    });
    return toAuditView(audit, 0);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Locks the audit, so a critical finding recorded at the same moment either lands before
// this check (and blocks it) or after completion (and is refused).
const complete = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    requireAuditId(id);
    const body = parseBody(input);
    const summary = optionalText(body.summary, "summary", 4000) ?? null;
    const waiver = optionalText(body.waiveCriticalReason, "waiveCriticalReason", 500);

    const audit = await inTransaction(async (tx) => {
      const current = await AuditQuery.lockById(id, scope, tx);
      if (!current) throw new CustomException(NOT_FOUND, notFound);
      if (current.status !== "in_progress") throw wrongState(`Only an audit in progress can be completed; this one is ${current.status}.`);
      if (current.checklist.some((line) => line.result === null)) {
        throw wrongState("Every checklist line needs a result (pass, fail or na) before the audit completes.");
      }
      const criticalOpen = await AuditQuery.openCriticalFindingIds(id, tx);
      if (criticalOpen.length > 0 && !waiver) {
        throw wrongState(
          `${criticalOpen.length} critical finding(s) are still open. Close them, or complete with waiveCriticalReason.`
        );
      }
      const updated = await AuditQuery.changeIfStatus(
        id,
        ["in_progress"],
        { status: "completed", completedAt: new Date(), summary, waiverReason: criticalOpen.length > 0 ? (waiver ?? null) : null },
        tx
      );
      if (!updated) throw stale();
      await OpsActivityQuery.append(
        activityRow(user, {
          entity: "audit",
          entityId: id,
          action: "completed",
          storeId: current.storeId,
          fromStatus: "in_progress",
          toStatus: "completed",
          detail: criticalOpen.length > 0 ? { waivedCriticalFindingIds: criticalOpen, reason: waiver } : null,
        }),
        tx
      );
      return updated;
    });
    return toAuditView(audit, (await AuditQuery.openFindingCounts([id])).get(id) ?? 0);
  } catch (error) {
    throw toCustomException(error);
  }
};

// ---------------------------------------------------------------- findings
const createFinding = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    requireAuditId(id);
    const body = parseBody(input);
    const title = text(body.title, "title", 200);
    const severity = oneOf(body.severity, FINDING_SEVERITIES, "severity");
    const description = optionalText(body.description, "description", 4000) ?? null;
    const ownerId = body.ownerId === undefined || body.ownerId === null ? null : uuidField(body.ownerId, "ownerId");
    const dueDate = optionalDay(body.dueDate, "dueDate") ?? null;
    const today = todayInIst();
    if (dueDate && dueDate < today) throw new CustomException("dueDate cannot be in the past.", badRequest);
    if (ownerId) await requireActiveUsers([ownerId], "ownerId");

    const finding = await inTransaction(async (tx) => {
      const audit = await AuditQuery.lockById(id, scope, tx);
      if (!audit) throw new CustomException(NOT_FOUND, notFound);
      if (audit.status !== "in_progress") throw wrongState("Findings can only be recorded while the audit is in progress.");
      const created = await AuditQuery.createFinding(
        { auditId: id, storeId: audit.storeId, title, description, severity, ownerId, dueDate, createdBy: user.id },
        tx
      );
      await OpsActivityQuery.append(
        activityRow(user, {
          entity: "audit_finding",
          entityId: created.id,
          action: "created",
          storeId: audit.storeId,
          toStatus: "open",
          detail: { auditId: id, severity, ownerId },
        }),
        tx
      );
      return created;
    });
    return toFindingView(finding, today);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listFindings = async (id: string, scope: StoreScope, query: Record<string, unknown>) => {
  try {
    requireAuditId(id);
    const page = parsePage(query);
    if (!(await AuditQuery.findById(id, scope))) throw new CustomException(NOT_FOUND, notFound);
    const { items, total } = await AuditQuery.searchFindings(id, page);
    const today = todayInIst();
    return toPage(
      items.map((f) => toFindingView(f, today)),
      total,
      page
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

const listOpenFindings = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const today = todayInIst();
    const { items, total } = await AuditQuery.searchOpenFindings(
      {
        scope,
        severity: optionalOneOf(queryString(query.severity, "severity"), FINDING_SEVERITIES, "severity"),
        ownerId: queryUuid(query.ownerId, "ownerId"),
        overdueBefore: queryBoolean(query.overdue, "overdue") ? today : undefined,
      },
      page
    );
    const view = toPage(
      items.map((f) => toFindingView(f, today)),
      total,
      page
    );
    return { findings: view.items, page: view.page, limit: view.limit, total: view.total };
  } catch (error) {
    throw toCustomException(error);
  }
};

const updateFinding = async (findingId: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    requireFindingId(findingId);
    const body = parseBody(input);
    const change: IFindingUpdate = {};
    if (body.ownerId !== undefined) change.ownerId = uuidField(body.ownerId, "ownerId");
    if (body.dueDate !== undefined) {
      change.dueDate = parseDay(body.dueDate, "dueDate");
      if (change.dueDate < todayInIst()) throw new CustomException("dueDate cannot be in the past.", badRequest);
    }
    if (body.status !== undefined) {
      if (body.status === "closed") throw new CustomException("Use the close action to close a finding.", badRequest);
      change.status = oneOf(body.status, ["open", "in_progress"] as const, "status");
    }
    if (Object.keys(change).length === 0) throw new CustomException("Nothing to update.", badRequest);
    if (change.ownerId) await requireActiveUsers([change.ownerId], "ownerId");

    const today = todayInIst();
    const finding = await inTransaction(async (tx) => {
      const current = await AuditQuery.findFindingById(findingId, scope, tx);
      if (!current) throw new CustomException(FINDING_NOT_FOUND, notFound);
      if (current.status === "closed") throw wrongState("A closed finding cannot be changed.");
      const owner = change.ownerId ?? current.ownerId;
      const due = change.dueDate ?? current.dueDate;
      if (change.status === "in_progress" && (!owner || !due)) {
        throw new CustomException("A finding needs an owner and a due date before work starts.", badRequest);
      }
      const updated = await AuditQuery.changeFindingIfStatus(findingId, current.status, change, tx);
      if (!updated) throw stale();
      await OpsActivityQuery.append(
        activityRow(user, {
          entity: "audit_finding",
          entityId: findingId,
          action: "updated",
          storeId: current.storeId,
          fromStatus: current.status,
          toStatus: updated.status,
          detail: {
            ...(change.ownerId ? { ownerId: change.ownerId } : {}),
            ...(change.dueDate ? { dueDate: dayString(change.dueDate) } : {}),
          },
        }),
        tx
      );
      return updated;
    });
    return toFindingView(finding, today);
  } catch (error) {
    throw toCustomException(error);
  }
};

const HIGH: IFinding["severity"][] = ["high", "critical"];

const closeFinding = async (findingId: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    requireFindingId(findingId);
    const body = parseBody(input);
    const correctiveAction = text(body.correctiveAction, "correctiveAction", 2000);
    const evidence = optionalText(body.evidence, "evidence", 2000) ?? null;

    const today = todayInIst();
    const finding = await inTransaction(async (tx) => {
      const current = await AuditQuery.findFindingById(findingId, scope, tx);
      if (!current) throw new CustomException(FINDING_NOT_FOUND, notFound);
      if (current.status === "closed") throw wrongState("This finding is already closed.");
      if (HIGH.includes(current.severity) && !evidence) {
        throw new CustomException("evidence is required to close a high or critical finding.", badRequest);
      }
      const updated = await AuditQuery.changeFindingIfStatus(
        findingId,
        current.status,
        { status: "closed", correctiveAction, evidence, closedBy: user.id, closedAt: new Date() },
        tx
      );
      if (!updated) throw stale();
      await OpsActivityQuery.append(
        activityRow(user, {
          entity: "audit_finding",
          entityId: findingId,
          action: "closed",
          storeId: current.storeId,
          fromStatus: current.status,
          toStatus: "closed",
          detail: { severity: current.severity },
        }),
        tx
      );
      return updated;
    });
    return toFindingView(finding, today);
  } catch (error) {
    throw toCustomException(error);
  }
};

// ---------------------------------------------------------------- evidence
// This service's own record of who did what in compliance, audits and incidents; it does
// not read other services' logs.
const evidence = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const now = new Date();
    const to = optionalDay(queryString(query.to, "to"), "to");
    const from = optionalDay(queryString(query.from, "from"), "from");
    const upper = to ? istDayStart(addDays(to, 1)) : new Date(now.getTime() + 1);
    const lower = from ? istDayStart(from) : new Date(upper.getTime() - DEFAULT_ACTIVITY_DAYS * 86_400_000);
    if (lower >= upper) throw new CustomException("from must be before to.", badRequest);
    if (daysBetween(lower, upper) > MAX_ACTIVITY_SPAN_DAYS) {
      throw new CustomException(`The date range can span at most ${MAX_ACTIVITY_SPAN_DAYS} days.`, badRequest);
    }
    const entity = queryString(query.entity, "entity");
    const action = queryString(query.action, "action");
    if ((entity && entity.length > 40) || (action && action.length > 40)) {
      throw new CustomException("entity and action must be at most 40 characters.", badRequest);
    }
    const { items, total } = await OpsActivityQuery.search(
      { scope, from: lower, to: upper, actorId: queryUuid(query.userId, "userId"), entity, action },
      page
    );
    return {
      generatedAt: now.toISOString(),
      entries: items.map((row) => ({
        at: row.at.toISOString(),
        userId: row.actorId,
        userName: row.actorName,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
      })),
      page: page.page,
      limit: page.limit,
      total,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const AuditService = {
  create,
  list,
  getById,
  update,
  start,
  complete,
  createFinding,
  listFindings,
  listOpenFindings,
  updateFinding,
  closeFinding,
  evidence,
};
