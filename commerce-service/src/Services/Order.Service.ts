import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { StoreScope } from "../Middleware/StoreScope.js";
import {
  IOrder,
  IPipelineRow,
  ORDER_CHANNELS,
  ORDER_PAYMENT_STATUSES,
  ORDER_PRIORITIES,
  OrderPriority,
} from "../Models/Order/Order.Interface.js";
import {
  ORDER_STATUS_FLOW,
  ORDER_STATUS_LABEL,
  ORDER_STATUSES,
  OrderStatus,
  isCancellable,
  isFinalStatus,
} from "../Models/Order/OrderStatus.js";
import { CatalogQuery } from "../Queries/Catalog.Query.js";
import { CustomerQuery } from "../Queries/Customer.Query.js";
import { OrderQuery } from "../Queries/Order.Query.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { oneOf, optionalOneOf, optionalText, parseBody, parseLimit, queryString, text } from "../Utils/Input.js";
import { toRupees } from "../Utils/Money.js";
import { isUuid } from "../Utils/Uuid.js";
import { parseCare } from "./OrderCare.js";
import { parseLines, priceOrder, rankLists } from "./OrderPricing.js";

// Standard service is two days, express one; both are a default the booking may override.
export const STANDARD_PROMISE_HOURS = 48;
export const EXPRESS_PROMISE_HOURS = 24;
const MAX_PROMISE_DAYS = 60;

const ORDER_REF_PREFIX = "LOC-";
const NOT_FOUND = "Order not found.";
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

// `active` is a filter the orders screen uses: everything still moving through the plant.
const ACTIVE_FILTER = "active";
const ACTIVE_STATUSES: OrderStatus[] = ORDER_STATUS_FLOW.filter((s) => !isFinalStatus(s));

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  manager: "Store manager",
  staff: "Employee",
};

// The gateway forwards the verified id and role; a name is shown when it forwards one too.
const actorName = (user: RequestUser): string => user.name ?? ROLE_LABEL[user.role] ?? user.role;

export const toOrderView = (order: IOrder, now: Date = new Date()) => ({
  id: order.id,
  ref: order.ref,
  storeId: order.storeId,
  customerId: order.customerId,
  customerName: order.customerName,
  customerPhone: order.customerPhone,
  status: order.status,
  priority: order.priority,
  paymentStatus: order.paymentStatus,
  channel: order.channel,
  pieces: order.pieces,
  weightKg: order.weightGrams / 1000,
  amount: toRupees(order.amountPaise),
  placedAt: order.placedAt.toISOString(),
  promisedAt: order.promisedAt.toISOString(),
  // Read-time, so it is right whenever the order is fetched and never stored stale.
  slackMinutes: Math.round((order.promisedAt.getTime() - now.getTime()) / MS_PER_MINUTE),
  care: order.care,
  items: order.items.map((item) => ({
    id: item.id,
    garment: item.garment,
    category: item.category,
    service: item.serviceName,
    qty: item.quantityMilli / 1000,
    unit: item.unit,
    rate: toRupees(item.ratePaise),
    amount: toRupees(item.amountPaise),
  })),
  timeline: order.events.map((event) => ({
    at: event.at.toISOString(),
    status: event.status,
    by: event.byName,
    ...(event.note ? { note: event.note } : {}),
  })),
  riderName: order.riderName,
  address: order.address,
});

const defaultPromiseAt = (priority: OrderPriority, from: Date): Date =>
  new Date(from.getTime() + (priority === "express" ? EXPRESS_PROMISE_HOURS : STANDARD_PROMISE_HOURS) * MS_PER_HOUR);

const parsePromisedAt = (value: unknown, now: Date): Date | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const at = new Date(typeof value === "string" ? value : Number.NaN);
  if (Number.isNaN(at.getTime())) throw new CustomException("promisedAt must be an ISO date and time.", badRequest);
  if (at <= now || at.getTime() - now.getTime() > MAX_PROMISE_DAYS * MS_PER_DAY) {
    throw new CustomException(`promisedAt must be in the future, within ${MAX_PROMISE_DAYS} days.`, badRequest);
  }
  return at;
};

