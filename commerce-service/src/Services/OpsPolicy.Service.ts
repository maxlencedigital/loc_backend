import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { StoreScope } from "../Middleware/StoreScope.js";
import {
  IPolicy,
  IPolicyFilter,
  IPolicyRenewal,
  IPolicyWrite,
  POLICY_STATUSES,
  POLICY_TYPES,
  PolicyStatus,
} from "../Models/OpsInsurance/Insurance.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { OpsPolicyQuery } from "../Queries/OpsPolicy.Query.js";
import { oneOf, optionalOneOf, parseBody, queryString, text } from "../Utils/Input.js";
import { rupeesToPaise, toRupees } from "../Utils/Money.js";
import { DateString, addDays, daysBetween, parseDateInput, todayIst } from "../Utils/OpsDates.js";
import { nullableText, parseDocumentRef, queryInteger, uuidList } from "../Utils/OpsInput.js";
import { isUuid } from "../Utils/Uuid.js";
import { actorOf, isBackOffice, listStore, notFoundError } from "./OpsActor.js";

const NOT_FOUND = "Insurance policy";
const EXPIRING_WINDOW_DAYS = 30;
const DEFAULT_RENEWAL_DAYS = 60;
const MAX_RENEWAL_DAYS = 365;
// A policy that lapsed within this many days still shows on the renewals list, as overdue.
const LAPSED_GRACE_DAYS = 30;
const MAX_STORES = 100;
const MAX_EMPLOYEES = 500;
const MAX_DOCUMENTS = 10;
const MAX_COVERAGE_PAISE = 1_000_000_000_000;
const MAX_PREMIUM_PAISE = 100_000_000_000;
const MAX_RENEWAL_YEARS_DAYS = 366 * 5;
const RIDER_POLICY_LIMIT = 20;

// Cancellation is stored; expiring and expired follow the end date and the current day.
export const policyStatus = (policy: IPolicy, today: DateString): PolicyStatus => {
  if (policy.cancelledAt) return "cancelled";
  if (policy.endDate < today) return "expired";
  if (policy.endDate <= addDays(today, EXPIRING_WINDOW_DAYS)) return "expiring";
  return "active";
};

export const toPolicyView = (policy: IPolicy, user: RequestUser, today: DateString, renewals?: IPolicyRenewal[]) => ({
  id: policy.id,
  type: policy.type,
  insurer: policy.insurer,
  policyNumber: policy.policyNumber,
  coverageAmount: policy.coverageAmountPaise === null ? null : toRupees(policy.coverageAmountPaise),
  premium: policy.premiumPaise === null ? null : toRupees(policy.premiumPaise),
  startDate: policy.startDate,
  endDate: policy.endDate,
  covers: policy.covers,
  // The people a policy names are shown to back office only; a manager gets the count.
  appliesTo: {
    storeIds: policy.storeIds,
    employeeIds: isBackOffice(user) ? policy.employeeIds : [],
    employeeCount: policy.employeeIds.length,
  },
  status: policyStatus(policy, today),
  documents: policy.documents,
  cancelReason: policy.cancelReason,
  createdAt: policy.createdAt.toISOString(),
  updatedAt: policy.updatedAt.toISOString(),
  ...(renewals
    ? {
        renewals: renewals.map((r) => ({
          previousEndDate: r.previousEndDate,
          newEndDate: r.newEndDate,
          previousPolicyNumber: r.previousPolicyNumber,
          newPolicyNumber: r.newPolicyNumber,
          previousPremium: r.previousPremiumPaise === null ? null : toRupees(r.previousPremiumPaise),
          newPremium: r.newPremiumPaise === null ? null : toRupees(r.newPremiumPaise),
          by: r.byName,
          at: r.at.toISOString(),
        })),
      }
    : {}),
});

const numberConflict = (error: unknown): CustomException | null =>
  isUniqueViolation(error, "insurer_number")
    ? new CustomException("This insurer already has a policy with that number.", conflict)
    : null;

