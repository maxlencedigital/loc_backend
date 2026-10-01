import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { ITicket, ITicketDetail, ITicketPatch, TICKET_STATUSES } from "../Models/Ticket/Ticket.Interface.js";
import { violates } from "./Complaint.Service.js";
import { TicketQuery } from "../Queries/Ticket.Query.js";
import { optionalOneOf, parseBody, queryString, text } from "../Utils/Input.js";
import { idOrNotFound, parseIdempotencyKey } from "../Utils/SupportInput.js";
import { isUuid } from "../Utils/Uuid.js";
import { customerUserId, findOwnedOrder } from "./CustomerLink.js";

const NOT_FOUND = "Support ticket not found.";
export const MAX_TICKET_MESSAGES = 200;
const MAX_SUBJECT = 120;
const MAX_MESSAGE = 2000;
const MAX_AUTHOR_NAME = 80;

// open: waiting for support. answered: support replied. closed: finished, no more messages.
// A customer's reply puts an answered ticket back to open; nothing reopens a closed one.
const customerReplyStatus = (ticket: ITicket): ITicket["status"] => {
  if (ticket.status === "closed") {
    throw new CustomException("This ticket is closed. Please open a new one.", conflict);
  }
  return "open";
};

const toListItem = (t: ITicket) => ({
  id: t.id,
  subject: t.subject,
  status: t.status,
  orderId: t.orderId,
  updatedAt: t.updatedAt.toISOString(),
});

const toDetail = (t: ITicketDetail) => ({
  ...toListItem(t),
  createdAt: t.createdAt.toISOString(),
  messages: t.messages.map((m) => ({ from: m.author, message: m.message, at: m.createdAt.toISOString() })),
});

const open = async (user: RequestUser, input: unknown, rawKey: unknown) => {
  try {
    const userId = customerUserId(user);
    const body = parseBody(input);
    const key = parseIdempotencyKey(rawKey);
    const subject = text(body.subject, "subject", MAX_SUBJECT);
    const message = text(body.message, "message", MAX_MESSAGE);
    if (body.orderId !== undefined && body.orderId !== null && !isUuid(body.orderId)) {
      throw new CustomException("orderId must be a valid id.", badRequest);
    }

    if (key) {
      const prior = await TicketQuery.findByCustomerKey(userId, key);
      if (prior) return { created: false, data: toDetail(prior) };
    }
    const order = body.orderId ? await findOwnedOrder(user, body.orderId) : null;
    try {
      const ticket = await TicketQuery.create({
        customerUserId: userId,
        subject,
        orderId: order?.id ?? null,
        storeId: order?.storeId ?? null,
        idempotencyKey: key,
        firstMessage: { author: "customer", authorUserId: userId, authorName: user.name ?? "Customer", message },
      });
      return { created: true, data: toDetail(ticket) };
    } catch (error) {
      if (key && violates(error, "ticket_customer_key", "idempotencyKey")) {
        const raced = await TicketQuery.findByCustomerKey(userId, key);
        if (raced) return { created: false, data: toDetail(raced) };
      }
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const listMine = async (user: RequestUser, query: Record<string, unknown>) => {
  try {
    const userId = customerUserId(user);
    const page = parsePage(query);
    const status = optionalOneOf(queryString(query.status, "status"), TICKET_STATUSES, "status");
    const { items, total } = await TicketQuery.listForCustomer(userId, status, page);
    return toPage(items.map(toListItem), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getMine = async (user: RequestUser, id: string) => {
  try {
    const userId = customerUserId(user);
    const ticket = await TicketQuery.findDetail(idOrNotFound(id, NOT_FOUND), userId);
    if (!ticket) throw new CustomException(NOT_FOUND, notFound);
    return toDetail(ticket);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Shared by the customer's reply and support's reply: lock the ticket, check the cap and the
// status rule, append the message, in one transaction.
const append = async (
  rawId: unknown,
  owner: string | null,
  message: { author: "customer" | "support"; authorUserId: string | null; authorName: string; message: string },
  rule: (ticket: ITicket) => ITicketPatch & { status: ITicket["status"] }
) => {
  const id = idOrNotFound(rawId, NOT_FOUND);
  await TicketQuery.inTransaction(async (tx) => {
    const ticket = await TicketQuery.lock(id, owner, tx);
    if (!ticket) throw new CustomException(NOT_FOUND, notFound);
    if (ticket.messageCount >= MAX_TICKET_MESSAGES) {
      throw new CustomException("This ticket has reached its message limit.", conflict);
    }
    await TicketQuery.appendMessage(id, message, rule(ticket), tx);
  });
  const detail = await TicketQuery.findDetail(id, owner);
  if (!detail) throw new CustomException(NOT_FOUND, notFound);
  return detail;
};

const replyMine = async (user: RequestUser, id: string, input: unknown) => {
  try {
    const userId = customerUserId(user);
    const message = text(parseBody(input).message, "message", MAX_MESSAGE);
    const detail = await append(
      id,
      userId,
      { author: "customer", authorUserId: userId, authorName: user.name ?? "Customer", message },
      (ticket) => ({ status: customerReplyStatus(ticket), answeredAt: null })
    );
    return toDetail(detail);
  } catch (error) {
    throw toCustomException(error);
  }
};

// ---------------------------------------------------------------- internal
// The support side has no public endpoint in the catalogue; a support console reaches it
// through the internal API, naming the agent.
const parseAgent = (body: Record<string, unknown>) => {
  if (!isUuid(body.authorUserId)) throw new CustomException("authorUserId must be a valid id.", badRequest);
  return { authorUserId: body.authorUserId, authorName: text(body.authorName, "authorName", MAX_AUTHOR_NAME) };
};

const supportReply = async (id: string, input: unknown) => {
  try {
    const body = parseBody(input);
    const message = text(body.message, "message", MAX_MESSAGE);
    const agent = parseAgent(body);
    const ticketId = idOrBadRequest(id);
    const detail = await append(ticketId, null, { author: "support", ...agent, message }, (ticket) => {
      if (ticket.status === "closed") throw new CustomException("This ticket is closed.", conflict);
      const now = new Date();
      return { status: "answered", answeredAt: now, ...(ticket.firstResponseAt ? {} : { firstResponseAt: now }) };
    });
    return { id: detail.id, status: detail.status, firstResponseAt: detail.firstResponseAt?.toISOString() ?? null };
  } catch (error) {
    throw toCustomException(error);
  }
};

const close = async (id: string) => {
  try {
    const ticketId = idOrBadRequest(id);
    await TicketQuery.inTransaction(async (tx) => {
      const ticket = await TicketQuery.lock(ticketId, null, tx);
      if (!ticket) throw new CustomException(NOT_FOUND, notFound);
      // Closing twice is a no-op, so a retry from the caller is safe.
      if (ticket.status !== "closed") await TicketQuery.setStatus(ticketId, { status: "closed", closedAt: new Date() }, tx);
    });
    return { id: ticketId, status: "closed" as const };
  } catch (error) {
    throw toCustomException(error);
  }
};

// Internal routes answer a malformed id with 400: the shared route test treats a 404 from a
// service call as "not let in".
const idOrBadRequest = (id: string): string => {
  if (!isUuid(id)) throw new CustomException("id must be a valid id.", badRequest);
  return id;
};

export const TicketService = { open, listMine, getMine, replyMine, supportReply, close };
