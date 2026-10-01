import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import type { IOrder, RiskClass } from "../Models/Order/Order.Interface.js";
import { RISK_CLASSES } from "../Models/Order/Order.Interface.js";
import {
  FABRICS,
  ITEM_CONDITIONS,
  RECEIVED_FROM,
  type IFabricRule,
  type IPiece,
  type IPieceCreate,
  type IPieceEdit,
} from "../Models/StoreFloor/StoreFloor.Interface.js";
import { FabricRuleQuery } from "../Queries/FabricRule.Query.js";
import { FloorTransaction, type Db } from "../Queries/Floor.Transaction.js";
import { OrderQuery } from "../Queries/Order.Query.js";
import { PieceQuery } from "../Queries/Piece.Query.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { oneOf, optionalOneOf, optionalText, parseBody, queryString, text, wholeNumber } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { syncOrderStatus } from "./FloorOrderStatus.js";
import { actorOf, toPieceView } from "./FloorSupport.js";
import { differsFromSuggestion, suggestProcess } from "./ProcessSuggestion.js";

const NOT_FOUND = "Order not found.";
const ITEM_NOT_FOUND = "Item not found on this order.";
const MAX_CHECK_IN_ITEMS = 100;
const MAX_PIECES_PER_ORDER = 500;
const MAX_QUANTITY = 50;
const MAX_CARE_FLAGS = 10;
const MAX_TEMPERATURE_C = 95;
const EDITABLE_STAGES = ["received", "sorted"];

// ---------------------------------------------------------------- parsing
interface IPieceInput {
  garment: string;
  garmentTypeId: string | null;
  serviceId: string | null;
  quantity: number;
  condition: string;
  fabric: string;
  careFlags: string[];
  note: string | null;
}

const parseCareFlags = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value) || value.length > MAX_CARE_FLAGS) {
    throw new CustomException(`${field} must be a list of at most ${MAX_CARE_FLAGS} entries.`, badRequest);
  }
  return value.map((flag) => text(flag, field, 40));
};

const parsePieceInput = (raw: unknown, label: string, quantityRequired: boolean): IPieceInput => {
  const item = parseBody(raw);
  // The garment-type catalogue is not built yet, so the garment's name is what identifies it.
  if (item.weightKg !== undefined) {
    throw new CustomException(`${label}: garments are counted, not weighed. Send quantity.`, badRequest);
  }
  if (item.garmentTypeId !== undefined && item.garmentTypeId !== null && !isUuid(item.garmentTypeId)) {
    throw new CustomException(`${label}: garmentTypeId must be a valid id.`, badRequest);
  }
  if (item.serviceId !== undefined && item.serviceId !== null && !isUuid(item.serviceId)) {
    throw new CustomException(`${label}: serviceId must be a valid id.`, badRequest);
  }
  if (quantityRequired && item.quantity === undefined) {
    throw new CustomException(`${label}: quantity is required.`, badRequest);
  }
  return {
    garment: text(item.garment, `${label}: garment`, 80),
    garmentTypeId: (item.garmentTypeId as string | undefined) ?? null,
    serviceId: (item.serviceId as string | undefined) ?? null,
    quantity: item.quantity === undefined ? 1 : wholeNumber(item.quantity, `${label}: quantity`, 1, MAX_QUANTITY),
    condition: optionalOneOf(item.condition, ITEM_CONDITIONS, `${label}: condition`) ?? "ok",
    fabric: optionalOneOf(item.fabric, FABRICS, `${label}: fabric`) ?? "unknown",
    careFlags: item.careFlags === undefined ? [] : parseCareFlags(item.careFlags, `${label}: careFlags`),
    note: optionalText(item.note, `${label}: note`, 300) ?? null,
  };
};

const higherRisk = (a: RiskClass, b: RiskClass): RiskClass => (RISK_CLASSES.indexOf(a) >= RISK_CLASSES.indexOf(b) ? a : b);

// A piece's risk comes from its own fabric. Only a fabric nobody could identify inherits the
// booking's overall risk, so one silk blouse does not make a bag of shirts high risk.
const pieceRisk = (fabric: string, rule: IFabricRule | undefined, order: IOrder): RiskClass =>
  fabric === "unknown" ? higherRisk(rule?.risk ?? "medium", order.care.riskClass) : (rule?.risk ?? "medium");

