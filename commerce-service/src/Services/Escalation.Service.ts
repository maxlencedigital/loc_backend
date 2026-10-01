import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { COMPLAINT_DECISIONS, COMPLAINT_STATUSES, COMPLAINT_TYPES } from "../Models/Complaint/Complaint.Interface.js";
import { ComplaintQuery } from "../Queries/Complaint.Query.js";
import { oneOf, optionalOneOf, parseBody, queryString, text } from "../Utils/Input.js";
import { actorNameOf, effectiveStore, idOrNotFound, optionalUuidQuery, userIdOf } from "../Utils/SupportInput.js";
import { toEscalationItem, toStaffDetail } from "./Complaint.Views.js";
import { NOT_FOUND, event, mutate, needTransition, parseMoney, statusPatch } from "./Complaint.Service.js";

const MAX_NOTE = 2000;

// The admin queue is the complaints that went to management. With no status filter it is the
// ones still waiting for a decision; ask for `resolved` to see the decided ones.
const list = async (scope: string | null, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const status = optionalOneOf(queryString(query.status, "status"), COMPLAINT_STATUSES, "status") ?? "escalated";
    const { items, total } = await ComplaintQuery.search(
      {
        storeId: effectiveStore(scope, optionalUuidQuery(query.storeId, "storeId")),
        statuses: [status],
        type: optionalOneOf(queryString(query.type, "type"), COMPLAINT_TYPES, "type"),
        escalatedOnly: true,
        page,
      },
      "escalatedAt"
    );
    return toPage(items.map(toEscalationItem), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const get = async (scope: string | null, id: string) => {
  try {
    const detail = await ComplaintQuery.findDetail(idOrNotFound(id, NOT_FOUND), { storeId: scope, escalatedOnly: true });
    if (!detail) throw new CustomException(NOT_FOUND, notFound);
    return toStaffDetail(detail);
  } catch (error) {
    throw toCustomException(error);
  }
};

// The final word. Recording a refund here does not move money: paying it out is a finance
// action that nothing in the agreed internal contract exposes yet.
const decide = async (user: RequestUser, scope: string | null, id: string, input: unknown) => {
  try {
    const actor = { role: "staff" as const, userId: userIdOf(user), name: actorNameOf(user) };
    const body = parseBody(input);
    const decision = oneOf(body.decision, COMPLAINT_DECISIONS, "decision");
    const note = text(body.note, "note", MAX_NOTE);
    const hasAmount = body.amount !== undefined && body.amount !== null;
    if (decision === "refund" && !hasAmount) {
      throw new CustomException("amount is required for a refund.", badRequest);
    }
    if (hasAmount && decision !== "refund" && decision !== "goodwill") {
      throw new CustomException("amount only applies to a refund or goodwill decision.", badRequest);
    }
    const owner = { storeId: scope, escalatedOnly: true };
    const known = await ComplaintQuery.findDetail(idOrNotFound(id, NOT_FOUND), owner);
    if (!known) throw new CustomException(NOT_FOUND, notFound);
    const amountPaise = hasAmount ? await parseMoney(body.amount, "amount", known.orderId, scope) : null;

    const detail = await mutate(id, owner, (c) => {
      const to = needTransition(c, "decide");
      const now = new Date();
      return {
        patch: {
          ...statusPatch(c, to),
          resolvedAt: now,
          firstResponseAt: c.firstResponseAt ?? now,
          decision,
          resolution: note,
          refundAmountPaise: amountPaise,
          goodwill: decision === "goodwill" ? note : null,
        },
        events: [event(actor, "resolved", { message: note, fromStatus: c.status, toStatus: to })],
      };
    });
    return toStaffDetail(detail);
  } catch (error) {
    throw toCustomException(error);
  }
};

export const EscalationService = { list, get, decide };
