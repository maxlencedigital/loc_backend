import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, forbidden, unauthorized } from "../../commons/Utils/StatusCode.js";
import { isUuid } from "../Utils/Uuid.js";
import type { IdentifiedRequest } from "./Identity.js";

/** The store a request is limited to, or null for "every store" (admins only). */
export type StoreScope = string | null;

export const NO_STORE_MESSAGE = "Your account is not assigned to a store.";

const isCrossStoreRole = (role: string) => role === "super_admin" || role === "admin";
const isStoreBoundRole = (role: string) => role === "manager" || role === "staff";

// The one place "which store?" is decided. A store-bound role is pinned to their own
// store and the scope header is ignored, so a forged x-store-scope cannot widen access.
export const resolveStoreScope = (req: IdentifiedRequest): StoreScope => {
  const user = req.user;
  if (!user) throw new CustomException("Authentication required.", unauthorized);

  if (isCrossStoreRole(user.role)) {
    if (user.scopeStoreId === null) return null;
    if (!isUuid(user.scopeStoreId)) throw new CustomException("Invalid store.", badRequest);
    return user.scopeStoreId;
  }
  if (isStoreBoundRole(user.role)) {
    if (!isUuid(user.storeId)) throw new CustomException(NO_STORE_MESSAGE, forbidden);
    return user.storeId;
  }
  throw new CustomException("You do not have permission to perform this action.", forbidden);
};