const serviceFor = (input: IPieceInput, order: IOrder): string => {
  const services = [...new Set(order.items.map((line) => line.serviceId))];
  if (input.serviceId) {
    if (!services.includes(input.serviceId)) {
      throw new CustomException(`${input.garment}: that service is not on this order.`, badRequest);
    }
    return input.serviceId;
  }
  if (services.length === 1) return services[0] as string;
  throw new CustomException(`${input.garment}: serviceId is required because this order has more than one service.`, badRequest);
};

const tagCode = (storeCode: string, sequence: number) => `${storeCode}-${String(sequence).padStart(6, "0")}`;

// Creates the pieces for a set of inputs: one row per physical garment, tags handed out as one block.
const createPieces = async (
  order: IOrder,
  inputs: IPieceInput[],
  receivedFrom: string,
  user: RequestUser,
  tx: Db
): Promise<IPiece[]> => {
  const total = inputs.reduce((sum, input) => sum + input.quantity, 0);
  const existing = Object.values(await PieceQuery.stageCounts(order.id, tx)).reduce((sum, n) => sum + (n ?? 0), 0);
  if (existing + total > MAX_PIECES_PER_ORDER) {
    throw new CustomException(`An order can have at most ${MAX_PIECES_PER_ORDER} garments.`, badRequest);
  }
  const store = await StoreQuery.findById(order.storeId, null);
  if (!store) throw new CustomException(NOT_FOUND, notFound);
  const rules = await FabricRuleQuery.findByFabrics([...new Set(inputs.map((i) => i.fabric))], tx);
  const last = await PieceQuery.allocateTags(order.storeId, total, tx);

  let sequence = last - total;
  const rows: IPieceCreate[] = inputs.flatMap((input) =>
    Array.from({ length: input.quantity }, (): IPieceCreate => {
      sequence += 1;
      return {
        storeId: order.storeId,
        orderId: order.id,
        orderRef: order.ref,
        serviceId: serviceFor(input, order),
        garmentTypeId: input.garmentTypeId,
        tagCode: tagCode(store.code, sequence),
        garment: input.garment,
        condition: input.condition,
        fabric: input.fabric,
        colour: order.care.colour,
        soilLevel: order.care.soilLevel,
        riskClass: pieceRisk(input.fabric, rules.get(input.fabric), order),
        careFlags: input.careFlags,
        note: input.note,
        priority: order.priority,
        dueAt: order.promisedAt,
        receivedFrom,
        receivedByName: actorOf(user).byName,
      };
    })
  );
  return await PieceQuery.createMany(rows, tx);
};

const requireOrder = async (id: string, scope: StoreScope, tx: Db): Promise<IOrder> => {
  const order = isUuid(id) ? await OrderQuery.lockById(id, scope, tx) : null;
  if (!order) throw new CustomException(NOT_FOUND, notFound);
  return order;
};

const refuseClosed = (order: IOrder) => {
  if (order.status === "cancelled") throw new CustomException("A cancelled order cannot be changed on the floor.", conflict);
  if (order.status === "delivered") throw new CustomException("A delivered order cannot be changed.", conflict);
};

