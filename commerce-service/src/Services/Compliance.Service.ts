import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import {
  COMPLIANCE_STATUSES,
  COMPLIANCE_TYPES,
  ComplianceStatus,
  IChecklistEntry,
  IComplianceItem,
  IComplianceUpdate,
} from "../Models/Ops/Compliance.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { ComplianceQuery } from "../Queries/Compliance.Query.js";
import { OpsActivityQuery } from "../Queries/OpsActivity.Query.js";
import { inTransaction } from "../Queries/OpsCompliance.Db.js";
import { oneOf, optionalOneOf, optionalText, parseBody, queryString, text } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import {
  activityRow,
  addDays,
  boundedArray,
  daysBetween,
  dayString,
  nullableDay,
  nullableText,
  nullableUuid,
  optionalDay,
  optionalUuid,
  parseDay,
  parseFileRef,
  queryInteger,
  requireActiveUsers,
  storeFilter,
  storeForWrite,
  todayInIst,
} from "./OpsCompliance.Shared.js";

export const EXPIRING_WINDOW_DAYS = 30;
const DEFAULT_DUE_DAYS = 30;
const MAX_DUE_DAYS = 365;
const MAX_CHECKLIST = 50;
const MAX_DOCUMENTS = 20;
const RENEWALS_SHOWN = 50;
const MAX_HORIZON_YEARS = 50;
const NOT_FOUND = "Compliance item not found.";

// Derived from the expiry date on every read, so it can never be stale.
export const statusOf = (daysLeft: number): ComplianceStatus =>
  daysLeft < 0 ? "expired" : daysLeft <= EXPIRING_WINDOW_DAYS ? "expiring" : "valid";

const toView = (item: IComplianceItem, today: Date) => {
  const daysLeft = daysBetween(today, item.expiresOn);
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    authority: item.authority,
    referenceNumber: item.referenceNumber,
    issuedOn: item.issuedOn ? dayString(item.issuedOn) : null,
    expiresOn: dayString(item.expiresOn),
    storeId: item.storeId,
    ownerId: item.ownerId,
    status: statusOf(daysLeft),
    daysLeft,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
};

const requireId = (id: string) => {
  if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
};

const checkDates = (issuedOn: Date | null | undefined, expiresOn: Date) => {
  if (issuedOn && issuedOn > expiresOn) throw new CustomException("issuedOn cannot be after expiresOn.", badRequest);
};

const duplicate = (item: { type: string; name: string }) =>
  new CustomException(`A ${item.type} named "${item.name}" already exists for this store.`, conflict);

