import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import {
  CLAIM_OUTCOMES,
  CLAIM_STATUSES,
  CLAIM_TRANSITIONS,
  ClaimStatus,
  IClaim,
  IClaimDetail,
} from "../Models/OpsInsurance/Insurance.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { OpsClaimQuery } from "../Queries/OpsClaim.Query.js";
import { OpsPolicyQuery } from "../Queries/OpsPolicy.Query.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { oneOf, optionalOneOf, parseBody, queryString, text } from "../Utils/Input.js";
import { rupeesToPaise, toRupees } from "../Utils/Money.js";
import { istDateOf, parseDateInput, todayIst } from "../Utils/OpsDates.js";
import { nullableText, optionalUuid, parseDocumentRef, parseIdempotencyKey } from "../Utils/OpsInput.js";
import { isUuid } from "../Utils/Uuid.js";
import { actorOf, notFoundError, parseRange } from "./OpsActor.js";

const NOT_FOUND = "Insurance claim";
const MAX_CLAIM_PAISE = 1_000_000_000_000;
const MAX_DOCUMENTS = 20;
const MS_PER_DAY = 86_400_000;

// A closed list keeps the history report bounded. Entries are matched case-insensitively.
export const CLAIM_TYPES = [
  "fire",
  "theft",
  "water_damage",
  "equipment_breakdown",
  "accident",
  "medical",
  "vehicle_damage",
  "third_party_liability",
  "other",
] as const;

export const toClaimView = (claim: IClaim) => ({
  id: claim.id,
  number: claim.number,
  policyId: claim.policyId,
  type: claim.type,
  description: claim.description,
  incidentDate: claim.incidentDate,
  status: claim.status,
  claimAmount: toRupees(claim.claimAmountPaise),
  settledAmount: claim.settledAmountPaise === null ? null : toRupees(claim.settledAmountPaise),
  outcome: claim.outcome,
  insurerReference: claim.insurerReference,
  incidentId: claim.incidentId,
  storeId: claim.storeId,
  employeeId: claim.employeeId,
  orderId: claim.orderId,
  raisedOn: istDateOf(claim.raisedAt),
  settledAt: claim.settledAt?.toISOString() ?? null,
  documents: claim.documents,
});

export const toClaimDetailView = (claim: IClaimDetail) => ({
  ...toClaimView(claim),
  timeline: claim.events.map((e) => ({
    at: e.at.toISOString(),
    from: e.fromStatus,
    status: e.toStatus,
    by: e.byName,
    ...(e.note ? { note: e.note } : {}),
  })),
});

const parseClaimType = (value: unknown): string => {
  const normal = text(value, "type", 40).toLowerCase().replace(/[\s-]+/g, "_");
  return oneOf(normal, CLAIM_TYPES, "type");
};

