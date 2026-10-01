import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import type { IPiece } from "../Models/StoreFloor/StoreFloor.Interface.js";
import { queryString } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  manager: "Store manager",
  staff: "Employee",
};

export const STORE_NOT_FOUND = "Store not found.";

/** Who is acting, as the order timeline and floor records show it. */
export const actorOf = (user: RequestUser): { byName: string; byUserId: string } => ({
  byName: user.name ?? ROLE_LABEL[user.role] ?? user.role,
  byUserId: user.id,
});

// The store a list or action is about. A store-bound role is pinned to its own store, and naming
// another one is "not found" (never confirmed to exist). An admin names a store, or sees all.
export const resolveStoreFilter = (scope: StoreScope, raw: unknown, required: boolean): string | null => {
  const named = queryString(raw, "storeId");
  if (named !== undefined && !isUuid(named)) throw new CustomException("storeId must be a valid id.", badRequest);
  if (scope && named && named !== scope) throw new CustomException(STORE_NOT_FOUND, notFound);
  const store = scope ?? named ?? null;
  if (required && !store) throw new CustomException("storeId is required.", badRequest);
  return store;
};

// Stores work on Indian time: a "day" for due dates, daily checks and capacity is the local day.
const IST_OFFSET_MINUTES = 330;
const MS_PER_MINUTE = 60_000;

/** The local (Indian) calendar date of an instant, as YYYY-MM-DD. */
export const localDate = (at: Date): string => new Date(at.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE).toISOString().slice(0, 10);

/** Midnight UTC of a YYYY-MM-DD string, the value a Postgres date column round-trips. */
export const dateOnly = (isoDate: string): Date => new Date(`${isoDate}T00:00:00.000Z`);

export const toPieceView = (piece: IPiece) => ({
  id: piece.id,
  tagCode: piece.tagCode,
  orderId: piece.orderId,
  orderRef: piece.orderRef,
  garment: piece.garment,
  garmentTypeId: piece.garmentTypeId,
  serviceId: piece.serviceId,
  condition: piece.condition,
  fabric: piece.fabric,
  colour: piece.colour,
  soilLevel: piece.soilLevel,
  risk: piece.riskClass,
  careFlags: piece.careFlags,
  note: piece.note,
  priority: piece.priority,
  dueAt: piece.dueAt.toISOString(),
  stage: piece.stage,
  batchId: piece.activeBatchId,
  process: piece.processWash
    ? {
        wash: piece.processWash,
        dry: piece.processDry,
        temperatureC: piece.processTemperatureC,
        cycle: piece.processCycle,
        overridden: piece.overrideReason !== null,
        overrideReason: piece.overrideReason,
        setBy: piece.processSetBy,
        setAt: piece.processSetAt?.toISOString() ?? null,
      }
    : null,
  qcPassed: piece.qcPassedAt !== null,
  reworkCount: piece.reworkCount,
});
