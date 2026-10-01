import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, forbidden, notFound } from "../../commons/Utils/StatusCode.js";
import { SupportClient } from "../Clients/SupportServices.Client.js";
import type { RequestUser } from "../Middleware/Identity.js";
import {
  COMPLAINT_SEVERITIES,
  COMPLAINT_STATUSES,
  COMPLAINT_TYPES,
  ComplaintActor,
  IComplaint,
  IComplaintDetail,
  IComplaintOwner,
  IComplaintPatch,
  IComplaintPhoto,
  INewComplaintEvent,
} from "../Models/Complaint/Complaint.Interface.js";
import {
  COMPLAINT_STATUS_LABEL,
  ComplaintAction,
  activeKeyFor,
  isActiveComplaint,
  nextComplaintStatus,
} from "../Models/Complaint/ComplaintStatus.js";
import { IOrderRef } from "../Models/CustomerPayment/CustomerPayment.Interface.js";
import { ComplaintQuery, Db } from "../Queries/Complaint.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { SupportOrderQuery } from "../Queries/SupportOrder.Query.js";
import { oneOf, optionalOneOf, optionalText, parseBody, queryString, text, wholeNumber } from "../Utils/Input.js";
import { rupeesToPaise } from "../Utils/Money.js";
import { parsePhotoNote, parsePhotoUrl } from "../Utils/PhotoInput.js";
import {
  actorNameOf,
  effectiveStore,
  idOrNotFound,
  optionalBoolean,
  optionalDayQuery,
  optionalUuidQuery,
  parseIdempotencyKey,
  userIdOf,
} from "../Utils/SupportInput.js";
import { isUuid } from "../Utils/Uuid.js";
import { customerUserId, findOwnedOrder } from "./CustomerLink.js";
import {
  toCustomerDetail,
  toCustomerListItem,
  toStaffDetail,
  toStaffListItem,
} from "./Complaint.Views.js";

export const NOT_FOUND = "Complaint not found.";
export const MAX_THREAD_EVENTS = 500;
export const MAX_PHOTOS = 10;
const MAX_PHOTOS_PER_CALL = 5;
const MAX_TEXT = 2000;
const MAX_NOTE = 500;
export const DEFAULT_CLOSE_AFTER_DAYS = 7;
export const MAX_CLOSE_BATCH = 500;
const MS_PER_DAY = 86_400_000;
const ASSIGNABLE_ROLES = ["staff", "manager", "admin", "super_admin"];
const STORE_BOUND_ROLES = ["staff", "manager"];
// Money decisions need a manager; a staff member can settle a complaint without paying out.
const MONEY_ROLES = ["manager", "admin", "super_admin"];

export interface Outcome<T> {
  /** False when a retry or a duplicate returned the complaint that already existed. */
  created: boolean;
  data: T;
}

export interface Actor {
  role: ComplaintActor;
  userId: string | null;
  name: string;
}

const staffActor = (user: RequestUser): Actor => ({ role: "staff", userId: userIdOf(user), name: actorNameOf(user) });
const customerActor = (user: RequestUser): Actor => ({
  role: "customer",
  userId: user.id,
  name: user.name ?? "Customer",
});

export const event = (
  actor: Actor,
  kind: INewComplaintEvent["kind"],
  extra: Partial<Omit<INewComplaintEvent, "kind" | "actorRole" | "actorUserId" | "actorName">> = {}
): INewComplaintEvent => ({
  kind,
  actorRole: actor.role,
  actorUserId: actor.userId,
  actorName: actor.name,
  message: null,
  internal: false,
  fromStatus: null,
  toStatus: null,
  ...extra,
});

export const violates = (error: unknown, ...names: string[]): boolean =>
  names.some((name) => isUniqueViolation(error, name));

/** The next status for the action, or a 409 naming where the complaint is. */
export const needTransition = (c: IComplaint, action: ComplaintAction) => {
  const to = nextComplaintStatus(c.status, action);
  if (!to) {
    throw new CustomException(
      `This complaint is ${COMPLAINT_STATUS_LABEL[c.status]}, so that action is not allowed.`,
      conflict
    );
  }
  return to;
};

/** The status-dependent part of a patch: the live-complaint key follows the status. */
export const statusPatch = (c: IComplaint, to: IComplaint["status"]): IComplaintPatch => ({
  status: to,
  activeKey: isActiveComplaint(to) ? activeKeyFor(c.orderId, c.type) : null,
});

