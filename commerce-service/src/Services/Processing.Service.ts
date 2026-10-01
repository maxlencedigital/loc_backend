import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import {
  BATCH_STATUSES,
  type BatchStage,
  type IBatch,
  type IPiece,
} from "../Models/StoreFloor/StoreFloor.Interface.js";
import { BatchQuery } from "../Queries/Batch.Query.js";
import { CatalogQuery } from "../Queries/Catalog.Query.js";
import { FloorTransaction, type Db } from "../Queries/Floor.Transaction.js";
import { MachineQuery } from "../Queries/Machine.Query.js";
import { PieceQuery } from "../Queries/Piece.Query.js";
import { StoreOrderQuery } from "../Queries/StoreOrder.Query.js";
import { optionalOneOf, parseBody, queryString } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { STAGE_INTAKE, assertCompatible, batchStageFor, compatibilityKey } from "./BatchCompatibility.js";
import { syncOrders } from "./FloorOrderStatus.js";
import { actorOf, localDate, resolveStoreFilter, toPieceView } from "./FloorSupport.js";
import { reserveForBatch } from "./MachineReservation.js";

const NOT_FOUND = "Batch not found.";
const MAX_BATCH_PIECES = 200;
const MAX_REQUEST_IDS = 100;
const SUGGESTION_SOURCE_LIMIT = 500;
const MAX_NOTES = 300;
const GRAMS_PER_KG = 1000;
const MAX_DUE_DAYS = 60;
const MS_PER_DAY = 86_400_000;

export const toBatchView = (batch: IBatch, pieces?: IPiece[]) => ({
  id: batch.id,
  storeId: batch.storeId,
  serviceId: batch.serviceId,
  stage: batch.stage,
  status: batch.status,
  machineId: batch.machineId,
  dueAt: batch.dueAt?.toISOString() ?? null,
  startedAt: batch.startedAt?.toISOString() ?? null,
  finishedAt: batch.finishedAt?.toISOString() ?? null,
  loadWeightKg: batch.loadWeightGrams === null ? null : batch.loadWeightGrams / GRAMS_PER_KG,
  notes: batch.notes,
  itemCount: batch.pieceCount,
  createdBy: batch.createdByName,
  createdAt: batch.createdAt.toISOString(),
  ...(pieces ? { items: pieces.map(toPieceView) } : {}),
});

const parseIds = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REQUEST_IDS) {
    throw new CustomException(`${field} must list 1 to ${MAX_REQUEST_IDS} items.`, badRequest);
  }
  if (!value.every(isUuid)) throw new CustomException(`${field} must contain valid ids.`, badRequest);
  const unique = [...new Set(value as string[])];
  if (unique.length !== value.length) throw new CustomException(`${field} lists the same item twice.`, badRequest);
  return unique;
};

const parseFutureDate = (value: unknown, field: string, now: Date): Date | null => {
  if (value === undefined || value === null || value === "") return null;
  const at = new Date(typeof value === "string" ? value : Number.NaN);
  if (Number.isNaN(at.getTime())) throw new CustomException(`${field} must be an ISO date and time.`, badRequest);
  if (at.getTime() - now.getTime() > MAX_DUE_DAYS * MS_PER_DAY) {
    throw new CustomException(`${field} must be within ${MAX_DUE_DAYS} days.`, badRequest);
  }
  return at;
};

// The pieces a batch may take: all in the store, none in another batch, none on a cancelled order.
const loadPieces = async (ids: string[], storeId: string, tx: Db): Promise<IPiece[]> => {
  const pieces = await PieceQuery.findManyInStore(ids, storeId, tx);
  if (pieces.length !== ids.length) throw new CustomException("One or more items were not found.", notFound);
  const orders = await StoreOrderQuery.summaries([...new Set(pieces.map((p) => p.orderId))], tx);
  const cancelled = orders.find((o) => o.status === "cancelled");
  if (cancelled) throw new CustomException(`Order ${cancelled.ref} is cancelled; its garments cannot be processed.`, conflict);
  const busy = pieces.find((p) => p.activeBatchId !== null);
  if (busy) throw new CustomException(`${busy.tagCode} is already in a batch.`, conflict);
  return pieces;
};

const findBatch = async (id: string, scope: StoreScope, tx?: Db): Promise<IBatch> => {
  const batch = isUuid(id) ? await BatchQuery.findById(id, scope, tx) : null;
  if (!batch) throw new CustomException(NOT_FOUND, notFound);
  return batch;
};

