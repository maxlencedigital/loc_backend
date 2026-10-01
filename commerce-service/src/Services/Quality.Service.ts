import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, conflict, notFound, serviceUnavailable } from "../../commons/Utils/StatusCode.js";
import { DispatchClient } from "../Clients/Dispatch.Client.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import type { IOrder } from "../Models/Order/Order.Interface.js";
import { ORDER_STATUS_LABEL } from "../Models/Order/OrderStatus.js";
import type { IPiece, IQualityResult, QcOutcome } from "../Models/StoreFloor/StoreFloor.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { FloorTransaction, type Db } from "../Queries/Floor.Transaction.js";
import { OrderQuery } from "../Queries/Order.Query.js";
import { PieceQuery } from "../Queries/Piece.Query.js";
import { QualityQuery } from "../Queries/Quality.Query.js";
import { StoreOrderQuery } from "../Queries/StoreOrder.Query.js";
import { oneOf, optionalText, parseBody, text, wholeNumber } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { syncOrderStatus } from "./FloorOrderStatus.js";
import { actorOf } from "./FloorSupport.js";
import { checkTransition } from "./Order.Service.js";

const NOT_FOUND = "Order not found.";
const MAX_RESULTS = 500;
const MAX_SIGNATURE_CHARS = 100_000;
const SIGNATURE = /^(data:image\/(png|jpeg|webp);base64,)?[A-Za-z0-9+/=\s]+$/;
const OUTCOMES = ["pass", "fail", "rework"] as const;

const requireOrder = async (id: string, scope: StoreScope, tx: Db): Promise<IOrder> => {
  const order = isUuid(id) ? await OrderQuery.lockById(id, scope, tx) : null;
  if (!order) throw new CustomException(NOT_FOUND, notFound);
  return order;
};

const refuseCancelled = (order: IOrder) => {
  if (order.status === "cancelled") throw new CustomException("This order is cancelled.", conflict);
};

// ------------------------------------------------------------------ collect
const ALREADY_COLLECTED = "This order has already been collected.";

