import { checkTransition } from "./Order.Service.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { ORDER_STATUS_FLOW, OrderStatus, isFinalStatus } from "../Models/Order/OrderStatus.js";
import { PIECE_STAGES } from "../Models/StoreFloor/StoreFloor.Interface.js";
import { OrderQuery } from "../Queries/Order.Query.js";
import { PieceQuery } from "../Queries/Piece.Query.js";
import type { Db } from "../Queries/Floor.Transaction.js";
import { actorOf } from "./FloorSupport.js";

const flowIndex = (status: OrderStatus) => ORDER_STATUS_FLOW.indexOf(status as (typeof ORDER_STATUS_FLOW)[number]);
const LEFT_THE_PLANT = flowIndex("out_for_delivery");

/**
 * Brings an order's status in line with its pieces: an order is only as far along as its least
 * advanced piece. It never writes the status directly. Each step goes through the order service's
 * own transition rule (one step at a time, a note when going back) and appends a timeline event
 * with the acting user. Returns the status afterwards, or null when the order was left alone.
 */
export const syncOrderStatus = async (
  orderId: string,
  storeId: string,
  user: RequestUser,
  note: string,
  tx: Db
): Promise<OrderStatus | null> => {
  const order = await OrderQuery.lockById(orderId, storeId, tx);
  if (!order || isFinalStatus(order.status) || flowIndex(order.status) >= LEFT_THE_PLANT) return null;

  const counts = await PieceQuery.stageCounts(orderId, tx);
  const slowest = PIECE_STAGES.find((stage) => (counts[stage] ?? 0) > 0);
  if (!slowest) return order.status;

  const target = flowIndex(slowest);
  let current: OrderStatus = order.status;
  while (flowIndex(current) !== target) {
    const next = ORDER_STATUS_FLOW[flowIndex(current) + (target > flowIndex(current) ? 1 : -1)] as OrderStatus;
    checkTransition(current, next, note);
    await OrderQuery.applyStatus(orderId, { status: next, note, ...actorOf(user) }, tx);
    current = next;
  }
  return current;
};

/** Syncs several orders in a fixed order, so two actions touching the same orders never lock them crosswise. */
export const syncOrders = async (orderIds: string[], storeId: string, user: RequestUser, note: string, tx: Db): Promise<void> => {
  for (const orderId of [...new Set(orderIds)].sort()) {
    await syncOrderStatus(orderId, storeId, user, note, tx);
  }
};
