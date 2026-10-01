import type { OrderPaymentStatus } from "../Order/Order.Interface.js";
import { ORDER_STATUS_FLOW, OrderStatus } from "../Order/OrderStatus.js";

// The customer sees a shorter, friendlier journey than the plant does. The plant's eleven
// statuses collapse onto these (sorting, washing and drying are all "processing").
export const CUSTOMER_STATUSES = [
  "placed",
  "pickup_scheduled",
  "picked_up",
  "at_store",
  "processing",
  "quality_check",
  "ready",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** The stages drawn on the tracking screen, in order. `pickup_scheduled` is a state of `placed`. */
export const CUSTOMER_STAGES = [
  "placed",
  "picked_up",
  "at_store",
  "processing",
  "quality_check",
  "ready",
  "out_for_delivery",
  "delivered",
] as const;
export type CustomerStage = (typeof CUSTOMER_STAGES)[number];

const STAGE_OF: Record<Exclude<OrderStatus, "cancelled">, CustomerStage> = {
  booked: "placed",
  picked_up: "picked_up",
  received: "at_store",
  sorted: "processing",
  washing: "processing",
  drying: "processing",
  quality_check: "quality_check",
  packed: "ready",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
};

export const stageOf = (status: Exclude<OrderStatus, "cancelled">): CustomerStage => STAGE_OF[status];

/** A booked order with a pickup slot is "pickup_scheduled"; one without (a walk-in) is "placed". */
export const toCustomerStatus = (status: OrderStatus, hasPickupSlot: boolean): CustomerStatus => {
  if (status === "cancelled") return "cancelled";
  const stage = STAGE_OF[status];
  return stage === "placed" && hasPickupSlot ? "pickup_scheduled" : stage;
};

export interface IStatusFilter {
  statuses: OrderStatus[];
  hasPickupSlot?: boolean;
}

/** The plant statuses (and slot condition) behind one customer-visible status. */
export const toStatusFilter = (status: CustomerStatus): IStatusFilter => {
  if (status === "placed") return { statuses: ["booked"], hasPickupSlot: false };
  if (status === "pickup_scheduled") return { statuses: ["booked"], hasPickupSlot: true };
  if (status === "cancelled") return { statuses: ["cancelled"] };
  return { statuses: ORDER_STATUS_FLOW.filter((s) => STAGE_OF[s] === status) };
};

const PAYMENT_LABEL: Record<OrderPaymentStatus, string> = {
  paid: "paid",
  unpaid: "unpaid",
  part_paid: "partially_paid",
};

/** The catalogue also has `refunded`; the order has no refund state yet, so it is never returned. */
export const toCustomerPaymentStatus = (status: OrderPaymentStatus): string => PAYMENT_LABEL[status];