const parseAddress = (value: unknown): string | undefined => optionalText(value, "address", 200);

// One step forward along the flow, or one step back with a note (rework). Delivered and
// cancelled are final. Pure, so the whole state machine is testable without a database.
export const checkTransition = (current: OrderStatus, target: OrderStatus, note: string | null): void => {
  if (isFinalStatus(current)) {
    throw new CustomException(`A ${ORDER_STATUS_LABEL[current].toLowerCase()} order cannot change status.`, badRequest);
  }
  const from = ORDER_STATUS_FLOW.indexOf(current as (typeof ORDER_STATUS_FLOW)[number]);
  const to = ORDER_STATUS_FLOW.indexOf(target as (typeof ORDER_STATUS_FLOW)[number]);
  if (to === from + 1) return;
  if (to === from - 1 && to >= 0) {
    if (!note) throw new CustomException("A note is required when moving an order back.", badRequest);
    return;
  }
  throw new CustomException("An order moves one step forward, or one step back with a note.", badRequest);
};

const create = async (scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const now = new Date();
    if (!isUuid(body.customerId)) throw new CustomException("customerId is required.", badRequest);
    const priority = optionalOneOf(body.priority, ORDER_PRIORITIES, "priority") ?? "standard";
    const channel = optionalOneOf(body.channel, ORDER_CHANNELS, "channel") ?? "walk_in";
    const paymentStatus = optionalOneOf(body.paymentStatus, ORDER_PAYMENT_STATUSES, "paymentStatus") ?? "unpaid";
    const lines = parseLines(body.items);
    const care = parseCare(body.care);
    const promisedAt = parsePromisedAt(body.promisedAt, now) ?? defaultPromiseAt(priority, now);
    const address = parseAddress(body.address);

    if (!scope) throw new CustomException("Choose a store.", badRequest);
    const store = await StoreQuery.findById(scope, null);
    if (!store) throw new CustomException("Choose a store.", badRequest);
    if (store.status !== "live") throw new CustomException("This store is not taking orders.", badRequest);

    // A store-bound caller can only ever find their own store's customers.
    const customer = await CustomerQuery.findById(body.customerId, scope);
    if (!customer) throw new CustomException("Customer not found.", notFound);

    const services = new Map(
      (await CatalogQuery.findServicesByIds([...new Set(lines.map((l) => l.serviceId))])).map((s) => [s.id, s])
    );
    const lists = rankLists(
      await CatalogQuery.findActiveForPricing([...services.keys()]),
      store.id,
      customer.type
    );
    const priced = priceOrder(lines, services, lists, priority);

    const order = await OrderQuery.inTransaction(async (tx) => {
      const ref = `${ORDER_REF_PREFIX}${await OrderQuery.nextOrderNumber(tx)}`;
      const created = await OrderQuery.create(
        ref,
        {
          storeId: store.id,
          customerId: customer.id,
          priority,
          paymentStatus,
          channel,
          pieces: priced.pieces,
          weightGrams: priced.weightGrams,
          amountPaise: priced.amountPaise,
          promisedAt,
          care,
          address: address ?? customer.addresses[0] ?? "",
          createdByUserId: user.id,
          items: priced.items,
          firstEvent: { byName: actorName(user), byUserId: user.id },
        },
        tx
      );
      await CustomerQuery.recordOrder(customer.id, priced.amountPaise, created.placedAt, tx);
      return created;
    });
    return toOrderView(order);
  } catch (error) {
    throw toCustomException(error);
  }
};

const parseDate = (value: unknown, field: string, endOfDay: boolean): Date | undefined => {
  const raw = queryString(value, field);
  if (raw === undefined) return undefined;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) throw new CustomException(`${field} must be an ISO date.`, badRequest);
  // "to=2026-09-30" means through the end of that day, not its first millisecond.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  return endOfDay && dateOnly ? new Date(at.getTime() + MS_PER_DAY - 1) : at;
};