// The counter hand-over. Collecting before payment is allowed, because staff sometimes release
// an order against a promise to pay, but the answer says so and the timeline records it.
const collect = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const collectedBy = text(body.collectedBy, "collectedBy", 80);
    let signature: string | null = null;
    if (body.signature !== undefined && body.signature !== null && body.signature !== "") {
      if (typeof body.signature !== "string" || body.signature.length > MAX_SIGNATURE_CHARS || !SIGNATURE.test(body.signature)) {
        throw new CustomException("signature must be a base64 image of reasonable size.", badRequest);
      }
      signature = body.signature;
    }

    return await FloorTransaction.run(async (tx) => {
      const order = await requireOrder(id, scope, tx);
      refuseCancelled(order);
      if (order.status === "delivered" || (await StoreOrderQuery.findCollection(order.id, tx))) {
        throw new CustomException(ALREADY_COLLECTED, conflict);
      }
      if (order.status !== "packed") {
        throw new CustomException(`This order is ${ORDER_STATUS_LABEL[order.status].toLowerCase()}; only a packed order can be handed over.`, conflict);
      }
      const owing = order.paymentStatus !== "paid";
      const actor = actorOf(user);
      const note = `Collected at the counter by ${collectedBy}${owing ? ` (payment ${order.paymentStatus === "part_paid" ? "partly paid" : "outstanding"})` : ""}.`;
      try {
        await StoreOrderQuery.createCollection(
          { orderId: order.id, storeId: order.storeId, collectedBy, signature, paymentOutstanding: owing, byName: actor.byName, byUserId: actor.byUserId },
          tx
        );
      } catch (error) {
        throw isUniqueViolation(error) ? new CustomException(ALREADY_COLLECTED, conflict) : error;
      }
      // Out the door and into the customer's hands: two steps of the normal status flow.
      for (const next of ["out_for_delivery", "delivered"] as const) {
        const current = next === "out_for_delivery" ? "packed" : "out_for_delivery";
        checkTransition(current, next, note);
        await OrderQuery.applyStatus(order.id, { status: next, note, ...actor }, tx);
      }
      return {
        orderId: order.id,
        orderNumber: order.ref,
        status: "delivered",
        collectedBy,
        paymentStatus: order.paymentStatus,
        paymentOutstanding: owing,
        ...(owing ? { warning: "Collected with payment outstanding. Settle the balance with the customer." } : {}),
      };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------ quality check
interface IResultInput {
  pieceId: string;
  passed: boolean;
  note: string | null;
  comparedWithPickupNotes: boolean;
}

const parseResults = (value: unknown): IResultInput[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RESULTS) {
    throw new CustomException(`results must list 1 to ${MAX_RESULTS} items.`, badRequest);
  }
  const results = value.map((raw, index): IResultInput => {
    const row = parseBody(raw);
    const label = `Result ${index + 1}`;
    if (!isUuid(row.itemId)) throw new CustomException(`${label}: itemId must be a valid id.`, badRequest);
    if (typeof row.passed !== "boolean") throw new CustomException(`${label}: passed must be true or false.`, badRequest);
    if (row.comparedWithPickupNotes !== undefined && typeof row.comparedWithPickupNotes !== "boolean") {
      throw new CustomException(`${label}: comparedWithPickupNotes must be true or false.`, badRequest);
    }
    // A failure without a reason cannot be fixed by whoever gets the garment back.
    const note = row.passed ? (optionalText(row.note, `${label}: note`, 300) ?? null) : text(row.note, `${label}: note (the reason it failed)`, 300);
    return { pieceId: row.itemId, passed: row.passed, note, comparedWithPickupNotes: row.comparedWithPickupNotes === true };
  });
  if (new Set(results.map((r) => r.pieceId)).size !== results.length) {
    throw new CustomException("results lists the same item twice.", badRequest);
  }
  return results;
};

const recordQualityCheck = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const results = parseResults(body.results);
    const declared = body.overall === undefined ? undefined : oneOf(body.overall, OUTCOMES, "overall");
    const outcome: QcOutcome = results.every((r) => r.passed) ? "pass" : "fail";
    if (declared && (declared === "pass") !== (outcome === "pass")) {
      throw new CustomException(`overall says ${declared} but the item results say ${outcome}.`, badRequest);
    }

    return await FloorTransaction.run(async (tx) => {
      const order = await requireOrder(id, scope, tx);
      refuseCancelled(order);
      const pieces = new Map((await PieceQuery.listByOrder(order.id, scope, tx)).map((p) => [p.id, p]));
      for (const result of results) {
        const piece = pieces.get(result.pieceId);
        if (!piece) throw new CustomException("Item not found on this order.", notFound);
        if (piece.stage !== "quality_check") {
          throw new CustomException(`${piece.tagCode} is not at quality check yet (${piece.stage.replace("_", " ")}).`, conflict);
        }
      }
      const actor = actorOf(user);
      const check = await QualityQuery.create({ orderId: order.id, storeId: order.storeId, outcome, ...actor, results }, tx);

      const passed = results.filter((r) => r.passed).map((r) => r.pieceId);
      const failed = results.filter((r) => !r.passed);
      if (passed.length && (await PieceQuery.markQcPassed(passed, order.id, new Date(), tx)) !== passed.length) {
        throw new CustomException("A garment changed while it was being checked. Reload and try again.", conflict);
      }
      let status = order.status;
      if (failed.length) {
        const sent = await PieceQuery.sendBackForRework(failed.map((r) => r.pieceId), order.id, tx);
        if (sent !== failed.length) throw new CustomException("A garment changed while it was being checked. Reload and try again.", conflict);
        const first = failed[0] as IResultInput;
        status = (await syncOrderStatus(order.id, order.storeId, user, `Quality check failed on ${pieces.get(first.pieceId)?.tagCode}: ${first.note}`, tx)) ?? status;
      }
      return { id: check.id, outcome, orderStatus: status, passedCount: passed.length, reworkCount: failed.length };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const getQualityCheck = async (id: string, scope: StoreScope) => {
  try {
    const order = isUuid(id) ? await OrderQuery.findById(id, scope) : null;
    if (!order) throw new CustomException(NOT_FOUND, notFound);
    const check = await QualityQuery.latestForOrder(order.id, scope);
    if (!check) throw new CustomException("No quality check has been recorded for this order.", notFound);
    const tags = new Map((await PieceQuery.listByOrder(order.id, scope)).map((p: IPiece) => [p.id, p.tagCode]));
    return {
      id: check.id,
      orderId: order.id,
      outcome: check.outcome,
      checkedBy: check.byName,
      checkedAt: check.createdAt.toISOString(),
      results: check.results.map((r: IQualityResult) => ({ itemId: r.pieceId, tagCode: tags.get(r.pieceId) ?? null, passed: r.passed, note: r.note, comparedWithPickupNotes: r.comparedWithPickupNotes })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------- ready
const needsDelivery = (order: IOrder) => order.channel !== "walk_in" && order.address.trim() !== "";

// "Ready" is packed: every garment passed quality check and was counted into the bag. Packing is
// committed first; the delivery job is requested after, and asking again is safe (the order is
// already packed and logistics answers the same job).
const markOrderReady = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const packedCount = body.packedCount === undefined ? undefined : wholeNumber(body.packedCount, "packedCount", 0, MAX_RESULTS);

    const order = await FloorTransaction.run(async (tx) => {
      const locked = await requireOrder(id, scope, tx);
      refuseCancelled(locked);
      if (locked.status === "delivered") throw new CustomException(ALREADY_COLLECTED, conflict);
      if (locked.status === "out_for_delivery") throw new CustomException("This order has already left the store.", conflict);
      const pieces = await PieceQuery.listByOrder(locked.id, scope, tx);
      if (pieces.length === 0) throw new CustomException("This order has no garments checked in yet.", conflict);
      if (packedCount !== undefined && packedCount !== pieces.length) {
        throw new CustomException(`packedCount ${packedCount} does not match the ${pieces.length} garments on this order.`, badRequest);
      }
      if (locked.status === "packed") return locked;
      if (locked.status !== "quality_check") {
        throw new CustomException(`This order is ${ORDER_STATUS_LABEL[locked.status].toLowerCase()}; it must reach quality check first.`, conflict);
      }
      const unfinished = pieces.filter((p) => p.stage !== "quality_check" || p.qcPassedAt === null);
      if (unfinished.length > 0) {
        const tags = unfinished.slice(0, 5).map((p) => p.tagCode).join(", ");
        throw new CustomException(`${unfinished.length} of ${pieces.length} garments have not passed quality check (${tags}${unfinished.length > 5 ? ", ..." : ""}).`, conflict);
      }
      if ((await PieceQuery.packOrder(locked.id, tx)) !== pieces.length) {
        throw new CustomException("A garment changed while packing. Reload and try again.", conflict);
      }
      await syncOrderStatus(locked.id, locked.storeId, user, `Packed and ready: ${pieces.length} garments.`, tx);
      return { ...locked, status: "packed" as const };
    });

    let deliveryJobId: string | null = null;
    if (needsDelivery(order)) {
      try {
        deliveryJobId = await DispatchClient.createDeliveryJob({
          orderId: order.id,
          orderRef: order.ref,
          storeId: order.storeId,
          address: order.address,
          contactName: order.customerName,
          contactPhone: order.customerPhone,
          priority: order.priority,
        });
      } catch (error) {
        console.error("[ready] delivery job failed:", (error as Error)?.message);
        throw new CustomException("The order is packed, but dispatch could not be reached. Try again to create the delivery job.", serviceUnavailable, { orderId: order.id, status: "packed" });
      }
    }
    return { orderId: order.id, orderNumber: order.ref, status: "packed", deliveryJobId };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const QualityService = { collect, recordQualityCheck, getQualityCheck, markOrderReady };
