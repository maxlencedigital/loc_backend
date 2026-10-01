import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import { RISK_CLASSES, type RiskClass } from "../Models/Order/Order.Interface.js";
import type { OrderStatus } from "../Models/Order/OrderStatus.js";
import { FABRICS } from "../Models/StoreFloor/StoreFloor.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { FabricRuleQuery } from "../Queries/FabricRule.Query.js";
import { FloorTransaction } from "../Queries/Floor.Transaction.js";
import { OrderQuery } from "../Queries/Order.Query.js";
import { PieceQuery } from "../Queries/Piece.Query.js";
import { StoreOrderQuery } from "../Queries/StoreOrder.Query.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { optionalOneOf, optionalText, parseBody, text } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { CustomerService } from "./Customer.Service.js";
import { STORE_NOT_FOUND, actorOf } from "./FloorSupport.js";
import { OrderService, toOrderView } from "./Order.Service.js";

const NOT_FOUND = "Order not found.";
const MAX_NOTE_CHARS = 1000;
const MAX_CARE_ANSWERS = 10;
const MAX_KEY_CHARS = 80;
const PAYMENT_METHODS = ["cash", "upi", "card", "pay_later"] as const;
// An order can only change store before it reaches the floor: afterwards its garments are tagged here.
const MOVABLE: OrderStatus[] = ["booked", "picked_up"];

const requireOrder = async (id: string, scope: StoreScope) => {
  const order = isUuid(id) ? await OrderQuery.findById(id, scope) : null;
  if (!order) throw new CustomException(NOT_FOUND, notFound);
  return order;
};

const addOrderNote = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const note = text(parseBody(input).note, "note", MAX_NOTE_CHARS);
    const order = await requireOrder(id, scope);
    const saved = await StoreOrderQuery.addNote({ orderId: order.id, storeId: order.storeId, note, ...actorOf(user) });
    return { id: saved.id, note: saved.note, by: saved.byName, at: saved.createdAt.toISOString() };
  } catch (error) {
    throw toCustomException(error);
  }
};

const getOrderTimeline = async (id: string, scope: StoreScope) => {
  try {
    const order = await requireOrder(id, scope);
    const notes = await StoreOrderQuery.listNotes(order.id);
    return {
      events: order.events.map((event) => ({
        at: event.at.toISOString(),
        status: event.status,
        by: event.byName,
        ...(event.note ? { note: event.note } : {}),
      })),
      notes: notes.map((n) => ({ id: n.id, note: n.note, by: n.byName, at: n.createdAt.toISOString() })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const routeOrderToStore = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    if (!isUuid(body.storeId)) throw new CustomException("storeId must be a valid id.", badRequest);
    const targetId = body.storeId;
    const reason = optionalText(body.reason, "reason", 300);

    const moved = await FloorTransaction.run(async (tx) => {
      const order = isUuid(id) ? await OrderQuery.lockById(id, scope, tx) : null;
      if (!order) throw new CustomException(NOT_FOUND, notFound);
      if (order.storeId === targetId) throw new CustomException("The order is already at that store.", badRequest);
      const target = await StoreQuery.findById(targetId, null);
      if (!target) throw new CustomException(STORE_NOT_FOUND, notFound);
      if (target.status !== "live") throw new CustomException("That store is not taking orders.", badRequest);
      const source = await StoreQuery.findById(order.storeId, null);

      const hasPieces = Object.keys(await PieceQuery.stageCounts(order.id, tx)).length > 0;
      if (!MOVABLE.includes(order.status) || hasPieces) {
        throw new CustomException("This order has already reached the floor and cannot be sent to another store.", conflict);
      }
      if (!(await StoreOrderQuery.reassignStore(order.id, order.storeId, target.id, MOVABLE, tx))) {
        throw new CustomException("The order changed while it was being moved. Reload and try again.", conflict);
      }
      await StoreOrderQuery.addEvent(
        { orderId: order.id, status: order.status, note: `Sent from ${source?.code ?? "its store"} to ${target.code}${reason ? `: ${reason}` : "."}`, ...actorOf(user) },
        tx
      );
      return order.id;
    });
    // The caller may no longer be allowed to see it at its new store, so read it unscoped.
    const order = await OrderQuery.findById(moved, null);
    return toOrderView(order as NonNullable<typeof order>);
  } catch (error) {
    throw toCustomException(error);
  }
};

// ---------------------------------------------------------------- walk-in
const walkInResult = (order: ReturnType<typeof toOrderView>) => ({
  orderId: order.id,
  orderNumber: order.ref,
  amountDue: order.paymentStatus === "paid" ? 0 : order.amount,
  paymentStatus: order.paymentStatus,
  order,
});

const parseCareAnswers = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CARE_ANSWERS) {
    throw new CustomException(`careAnswers must list at most ${MAX_CARE_ANSWERS} answers.`, badRequest);
  }
  return value.map((raw, index) => {
    const answer = parseBody(raw);
    return text(`${text(answer.questionId, `careAnswers ${index + 1}: questionId`, 30)}: ${text(answer.answer, `careAnswers ${index + 1}: answer`, 45)}`, "careAnswers", 80);
  });
};