// ---------------------------------------------------------------- reads
const listFabricRules = async (query: Record<string, unknown>) => {
  try {
    const fabric = optionalOneOf(queryString(query.fabric, "fabric"), FABRICS, "fabric");
    const page = parsePage(query);
    const rules = await FabricRuleQuery.search(fabric, page);
    return toPage(
      rules.items.map((rule) => ({
        id: rule.id,
        fabric: rule.fabric,
        risk: rule.risk,
        handling: rule.handling,
        recommendedWash: rule.washProgramme,
        recommendedDry: rule.dryProgramme,
        maxTemperatureC: rule.maxTemperatureC,
        cycle: rule.cycle,
      })),
      rules.total,
      page
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

const isFlagged = (piece: IPiece) =>
  piece.riskClass !== "low" || piece.careFlags.length > 0 || piece.condition !== "ok" || piece.note !== null;

const careSummary = async (id: string, scope: StoreScope) => {
  try {
    const order = isUuid(id) ? await OrderQuery.findById(id, scope) : null;
    if (!order) throw new CustomException(NOT_FOUND, notFound);
    const pieces = await PieceQuery.listByOrder(order.id, scope);
    const care = order.care;
    const flaggedPieces = pieces.filter(isFlagged);
    const orderFlagged = care.riskClass !== "low" || care.flags.length > 0 || care.customerNote !== null || care.riderNote !== null;
    return {
      flagged: orderFlagged || flaggedPieces.length > 0,
      order: {
        risk: care.riskClass,
        fabric: care.fabric,
        flags: care.flags,
        customerNotes: care.customerNote,
        riderNotes: care.riderNote,
        photoCount: care.photoCount,
      },
      items: flaggedPieces.map((piece) => ({
        itemId: piece.id,
        tagCode: piece.tagCode,
        name: piece.garment,
        fabric: piece.fabric,
        risk: piece.riskClass,
        condition: piece.condition,
        flags: piece.careFlags,
        note: piece.note,
        customerNotes: care.customerNote,
        riderNotes: care.riderNote,
        photos: [],
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const findPiece = async (id: string, itemId: string, scope: StoreScope): Promise<IPiece> => {
  const piece = isUuid(id) && isUuid(itemId) ? await PieceQuery.findInOrder(id, itemId, scope) : null;
  if (!piece) throw new CustomException(ITEM_NOT_FOUND, notFound);
  return piece;
};

const suggestionFor = async (piece: IPiece) =>
  suggestProcess(
    { fabric: piece.fabric, colour: piece.colour, soilLevel: piece.soilLevel, riskClass: piece.riskClass, careFlags: piece.careFlags },
    await FabricRuleQuery.findByFabric(piece.fabric)
  );

const getProcessSuggestion = async (id: string, itemId: string, scope: StoreScope) => {
  try {
    return await suggestionFor(await findPiece(id, itemId, scope));
  } catch (error) {
    throw toCustomException(error);
  }
};

// ---------------------------------------------------------------- check-in
const checkIn = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const receivedFrom = oneOf(body.receivedFrom, RECEIVED_FROM, "receivedFrom");
    if (body.riderId !== undefined && body.riderId !== null && !isUuid(body.riderId)) {
      throw new CustomException("riderId must be a valid id.", badRequest);
    }
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_CHECK_IN_ITEMS) {
      throw new CustomException(`items must list 1 to ${MAX_CHECK_IN_ITEMS} garment lines.`, badRequest);
    }
    const inputs = body.items.map((raw, index) => parsePieceInput(raw, `Item ${index + 1}`, true));

    return await FloorTransaction.run(async (tx) => {
      const order = await requireOrder(id, scope, tx);
      refuseClosed(order);
      if (order.status !== "booked" && order.status !== "picked_up") {
        throw new CustomException("This order has already been checked in.", conflict);
      }
      const pieces = await createPieces(order, inputs, receivedFrom, user, tx);
      const status = await syncOrderStatus(order.id, order.storeId, user, `Received at the store: ${pieces.length} garments tagged.`, tx);
      return { orderStatus: status, tagsToPrint: pieces.map((p) => p.tagCode), items: pieces.map(toPieceView) };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const addItem = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const garment = parsePieceInput(input, "Item", false);
    return await FloorTransaction.run(async (tx) => {
      const order = await requireOrder(id, scope, tx);
      refuseClosed(order);
      if (order.status !== "received" && order.status !== "sorted") {
        throw new CustomException(
          "Garments can only be added between check-in and the start of washing. Book the extra garment as a new order.",
          conflict
        );
      }
      const pieces = await createPieces(order, [garment], "customer", user, tx);
      const status = await syncOrderStatus(order.id, order.storeId, user, "A garment was added after check-in.", tx);
      return { orderStatus: status, tagsToPrint: pieces.map((p) => p.tagCode), items: pieces.map(toPieceView) };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

// ---------------------------------------------------------------- edits
const CHANGED_ELSEWHERE = "This garment was changed by someone else. Reload and try again.";
const LOCKED = "Washing has started for this garment, so it can no longer be changed here.";

const editablePiece = async (order: IOrder, itemId: string, scope: StoreScope, tx: Db) => {
  const piece = isUuid(itemId) ? await PieceQuery.findInOrder(order.id, itemId, scope, tx) : null;
  if (!piece) throw new CustomException(ITEM_NOT_FOUND, notFound);
  if (!EDITABLE_STAGES.includes(piece.stage) || piece.activeBatchId) throw new CustomException(LOCKED, conflict);
  return piece;
};

const updateItem = async (id: string, itemId: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const changes: IPieceEdit = {};
    if (body.condition !== undefined) changes.condition = oneOf(body.condition, ITEM_CONDITIONS, "condition");
    if (body.fabric !== undefined) changes.fabric = oneOf(body.fabric, FABRICS, "fabric");
    if (body.careFlags !== undefined) changes.careFlags = parseCareFlags(body.careFlags, "careFlags");
    if (body.note !== undefined) changes.note = body.note === null || body.note === "" ? null : text(body.note, "note", 300);
    if (Object.keys(changes).length === 0) {
      throw new CustomException("Send at least one of condition, fabric, careFlags or note.", badRequest);
    }

    return await FloorTransaction.run(async (tx) => {
      const order = await requireOrder(id, scope, tx);
      refuseClosed(order);
      const piece = await editablePiece(order, itemId, scope, tx);
      const edit: IPieceEdit = { ...changes };
      const careChanged = changes.fabric !== undefined || changes.careFlags !== undefined;
      if (changes.fabric !== undefined) {
        const rule = (await FabricRuleQuery.findByFabrics([changes.fabric], tx)).get(changes.fabric);
        edit.riskClass = pieceRisk(changes.fabric, rule, order);
      }
      // The process was decided for the old care details, so it must be decided again.
      if (careChanged && piece.stage === "sorted") {
        Object.assign(edit, {
          stage: "received",
          processWash: null,
          processDry: null,
          processTemperatureC: null,
          processCycle: null,
          suggestedWash: null,
          suggestedDry: null,
          overrideReason: null,
          processSetBy: null,
          processSetAt: null,
        } satisfies IPieceEdit);
      }
      if (!(await PieceQuery.edit(piece.id, edit, { stage: piece.stage, noBatch: true }, tx))) {
        throw new CustomException(CHANGED_ELSEWHERE, conflict);
      }
      await syncOrderStatus(order.id, order.storeId, user, `Care details changed on ${piece.tagCode}.`, tx);
      const updated = await PieceQuery.findInOrder(order.id, piece.id, scope, tx);
      return toPieceView(updated as IPiece);
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const removeItem = async (id: string, itemId: string, scope: StoreScope, user: RequestUser) => {
  try {
    return await FloorTransaction.run(async (tx) => {
      const order = await requireOrder(id, scope, tx);
      refuseClosed(order);
      const piece = await editablePiece(order, itemId, scope, tx);
      if (!(await PieceQuery.remove(piece.id, { stage: piece.stage, noBatch: true }, tx))) {
        throw new CustomException(CHANGED_ELSEWHERE, conflict);
      }
      await syncOrderStatus(order.id, order.storeId, user, `${piece.tagCode} was removed from the order.`, tx);
      return { id: piece.id, tagCode: piece.tagCode, removed: true };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

// ---------------------------------------------------------------- process choice
const setItemProcess = async (id: string, itemId: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const choice = {
      wash: text(body.wash, "wash", 60),
      dry: text(body.dry, "dry", 60),
      temperatureC: body.temperatureC === undefined ? undefined : wholeNumber(body.temperatureC, "temperatureC", 0, MAX_TEMPERATURE_C),
      cycle: optionalText(body.cycle, "cycle", 40),
    };
    const overrideReason = optionalText(body.overrideReason, "overrideReason", 300);

    return await FloorTransaction.run(async (tx) => {
      const order = await requireOrder(id, scope, tx);
      refuseClosed(order);
      const piece = await editablePiece(order, itemId, scope, tx);
      const suggestion = await suggestionFor(piece);
      const overridden = differsFromSuggestion(choice, suggestion);
      // Staff make the final call, but a choice against the suggestion is on record with a reason.
      if (overridden && !overrideReason) {
        throw new CustomException("overrideReason is required when the process differs from the suggestion.", badRequest);
      }
      const edit: IPieceEdit = {
        stage: "sorted",
        processWash: choice.wash,
        processDry: choice.dry,
        processTemperatureC: choice.temperatureC ?? suggestion.recommended.temperatureC,
        processCycle: choice.cycle ?? suggestion.recommended.cycle,
        suggestedWash: suggestion.recommended.wash,
        suggestedDry: suggestion.recommended.dry,
        overrideReason: overridden ? (overrideReason as string) : null,
        processSetBy: actorOf(user).byName,
        processSetAt: new Date(),
      };
      if (!(await PieceQuery.edit(piece.id, edit, { stage: piece.stage, noBatch: true }, tx))) {
        throw new CustomException(CHANGED_ELSEWHERE, conflict);
      }
      await syncOrderStatus(order.id, order.storeId, user, "Every garment has its wash and dry process.", tx);
      return toPieceView((await PieceQuery.findInOrder(order.id, piece.id, scope, tx)) as IPiece);
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

export const CheckInService = {
  listFabricRules,
  careSummary,
  checkIn,
  addItem,
  updateItem,
  removeItem,
  setItemProcess,
  getProcessSuggestion,
};
