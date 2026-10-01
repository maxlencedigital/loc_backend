import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, forbidden, unauthorized } from "../../commons/Utils/StatusCode.js";
import { isUuid } from "../Utils/Uuid.js";
import type { IdentifiedRequest, UserRole } from "./Identity.js";

/** The store a request is limited to, or null for "every store" (admins and hr). */
export type StoreScope = string | null;

export const NO_STORE_MESSAGE = "Your account is not assigned to a store.";

// Who is calling, with the store headers the gateway sets from the verified token.
// Identity.ts keeps only id and role, so the rest is read here, from the same request.
export interface Actor {
  id: string;
  role: UserRole;
  storeId: string | null;
  scopeStoreId: string | null;
  name: string | null;
}

const headerOrNull = (req: IdentifiedRequest, name: string): string | null => req.header(name)?.trim() || null;

const decodeName = (value: string | null): string | null => {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

export const requestActor = (req: IdentifiedRequest): Actor => {
  if (!req.user) throw new CustomException("Authentication required.", unauthorized);
  return {
    id: req.user.id,
    role: req.user.role,
    storeId: headerOrNull(req, "x-user-store-id"),
    scopeStoreId: headerOrNull(req, "x-store-scope"),
    name: decodeName(headerOrNull(req, "x-user-name")),
  };
};

const isCrossStoreRole = (role: string) => role === "super_admin" || role === "admin";
// HR works across every store; the gateway never forwards a scope header for it.
const isCompanyWideRole = (role: string) => role === "hr";
const isStoreBoundRole = (role: string) => role === "manager" || role === "staff";

/** The rule itself, on an actor: the same rule commerce applies, so a store means one thing everywhere. */
export const scopeOfActor = (actor: Actor): StoreScope => {
  if (isCrossStoreRole(actor.role)) {
    if (actor.scopeStoreId === null) return null;
    if (!isUuid(actor.scopeStoreId)) throw new CustomException("Invalid store.", badRequest);
    return actor.scopeStoreId;
  }
  if (isCompanyWideRole(actor.role)) return null;
  if (isStoreBoundRole(actor.role)) {
    if (!isUuid(actor.storeId)) throw new CustomException(NO_STORE_MESSAGE, forbidden);
    return actor.storeId;
  }
  throw new CustomException("You do not have permission to perform this action.", forbidden);
};

// A store-bound role is pinned to their own store and the scope header is ignored,
// so a forged x-store-scope cannot widen access.
export const resolveStoreScope = (req: IdentifiedRequest): StoreScope => scopeOfActor(requestActor(req));

/** Actor and store scope together, for the dispatch controllers. */
export const dispatchContext = (req: IdentifiedRequest): { actor: Actor; scope: StoreScope } => {
  const actor = requestActor(req);
  return { actor, scope: scopeOfActor(actor) };
};
