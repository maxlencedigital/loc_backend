import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, forbidden, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import { IEmployeeRef } from "../Models/Hr/Employee.Interface.js";
import {
  GRIEVANCE_CATEGORIES,
  GRIEVANCE_STATUSES,
  IGrievance,
  IGrievanceNote,
  IGrievanceVisibility,
} from "../Models/Hr/Grievance.Interface.js";
import { Db, inHrTransaction } from "../Queries/Hr.Transaction.js";
import { GrievanceQuery } from "../Queries/Grievance.Query.js";
import { addDays, clock, dayStart, parseOptionalDate } from "../Utils/HrDate.js";
import { parseBoolean, parseUuid } from "../Utils/HrInput.js";
import { oneOf, optionalOneOf, parseBody, queryString, text } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { assertEmployeeInScope, findEmployeeByUserId } from "./EmployeeAccess.js";
import { actorName } from "./HrActor.js";
import { directoryOf, employeeIdsInScope, requireEmployees } from "./PeopleScope.js";

const NOT_FOUND = "Grievance not found.";
const HOUR_MS = 3_600_000;
const FIRST_RESPONSE_HOURS = 48;
const RESOLUTION_DAYS = 14;
const SERIOUS_RESOLUTION_DAYS = 7;
// Harassment and discrimination are always confidential, whatever the person ticked.
const ALWAYS_CONFIDENTIAL = ["harassment", "discrimination"];

/** Past its first-response or resolution deadline (a closed case is judged by when it closed). */
export const slaBreached = (g: Pick<IGrievance, "firstResponseDueAt" | "resolutionDueAt" | "firstResponseAt" | "closedAt">, now: Date): boolean => {
  const responded = g.firstResponseAt ?? g.closedAt;
  const lateResponse = (responded ?? now) > g.firstResponseDueAt;
  const lateResolution = (g.closedAt ?? now) > g.resolutionDueAt;
  return lateResponse || lateResolution;
};

// ------------------------------------------------------------------ views

const toNoteView = (n: IGrievanceNote) => ({
  id: n.id,
  kind: n.kind,
  message: n.message,
  internal: n.internal,
  author: n.authorName,
  createdAt: n.createdAt.toISOString(),
});

// A person who raised a case anonymously is not named to HR, in the list or the detail.
const toHrView = (g: IGrievance, names: Map<string, IEmployeeRef>, now: Date) => ({
  id: g.id,
  category: g.category,
  status: g.status,
  assigneeId: g.assigneeId,
  raisedAt: g.raisedAt.toISOString(),
  anonymous: g.anonymous,
  confidential: g.confidential,
  ...(g.anonymous ? {} : { employeeId: g.employeeId, employeeName: names.get(g.employeeId)?.name ?? "Unknown" }),
  againstEmployeeId: g.againstEmployeeId,
  slaBreached: slaBreached(g, now),
  firstResponseDueAt: g.firstResponseDueAt.toISOString(),
  resolutionDueAt: g.resolutionDueAt.toISOString(),
});

const toDetailView = (g: IGrievance, notes: IGrievanceNote[], names: Map<string, IEmployeeRef>, now: Date) => ({
  ...toHrView(g, names, now),
  description: g.description,
  assignedAt: g.assignedAt ? g.assignedAt.toISOString() : null,
  firstResponseAt: g.firstResponseAt ? g.firstResponseAt.toISOString() : null,
  escalatedAt: g.escalatedAt ? g.escalatedAt.toISOString() : null,
  escalationReason: g.escalationReason,
  closedAt: g.closedAt ? g.closedAt.toISOString() : null,
  outcome: g.outcome,
  notes: notes.map(toNoteView),
});

// -------------------------------------------------------------- visibility

/**
 * Who sees which cases. HR and admins: every case of the stores they work across. A store
 * manager: only non-confidential cases of their own people, never one filed against them.
 * Anyone else has no HR view at all.
 */
const visibilityFor = async (user: RequestUser, scope: StoreScope): Promise<IGrievanceVisibility> => {
  if (user.role === "hr" || user.role === "admin" || user.role === "super_admin") {
    const { ids } = await employeeIdsInScope(scope);
    return { employeeIds: ids, nonConfidentialOnly: false, notAgainst: null };
  }
  if (user.role === "manager") {
    const { ids } = await employeeIdsInScope(scope);
    const own = await findEmployeeByUserId(user.id);
    return { employeeIds: ids ?? [], nonConfidentialOnly: true, notAgainst: own?.id ?? null };
  }
  throw new CustomException("You do not have permission to perform this action.", forbidden);
};

