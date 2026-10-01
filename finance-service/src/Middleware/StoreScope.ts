import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, forbidden, notFound, unauthorized } from "../../commons/Utils/StatusCode.js";
import { isUuid } from "../Utils/Input.js";
import type { IdentifiedRequest, UserRole } from "./Identity.js";

// Identity.ts (shared, not edited here) only carries the user id and role; the store headers the
// gateway adds are read here, in the one place that decides "which store?".

/** The store a request is limited to, or null for "every store" (admins and HR only). */
export type StoreScope = string | null;

export const NO_STORE_MESSAGE = "Your account is not assigned to a store.";

export interface Actor {
  id: string;
  role: UserRole;
  name: string | null;
  storeId: string | null;
  scopeStoreId: string | null;
}

const headerOrNull = (req: IdentifiedRequest, name: string): string | null => req.header(name)?.trim() || null;

// The gateway percent-encodes the name; a malformed value is dropped, not a 500.
const decodeName = (value: string | null): string | null => {
  if (!value) return null;
  try {
    return decodeURIComponent(value).slice(0, 120);
  } catch {
    return null;
  }
};

export const actorOf = (req: IdentifiedRequest): Actor => {
  if (!req.user) throw new CustomException("Authentication required.", unauthorized);
  return {
    id: req.user.id,
    role: req.user.role,
    name: decodeName(headerOrNull(req, "x-user-name")),
    storeId: headerOrNull(req, "x-user-store-id"),
    scopeStoreId: headerOrNull(req, "x-store-scope"),
  };
};

const isCrossStoreRole = (role: string) => role === "super_admin" || role === "admin";
// HR works across every store; the gateway never forwards a scope header for it.
const isCompanyWideRole = (role: string) => role === "hr";
const isStoreBoundRole = (role: string) => role === "manager" || role === "staff";

export const isCrossStore = (actor: Pick<Actor, "role">) => isCrossStoreRole(actor.role);

// A store-bound role is pinned to their own store and the scope header is ignored, so a forged
// x-store-scope cannot widen access.
export const scopeOf = (actor: Actor): StoreScope => {
  if (isCrossStoreRole(actor.role)) {
    if (actor.scopeStoreId === null) return null;
    if (!isUuid(actor.scopeStoreId)) throw new CustomException("Invalid store.", badRequest);
    return actor.scopeStoreId.toLowerCase();
  }
  if (isCompanyWideRole(actor.role)) return null;
  if (isStoreBoundRole(actor.role)) {
    if (!isUuid(actor.storeId)) throw new CustomException(NO_STORE_MESSAGE, forbidden);
    return actor.storeId.toLowerCase();
  }
  throw new CustomException("You do not have permission to perform this action.", forbidden);
};

export const resolveStoreScope = (req: IdentifiedRequest): StoreScope => scopeOf(actorOf(req));

/**
 * The store a read is limited to, given an optional ?storeId. An admin may choose (the query
 * wins over the header scope); a store-bound role asking for another store gets 404, the same
 * answer as for a store that does not exist.
 */
export const effectiveStore = (actor: Actor, requestedStoreId?: string): StoreScope => {
  const scope = scopeOf(actor);
  if (requestedStoreId === undefined) return scope;
  if (isCrossStoreRole(actor.role) || scope === null) return requestedStoreId;
  if (requestedStoreId !== scope) throw new CustomException("Store not found.", notFound);
  return scope;
};
