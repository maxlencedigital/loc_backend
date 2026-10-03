import { CustomException } from "../../commons/Exception/CustomException.js";
import { ServiceClient } from "../../commons/Http/ServiceClient.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import {
  IRequest,
  IRequestEvent,
  IRequestEventCreate,
  IRequestUpdate,
  REQUEST_CATEGORIES,
  REQUEST_PRIORITIES,
  REQUEST_STATUSES,
  REQUEST_TRANSITIONS,
  RequestStatus,
} from "../Models/It/It.Interface.js";
import { ItDeviceQuery } from "../Queries/ItDevice.Query.js";
import { ItRequestQuery } from "../Queries/ItRequest.Query.js";
import { timeOut } from "../Utils/AssetDates.js";
import { actorId, actorName, patchable, requireChange, uuidField } from "../Utils/AssetInput.js";
import { oneOf, optionalOneOf, parseBody, queryString, text } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";

const NOT_FOUND = "Request not found.";
const COMMENTS_LIMIT = 200;
const HISTORY_LIMIT = 100;

// HR and admins work the queue; everyone else sees only what they raised.
const isDesk = (user: RequestUser) => user.role === "super_admin" || user.role === "admin" || user.role === "hr";

interface GatewayUser {
  id: string;
  name: string;
  isActive: boolean;
}

