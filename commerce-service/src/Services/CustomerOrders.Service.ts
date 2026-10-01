import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { ICustomerOrderExt } from "../Models/CustomerAccount/CustomerAccount.Interface.js";
import {
  CUSTOMER_STAGES,
  CUSTOMER_STATUSES,
  CustomerStatus,
  stageOf,
  toCustomerPaymentStatus,
  toCustomerStatus,
  toStatusFilter,
} from "../Models/CustomerAccount/CustomerOrderStatus.js";
import { IOrder } from "../Models/Order/Order.Interface.js";
import { CustomerAddressQuery } from "../Queries/CustomerAddress.Query.js";
import { CustomerOrderQuery } from "../Queries/CustomerOrder.Query.js";
import { CustomerQuery } from "../Queries/Customer.Query.js";
import { OrderQuery } from "../Queries/Order.Query.js";
import { PickupSlotQuery } from "../Queries/PickupSlot.Query.js";
import { garmentTypeIdOf } from "../Utils/GarmentTypeId.js";
import { optionalOneOf, optionalText, parseBody, queryString } from "../Utils/Input.js";
import { toRupees } from "../Utils/Money.js";
import { isUuid } from "../Utils/Uuid.js";
import { resolveCustomer } from "./CustomerAccount.Service.js";
import { isOpenForBooking, slotConfigOf } from "./PickupSlot.Service.js";
import { dayStart, parseDateOnly } from "./PickupSlots.js";

const NOT_FOUND = "Order not found.";
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
// The rider is dispatched an hour before the window opens; after that the slot is fixed.
export const RESCHEDULE_CUTOFF_MINUTES = 60;
export const DEFAULT_CANCEL_REASON = "Cancelled by the customer.";

const isoOrNull = (at: Date | null | undefined) => (at ? at.toISOString() : null);
const pickupOf = (ext: ICustomerOrderExt | undefined) =>
  ext ? { from: ext.pickupFrom.toISOString(), to: ext.pickupTo.toISOString() } : null;

// One entry per customer-visible stage. A stage is done once the order has reached it or
// passed it; `at` is when it first got there. A cancelled order ends with its own stage.
export const buildStages = (order: Pick<IOrder, "status" | "events">) => {
  const firstAt = new Map<string, Date>();
  let reached = -1;
  for (const event of order.events) {
    if (event.status === "cancelled") continue;
    const stage = stageOf(event.status);
    if (!firstAt.has(stage)) firstAt.set(stage, event.at);
    reached = Math.max(reached, CUSTOMER_STAGES.indexOf(stage));
  }
  const stages = CUSTOMER_STAGES.map((stage, index) => ({
    stage: stage as string,
    at: isoOrNull(firstAt.get(stage)),
    done: index <= reached,
  }));
  if (order.status === "cancelled") {
    const cancelled = [...order.events].reverse().find((e) => e.status === "cancelled");
    stages.push({ stage: "cancelled", at: isoOrNull(cancelled?.at), done: true });
  }
  return stages;
};

const toDetail = (order: IOrder, ext: ICustomerOrderExt | undefined) => ({
  id: order.id,
  orderNumber: order.ref,
  status: toCustomerStatus(order.status, ext !== undefined),
  express: order.priority === "express",
  total: toRupees(order.amountPaise),
  paymentStatus: toCustomerPaymentStatus(order.paymentStatus),
  storeId: order.storeId,
  pickupSlot: pickupOf(ext),
  placedAt: order.placedAt.toISOString(),
  promisedAt: order.promisedAt.toISOString(),
  items: order.items.map((item) => ({
    id: item.id,
    garmentType: item.garment,
    service: item.serviceName,
    quantity: item.quantityMilli / 1000,
    unit: item.unit,
    status: toCustomerStatus(order.status, ext !== undefined),
    careFlags: order.care.flags,
  })),
  timeline: buildStages(order),
});

// Loads one of the caller's orders with its pickup details; anyone else's is a 404.
const loadOwned = async (customerId: string, id: string) => {
  if (!isUuid(id) || !(await CustomerOrderQuery.ownsOrder(customerId, id))) throw new CustomException(NOT_FOUND, notFound);
  const order = await OrderQuery.findById(id, null);
  if (!order) throw new CustomException(NOT_FOUND, notFound);
  const [ext] = await CustomerOrderQuery.findExtByOrderIds([id]);
  return { order, ext };
};

