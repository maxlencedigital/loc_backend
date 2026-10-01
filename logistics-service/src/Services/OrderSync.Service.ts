import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { ServiceClient } from "../../commons/Http/ServiceClient.js";
import { IJob } from "../Models/Job/Job.Interface.js";
import { IOutbox } from "../Models/Sync/Outbox.Interface.js";
import { Db } from "../Queries/Job.Query.js";
import { OutboxQuery } from "../Queries/Outbox.Query.js";

// Keeps commerce's order in step with what riders do. The rule: our own change commits
// first and is never undone by commerce being slow or down. The call to commerce is written
// to the outbox in the SAME transaction as the change, tried right after it commits, and
// retried by `retryPending` until it lands (or is refused on its merits, which needs a person).

/** Commerce's order statuses that a rider's work causes. */
export const ORDER_STATUS = {
  pickedUp: "picked_up",
  receivedAtStore: "received",
  outForDelivery: "out_for_delivery",
  delivered: "delivered",
} as const;
export type CommerceOrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

const CALL_TIMEOUT_MS = 3_000;
const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 8;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;
export const RETRY_BATCH = 50;
const ACTOR = { name: "Logistics" };

const enqueueStatus = async (job: IJob, status: CommerceOrderStatus, note: string, db: Db): Promise<IOutbox> => {
  try {
    return await OutboxQuery.enqueue(
      {
        kind: "order_status",
        orderId: job.orderId,
        jobId: job.id,
        payload: { status: status, note },
        dedupeKey: `order_status:${job.id}:${status}`,
      },
      db
    );
  } catch (error) {
    throw error;
  }
};

/** Door money taken: commerce is told the new paid total (see deliverPayment for how). */
const enqueuePayment = async (job: IJob, paymentId: string, deltaPaise: number, db: Db): Promise<IOutbox> => {
  try {
    return await OutboxQuery.enqueue(
      {
        kind: "order_payment",
        orderId: job.orderId,
        jobId: job.id,
        payload: { paymentId, deltaPaise },
        dedupeKey: `order_payment:${paymentId}`,
      },
      db
    );
  } catch (error) {
    throw error;
  }
};

interface CommerceOrder {
  paidPaise: number;
  amountPaise: number;
}

// The paid total commerce is told is fixed the first time it is worked out and saved on the
// row, so a retry after a lost answer re-sends the same absolute figure instead of adding the
// payment twice. Commerce never lowers a paid total, which makes the re-send harmless.
const deliverPayment = async (row: IOutbox): Promise<void> => {
  let target = row.payload.targetPaidPaise as number | undefined;
  let orderAmount = row.payload.orderAmountPaise as number | undefined;
  if (target === undefined || orderAmount === undefined) {
    const order = await ServiceClient.get<CommerceOrder>("commerce", `/internal/orders/${row.orderId}`, { timeoutMs: CALL_TIMEOUT_MS });
    target = order.paidPaise + (row.payload.deltaPaise as number);
    orderAmount = order.amountPaise;
    await OutboxQuery.savePayload(row.id, { ...row.payload, targetPaidPaise: target, orderAmountPaise: orderAmount });
  }
  const paymentStatus = target >= orderAmount ? "paid" : target > 0 ? "part_paid" : "unpaid";
  await ServiceClient.post("commerce", `/internal/orders/${row.orderId}/payment-status`, {
    body: { paymentStatus, paidPaise: target },
    timeoutMs: CALL_TIMEOUT_MS,
  });
};

const deliver = async (row: IOutbox): Promise<void> => {
  if (row.kind === "order_payment") return deliverPayment(row);
  await ServiceClient.post("commerce", `/internal/orders/${row.orderId}/status`, {
    body: { status: row.payload.status, note: row.payload.note, actor: ACTOR },
    timeoutMs: CALL_TIMEOUT_MS,
  });
};

// A refusal on the merits (4xx) will not change by trying again; an outage (503, timeout) will.
const isPermanent = (error: unknown): boolean =>
  error instanceof CustomException && error.errorCode >= 400 && error.errorCode < 500 && error.errorCode !== 408 && error.errorCode !== 429;

const backoffMs = (attempts: number) => Math.min(RETRY_BASE_MS * 2 ** Math.max(attempts - 1, 0), RETRY_MAX_MS);

type Outcome = "delivered" | "retry" | "dead" | "skipped";

/** Tries one row. Never throws: the business operation that queued it has already succeeded. */
const attempt = async (row: IOutbox): Promise<Outcome> => {
  try {
    const now = new Date();
    if (!(await OutboxQuery.claim(row.id, now, new Date(now.getTime() + LEASE_MS)))) return "skipped";
    const attempts = row.attempts + 1;
    try {
      await deliver(row);
      await OutboxQuery.markDone(row.id);
      return "delivered";
    } catch (error) {
      const message = error instanceof CustomException ? error.displayMessage : "The call failed.";
      if (isPermanent(error) || attempts >= MAX_ATTEMPTS) {
        console.error(`[order-sync] ${row.kind} for order ${row.orderId} gave up: ${message}`);
        await OutboxQuery.markFailed(row.id, message, "dead", new Date());
        return "dead";
      }
      console.error(`[order-sync] ${row.kind} for order ${row.orderId} will be retried: ${message}`);
      await OutboxQuery.markFailed(row.id, message, "pending", new Date(Date.now() + backoffMs(attempts)));
      return "retry";
    }
  } catch (error) {
    // The outbox row itself could not be updated; the lease expires and the row is picked up again.
    console.error("[order-sync] could not record the outcome:", (error as Error)?.message);
    return "retry";
  }
};

/** Right after commit: try each queued row once. */
const flush = async (rows: IOutbox[]): Promise<void> => {
  await Promise.all(rows.map(attempt));
};

/**
 * Re-sends everything that is due. Exposed to operators as POST /internal/jobs/retry-sync
 * (call it from a scheduler or by hand); safe to run concurrently with itself.
 */
const retryPending = async (limit: number = RETRY_BATCH) => {
  try {
    const due = await OutboxQuery.listDue(new Date(), limit);
    const outcomes = await Promise.all(due.map(attempt));
    const count = (outcome: Outcome) => outcomes.filter((o) => o === outcome).length;
    return { processed: due.length, delivered: count("delivered"), retrying: count("retry"), dead: count("dead"), skipped: count("skipped") };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const OrderSyncService = { enqueueStatus, enqueuePayment, flush, retryPending };