const insurerName = (value: unknown) => text(value, "insurer", 120).replace(/\s+/g, " ");
const normalNumber = (value: unknown) => text(value, "policyNumber", 80).toUpperCase();

const parseAppliesTo = async (value: unknown): Promise<{ storeIds?: string[]; employeeIds?: string[] }> => {
  if (value === undefined) return {};
  const body = parseBody(value);
  const result: { storeIds?: string[]; employeeIds?: string[] } = {};
  if (body.storeIds !== undefined) {
    result.storeIds = uuidList(body.storeIds, "storeIds", MAX_STORES);
    if (result.storeIds.length > 0 && (await OpsPolicyQuery.countStores(result.storeIds)) !== result.storeIds.length) {
      throw new CustomException("storeIds contains a store that does not exist.", badRequest);
    }
  }
  if (body.employeeIds !== undefined) result.employeeIds = uuidList(body.employeeIds, "employeeIds", MAX_EMPLOYEES);
  return result;
};

const parseMoney = (value: unknown, field: string, max: number): number | null | undefined =>
  value === undefined ? undefined : value === null ? null : rupeesToPaise(value, field, max);

const requirePolicy = async (id: string, scope: StoreScope): Promise<IPolicy> => {
  const policy = isUuid(id) ? await OpsPolicyQuery.findById(id, scope) : null;
  if (!policy) throw notFoundError(NOT_FOUND);
  return policy;
};