interface Change {
  patch: IComplaintPatch;
  events: INewComplaintEvent[];
}

// One complaint, one transaction: lock the row, let the rule decide against the status it
// has right now, write the change and its thread entries together. The owner filter makes a
// foreign complaint a 404 before any rule runs.
export const mutate = async (
  rawId: unknown,
  owner: IComplaintOwner,
  rule: (current: IComplaint) => Change
): Promise<IComplaintDetail> => {
  const id = idOrNotFound(rawId, NOT_FOUND);
  await ComplaintQuery.inTransaction(async (tx: Db) => {
    const current = await ComplaintQuery.lock(id, owner, tx);
    if (!current) throw new CustomException(NOT_FOUND, notFound);
    const change = rule(current);
    if ((await ComplaintQuery.countEvents(id, tx)) + change.events.length > MAX_THREAD_EVENTS) {
      throw new CustomException("This complaint has reached its message limit.", conflict);
    }
    await ComplaintQuery.apply(id, change.patch, change.events, tx);
  });
  const detail = await ComplaintQuery.findDetail(id, owner);
  if (!detail) throw new CustomException(NOT_FOUND, notFound);
  return detail;
};

// -------------------------------------------------------------- creation
interface NewComplaint {
  order: IOrderRef;
  source: "customer" | "store";
  customerUserId: string | null;
  actor: Actor;
  createdByUserId: string;
  key: string | null;
  type: (typeof COMPLAINT_TYPES)[number];
  severity: (typeof COMPLAINT_SEVERITIES)[number];
  description: string;
  itemId: string | null;
  // What to do when a live complaint of this type already exists on the order.
  onDuplicate: (existing: IComplaintDetail) => IComplaintDetail;
}

const createComplaint = async (n: NewComplaint): Promise<Outcome<IComplaintDetail>> => {
  const activeKey = activeKeyFor(n.order.id, n.type);
  const existing = async (): Promise<IComplaintDetail | null> => {
    const byKey = n.key ? await ComplaintQuery.findByCreatorKey(n.createdByUserId, n.key) : null;
    if (byKey) return byKey;
    const live = await ComplaintQuery.findByActiveKey(activeKey);
    return live ? n.onDuplicate(live) : null;
  };

  const prior = await existing();
  if (prior) return { created: false, data: prior };
  try {
    const created = await ComplaintQuery.create({
      orderId: n.order.id,
      orderRef: n.order.ref,
      storeId: n.order.storeId,
      customerId: n.order.customerId,
      customerUserId: n.customerUserId,
      source: n.source,
      type: n.type,
      severity: n.severity,
      description: n.description,
      itemId: n.itemId,
      activeKey,
      createdByUserId: n.createdByUserId,
      idempotencyKey: n.key,
      firstEvent: event(n.actor, "created", { message: n.description, toStatus: "open" }),
    });
    return { created: true, data: created };
  } catch (error) {
    // A simultaneous duplicate lost the race on a unique index: answer with the winner.
    if (violates(error, "creator_key", "idempotencyKey", "active_key", "activeKey")) {
      const raced = await existing();
      if (raced) return { created: false, data: raced };
    }
    throw error;
  }
};

const parseNew = (body: Record<string, unknown>) => {
  if (!isUuid(body.orderId)) throw new CustomException("orderId must be a valid id.", badRequest);
  if (body.itemId !== undefined && body.itemId !== null && !isUuid(body.itemId)) {
    throw new CustomException("itemId must be a valid id.", badRequest);
  }
  return {
    orderId: body.orderId,
    type: oneOf(body.type, COMPLAINT_TYPES, "type"),
    description: text(body.description, "description", MAX_TEXT),
    itemId: (body.itemId as string | undefined | null) ?? null,
  };
};

const checkItem = async (order: IOrderRef, itemId: string | null) => {
  if (itemId && !(await SupportOrderQuery.orderHasItem(order.id, itemId))) {
    throw new CustomException("itemId is not an item of this order.", badRequest);
  }
};

