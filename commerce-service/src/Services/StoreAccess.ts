import { CustomException } from "../../commons/Exception/CustomException.js";
import { notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import type { IStore } from "../Models/Store/Store.Interface.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { isUuid } from "../Utils/Uuid.js";

export const STORE_NOT_FOUND = "Store not found.";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  manager: "Store manager",
  hr: "HR",
  staff: "Employee",
};

/** Who did it, for audit rows: the name the gateway forwarded, else the role. */
export const actorNameOf = (user: RequestUser): string => user.name ?? ROLE_LABEL[user.role] ?? user.role;

// The path store must exist and be inside the caller's scope. A store-bound caller asking for
// another store gets the same 404 as for a store that does not exist.
export const requireStore = async (id: string, scope: StoreScope): Promise<IStore> => {
  const store = isUuid(id) ? await StoreQuery.findById(id, scope) : null;
  if (!store) throw new CustomException(STORE_NOT_FOUND, notFound);
  return store;
};