// The contract speaks of garment types, which have no catalogue yet: a line names its garment and
// category, exactly as the dashboard's own booking does. Prices are never read from the request.
const toOrderLines = (raw: unknown) => {
  if (!Array.isArray(raw) || raw.length === 0) throw new CustomException("items must list at least one item.", badRequest);
  return raw.map((entry, index) => {
    const item = parseBody(entry);
    if (item.quantity !== undefined && item.weightKg !== undefined) {
      throw new CustomException(`Item ${index + 1}: send quantity or weightKg, not both.`, badRequest);
    }
    const fabric = optionalOneOf(item.fabric, FABRICS, `Item ${index + 1}: fabric`);
    return { line: { serviceId: item.serviceId, garment: item.garment, category: item.category, qty: item.quantity ?? item.weightKg }, fabric };
  });
};

const createWalkInOrder = async (scope: StoreScope, user: RequestUser, input: unknown, idempotencyKey?: string) => {
  let claim: { id: string } | null = null;
  try {
    const body = parseBody(input);
    if (idempotencyKey !== undefined && (idempotencyKey.trim() === "" || idempotencyKey.length > MAX_KEY_CHARS)) {
      throw new CustomException(`Idempotency-Key must be 1 to ${MAX_KEY_CHARS} characters.`, badRequest);
    }
    const storeId = scope ?? body.storeId;
    if (!isUuid(storeId)) throw new CustomException("Choose a store.", badRequest);
    if (scope && body.storeId !== undefined && body.storeId !== scope) throw new CustomException(STORE_NOT_FOUND, notFound);
    const customerPicked = [body.customerId, body.newCustomer].filter((v) => v !== undefined && v !== null).length;
    if (customerPicked !== 1) throw new CustomException("Send either customerId or newCustomer.", badRequest);

    const entries = toOrderLines(body.items);
    const method = optionalOneOf(body.paymentMethod, PAYMENT_METHODS, "paymentMethod") ?? "pay_later";
    const flags = parseCareAnswers(body.careAnswers);
    const fabrics = [...new Set(entries.map((e) => e.fabric).filter((f): f is (typeof FABRICS)[number] => f !== undefined))];
    const rules = fabrics.length ? await FabricRuleQuery.findByFabrics(fabrics) : new Map();
    const risk = fabrics.reduce<RiskClass>((worst, f) => {
      const rule = rules.get(f);
      return rule && RISK_CLASSES.indexOf(rule.risk) > RISK_CLASSES.indexOf(worst) ? rule.risk : worst;
    }, "low");
    const care = {
      ...(fabrics.find((f) => f !== "unknown") ? { fabric: fabrics.find((f) => f !== "unknown") } : {}),
      riskClass: risk,
      flags,
      ...(body.careNotes !== undefined ? { customerNote: text(body.careNotes, "careNotes", 300) } : {}),
    };

    if (idempotencyKey) {
      try {
        claim = await StoreOrderQuery.claimRequest(user.id, idempotencyKey);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const earlier = await StoreOrderQuery.findRequest(user.id, idempotencyKey);
        const original = earlier?.orderId ? await OrderQuery.findById(earlier.orderId, scope) : null;
        if (original) return walkInResult(toOrderView(original));
        throw new CustomException("A request with this Idempotency-Key is still being processed.", conflict);
      }
    }

    let customerId = body.customerId;
    if (body.newCustomer !== undefined) {
      const customer = await CustomerService.create(scope, { ...parseBody(body.newCustomer), storeId });
      customerId = customer.id;
    }
    const order = await OrderService.create(storeId, user, {
      customerId,
      channel: "walk_in",
      priority: body.express === true ? "express" : "standard",
      paymentStatus: method === "pay_later" ? "unpaid" : "paid",
      promisedAt: body.dueAt,
      items: entries.map((e) => e.line),
      care,
    });
    if (claim) await StoreOrderQuery.completeRequest(claim.id, order.id);
    return walkInResult(order);
  } catch (error) {
    // A failed attempt must not block the retry that follows it.
    if (claim) await StoreOrderQuery.releaseRequest(claim.id).catch(() => undefined);
    throw toCustomException(error);
  }
};

export const StoreOrdersService = { addOrderNote, getOrderTimeline, routeOrderToStore, createWalkInOrder };