const parseRangeDate = (value: unknown, field: string, endOfDay: boolean): Date | undefined => {
  const raw = queryString(value, field);
  if (raw === undefined) return undefined;
  const start = dayStart(parseDateOnly(raw, field));
  return endOfDay ? new Date(start.getTime() + MS_PER_DAY - 1) : start;
};

const listMyOrders = async (user: RequestUser, query: Record<string, unknown>) => {
  try {
    const { customer } = await resolveCustomer(user);
    const page = parsePage(query);
    const status = optionalOneOf(queryString(query.status, "status"), CUSTOMER_STATUSES, "status") as CustomerStatus | undefined;
    const filter = status ? toStatusFilter(status) : null;
    const { rows, total } = await CustomerOrderQuery.listOwned(customer.id, {
      statuses: filter?.statuses,
      hasPickupSlot: filter?.hasPickupSlot,
      from: parseRangeDate(query.from, "from", false),
      to: parseRangeDate(query.to, "to", true),
      offset: page.offset,
      limit: page.limit,
    });
    const exts = new Map((await CustomerOrderQuery.findExtByOrderIds(rows.map((r) => r.id))).map((e) => [e.orderId, e]));
    return toPage(
      rows.map((row) => ({
        id: row.id,
        orderNumber: row.ref,
        status: toCustomerStatus(row.status, exts.has(row.id)),
        express: row.priority === "express",
        total: toRupees(row.amountPaise),
        paymentStatus: toCustomerPaymentStatus(row.paymentStatus),
        storeId: row.storeId,
        pickupSlot: pickupOf(exts.get(row.id)),
        placedAt: row.placedAt.toISOString(),
      })),
      total,
      page
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

const getMyOrder = async (user: RequestUser, id: string) => {
  try {
    const { customer } = await resolveCustomer(user);
    const { order, ext } = await loadOwned(customer.id, id);
    return toDetail(order, ext);
  } catch (error) {
    throw toCustomException(error);
  }
};

const trackMyOrder = async (user: RequestUser, id: string) => {
  try {
    const { customer } = await resolveCustomer(user);
    const { order, ext } = await loadOwned(customer.id, id);
    return {
      status: toCustomerStatus(order.status, ext !== undefined),
      stages: buildStages(order),
      // Logistics is not connected yet: a rider's name is known once assigned, nothing else is.
      rider: order.riderName
        ? { name: order.riderName, phone: null, etaMinutes: null, latitude: null, longitude: null }
        : null,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// Allowed only while the rider has not collected anything (status "booked"). The order's lock
// is held, so a cancel and a status change cannot both win. The slot seat goes back.
const cancelMyOrder = async (user: RequestUser, id: string, input: unknown) => {
  try {
    const { customer } = await resolveCustomer(user);
    const reason = optionalText(parseBody(input).reason, "reason", 500) ?? DEFAULT_CANCEL_REASON;
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    const done = await OrderQuery.inTransaction(async (tx) => {
      if (!(await CustomerOrderQuery.lockOwned(customer.id, id, tx))) throw new CustomException(NOT_FOUND, notFound);
      const order = await OrderQuery.findById(id, null, tx);
      if (!order) throw new CustomException(NOT_FOUND, notFound);
      const [ext] = await CustomerOrderQuery.findExtByOrderIds([id], tx);
      if (order.status === "cancelled") return { order, ext };
      if (order.status !== "booked") {
        throw new CustomException("This order can no longer be cancelled because pickup has started.", conflict);
      }
      const cancelled = await OrderQuery.applyStatus(id, { status: "cancelled", note: reason, byName: customer.name, byUserId: user.id }, tx);
      await CustomerQuery.reverseOrder(customer.id, order.amountPaise, tx);
      if (ext) await PickupSlotQuery.release(ext.pickupSlotId, tx);
      return { order: cancelled, ext };
    });
    return toDetail(done.order, done.ext);
  } catch (error) {
    throw toCustomException(error);
  }
};

const INVOICE_PREFIX = "INV-";

// There is no invoice store yet: the invoice is the order's own record, numbered after it.
// No PDF exists, so downloadUrl is null.
const getMyOrderInvoice = async (user: RequestUser, id: string) => {
  try {
    const { customer } = await resolveCustomer(user);
    const { order } = await loadOwned(customer.id, id);
    if (order.status === "cancelled") throw new CustomException("A cancelled order has no invoice.", notFound);
    return {
      invoiceNumber: `${INVOICE_PREFIX}${order.ref.replace(/^LOC-/, "")}`,
      issuedAt: order.placedAt.toISOString(),
      total: toRupees(order.amountPaise),
      downloadUrl: null,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// A starting basket for a new order, not an order: nothing is priced or booked here.
const reorderMyOrder = async (user: RequestUser, id: string) => {
  try {
    const { profile, customer } = await resolveCustomer(user);
    const { order, ext } = await loadOwned(customer.id, id);
    const lines = new Map((await CustomerOrderQuery.findLinesByOrder(order.id)).map((l) => [l.orderItemId, l]));
    const remembered = ext?.pickupAddressId ? await CustomerAddressQuery.findOwned(customer.id, ext.pickupAddressId) : null;
    return {
      addressId: remembered?.id ?? profile.defaultAddressId,
      items: order.items.map((item) => {
        const line = lines.get(item.id);
        return {
          garmentTypeId: line?.garmentTypeId ?? garmentTypeIdOf(item.category, item.garment),
          serviceId: item.serviceId,
          ...(item.unit === "kg" ? { weightKg: item.quantityMilli / 1000 } : { quantity: item.quantityMilli / 1000 }),
          ...(line && line.fabric !== "unknown" ? { fabric: line.fabric } : {}),
          ...(line?.note ? { note: line.note } : {}),
          ...(line?.garmentProfileId ? { garmentProfileId: line.garmentProfileId } : {}),
        };
      }),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const formatWindow = (from: Date, to: Date) => `${from.toISOString()} to ${to.toISOString()}`;

// Same store only, while the order is still "booked" and at least an hour before its window
// opens. The old seat is released and the new one taken in the one transaction, in id order
// so two customers swapping seats cannot deadlock.
const rescheduleMyPickup = async (user: RequestUser, id: string, input: unknown) => {
  try {
    const { customer } = await resolveCustomer(user);
    const body = parseBody(input);
    if (!isUuid(body.pickupSlotId)) throw new CustomException("Choose a valid pickup slot.", badRequest);
    const newSlotId = body.pickupSlotId;
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    const now = new Date();

    const done = await OrderQuery.inTransaction(async (tx) => {
      if (!(await CustomerOrderQuery.lockOwned(customer.id, id, tx))) throw new CustomException(NOT_FOUND, notFound);
      const order = await OrderQuery.findById(id, null, tx);
      const [ext] = await CustomerOrderQuery.findExtByOrderIds([id], tx);
      if (!order) throw new CustomException(NOT_FOUND, notFound);
      if (order.status !== "booked" || !ext) {
        throw new CustomException("The pickup can only be moved before the rider collects the order.", conflict);
      }
      if (ext.pickupSlotId === newSlotId) return { order, ext };
      if (ext.pickupFrom.getTime() - now.getTime() < RESCHEDULE_CUTOFF_MINUTES * MS_PER_MINUTE) {
        throw new CustomException("The pickup is too close to move. Please contact the store.", conflict);
      }
      const slot = await PickupSlotQuery.findById(newSlotId, tx);
      if (!slot) throw new CustomException("Choose a valid pickup slot.", badRequest);
      if (slot.storeId !== order.storeId) throw new CustomException("Choose a pickup slot at the same store.", conflict);
      if (!isOpenForBooking(slot, await slotConfigOf(slot.storeId), now)) {
        throw new CustomException("That pickup slot is no longer available. Please choose another.", conflict);
      }
      const moves: [string, () => Promise<unknown>][] = [
        [ext.pickupSlotId, () => PickupSlotQuery.release(ext.pickupSlotId, tx)],
        [slot.id, async () => {
          if (!(await PickupSlotQuery.reserve(slot.id, tx))) {
            throw new CustomException("That pickup slot is no longer available. Please choose another.", conflict);
          }
        }],
      ];
      for (const [, run] of moves.sort((a, b) => a[0].localeCompare(b[0]))) await run();
      await CustomerOrderQuery.updatePickup(id, { pickupSlotId: slot.id, pickupFrom: slot.startsAt, pickupTo: slot.endsAt }, tx);
      const updated = await OrderQuery.applyStatus(
        id,
        { status: "booked", note: `Pickup moved to ${formatWindow(slot.startsAt, slot.endsAt)}.`, byName: customer.name, byUserId: user.id },
        tx
      );
      return { order: updated, ext: { ...ext, pickupSlotId: slot.id, pickupFrom: slot.startsAt, pickupTo: slot.endsAt } };
    });
    return toDetail(done.order, done.ext);
  } catch (error) {
    throw toCustomException(error);
  }
};

export const CustomerOrdersService = {
  listMyOrders,
  getMyOrder,
  trackMyOrder,
  cancelMyOrder,
  getMyOrderInvoice,
  reorderMyOrder,
  rescheduleMyPickup,
};