const parseStatusFilter = (value: unknown): OrderStatus[] | undefined => {
  const raw = queryString(value, "status");
  if (raw === undefined) return undefined;
  return raw === ACTIVE_FILTER ? ACTIVE_STATUSES : [oneOf(raw, ORDER_STATUSES, "status")];
};

const list = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const customerId = queryString(query.customerId, "customerId");
    if (customerId !== undefined && !isUuid(customerId)) {
      throw new CustomException("customerId must be a valid id.", badRequest);
    }
    const orders = await OrderQuery.search({
      storeId: scope,
      statuses: parseStatusFilter(query.status),
      priority: optionalOneOf(queryString(query.priority, "priority"), ORDER_PRIORITIES, "priority"),
      paymentStatus: optionalOneOf(queryString(query.paymentStatus, "paymentStatus"), ORDER_PAYMENT_STATUSES, "paymentStatus"),
      customerId,
      q: queryString(query.q, "q"),
      from: parseDate(query.from, "from", false),
      to: parseDate(query.to, "to", true),
      limit: parseLimit(query.limit),
    });
    const now = new Date();
    return orders.map((order) => toOrderView(order, now));
  } catch (error) {
    throw toCustomException(error);
  }
};

const getById = async (id: string, scope: StoreScope) => {
  try {
    const order = isUuid(id) ? await OrderQuery.findById(id, scope) : null;
    if (!order) throw new CustomException(NOT_FOUND, notFound);
    return toOrderView(order);
  } catch (error) {
    throw toCustomException(error);
  }
};

const pipeline = async (scope: StoreScope): Promise<IPipelineRow[]> => {
  try {
    const counts = await OrderQuery.countByStatus(scope, ACTIVE_STATUSES);
    return ACTIVE_STATUSES.map((status) => ({
      status,
      label: ORDER_STATUS_LABEL[status],
      count: counts[status] ?? 0,
    })).filter((row) => row.count > 0);
  } catch (error) {
    throw toCustomException(error);
  }
};

// The row lock turns two simultaneous identical requests into one event: the second waits,
// then sees the new status and is refused by checkTransition.
const changeStatus = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const target = oneOf(body.status, ORDER_STATUSES, "status");
    const note = optionalText(body.note, "note", 500) ?? null;
    if (target === "cancelled") {
      throw new CustomException("Use the cancel action to cancel an order.", badRequest);
    }
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);

    const updated = await OrderQuery.inTransaction(async (tx) => {
      const order = await OrderQuery.lockById(id, scope, tx);
      if (!order) throw new CustomException(NOT_FOUND, notFound);
      checkTransition(order.status, target, note);
      return await OrderQuery.applyStatus(id, { status: target, note, byName: actorName(user), byUserId: user.id }, tx);
    });
    return toOrderView(updated);
  } catch (error) {
    throw toCustomException(error);
  }
};

const cancel = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const reason = text(parseBody(input).reason, "reason", 500);
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);

    const updated = await OrderQuery.inTransaction(async (tx) => {
      const order = await OrderQuery.lockById(id, scope, tx);
      if (!order) throw new CustomException(NOT_FOUND, notFound);
      if (!isCancellable(order.status)) {
        throw new CustomException(
          `A ${ORDER_STATUS_LABEL[order.status].toLowerCase()} order cannot be cancelled.`,
          badRequest
        );
      }
      const cancelled = await OrderQuery.applyStatus(
        id,
        { status: "cancelled", note: reason, byName: actorName(user), byUserId: user.id },
        tx
      );
      await CustomerQuery.reverseOrder(order.customerId, order.amountPaise, tx);
      return cancelled;
    });
    return toOrderView(updated);
  } catch (error) {
    throw toCustomException(error);
  }
};

export const OrderService = { create, list, getById, pipeline, changeStatus, cancel };