const create = async (user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const data: IPolicyWrite = {
      type: oneOf(body.type, POLICY_TYPES, "type"),
      insurer: insurerName(body.insurer),
      policyNumber: normalNumber(body.policyNumber),
      coverageAmountPaise: parseMoney(body.coverageAmount, "coverageAmount", MAX_COVERAGE_PAISE) ?? null,
      premiumPaise: parseMoney(body.premium, "premium", MAX_PREMIUM_PAISE) ?? null,
      startDate: parseDateInput(body.startDate, "startDate"),
      endDate: parseDateInput(body.endDate, "endDate"),
      covers: nullableText(body.covers, "covers", 1000) ?? null,
      storeIds: [],
      employeeIds: [],
    };
    if (data.endDate < data.startDate) throw new CustomException("endDate must not be before startDate.", badRequest);
    if (body.status !== undefined && body.status !== "active") {
      throw new CustomException("A new policy starts active; its status then follows its dates.", badRequest);
    }
    const applies = await parseAppliesTo(body.appliesTo);
    data.storeIds = applies.storeIds ?? [];
    data.employeeIds = applies.employeeIds ?? [];
    try {
      const policy = await OpsPolicyQuery.create({ ...data, createdBy: user.id });
      return toPolicyView(policy, user, todayIst());
    } catch (error) {
      throw numberConflict(error) ?? error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

// The API status filter as date and cancellation conditions on indexed columns.
const statusFilter = (status: PolicyStatus, today: DateString): Partial<IPolicyFilter> => {
  const soon = addDays(today, EXPIRING_WINDOW_DAYS);
  switch (status) {
    case "cancelled":
      return { cancelled: true };
    case "expired":
      return { cancelled: false, endTo: addDays(today, -1) };
    case "expiring":
      return { cancelled: false, endFrom: today, endTo: soon };
    default:
      return { cancelled: false, endFrom: addDays(soon, 1) };
  }
};

const list = async (user: RequestUser, scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const type = optionalOneOf(queryString(query.type, "type"), POLICY_TYPES, "type");
    const status = optionalOneOf(queryString(query.status, "status"), POLICY_STATUSES, "status");
    const store = listStore(scope, query);
    if (store.empty) return toPage([], 0, page);
    const today = todayIst();
    const { items, total } = await OpsPolicyQuery.list({
      storeId: store.storeId,
      type,
      ...(status ? statusFilter(status, today) : {}),
      offset: page.offset,
      limit: page.limit,
    });
    return toPage(items.map((p) => toPolicyView(p, user, today)), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getById = async (id: string, user: RequestUser, scope: StoreScope) => {
  try {
    const policy = await requirePolicy(id, scope);
    return toPolicyView(policy, user, todayIst(), await OpsPolicyQuery.listRenewals(id, 20));
  } catch (error) {
    throw toCustomException(error);
  }
};

const update = async (id: string, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const patch: Partial<IPolicyWrite> = {};
    if (body.type !== undefined) patch.type = oneOf(body.type, POLICY_TYPES, "type");
    if (body.insurer !== undefined) patch.insurer = insurerName(body.insurer);
    if (body.policyNumber !== undefined) patch.policyNumber = normalNumber(body.policyNumber);
    const coverage = parseMoney(body.coverageAmount, "coverageAmount", MAX_COVERAGE_PAISE);
    if (coverage !== undefined) patch.coverageAmountPaise = coverage;
    const premium = parseMoney(body.premium, "premium", MAX_PREMIUM_PAISE);
    if (premium !== undefined) patch.premiumPaise = premium;
    if (body.startDate !== undefined) patch.startDate = parseDateInput(body.startDate, "startDate");
    if (body.endDate !== undefined) patch.endDate = parseDateInput(body.endDate, "endDate");
    const covers = nullableText(body.covers, "covers", 1000);
    if (covers !== undefined) patch.covers = covers;
    Object.assign(patch, await parseAppliesTo(body.appliesTo));
    const status = body.status === undefined ? undefined : oneOf(body.status, ["active", "cancelled"] as const, "status");
    const reason = nullableText(body.reason, "reason", 500);
    if (body.status !== undefined && status === undefined) throw new CustomException("Invalid status.", badRequest);
    if (!isUuid(id)) throw notFoundError(NOT_FOUND);

    const saved = await OpsPolicyQuery.inTransaction(async (tx) => {
      if (!(await OpsPolicyQuery.lockById(id, null, tx))) throw notFoundError(NOT_FOUND);
      const current = await OpsPolicyQuery.findById(id, null, tx);
      if (!current) throw notFoundError(NOT_FOUND);
      const edits = Object.keys(patch).length > 0;
      if (current.cancelledAt && edits) throw new CustomException("Reinstate the policy before editing it.", conflict);
      if (status === "cancelled" && current.cancelledAt) throw new CustomException("This policy is already cancelled.", conflict);
      const merged = { ...current, ...patch };
      if (merged.endDate < merged.startDate) throw new CustomException("endDate must not be before startDate.", badRequest);
      const change: Parameters<typeof OpsPolicyQuery.update>[1] = { ...patch };
      if (status === "cancelled") Object.assign(change, { cancelledAt: new Date(), cancelReason: reason ?? null });
      if (status === "active" && current.cancelledAt) Object.assign(change, { cancelledAt: null, cancelReason: null });
      if (Object.keys(change).length === 0) return current;
      return await OpsPolicyQuery.update(id, change, tx);
    });
    return toPolicyView(saved, user, todayIst());
  } catch (error) {
    throw toCustomException(numberConflict(error) ?? error);
  }
};

const renew = async (id: string, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const newEndDate = parseDateInput(body.newEndDate, "newEndDate");
    const premium = parseMoney(body.premium, "premium", MAX_PREMIUM_PAISE);
    const newNumber = body.policyNumber === undefined ? undefined : normalNumber(body.policyNumber);
    if (!isUuid(id)) throw notFoundError(NOT_FOUND);
    const actor = actorOf(user);
    const today = todayIst();

    const saved = await OpsPolicyQuery.inTransaction(async (tx) => {
      if (!(await OpsPolicyQuery.lockById(id, null, tx))) throw notFoundError(NOT_FOUND);
      const current = await OpsPolicyQuery.findById(id, null, tx);
      if (!current) throw notFoundError(NOT_FOUND);
      if (current.cancelledAt) throw new CustomException("A cancelled policy cannot be renewed.", conflict);
      const floor = current.endDate > today ? current.endDate : today;
      if (newEndDate <= floor) {
        throw new CustomException("newEndDate must be after the current end date and after today.", badRequest);
      }
      if (daysBetween(floor, newEndDate) > MAX_RENEWAL_YEARS_DAYS) {
        throw new CustomException("newEndDate is more than five years away.", badRequest);
      }
      const policyNumber = newNumber ?? current.policyNumber;
      const renewed = await OpsPolicyQuery.renew(
        id,
        current.endDate,
        { endDate: newEndDate, policyNumber, premiumPaise: premium },
        {
          previousEndDate: current.endDate,
          newEndDate,
          previousPolicyNumber: current.policyNumber,
          newPolicyNumber: policyNumber,
          previousPremiumPaise: current.premiumPaise,
          newPremiumPaise: premium === undefined ? current.premiumPaise : premium,
          byUserId: actor.id,
          byName: actor.name,
        },
        tx
      );
      if (!renewed) throw new CustomException("This policy was changed by someone else. Reload and try again.", conflict);
      return (await OpsPolicyQuery.findById(id, null, tx)) as IPolicy;
    });
    return toPolicyView(saved, user, today, await OpsPolicyQuery.listRenewals(id, 20));
  } catch (error) {
    throw toCustomException(numberConflict(error) ?? error);
  }
};

const attachDocument = async (id: string, user: RequestUser, input: unknown) => {
  try {
    const document = parseDocumentRef(parseBody(input), user.id, new Date());
    if (!isUuid(id)) throw notFoundError(NOT_FOUND);
    const saved = await OpsPolicyQuery.inTransaction(async (tx) => {
      if (!(await OpsPolicyQuery.lockById(id, null, tx))) throw notFoundError(NOT_FOUND);
      const current = await OpsPolicyQuery.findById(id, null, tx);
      if (!current) throw notFoundError(NOT_FOUND);
      if (current.documents.length >= MAX_DOCUMENTS) {
        throw new CustomException(`A policy holds at most ${MAX_DOCUMENTS} documents.`, conflict);
      }
      return await OpsPolicyQuery.saveDocuments(id, [...current.documents, document], tx);
    });
    return toPolicyView(saved, user, todayIst());
  } catch (error) {
    throw toCustomException(error);
  }
};

const renewals = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const withinDays = queryInteger(queryString(query.withinDays, "withinDays"), "withinDays", 1, MAX_RENEWAL_DAYS) ?? DEFAULT_RENEWAL_DAYS;
    const today = todayIst();
    const { items, total } = await OpsPolicyQuery.list({
      storeId: scope,
      cancelled: false,
      endFrom: addDays(today, -LAPSED_GRACE_DAYS),
      endTo: addDays(today, withinDays),
      offset: page.offset,
      limit: page.limit,
    });
    return {
      renewals: items.map((p) => ({
        policyId: p.id,
        type: p.type,
        insurer: p.insurer,
        policyNumber: p.policyNumber,
        endDate: p.endDate,
        daysLeft: daysBetween(today, p.endDate),
      })),
      page: page.page,
      limit: page.limit,
      total,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// Cover is valid when a rider-vehicle policy naming the rider is in force today. With none
// in force the latest one is reported (expired); with none at all the answer is "no cover".
const riderCoverStatus = async (riderId: string, scope: StoreScope) => {
  try {
    if (!isUuid(riderId)) throw notFoundError("Rider");
    const today = todayIst();
    const policies = await OpsPolicyQuery.findRiderPolicies(riderId, scope, RIDER_POLICY_LIMIT);
    const inForce = policies.find((p) => p.startDate <= today && p.endDate >= today);
    const shown = inForce ?? policies[0];
    return { valid: Boolean(inForce), expiresOn: shown?.endDate ?? null, policyNumber: shown?.policyNumber ?? null };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const OpsPolicyService = { create, list, getById, update, renew, attachDocument, renewals, riderCoverStatus };
