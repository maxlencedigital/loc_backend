import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { IInternalOrder } from "../Models/CustomerAccount/CustomerAccount.Interface.js";
import { ORDER_PAYMENT_STATUSES, OrderPaymentStatus } from "../Models/Order/Order.Interface.js";
import { ORDER_STATUSES } from "../Models/Order/OrderStatus.js";
import { CustomerOrderQuery } from "../Queries/CustomerOrder.Query.js";
import { CustomerProfileQuery } from "../Queries/CustomerProfile.Query.js";
import { OrderInternalQuery } from "../Queries/OrderInternal.Query.js";
import { OrderQuery } from "../Queries/Order.Query.js";
import { oneOf, parseBody, queryString, text, wholeNumber } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { OrderService } from "./Order.Service.js";
import { MAX_ORDER_AMOUNT_PAISE } from "./OrderPricing.js";
import { dayStart } from "./PickupSlots.js";

const NOT_FOUND = "Order not found.";
const BAD_ID = "id must be a valid order id.";
const MS_PER_DAY = 86_400_000;
export const MAX_SUMMARY_DAYS = 366;
export const DEFAULT_SUMMARY_DAYS = 30;
const ACTOR_NAME = /^[A-Za-z][A-Za-z0-9 _-]{0,39}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// An order with no recorded payments: "paid" means the whole amount (how walk-in and seeded
// orders were marked), anything else means nothing is known to be paid.
const impliedPaidPaise = (order: IInternalOrder): number => (order.paymentStatus === "paid" ? order.amountPaise : 0);

export const derivePaymentStatus = (paidPaise: number, amountPaise: number): OrderPaymentStatus => {
  if (paidPaise <= 0) return "unpaid";
  return paidPaise >= amountPaise ? "paid" : "part_paid";
};

const summaryOf = async (id: string, db?: Parameters<typeof OrderInternalQuery.findOrder>[1]) => {
  const order = await OrderInternalQuery.findOrder(id, db);
  if (!order) throw new CustomException(NOT_FOUND, notFound);
  const [paid, profile, [ext]] = await Promise.all([
    OrderInternalQuery.findPaidPaise(id, db),
    CustomerProfileQuery.findByCustomerId(order.customerId, db),
    CustomerOrderQuery.findExtByOrderIds([id], db),
  ]);
  return {
    id: order.id,
    ref: order.ref,
    storeId: order.storeId,
    customerId: order.customerId,
    customerUserId: profile?.userId ?? null,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    status: order.status,
    priority: order.priority,
    paymentStatus: order.paymentStatus,
    amountPaise: order.amountPaise,
    paidPaise: paid ?? impliedPaidPaise(order),
    address: order.address,
    promisedAt: order.promisedAt.toISOString(),
    // Beyond the agreed shape: what the logistics service needs to plan a pickup and a drop.
    deliveryAddress: ext?.deliveryAddress ?? order.address,
    pickupWindow: ext ? { from: ext.pickupFrom.toISOString(), to: ext.pickupTo.toISOString() } : null,
  };
};

const getOrder = async (id: string) => {
  try {
    if (!isUuid(id)) throw new CustomException(BAD_ID, badRequest);
    return await summaryOf(id);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Idempotent and one-way: the paid total only ever goes up, and the label is derived from
// it, so a late or repeated message cannot undo a payment. The order row is locked first.
const updatePaymentStatus = async (id: string, input: unknown) => {
  try {
    if (!isUuid(id)) throw new CustomException(BAD_ID, badRequest);
    const body = parseBody(input);
    const claimed = oneOf(body.paymentStatus, ORDER_PAYMENT_STATUSES, "paymentStatus");
    const incoming = wholeNumber(body.paidPaise, "paidPaise", 0, MAX_ORDER_AMOUNT_PAISE);

    return await OrderQuery.inTransaction(async (tx) => {
      if (!(await OrderQuery.lockById(id, null, tx))) throw new CustomException(NOT_FOUND, notFound);
      const order = await OrderInternalQuery.findOrder(id, tx);
      if (!order) throw new CustomException(NOT_FOUND, notFound);
      if (incoming > order.amountPaise) throw new CustomException("paidPaise is more than the order amount.", badRequest);
      if (derivePaymentStatus(incoming, order.amountPaise) !== claimed) {
        throw new CustomException("paymentStatus does not match paidPaise and the order amount.", badRequest);
      }
      const stored = await OrderInternalQuery.findPaidPaise(id, tx);
      const current = stored ?? impliedPaidPaise(order);
      const paid = Math.max(current, incoming);
      if (stored === null || paid !== stored) await OrderInternalQuery.upsertPaidPaise(id, paid, tx);
      const label = derivePaymentStatus(paid, order.amountPaise);
      if (label !== order.paymentStatus) await OrderInternalQuery.setPaymentStatus(id, label, tx);
      return await summaryOf(id, tx);
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

// The normal status machine and row lock, run as a named system actor instead of a user.
const changeStatus = async (id: string, input: unknown) => {
  try {
    if (!isUuid(id)) throw new CustomException(BAD_ID, badRequest);
    const body = parseBody(input);
    oneOf(body.status, ORDER_STATUSES, "status");
    const actorName = text(parseBody(body.actor).name, "actor.name", 40);
    if (!ACTOR_NAME.test(actorName)) throw new CustomException("actor.name is not valid.", badRequest);
    const system: RequestUser = {
      id: `system:${actorName.toLowerCase().replace(/\s+/g, "-")}`,
      role: "admin",
      storeId: null,
      scopeStoreId: null,
      name: actorName,
    };
    await OrderService.changeStatus(id, null, system, { status: body.status, note: body.note });
    return await summaryOf(id);
  } catch (error) {
    throw toCustomException(error);
  }
};

const parseBound = (value: unknown, field: string, endOfDay: boolean): Date | undefined => {
  const raw = queryString(value, field);
  if (raw === undefined) return undefined;
  const at = DATE_ONLY.test(raw) ? dayStart(raw) : new Date(raw);
  if (Number.isNaN(at.getTime())) throw new CustomException(`${field} must be an ISO date or date and time.`, badRequest);
  // A bare "to" date means through the end of that (Indian) day.
  return endOfDay && DATE_ONLY.test(raw) ? new Date(at.getTime() + MS_PER_DAY) : at;
};

const summary = async (query: Record<string, unknown>) => {
  try {
    const to = parseBound(query.to, "to", true) ?? new Date();
    const from = parseBound(query.from, "from", false) ?? new Date(to.getTime() - DEFAULT_SUMMARY_DAYS * MS_PER_DAY);
    if (from >= to) throw new CustomException("from must be before to.", badRequest);
    if (to.getTime() - from.getTime() > MAX_SUMMARY_DAYS * MS_PER_DAY) {
      throw new CustomException(`The range can be at most ${MAX_SUMMARY_DAYS} days.`, badRequest);
    }
    const storeId = queryString(query.storeId, "storeId");
    if (storeId !== undefined && !isUuid(storeId)) throw new CustomException("storeId must be a valid id.", badRequest);

    const rows = await OrderInternalQuery.summarise({ from, to, storeId: storeId ?? null });
    return {
      orders: rows.byStore.reduce((sum, s) => sum + s.orders, 0),
      revenuePaise: rows.byStore.reduce((sum, s) => sum + s.revenuePaise, 0),
      byStatus: Object.fromEntries(rows.byStatus.map((s) => [s.status, s.orders])),
      byDay: rows.byDay,
      byStore: rows.byStore,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const OrderInternalService = { getOrder, updatePaymentStatus, changeStatus, summary };