const create = async (scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const name = text(body.name, "name", 120);
    const type = oneOf(body.type, COMPLIANCE_TYPES, "type");
    const authority = optionalText(body.authority, "authority", 120) ?? null;
    const referenceNumber = optionalText(body.referenceNumber, "referenceNumber", 80) ?? null;
    const issuedOn = optionalDay(body.issuedOn, "issuedOn") ?? null;
    const expiresOn = parseDay(body.expiresOn, "expiresOn");
    checkDates(issuedOn, expiresOn);
    const ownerId = optionalUuid(body.ownerId, "ownerId") ?? null;
    const storeId = await storeForWrite(scope, body.storeId);
    if (ownerId) await requireActiveUsers([ownerId], "ownerId");

    const today = todayInIst();
    try {
      const item = await inTransaction(async (tx) => {
        const created = await ComplianceQuery.create(
          { name, type, authority, referenceNumber, issuedOn, expiresOn, storeId, ownerId, createdBy: user.id },
          tx
        );
        await OpsActivityQuery.append(
          activityRow(user, {
            entity: "compliance_item",
            entityId: created.id,
            action: "created",
            storeId,
            toStatus: statusOf(daysBetween(today, expiresOn)),
            detail: { name, type, expiresOn: dayString(expiresOn) },
          }),
          tx
        );
        return created;
      });
      return toView(item, today);
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicate({ type, name });
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const list = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const today = todayInIst();
    const { items, total } = await ComplianceQuery.search(
      {
        scope,
        storeId: storeFilter(scope, query),
        type: optionalOneOf(queryString(query.type, "type"), COMPLIANCE_TYPES, "type"),
        status: optionalOneOf(queryString(query.status, "status"), COMPLIANCE_STATUSES, "status"),
        today,
        expiringUntil: addDays(today, EXPIRING_WINDOW_DAYS),
      },
      page
    );
    return toPage(
      items.map((item) => toView(item, today)),
      total,
      page
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

// Expired items come first (negative daysLeft), then what lapses soonest.
const expiring = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const withinDays = queryInteger(query.withinDays, "withinDays", 1, MAX_DUE_DAYS) ?? DEFAULT_DUE_DAYS;
    const today = todayInIst();
    const { items, total } = await ComplianceQuery.searchDue(
      { scope, storeId: storeFilter(scope, query), until: addDays(today, withinDays) },
      page
    );
    return toPage(
      items.map((item) => toView(item, today)),
      total,
      page
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

const summary = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const today = todayInIst();
    const counts = await ComplianceQuery.countByStatus(
      scope,
      storeFilter(scope, query),
      today,
      addDays(today, EXPIRING_WINDOW_DAYS)
    );
    return {
      total: counts.valid + counts.expiring + counts.expired,
      valid: counts.valid,
      expiringSoon: counts.expiring,
      expired: counts.expired,
      expiringWithinDays: EXPIRING_WINDOW_DAYS,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const getById = async (id: string, scope: StoreScope) => {
  try {
    requireId(id);
    const item = await ComplianceQuery.findById(id, scope);
    if (!item) throw new CustomException(NOT_FOUND, notFound);
    const renewals = await ComplianceQuery.listRenewals(id, RENEWALS_SHOWN);
    return {
      ...toView(item, todayInIst()),
      checklist: item.checklist,
      documents: item.documents,
      renewals: renewals.map((r) => ({
        id: r.id,
        previousExpiresOn: dayString(r.previousExpiresOn),
        newExpiresOn: dayString(r.newExpiresOn),
        previousReferenceNumber: r.previousReferenceNumber,
        referenceNumber: r.referenceNumber,
        renewedBy: r.renewedBy,
        renewedAt: r.renewedAt.toISOString(),
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const update = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    requireId(id);
    const body = parseBody(input);
    const data: IComplianceUpdate = {};
    if (body.name !== undefined) data.name = text(body.name, "name", 120);
    if (body.type !== undefined) data.type = oneOf(body.type, COMPLIANCE_TYPES, "type");
    const authority = nullableText(body.authority, "authority", 120);
    if (authority !== undefined) data.authority = authority;
    const referenceNumber = nullableText(body.referenceNumber, "referenceNumber", 80);
    if (referenceNumber !== undefined) data.referenceNumber = referenceNumber;
    const issuedOn = nullableDay(body.issuedOn, "issuedOn");
    if (issuedOn !== undefined) data.issuedOn = issuedOn;
    if (body.expiresOn !== undefined) data.expiresOn = parseDay(body.expiresOn, "expiresOn");
    const ownerId = nullableUuid(body.ownerId, "ownerId");
    if (ownerId !== undefined) data.ownerId = ownerId;
    if (body.storeId !== undefined) {
      if (body.storeId === null) {
        if (scope) throw new CustomException("Not found.", notFound);
        data.storeId = null;
      } else {
        data.storeId = await storeForWrite(scope, body.storeId);
      }
    }
    // `status` is derived from expiresOn and is ignored here on purpose.
    if (Object.keys(data).length === 0) throw new CustomException("Nothing to update.", badRequest);
    if (ownerId) await requireActiveUsers([ownerId], "ownerId");

    const today = todayInIst();
    try {
      const item = await inTransaction(async (tx) => {
        const current = await ComplianceQuery.lockById(id, scope, tx);
        if (!current) throw new CustomException(NOT_FOUND, notFound);
        checkDates(data.issuedOn === undefined ? current.issuedOn : data.issuedOn, data.expiresOn ?? current.expiresOn);
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        for (const key of Object.keys(data) as (keyof IComplianceUpdate)[]) {
          const show = (v: unknown) => (v instanceof Date ? dayString(v) : v);
          if (show(current[key]) !== show(data[key])) changes[key] = { from: show(current[key]), to: show(data[key]) };
        }
        const updated = await ComplianceQuery.update(id, data, tx);
        await OpsActivityQuery.append(
          activityRow(user, {
            entity: "compliance_item",
            entityId: id,
            action: "updated",
            storeId: updated.storeId,
            fromStatus: statusOf(daysBetween(today, current.expiresOn)),
            toStatus: statusOf(daysBetween(today, updated.expiresOn)),
            detail: { changes },
          }),
          tx
        );
        return updated;
      });
      return toView(item, today);
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicate({ type: data.type ?? "item", name: data.name ?? "with this name" });
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const getChecklist = async (id: string, scope: StoreScope) => {
  try {
    requireId(id);
    const item = await ComplianceQuery.findById(id, scope);
    if (!item) throw new CustomException(NOT_FOUND, notFound);
    return { items: item.checklist };
  } catch (error) {
    throw toCustomException(error);
  }
};

const parseChecklist = (value: unknown): IChecklistEntry[] =>
  boundedArray(value, "items", MAX_CHECKLIST).map((raw, index) => {
    const entry = parseBody(raw);
    if (entry.done !== undefined && typeof entry.done !== "boolean") {
      throw new CustomException(`items[${index}].done must be true or false.`, badRequest);
    }
    return { title: text(entry.title, `items[${index}].title`, 200), done: entry.done === true };
  });

// A full replace; the row lock makes two simultaneous edits queue rather than interleave.
const setChecklist = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    requireId(id);
    const checklist = parseChecklist(parseBody(input).items);
    return await inTransaction(async (tx) => {
      const current = await ComplianceQuery.lockById(id, scope, tx);
      if (!current) throw new CustomException(NOT_FOUND, notFound);
      await ComplianceQuery.setChecklist(id, checklist, tx);
      await OpsActivityQuery.append(
        activityRow(user, {
          entity: "compliance_item",
          entityId: id,
          action: "checklist_set",
          storeId: current.storeId,
          detail: { total: checklist.length, done: checklist.filter((e) => e.done).length },
        }),
        tx
      );
      return { items: checklist };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

// A reference to a document kept elsewhere (https link + metadata); no file is stored here.
const addDocument = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    requireId(id);
    const body = parseBody(input);
    if (body.url === undefined) {
      throw new CustomException("Send JSON with name and an https url; files are not uploaded to this service.", badRequest);
    }
    const parsed = parseFileRef(body, "document");
    return await inTransaction(async (tx) => {
      const current = await ComplianceQuery.lockById(id, scope, tx);
      if (!current) throw new CustomException(NOT_FOUND, notFound);
      if (current.documents.length >= MAX_DOCUMENTS) {
        throw new CustomException(`An item can hold at most ${MAX_DOCUMENTS} documents.`, conflict);
      }
      const document = { ...parsed, addedBy: user.id, addedAt: new Date().toISOString() };
      await ComplianceQuery.setDocuments(id, [...current.documents, document], tx);
      await OpsActivityQuery.append(
        activityRow(user, {
          entity: "compliance_item",
          entityId: id,
          action: "document_added",
          storeId: current.storeId,
          detail: { documentId: document.id, name: document.name },
        }),
        tx
      );
      return document;
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const renew = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    requireId(id);
    const body = parseBody(input);
    const newExpiresOn = parseDay(body.newExpiresOn, "newExpiresOn");
    const referenceNumber = optionalText(body.referenceNumber, "referenceNumber", 80);
    const today = todayInIst();
    if (newExpiresOn < today) throw new CustomException("newExpiresOn cannot be in the past.", badRequest);
    const horizon = new Date(Date.UTC(today.getUTCFullYear() + MAX_HORIZON_YEARS, 0, 1));
    if (newExpiresOn > horizon) throw new CustomException("newExpiresOn is too far ahead.", badRequest);

    const item = await inTransaction(async (tx) => {
      const current = await ComplianceQuery.lockById(id, scope, tx);
      if (!current) throw new CustomException(NOT_FOUND, notFound);
      if (newExpiresOn <= current.expiresOn) {
        throw new CustomException("newExpiresOn must be later than the current expiry.", badRequest);
      }
      const renewed = await ComplianceQuery.renew(id, { newExpiresOn, referenceNumber }, tx);
      await ComplianceQuery.addRenewal(
        {
          itemId: id,
          previousExpiresOn: current.expiresOn,
          newExpiresOn,
          previousReferenceNumber: current.referenceNumber,
          referenceNumber: renewed.referenceNumber,
          renewedBy: user.id,
        },
        tx
      );
      await OpsActivityQuery.append(
        activityRow(user, {
          entity: "compliance_item",
          entityId: id,
          action: "renewed",
          storeId: renewed.storeId,
          fromStatus: statusOf(daysBetween(today, current.expiresOn)),
          toStatus: statusOf(daysBetween(today, newExpiresOn)),
          detail: { previousExpiresOn: dayString(current.expiresOn), newExpiresOn: dayString(newExpiresOn) },
        }),
        tx
      );
      return renewed;
    });
    return toView(item, today);
  } catch (error) {
    throw toCustomException(error);
  }
};

export const ComplianceService = {
  create,
  list,
  expiring,
  summary,
  getById,
  update,
  getChecklist,
  setChecklist,
  addDocument,
  renew,
};