// A no-op write that takes the batch's row lock, so adding items cannot interleave with a start.
const lockPlanned = async (batch: IBatch, tx: Db): Promise<void> => {
  if (batch.status !== "planned" || !(await BatchQuery.transition(batch.id, ["planned"], "planned", {}, tx))) {
    throw new CustomException(`A ${batch.status.replace("_", " ")} batch cannot be changed.`, conflict);
  }
};

const claim = async (pieces: IPiece[], batch: IBatch, tx: Db) => {
  const claimed = await PieceQuery.claimForBatch(pieces.map((p) => p.id), batch.id, STAGE_INTAKE[batch.stage], batch.storeId, tx);
  if (claimed !== pieces.length) {
    throw new CustomException("Some items were taken by another batch or moved on. Reload and try again.", conflict);
  }
};

// ------------------------------------------------------------------ create
const createBatch = async (scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const storeId = resolveStoreFilter(scope, body.storeId, true) as string;
    if (!isUuid(body.serviceId)) throw new CustomException("serviceId must be a valid id.", badRequest);
    const ids = parseIds(body.orderItemIds, "orderItemIds");
    if (body.machineId !== undefined && body.machineId !== null && !isUuid(body.machineId)) {
      throw new CustomException("machineId must be a valid id.", badRequest);
    }
    const dueAt = parseFutureDate(body.dueAt, "dueAt", new Date());

    const [service] = await CatalogQuery.findServicesByIds([body.serviceId]);
    if (!service || !service.active) throw new CustomException("That service is not offered.", badRequest);

    return await FloorTransaction.run(async (tx) => {
      const pieces = await loadPieces(ids, storeId, tx);
      const stage = batchStageFor(pieces);
      const stranger = pieces.find((p) => p.serviceId !== service.id);
      if (stranger) throw new CustomException(`${stranger.tagCode} is not booked for ${service.name}.`, conflict);
      assertCompatible(stage, pieces);

      const earliest = Math.min(...pieces.map((p) => p.dueAt.getTime()));
      const batch = await BatchQuery.create(
        { storeId, serviceId: service.id, stage, dueAt: dueAt ?? new Date(earliest), createdByName: actorOf(user).byName, createdByUserId: user.id },
        ids,
        tx
      );
      await claim(pieces, batch, tx);
      if (typeof body.machineId === "string") await reserveForBatch(batch, body.machineId, null, tx);
      return toBatchView((await BatchQuery.findById(batch.id, storeId, tx)) as IBatch, pieces);
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------- reads
const listBatches = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const dueBefore = queryString(query.dueBefore, "dueBefore");
    const serviceId = queryString(query.serviceId, "serviceId");
    if (serviceId !== undefined && !isUuid(serviceId)) throw new CustomException("serviceId must be a valid id.", badRequest);
    const due = dueBefore === undefined ? undefined : new Date(dueBefore);
    if (due && Number.isNaN(due.getTime())) throw new CustomException("dueBefore must be an ISO date and time.", badRequest);

    const result = await BatchQuery.search(
      {
        storeId: resolveStoreFilter(scope, query.storeId, false),
        status: optionalOneOf(queryString(query.status, "status"), BATCH_STATUSES, "status"),
        serviceId,
        dueBefore: due,
      },
      page
    );
    return toPage(result.items.map((batch) => toBatchView(batch)), result.total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getBatch = async (id: string, scope: StoreScope) => {
  try {
    const batch = await findBatch(id, scope);
    return toBatchView(batch, await BatchQuery.listPieces(batch.id));
  } catch (error) {
    throw toCustomException(error);
  }
};

interface ISuggestion {
  stage: BatchStage;
  serviceId: string;
  dueAt: string;
  orderItemIds: string[];
  reason: string;
}

// Groups waiting garments that may share a load and are due the same day, earliest due first.
// A group larger than a batch is split, so every suggestion can be created as it stands.
export const buildSuggestions = (pieces: IPiece[], stage: BatchStage): ISuggestion[] => {
  const groups = new Map<string, IPiece[]>();
  for (const piece of pieces) {
    const key = `${compatibilityKey(stage, piece)}|${localDate(piece.dueAt)}`;
    groups.set(key, [...(groups.get(key) ?? []), piece]);
  }
  return [...groups.values()]
    .sort((a, b) => (a[0] as IPiece).dueAt.getTime() - (b[0] as IPiece).dueAt.getTime())
    .flatMap((group) => {
      const first = group[0] as IPiece;
      const programme = stage === "washing" ? first.processWash : first.processDry;
      const chunks = Array.from({ length: Math.ceil(group.length / MAX_BATCH_PIECES) }, (_, i) =>
        group.slice(i * MAX_BATCH_PIECES, (i + 1) * MAX_BATCH_PIECES)
      );
      return chunks.map((chunk): ISuggestion => ({
        stage,
        serviceId: first.serviceId,
        dueAt: first.dueAt.toISOString(),
        orderItemIds: chunk.map((p) => p.id),
        reason: `${chunk.length} garments for ${stage}: same service and ${programme ?? "programme"}, due ${localDate(first.dueAt)}.`,
      }));
    });
};

const suggestBatches = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const storeId = resolveStoreFilter(scope, query.storeId, true) as string;
    const [washing, drying] = await Promise.all([
      PieceQuery.waitingForBatch(storeId, "sorted", SUGGESTION_SOURCE_LIMIT),
      PieceQuery.waitingForBatch(storeId, "drying", SUGGESTION_SOURCE_LIMIT),
    ]);
    return { suggestions: [...buildSuggestions(washing, "washing"), ...buildSuggestions(drying, "drying")] };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ----------------------------------------------------------------- changes
const assignBatchMachine = async (id: string, scope: StoreScope, input: unknown) => {
  try {
    const body = parseBody(input);
    if (!isUuid(body.machineId)) throw new CustomException("machineId must be a valid id.", badRequest);
    return await FloorTransaction.run(async (tx) => {
      const batch = await findBatch(id, scope, tx);
      await reserveForBatch(batch, body.machineId as string, null, tx);
      return toBatchView((await BatchQuery.findById(batch.id, scope, tx)) as IBatch);
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const addItemsToBatch = async (id: string, scope: StoreScope, input: unknown) => {
  try {
    const ids = parseIds(parseBody(input).orderItemIds, "orderItemIds");
    return await FloorTransaction.run(async (tx) => {
      const batch = await findBatch(id, scope, tx);
      await lockPlanned(batch, tx);
      if (batch.pieceCount + ids.length > MAX_BATCH_PIECES) {
        throw new CustomException(`A batch holds at most ${MAX_BATCH_PIECES} garments.`, badRequest);
      }
      const pieces = await loadPieces(ids, batch.storeId, tx);
      if (pieces.some((p) => p.stage !== STAGE_INTAKE[batch.stage])) {
        throw new CustomException(`A ${batch.stage} batch only takes garments that are ${STAGE_INTAKE[batch.stage]}.`, conflict);
      }
      const stranger = pieces.find((p) => p.serviceId !== batch.serviceId);
      if (stranger) throw new CustomException(`${stranger.tagCode} is not booked for this batch's service.`, conflict);
      const [anchor] = await BatchQuery.listPieces(batch.id, tx);
      assertCompatible(batch.stage, pieces, anchor);
      await claim(pieces, batch, tx);
      await BatchQuery.addMembers(batch.id, ids, tx);
      return toBatchView((await BatchQuery.findById(batch.id, scope, tx)) as IBatch, await BatchQuery.listPieces(batch.id, tx));
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

// Taking out the last garment cancels the batch and frees its machine.
const removeItemFromBatch = async (id: string, itemId: string, scope: StoreScope) => {
  try {
    return await FloorTransaction.run(async (tx) => {
      const batch = await findBatch(id, scope, tx);
      await lockPlanned(batch, tx);
      const [piece] = isUuid(itemId) ? await PieceQuery.findManyInStore([itemId], batch.storeId, tx) : [];
      if (!piece || piece.activeBatchId !== batch.id) throw new CustomException("That item is not in this batch.", notFound);
      await PieceQuery.releaseFromBatch([piece.id], batch.id, tx);
      await BatchQuery.removeMember(batch.id, piece.id, tx);
      if ((await BatchQuery.memberCount(batch.id, tx)) === 0) {
        if (batch.machineId) {
          await MachineQuery.release(batch.machineId, batch.id, tx);
          await BatchQuery.setMachine(batch.id, batch.machineId, null, tx);
        }
        await BatchQuery.transition(batch.id, ["planned"], "cancelled", {}, tx);
      }
      return toBatchView((await BatchQuery.findById(batch.id, scope, tx)) as IBatch);
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const shortId = (id: string) => id.slice(0, 8);

// Start and complete change the batch, its machine, every piece and each order's status together.
// Each write is conditional on the state it expects, so a second start or complete, or a piece that
// moved meanwhile, fails the whole transaction instead of leaving a half-started batch.
const startBatch = async (id: string, scope: StoreScope, user: RequestUser) => {
  try {
    return await FloorTransaction.run(async (tx) => {
      const batch = await findBatch(id, scope, tx);
      if (batch.status !== "planned") throw new CustomException(`This batch is already ${batch.status.replace("_", " ")}.`, conflict);
      if (!batch.machineId) throw new CustomException("Assign a machine before starting the batch.", conflict);
      if (batch.pieceCount === 0) throw new CustomException("A batch with no garments cannot start.", conflict);
      const machine = await MachineQuery.findById(batch.machineId, batch.storeId, tx);
      if (!machine) throw new CustomException("The machine for this batch was not found.", notFound);

      const now = new Date();
      if (!(await BatchQuery.transition(batch.id, ["planned"], "in_machine", { startedAt: now }, tx))) {
        throw new CustomException("This batch was already started.", conflict);
      }
      const freeAt = new Date(now.getTime() + machine.cycleMinutes * 60_000);
      if (!(await MachineQuery.start(machine.id, batch.id, freeAt, tx))) {
        throw new CustomException(`${machine.name} is no longer reserved for this batch. It may be out of service.`, conflict);
      }
      if (batch.stage === "washing") {
        const moved = await PieceQuery.advanceBatchPieces(batch.id, "sorted", "washing", { clearBatch: false }, tx);
        if (moved !== batch.pieceCount) throw new CustomException("Some garments changed since the batch was planned.", conflict);
      }
      const pieces = await BatchQuery.listPieces(batch.id, tx);
      await syncOrders(pieces.map((p) => p.orderId), batch.storeId, user, `${batch.stage === "washing" ? "Washing" : "Drying"} started (batch ${shortId(batch.id)}).`, tx);
      return toBatchView((await BatchQuery.findById(batch.id, scope, tx)) as IBatch);
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const completeBatch = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const notes = body.notes === undefined || body.notes === null || body.notes === "" ? null : String(body.notes).trim();
    if (notes !== null && (typeof body.notes !== "string" || notes.length > MAX_NOTES)) {
      throw new CustomException(`notes must be at most ${MAX_NOTES} characters.`, badRequest);
    }
    let loadGrams: number | null = null;
    if (body.loadWeightKg !== undefined && body.loadWeightKg !== null) {
      const kg = body.loadWeightKg;
      if (typeof kg !== "number" || !Number.isFinite(kg) || kg <= 0 || kg > 500) {
        throw new CustomException("loadWeightKg must be a weight in kilograms above zero.", badRequest);
      }
      loadGrams = Math.round(kg * GRAMS_PER_KG);
    }

    return await FloorTransaction.run(async (tx) => {
      const batch = await findBatch(id, scope, tx);
      if (batch.status !== "in_machine") {
        throw new CustomException(
          batch.status === "planned" ? "Start the batch before completing it." : `This batch is already ${batch.status.replace("_", " ")}.`,
          conflict
        );
      }
      const machine = batch.machineId ? await MachineQuery.findById(batch.machineId, batch.storeId, tx) : null;
      if (loadGrams !== null && machine && loadGrams > machine.capacityGrams) {
        throw new CustomException(`The load is more than ${machine.name} can take (${machine.capacityGrams / GRAMS_PER_KG} kg).`, badRequest);
      }
      if (!(await BatchQuery.transition(batch.id, ["in_machine"], "finished", { finishedAt: new Date(), loadWeightGrams: loadGrams, notes }, tx))) {
        throw new CustomException("This batch was already completed.", conflict);
      }
      if (machine) await MachineQuery.finish(machine.id, batch.id, tx);

      const pieces = await BatchQuery.listPieces(batch.id, tx);
      let moved: number;
      if (batch.stage === "washing") {
        moved =
          (await PieceQuery.advanceBatchPieces(batch.id, "washing", "drying", { clearBatch: true, dryNone: false }, tx)) +
          (await PieceQuery.advanceBatchPieces(batch.id, "washing", "quality_check", { clearBatch: true, dryNone: true }, tx));
      } else {
        moved = await PieceQuery.advanceBatchPieces(batch.id, "drying", "quality_check", { clearBatch: true }, tx);
      }
      if (moved !== batch.pieceCount) throw new CustomException("Some garments changed while the batch was running.", conflict);
      await syncOrders(pieces.map((p) => p.orderId), batch.storeId, user, `${batch.stage === "washing" ? "Washing" : "Drying"} finished (batch ${shortId(batch.id)}).`, tx);
      return toBatchView((await BatchQuery.findById(batch.id, scope, tx)) as IBatch);
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

export const ProcessingService = {
  createBatch,
  listBatches,
  suggestBatches,
  getBatch,
  assignBatchMachine,
  completeBatch,
  addItemsToBatch,
  removeItemFromBatch,
  startBatch,
};