// Also the entry point the incidents module uses to raise a claim from an incident.
const create = async (user: RequestUser, input: unknown, key?: string) => {
  try {
    const body = parseBody(input);
    const idempotencyKey = parseIdempotencyKey(key);
    const policyId = optionalUuid(body.policyId, "policyId");
    if (!policyId) throw new CustomException("policyId is required.", badRequest);
    const type = parseClaimType(body.type);
    const description = text(body.description, "description", 2000);
    const incidentDate = parseDateInput(body.incidentDate, "incidentDate");
    const claimAmountPaise = rupeesToPaise(body.claimAmount, "claimAmount", MAX_CLAIM_PAISE);
    const incidentId = optionalUuid(body.incidentId, "incidentId") ?? null;
    const storeId = optionalUuid(body.storeId, "storeId") ?? null;
    const employeeId = optionalUuid(body.employeeId, "employeeId") ?? null;
    const orderId = optionalUuid(body.orderId, "orderId") ?? null;
    const actor = actorOf(user);

    if (idempotencyKey) {
      const earlier = await OpsClaimQuery.findByIdempotencyKey(actor.id, idempotencyKey);
      if (earlier) return toClaimDetailView(earlier);
    }
    const policy = await OpsPolicyQuery.findById(policyId, null);
    if (!policy) throw notFoundError("Insurance policy");
    if (policy.cancelledAt) throw new CustomException("This policy is cancelled.", conflict);
    if (incidentDate > todayIst()) throw new CustomException("incidentDate cannot be in the future.", badRequest);
    if (incidentDate < policy.startDate || incidentDate > policy.endDate) {
      throw new CustomException(`incidentDate is outside the policy period (${policy.startDate} to ${policy.endDate}).`, badRequest);
    }
    if (policy.coverageAmountPaise !== null && claimAmountPaise > policy.coverageAmountPaise) {
      throw new CustomException("claimAmount is more than the policy's coverage amount.", badRequest);
    }
    if (storeId) {
      if (!(await StoreQuery.findById(storeId, null))) throw new CustomException("storeId does not match a store.", badRequest);
      if (policy.storeIds.length > 0 && !policy.storeIds.includes(storeId)) {
        throw new CustomException("This policy does not cover that store.", badRequest);
      }
    }

    try {
      const claim = await OpsClaimQuery.inTransaction(async (tx) => {
        const number = await OpsClaimQuery.nextNumber(tx);
        return await OpsClaimQuery.create(
          number,
          {
            policyId,
            type,
            description,
            incidentDate,
            claimAmountPaise,
            incidentId,
            storeId,
            employeeId,
            orderId,
            createdBy: actor.id,
            idempotencyKey: idempotencyKey ?? null,
            firstEvent: { byUserId: actor.id, byName: actor.name },
          },
          tx
        );
      });
      return toClaimDetailView(claim);
    } catch (error) {
      // Two simultaneous submissions of one key: the loser returns the winner's claim.
      if (idempotencyKey && isUniqueViolation(error, "idempotency")) {
        const winner = await OpsClaimQuery.findByIdempotencyKey(actor.id, idempotencyKey);
        if (winner) return toClaimDetailView(winner);
      }
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const list = async (query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const range = parseRange(query);
    const { items, total } = await OpsClaimQuery.list({
      status: optionalOneOf(queryString(query.status, "status"), CLAIM_STATUSES, "status"),
      policyId: optionalUuid(queryString(query.policyId, "policyId"), "policyId"),
      ...range,
      offset: page.offset,
      limit: page.limit,
    });
    return toPage(items.map(toClaimView), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const requireClaim = async (id: string): Promise<IClaimDetail> => {
  const claim = isUuid(id) ? await OpsClaimQuery.findById(id) : null;
  if (!claim) throw notFoundError(NOT_FOUND);
  return claim;
};

const getById = async (id: string) => {
  try {
    return toClaimDetailView(await requireClaim(id));
  } catch (error) {
    throw toCustomException(error);
  }
};

const stale = () => new CustomException("This claim was changed by someone else. Reload and try again.", conflict);

// Moves a claim along submitted and under_review, or sets the insurer's reference. Settling
// and rejecting go through settle, which needs an outcome.
const update = async (id: string, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const target = body.status === undefined ? undefined : oneOf(body.status, CLAIM_STATUSES, "status");
    const reference = nullableText(body.insurerReference, "insurerReference", 100);
    const note = nullableText(body.note, "note", 500) ?? null;
    if (target === undefined && reference === undefined) {
      throw new CustomException("Send a status or an insurerReference to change.", badRequest);
    }
    if (target === "settled" || target === "rejected") {
      throw new CustomException("Use the settle action to settle or reject a claim.", badRequest);
    }
    const claim = await requireClaim(id);
    if (CLAIM_TRANSITIONS[claim.status].length === 0) {
      throw new CustomException(`A ${claim.status} claim cannot be changed.`, conflict);
    }
    if (target !== undefined && !CLAIM_TRANSITIONS[claim.status].includes(target)) {
      throw new CustomException(`A ${claim.status.replace("_", " ")} claim cannot move to ${target.replace("_", " ")}.`, conflict);
    }
    const actor = actorOf(user);
    const to: ClaimStatus = target ?? claim.status;
    const moved = await OpsClaimQuery.inTransaction((tx) =>
      OpsClaimQuery.change(
        id,
        claim.status,
        { ...(target ? { status: target } : {}), ...(reference !== undefined ? { insurerReference: reference } : {}) },
        {
          fromStatus: claim.status,
          toStatus: to,
          note: note ?? (target ? null : "Insurer reference updated"),
          byUserId: actor.id,
          byName: actor.name,
        },
        tx
      )
    );
    if (!moved) throw stale();
    return toClaimDetailView(await requireClaim(id));
  } catch (error) {
    throw toCustomException(error);
  }
};

const settle = async (id: string, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const outcome = oneOf(body.outcome, CLAIM_OUTCOMES, "outcome");
    const note = nullableText(body.note, "note", 500) ?? null;
    const claim = await requireClaim(id);
    if (claim.status === "raised") throw new CustomException("Submit the claim to the insurer before settling it.", conflict);
    if (!CLAIM_TRANSITIONS[claim.status].includes(outcome === "rejected" ? "rejected" : "settled")) {
      throw new CustomException(`A ${claim.status.replace("_", " ")} claim cannot be settled again.`, conflict);
    }
    let paid: number | undefined;
    if (outcome === "rejected") {
      if (body.amount !== undefined && body.amount !== null && body.amount !== 0) {
        throw new CustomException("A rejected claim has no amount.", badRequest);
      }
    } else if (outcome === "paid") {
      paid = body.amount === undefined || body.amount === null ? claim.claimAmountPaise : rupeesToPaise(body.amount, "amount", MAX_CLAIM_PAISE);
      if (paid > claim.claimAmountPaise) throw new CustomException("amount cannot be more than the amount claimed.", badRequest);
    } else {
      if (body.amount === undefined || body.amount === null) throw new CustomException("amount is required for a partly paid claim.", badRequest);
      paid = rupeesToPaise(body.amount, "amount", MAX_CLAIM_PAISE);
      if (paid >= claim.claimAmountPaise) {
        throw new CustomException("A partly paid claim must be paid less than was claimed.", badRequest);
      }
    }
    const actor = actorOf(user);
    const now = new Date();
    const status: ClaimStatus = outcome === "rejected" ? "rejected" : "settled";
    const moved = await OpsClaimQuery.inTransaction((tx) =>
      OpsClaimQuery.change(
        id,
        claim.status,
        {
          status,
          outcome,
          settledAt: now,
          decisionSeconds: Math.max(0, Math.floor((now.getTime() - claim.raisedAt.getTime()) / 1000)),
          ...(paid !== undefined ? { settledAmountPaise: paid } : {}),
        },
        { fromStatus: claim.status, toStatus: status, note, byUserId: actor.id, byName: actor.name },
        tx
      )
    );
    if (!moved) throw stale();
    return toClaimDetailView(await requireClaim(id));
  } catch (error) {
    throw toCustomException(error);
  }
};

const attachDocument = async (id: string, user: RequestUser, input: unknown) => {
  try {
    const document = parseDocumentRef(parseBody(input), user.id, new Date());
    if (!isUuid(id)) throw notFoundError(NOT_FOUND);
    await OpsClaimQuery.inTransaction(async (tx) => {
      if (!(await OpsClaimQuery.lockById(id, tx))) throw notFoundError(NOT_FOUND);
      const claim = await OpsClaimQuery.findById(id, tx);
      if (!claim) throw notFoundError(NOT_FOUND);
      if (claim.documents.length >= MAX_DOCUMENTS) {
        throw new CustomException(`A claim holds at most ${MAX_DOCUMENTS} documents.`, conflict);
      }
      await OpsClaimQuery.saveDocuments(id, [...claim.documents, document], tx);
    });
    return toClaimDetailView(await requireClaim(id));
  } catch (error) {
    throw toCustomException(error);
  }
};

// Claimed and paid come from SQL sums; the average covers every claim that has been decided,
// whether paid or rejected.
const history = async (query: Record<string, unknown>) => {
  try {
    const { rows, averageDecisionSeconds } = await OpsClaimQuery.history(parseRange(query));
    const byType: Record<string, { count: number; claimed: number; paid: number; rejected: number }> = {};
    let claimed = 0;
    let paid = 0;
    let rejected = 0;
    for (const row of rows) {
      const entry = (byType[row.type] ??= { count: 0, claimed: 0, paid: 0, rejected: 0 });
      entry.count += row.count;
      entry.claimed += row.claimedPaise;
      entry.paid += row.paidPaise;
      if (row.status === "rejected") entry.rejected += row.count;
      claimed += row.claimedPaise;
      paid += row.paidPaise;
      if (row.status === "rejected") rejected += row.count;
    }
    return {
      totalClaimed: toRupees(claimed),
      totalPaid: toRupees(paid),
      rejected,
      averageDaysToSettle:
        averageDecisionSeconds === null ? null : Math.round((averageDecisionSeconds / (MS_PER_DAY / 1000)) * 10) / 10,
      byType: Object.fromEntries(
        Object.entries(byType).map(([type, e]) => [type, { ...e, claimed: toRupees(e.claimed), paid: toRupees(e.paid) }])
      ),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const OpsClaimService = { create, list, getById, update, settle, attachDocument, history };