export const toRequestView = (r: IRequest) => ({
  id: r.id,
  category: r.category,
  description: r.description,
  priority: r.priority,
  status: r.status,
  deviceId: r.deviceId,
  raisedBy: r.raisedByName,
  raisedById: r.raisedByUserId,
  assigneeId: r.assigneeUserId,
  assignee: r.assigneeName,
  resolution: r.resolution,
  closedAt: timeOut(r.closedAt),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const toEventView = (e: IRequestEvent) => ({
  at: e.at.toISOString(),
  kind: e.kind,
  from: e.fromStatus,
  to: e.toStatus,
  detail: e.detail,
  by: e.byName,
});

// A request outside the caller's own is not found, never forbidden: its existence is not theirs to know.
const readable = (request: IRequest | null, user: RequestUser): IRequest => {
  if (!request || (!isDesk(user) && request.raisedByUserId !== user.id)) throw new CustomException(NOT_FOUND, notFound);
  return request;
};

export const checkRequestTransition = (from: RequestStatus, to: RequestStatus): void => {
  if (from === "closed") throw new CustomException("A closed request cannot be changed.", conflict);
  if (!REQUEST_TRANSITIONS[from].includes(to)) {
    throw new CustomException(`A request cannot move from ${from.replace("_", " ")} to ${to.replace("_", " ")}.`, conflict);
  }
};

const raise = async (user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const raisedBy = actorId(user);
    if (!raisedBy) throw new CustomException("Your session has no valid user id; sign in again.", badRequest);
    const data = {
      category: oneOf(body.category, REQUEST_CATEGORIES, "category"),
      description: text(body.description, "description", 2000),
      priority: optionalOneOf(body.priority, REQUEST_PRIORITIES, "priority") ?? "normal",
      deviceId: body.deviceId === undefined || body.deviceId === null ? null : uuidField(body.deviceId, "deviceId"),
      raisedByUserId: raisedBy,
      raisedByName: actorName(user),
    };
    if (data.deviceId && !(await ItDeviceQuery.exists(data.deviceId))) {
      throw new CustomException("deviceId does not match a device.", badRequest);
    }
    const event: IRequestEventCreate = { kind: "raised", fromStatus: null, toStatus: "open", detail: null, byUserId: raisedBy, byName: data.raisedByName };
    return toRequestView(await ItRequestQuery.create(data, event));
  } catch (error) {
    throw toCustomException(error);
  }
};

const list = async (user: RequestUser, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const mine = queryString(query.mine, "mine");
    if (mine !== undefined && mine !== "true" && mine !== "false") throw new CustomException("mine must be true or false.", badRequest);
    const result = await ItRequestQuery.search(
      {
        raisedByUserId: !isDesk(user) || mine === "true" ? user.id : undefined,
        status: optionalOneOf(queryString(query.status, "status"), REQUEST_STATUSES, "status"),
        category: optionalOneOf(queryString(query.category, "category"), REQUEST_CATEGORIES, "category"),
      },
      page
    );
    return toPage(result.items.map(toRequestView), result.total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getById = async (id: string, user: RequestUser) => {
  try {
    const request = readable(isUuid(id) ? await ItRequestQuery.findById(id) : null, user);
    const [comments, events] = await Promise.all([
      ItRequestQuery.listComments(id, COMMENTS_LIMIT),
      ItRequestQuery.listEvents(id, HISTORY_LIMIT),
    ]);
    return {
      ...toRequestView(request),
      comments: comments.map((c) => ({ id: c.id, author: c.authorName, message: c.message, createdAt: c.createdAt.toISOString() })),
      history: events.map(toEventView),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// The gateway owns users: ask it who this is. A refusal on the merits is a 400 for the
// caller; an outage (503) passes through and nothing is written.
const lookupAssignee = async (userId: string): Promise<GatewayUser> => {
  const answer = await ServiceClient.post<{ users: GatewayUser[] }>("gateway", "/internal/users/lookup", {
    body: { ids: [userId] },
    idempotent: true,
  });
  const found = answer?.users?.find((u) => u.id === userId);
  if (!found) throw new CustomException("assigneeId does not match a user.", badRequest);
  if (!found.isActive) throw new CustomException("That user's account is deactivated.", badRequest);
  return found;
};

const update = async (id: string, user: RequestUser, input: unknown) => {
  try {
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    const body = parseBody(input);
    const assigneeId = patchable(body.assigneeId, (v) => uuidField(v, "assigneeId"));
    const status = body.status === undefined ? undefined : oneOf(body.status, REQUEST_STATUSES, "status");
    if (status === "closed") throw new CustomException("Use the close action to close a request.", badRequest);
    const priority = body.priority === undefined ? undefined : oneOf(body.priority, REQUEST_PRIORITIES, "priority");
    requireChange({ ...(assigneeId !== undefined ? { assigneeId } : {}), ...(status ? { status } : {}), ...(priority ? { priority } : {}) });
    const assignee = assigneeId ? await lookupAssignee(assigneeId) : null;

    const by = { byUserId: actorId(user), byName: actorName(user) };
    const updated = await ItRequestQuery.inTransaction(async (tx) => {
      const current = await ItRequestQuery.lockById(id, tx);
      if (!current) throw new CustomException(NOT_FOUND, notFound);
      if (current.status === "closed") throw new CustomException("A closed request cannot be changed.", conflict);
      const data: IRequestUpdate = {};
      const events: IRequestEventCreate[] = [];
      // Handing an open request to someone starts the work, unless the caller says otherwise.
      const target = status ?? (assignee && current.status === "open" ? "in_progress" : undefined);
      if (target && target !== current.status) {
        checkRequestTransition(current.status, target);
        data.status = target;
        events.push({ kind: "status_changed", fromStatus: current.status, toStatus: target, detail: null, ...by });
      }
      if (assigneeId !== undefined && assigneeId !== current.assigneeUserId) {
        data.assigneeUserId = assigneeId;
        data.assigneeName = assignee ? assignee.name : null;
        events.push({ kind: "assigned", fromStatus: null, toStatus: null, detail: assignee ? assignee.name : "Unassigned", ...by });
      }
      if (priority && priority !== current.priority) {
        data.priority = priority;
        events.push({ kind: "priority_changed", fromStatus: null, toStatus: null, detail: `${current.priority} to ${priority}`, ...by });
      }
      return events.length === 0 ? current : await ItRequestQuery.update(id, data, events, tx);
    });
    return toRequestView(updated);
  } catch (error) {
    throw toCustomException(error);
  }
};

const close = async (id: string, user: RequestUser, input: unknown) => {
  try {
    const resolution = text(parseBody(input).resolution, "resolution", 2000);
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    const closed = await ItRequestQuery.inTransaction(async (tx) => {
      const current = await ItRequestQuery.lockById(id, tx);
      if (!current) throw new CustomException(NOT_FOUND, notFound);
      if (current.status === "closed") throw new CustomException("This request is already closed.", conflict);
      return await ItRequestQuery.update(
        id,
        { status: "closed", resolution, closedAt: new Date(), closedByUserId: actorId(user) },
        [{ kind: "closed", fromStatus: current.status, toStatus: "closed", detail: null, byUserId: actorId(user), byName: actorName(user) }],
        tx
      );
    });
    return toRequestView(closed);
  } catch (error) {
    throw toCustomException(error);
  }
};

const comment = async (id: string, user: RequestUser, input: unknown) => {
  try {
    const message = text(parseBody(input).message, "message", 2000);
    const request = readable(isUuid(id) ? await ItRequestQuery.findById(id) : null, user);
    if (request.status === "closed") throw new CustomException("A closed request takes no more messages.", conflict);
    const saved = await ItRequestQuery.addComment(id, { userId: actorId(user), name: actorName(user) }, message);
    return { id: saved.id, author: saved.authorName, message: saved.message, createdAt: saved.createdAt.toISOString() };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const ItRequestService = { raise, list, getById, update, close, comment };
