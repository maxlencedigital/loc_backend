// The single definition of an order's journey. Mirrors ORDER_STATUS_FLOW in the
// dashboard's domain.ts; `cancelled` is deliberately outside the flow.
export const ORDER_STATUS_FLOW = [
  "booked",
  "picked_up",
  "received",
  "sorted",
  "washing",
  "drying",
  "quality_check",
  "packed",
  "out_for_delivery",
  "delivered",
] as const;

export type OrderStatus = (typeof ORDER_STATUS_FLOW)[number] | "cancelled";

export const ORDER_STATUSES: OrderStatus[] = [...ORDER_STATUS_FLOW, "cancelled"];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  booked: "Booked",
  picked_up: "Picked up",
  received: "Received",
  sorted: "Sorted",
  washing: "Washing",
  drying: "Drying",
  quality_check: "Quality check",
  packed: "Packed",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const isFinalStatus = (status: OrderStatus) => status === "delivered" || status === "cancelled";

/** Once the order has left the building the customer has it or is about to. */
export const isCancellable = (status: OrderStatus) =>
  !isFinalStatus(status) && status !== "out_for_delivery";