// ---------------------------------------------------------- customer side
const raise = async (user: RequestUser, input: unknown, rawKey: unknown) => {
  try {
    const userId = customerUserId(user);
    const body = parseBody(input);
    const key = parseIdempotencyKey(rawKey);
    const fields = parseNew(body);
    const order = await findOwnedOrder(user, fields.orderId);
    await checkItem(order, fields.itemId);
    const outcome = await createComplaint({
      ...fields,
      order,
      source: "customer",
      customerUserId: userId,
      actor: customerActor(user),
      createdByUserId: userId,
      key,
      severity: "medium",
      // A live complaint a store logged for this order is not the customer's to read.
      onDuplicate: (existing) => {
        if (existing.customerUserId !== userId) {
          throw new CustomException(
            "We already have an open complaint of this type for this order and our team is looking into it.",
            conflict
          );
        }
        return existing;
      },
    });
    return { created: outcome.created, data: { id: outcome.data.id, status: outcome.data.status, orderId: outcome.data.orderId } };
  } catch (error) {
    throw toCustomException(error);
  }
};

const listMine = async (user: RequestUser, query: Record<string, unknown>) => {
  try {
    const owner = customerUserId(user);
    const page = parsePage(query);
    const status = optionalOneOf(queryString(query.status, "status"), COMPLAINT_STATUSES, "status");
    const { items, total } = await ComplaintQuery.search(
      { customerUserId: owner, statuses: status ? [status] : undefined, page },
      "createdAt"
    );
    return toPage(items.map(toCustomerListItem), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getMine = async (user: RequestUser, id: string) => {
  try {
    const owner = customerUserId(user);
    const detail = await ComplaintQuery.findDetail(idOrNotFound(id, NOT_FOUND), { customerUserId: owner });
    if (!detail) throw new CustomException(NOT_FOUND, notFound);
    return toCustomerDetail(detail);
  } catch (error) {
    throw toCustomException(error);
  }
};

const commentMine = async (user: RequestUser, id: string, input: unknown) => {
  try {
    const owner = customerUserId(user);
    const message = text(parseBody(input).message, "message", MAX_TEXT);
    const actor = customerActor(user);
    const detail = await mutate(id, { customerUserId: owner }, (c) => {
      const to = needTransition(c, "customerReply");
      const reopened = c.status === "resolved";
      const events = [event(actor, "comment", { message })];
      if (!reopened) return { patch: { status: to }, events };
      events.push(event(actor, "reopened", { fromStatus: "resolved", toStatus: to }));
      return {
        patch: {
          ...statusPatch(c, to),
          resolvedAt: null,
          decision: null,
          resolution: null,
          refundAmountPaise: null,
          goodwill: null,
          reopenCount: c.reopenCount + 1,
        },
        events,
      };
    }).catch((error) => {
      if (violates(error, "active_key", "activeKey")) {
        throw new CustomException("Another complaint of this type is already open for this order.", conflict);
      }
      throw error;
    });
    return toCustomerDetail(detail);
  } catch (error) {
    throw toCustomException(error);
  }
};

const parsePhotos = (value: unknown): Array<Omit<IComplaintPhoto, "addedAt">> => {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PHOTOS_PER_CALL) {
    throw new CustomException(`photos must be a list of 1 to ${MAX_PHOTOS_PER_CALL} photo references.`, badRequest);
  }
  return value.map((entry, i) => {
    const photo = parseBody(entry);
    const caption = parsePhotoNote(photo.caption, `photos[${i}].caption`);
    const contentType =
      photo.contentType === undefined
        ? undefined
        : oneOf(photo.contentType, ["image/jpeg", "image/png", "image/webp", "image/heic"] as const, `photos[${i}].contentType`);
    return {
      url: parsePhotoUrl(photo.url, `photos[${i}].url`),
      ...(caption ? { caption } : {}),
      ...(contentType ? { contentType } : {}),
      ...(photo.sizeBytes === undefined
        ? {}
        : { sizeBytes: wholeNumber(photo.sizeBytes, `photos[${i}].sizeBytes`, 1, 10_000_000) }),
    };
  });
};

// References only: there is no file storage, so the app hosts the image and sends the link.
const addPhotos = async (user: RequestUser, id: string, input: unknown) => {
  try {
    const owner = customerUserId(user);
    const incoming = parsePhotos(parseBody(input).photos);
    const actor = customerActor(user);
    const detail = await mutate(id, { customerUserId: owner }, (c) => {
      const to = needTransition(c, "photos");
      const known = new Set(c.photos.map((p) => p.url));
      const added: IComplaintPhoto[] = [];
      for (const photo of incoming) {
        if (known.has(photo.url)) continue;
        known.add(photo.url);
        added.push({ ...photo, addedAt: new Date().toISOString() });
      }
      // The same links again (a retry) change nothing.
      if (added.length === 0) return { patch: {}, events: [] };
      if (c.photos.length + added.length > MAX_PHOTOS) {
        throw new CustomException(`A complaint can hold at most ${MAX_PHOTOS} photos.`, conflict);
      }
      return {
        patch: { status: to, photos: [...c.photos, ...added] },
        events: [event(actor, "photos_added", { message: `${added.length} photo(s) added` })],
      };
    });
    return { photos: detail.photos };
  } catch (error) {
    throw toCustomException(error);
  }
};

// -------------------------------------------------------------- store side
const log = async (user: RequestUser, scope: string | null, input: unknown, rawKey: unknown) => {
  try {
    const actor = staffActor(user);
    const body = parseBody(input);
    const key = parseIdempotencyKey(rawKey);
    const fields = parseNew(body);
    const severity = optionalOneOf(body.severity, COMPLAINT_SEVERITIES, "severity") ?? "medium";
    const order = await SupportOrderQuery.findOrderInScope(fields.orderId, scope);
    if (!order) throw new CustomException("Order not found.", notFound);
    await checkItem(order, fields.itemId);
    const outcome = await createComplaint({
      ...fields,
      order,
      severity,
      source: "store",
      customerUserId: null,
      actor,
      createdByUserId: actor.userId as string,
      key,
      onDuplicate: (existing) => existing,
    });
    return { created: outcome.created, data: { id: outcome.data.id, status: outcome.data.status, orderId: outcome.data.orderId } };
  } catch (error) {
    throw toCustomException(error);
  }
};

const list = async (scope: string | null, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const status = optionalOneOf(queryString(query.status, "status"), COMPLAINT_STATUSES, "status");
    const { items, total } = await ComplaintQuery.search(
      {
        storeId: effectiveStore(scope, optionalUuidQuery(query.storeId, "storeId")),
        statuses: status ? [status] : undefined,
        type: optionalOneOf(queryString(query.type, "type"), COMPLAINT_TYPES, "type"),
        assigneeId: optionalUuidQuery(query.assigneeId, "assigneeId"),
        from: optionalDayQuery(query.from, "from", false),
        to: optionalDayQuery(query.to, "to", true),
        page,
      },
      "createdAt"
    );
    return toPage(items.map(toStaffListItem), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const get = async (scope: string | null, id: string) => {
  try {
    const detail = await ComplaintQuery.findDetail(idOrNotFound(id, NOT_FOUND), { storeId: scope });
    if (!detail) throw new CustomException(NOT_FOUND, notFound);
    return toStaffDetail(detail);
  } catch (error) {
    throw toCustomException(error);
  }
};

const assign = async (user: RequestUser, scope: string | null, id: string, input: unknown) => {
  try {
    const actor = staffActor(user);
    const assigneeId = parseBody(input).assigneeId;
    if (!isUuid(assigneeId)) throw new CustomException("assigneeId must be a valid id.", badRequest);
    const owner = { storeId: scope };
    const current = await ComplaintQuery.findDetail(idOrNotFound(id, NOT_FOUND), owner);
    if (!current) throw new CustomException(NOT_FOUND, notFound);
    if (user.role === "staff" && assigneeId !== user.id) {
      throw new CustomException("You can only assign a complaint to yourself.", forbidden);
    }

    // The gateway is the source of who exists, is active and which store they belong to.
    const assignee = await SupportClient.findUser(assigneeId);
    const sameStore = assignee && (!STORE_BOUND_ROLES.includes(assignee.role) || assignee.storeId === current.storeId);
    if (!assignee || !assignee.isActive || !ASSIGNABLE_ROLES.includes(assignee.role) || !sameStore) {
      throw new CustomException("assigneeId must be an active team member of this complaint's store.", badRequest);
    }

    const detail = await mutate(id, owner, (c) => {
      const to = needTransition(c, "assign");
      const now = new Date();
      return {
        patch: { ...statusPatch(c, to), assigneeId, assigneeName: assignee.name, assignedAt: now },
        events: [event(actor, "assigned", { message: `Assigned to ${assignee.name}`, fromStatus: c.status, toStatus: to })],
      };
    });
    return toStaffDetail(detail);
  } catch (error) {
    throw toCustomException(error);
  }
};

const comment = async (user: RequestUser, scope: string | null, id: string, input: unknown) => {
  try {
    const actor = staffActor(user);
    const body = parseBody(input);
    const message = text(body.message, "message", MAX_TEXT);
    const internal = optionalBoolean(body.internal, "internal") ?? false;
    const detail = await mutate(id, { storeId: scope }, (c) => {
      const to = needTransition(c, internal ? "staffNote" : "staffReply");
      return {
        patch: {
          status: to,
          // The SLA clock stops at the first reply the customer can read, not at an internal note.
          ...(!internal && !c.firstResponseAt ? { firstResponseAt: new Date() } : {}),
        },
        events: [event(actor, "comment", { message, internal, fromStatus: c.status, toStatus: to })],
      };
    });
    return toStaffDetail(detail);
  } catch (error) {
    throw toCustomException(error);
  }
};

const escalate = async (user: RequestUser, scope: string | null, id: string, input: unknown) => {
  try {
    const actor = staffActor(user);
    const reason = text(parseBody(input).reason, "reason", MAX_NOTE);
    const detail = await mutate(id, { storeId: scope }, (c) => {
      const to = needTransition(c, "escalate");
      return {
        patch: { ...statusPatch(c, to), escalatedAt: new Date(), escalationReason: reason },
        events: [event(actor, "escalated", { message: reason, fromStatus: c.status, toStatus: to })],
      };
    });
    return toStaffDetail(detail);
  } catch (error) {
    throw toCustomException(error);
  }
};

/** A refund or goodwill amount in rupees, no more than the order is worth. */
export const parseMoney = async (value: unknown, field: string, orderId: string, scope: string | null): Promise<number> => {
  const order = await SupportOrderQuery.findOrderInScope(orderId, scope);
  if (!order) throw new CustomException(NOT_FOUND, notFound);
  return rupeesToPaise(value, field, order.amountPaise);
};

const resolve = async (user: RequestUser, scope: string | null, id: string, input: unknown) => {
  try {
    const actor = staffActor(user);
    const body = parseBody(input);
    const resolution = text(body.resolution, "resolution", MAX_TEXT);
    const goodwill = optionalText(body.goodwill, "goodwill", MAX_NOTE) ?? null;
    const hasRefund = body.refundAmount !== undefined && body.refundAmount !== null;
    if (hasRefund && !MONEY_ROLES.includes(user.role)) {
      throw new CustomException("A refund needs a store manager's approval.", forbidden);
    }
    const owner = { storeId: scope };
    const known = await ComplaintQuery.findDetail(idOrNotFound(id, NOT_FOUND), owner);
    if (!known) throw new CustomException(NOT_FOUND, notFound);
    const refundPaise = hasRefund ? await parseMoney(body.refundAmount, "refundAmount", known.orderId, scope) : null;

    const detail = await mutate(id, owner, (c) => {
      const to = needTransition(c, "resolve");
      const now = new Date();
      return {
        patch: {
          ...statusPatch(c, to),
          resolvedAt: now,
          firstResponseAt: c.firstResponseAt ?? now,
          decision: refundPaise !== null ? "refund" : goodwill ? "goodwill" : null,
          resolution,
          refundAmountPaise: refundPaise,
          goodwill,
        },
        events: [event(actor, "resolved", { message: resolution, fromStatus: c.status, toStatus: to })],
      };
    });
    return toStaffDetail(detail);
  } catch (error) {
    throw toCustomException(error);
  }
};

// ---------------------------------------------------------------- internal
// Run by a scheduler through the internal API: resolved complaints nobody has challenged
// for a while become closed, a bounded batch at a time.
const closeResolved = async (input: unknown) => {
  try {
    const body = parseBody(input);
    const days = body.olderThanDays === undefined ? DEFAULT_CLOSE_AFTER_DAYS : wholeNumber(body.olderThanDays, "olderThanDays", 1, 365);
    const limit = body.limit === undefined ? 200 : wholeNumber(body.limit, "limit", 1, MAX_CLOSE_BATCH);
    const now = new Date();
    const closed = await ComplaintQuery.inTransaction((tx) =>
      ComplaintQuery.closeResolved(new Date(now.getTime() - days * MS_PER_DAY), limit, now, tx)
    );
    return { closed };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const ComplaintService = {
  raise,
  listMine,
  getMine,
  commentMine,
  addPhotos,
  log,
  list,
  get,
  assign,
  comment,
  escalate,
  resolve,
  closeResolved,
};