/** The case, or 404 when it does not exist or this viewer may not see it. */
const loadVisible = async (id: string, user: RequestUser, scope: StoreScope): Promise<IGrievance> => {
  const grievance = isUuid(id) ? await GrievanceQuery.findById(id) : null;
  if (!grievance) throw new CustomException(NOT_FOUND, notFound);
  const visibility = await visibilityFor(user, scope);
  const inScope = await assertEmployeeInScope(grievance.employeeId, scope).then(() => true, () => false);
  const hidden =
    !inScope ||
    (visibility.nonConfidentialOnly && grievance.confidential) ||
    (visibility.notAgainst !== null && grievance.againstEmployeeId === visibility.notAgainst);
  if (hidden) throw new CustomException(NOT_FOUND, notFound);
  return grievance;
};

const dayRange = (fromRaw: unknown, toRaw: unknown) => {
  const from = parseOptionalDate(queryString(fromRaw, "from"), "from");
  const to = parseOptionalDate(queryString(toRaw, "to"), "to");
  if (from && to && to < from) throw new CustomException("from must not be after to.", badRequest);
  return { from: from ? dayStart(from) : undefined, to: to ? dayStart(addDays(to, 1)) : undefined };
};

// ------------------------------------------------------------- HR actions

const list = async (user: RequestUser, scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const assigneeId = queryString(query.assigneeId, "assigneeId");
    const range = dayRange(query.from, query.to);
    const { items, total } = await GrievanceQuery.list({
      visibility: await visibilityFor(user, scope),
      status: optionalOneOf(queryString(query.status, "status"), GRIEVANCE_STATUSES, "status"),
      category: optionalOneOf(queryString(query.category, "category"), GRIEVANCE_CATEGORIES, "category"),
      assigneeId: assigneeId ? parseUuid(assigneeId, "assigneeId") : undefined,
      ...range,
      offset: page.offset,
      limit: page.limit,
    });
    const names = await directoryOf(items.filter((g) => !g.anonymous).map((g) => g.employeeId));
    const now = clock.now();
    return toPage(items.map((g) => toHrView(g, names, now)), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const detail = async (g: IGrievance, includeInternal: boolean) => {
  const [notes, names] = await Promise.all([GrievanceQuery.listNotes(g.id, includeInternal), directoryOf(g.anonymous ? [] : [g.employeeId])]);
  return toDetailView(g, notes, names, clock.now());
};

const get = async (user: RequestUser, scope: StoreScope, id: string) => {
  try {
    return await detail(await loadVisible(id, user, scope), true);
  } catch (error) {
    throw toCustomException(error);
  }
};

const note = (g: IGrievance, user: RequestUser, kind: IGrievanceNote["kind"], message: string, internal: boolean, tx: Db) =>
  GrievanceQuery.addNote({ grievanceId: g.id, kind, message, internal, authorName: actorName(user), authorUserId: user.id }, tx);

const reloaded = async (user: RequestUser, scope: StoreScope, id: string) => detail(await loadVisible(id, user, scope), true);

const CLOSED = "This grievance is closed.";

const assign = async (user: RequestUser, scope: StoreScope, id: string, body: unknown) => {
  try {
    const assigneeId = parseUuid(parseBody(body).assigneeId, "assigneeId");
    const grievance = await loadVisible(id, user, scope);
    const [assignee] = await requireEmployees([assigneeId], null).catch(() => {
      throw new CustomException("assigneeId must be an HR employee.", badRequest);
    });
    if (!["hr", "admin"].includes(assignee.employeeType) || assignee.status === "exited") {
      throw new CustomException("assigneeId must be an active HR or admin employee.", badRequest);
    }
    if (assignee.id === grievance.employeeId || assignee.id === grievance.againstEmployeeId) {
      throw new CustomException("A case cannot be handled by the person who raised it or the person it concerns.", conflict);
    }
    await inHrTransaction(async (tx) => {
      const now = clock.now();
      if (!(await GrievanceQuery.assign(grievance.id, assignee.id, now, tx))) throw new CustomException(CLOSED, conflict);
      await GrievanceQuery.noteFirstResponse(grievance.id, now, tx);
      await note(grievance, user, "assignment", `Assigned to ${assignee.name}.`, true, tx);
    });
    return await reloaded(user, scope, id);
  } catch (error) {
    throw toCustomException(error);
  }
};

const comment = async (user: RequestUser, scope: StoreScope, id: string, body: unknown) => {
  try {
    const input = parseBody(body);
    const message = text(input.message, "message", 4000);
    const internal = input.internal === undefined ? false : parseBoolean(input.internal, "internal");
    const grievance = await loadVisible(id, user, scope);
    if (grievance.status === "closed") throw new CustomException(CLOSED, conflict);
    await inHrTransaction(async (tx) => {
      await note(grievance, user, "comment", message, internal, tx);
      // Only something the person can read counts as HR having responded.
      if (!internal) {
        await GrievanceQuery.noteFirstResponse(grievance.id, clock.now(), tx);
        await GrievanceQuery.startProgress(grievance.id, tx);
      }
    });
    return await reloaded(user, scope, id);
  } catch (error) {
    throw toCustomException(error);
  }
};

const escalate = async (user: RequestUser, scope: StoreScope, id: string, body: unknown) => {
  try {
    const reason = text(parseBody(body).reason, "reason", 1000);
    const grievance = await loadVisible(id, user, scope);
    await inHrTransaction(async (tx) => {
      if (!(await GrievanceQuery.escalate(grievance.id, reason, clock.now(), tx))) {
        throw new CustomException(grievance.status === "escalated" ? "This grievance is already escalated." : CLOSED, conflict);
      }
      await note(grievance, user, "escalation", `Escalated: ${reason}`, true, tx);
    });
    return await reloaded(user, scope, id);
  } catch (error) {
    throw toCustomException(error);
  }
};

const close = async (user: RequestUser, scope: StoreScope, id: string, body: unknown) => {
  try {
    const outcome = text(parseBody(body).outcome, "outcome", 2000);
    const grievance = await loadVisible(id, user, scope);
    await inHrTransaction(async (tx) => {
      const now = clock.now();
      if (!(await GrievanceQuery.close(grievance.id, outcome, now, actorName(user), tx))) throw new CustomException("This grievance is already closed.", conflict);
      await note(grievance, user, "closure", `Closed: ${outcome}`, false, tx);
    });
    return await reloaded(user, scope, id);
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------- self-service (used by the ESS routes)

/** An employee raises a concern. Everything but the text and category is decided here, not by the client. */
const raise = async (employee: IEmployeeRef, body: unknown) => {
  try {
    const input = parseBody(body);
    const category = oneOf(input.category, GRIEVANCE_CATEGORIES, "category");
    const description = text(input.description, "description", 4000);
    const anonymous = input.anonymous === undefined ? false : parseBoolean(input.anonymous, "anonymous");
    const asked = input.confidential === undefined ? true : parseBoolean(input.confidential, "confidential");
    let againstEmployeeId: string | null = null;
    if (input.againstEmployeeId !== undefined && input.againstEmployeeId !== null) {
      againstEmployeeId = parseUuid(input.againstEmployeeId, "againstEmployeeId");
      if (againstEmployeeId === employee.id) throw new CustomException("againstEmployeeId cannot be yourself.", badRequest);
      await requireEmployees([againstEmployeeId], null).catch(() => {
        throw new CustomException("againstEmployeeId must be an existing employee.", badRequest);
      });
    }
    const now = clock.now();
    const days = ALWAYS_CONFIDENTIAL.includes(category) ? SERIOUS_RESOLUTION_DAYS : RESOLUTION_DAYS;
    const created = await GrievanceQuery.create({
      employeeId: employee.id,
      againstEmployeeId,
      category,
      description,
      anonymous,
      confidential: ALWAYS_CONFIDENTIAL.includes(category) ? true : asked,
      firstResponseDueAt: new Date(now.getTime() + FIRST_RESPONSE_HOURS * HOUR_MS),
      resolutionDueAt: new Date(now.getTime() + days * 24 * HOUR_MS),
    });
    return toOwnView(created, []);
  } catch (error) {
    throw toCustomException(error);
  }
};

// What the person who raised it sees: their own text, progress and the notes HR wrote for them.
const toOwnView = (g: IGrievance, notes: IGrievanceNote[]) => ({
  id: g.id,
  category: g.category,
  description: g.description,
  status: g.status,
  anonymous: g.anonymous,
  raisedAt: g.raisedAt.toISOString(),
  closedAt: g.closedAt ? g.closedAt.toISOString() : null,
  outcome: g.outcome,
  notes: notes.map((n) => ({ kind: n.kind, message: n.message, author: n.authorName, createdAt: n.createdAt.toISOString() })),
});

const listMine = async (employee: IEmployeeRef, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await GrievanceQuery.list({
      visibility: { employeeIds: [employee.id], nonConfidentialOnly: false, notAgainst: null },
      status: optionalOneOf(queryString(query.status, "status"), GRIEVANCE_STATUSES, "status"),
      offset: page.offset,
      limit: page.limit,
    });
    return toPage(items.map((g) => ({ id: g.id, category: g.category, status: g.status, raisedAt: g.raisedAt.toISOString() })), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getMine = async (employee: IEmployeeRef, id: string) => {
  try {
    const grievance = isUuid(id) ? await GrievanceQuery.findById(id) : null;
    if (!grievance || grievance.employeeId !== employee.id) throw new CustomException(NOT_FOUND, notFound);
    return toOwnView(grievance, await GrievanceQuery.listNotes(grievance.id, false));
  } catch (error) {
    throw toCustomException(error);
  }
};

/** Open cases the viewer may count, for the HR summary. A store-bound view leaves confidential cases out. */
const countOpen = async (scope: StoreScope): Promise<number> => {
  const { ids } = await employeeIdsInScope(scope);
  return await GrievanceQuery.countOpen({ employeeIds: ids, nonConfidentialOnly: scope !== null, notAgainst: null });
};

export const GrievanceService = { list, get, assign, comment, escalate, close, raise, listMine, getMine, countOpen };
