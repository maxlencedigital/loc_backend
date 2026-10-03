import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { StoreScope } from "../Middleware/StoreScope.js";
import { queryString } from "../Utils/Input.js";
import { istDayEnd, istDayStart, optionalDateInput } from "../Utils/OpsDates.js";
import { optionalUuid } from "../Utils/OpsInput.js";

export interface IActor {
  id: string;
  name: string;
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  hr: "HR",
  manager: "Store manager",
};

export const actorOf = (user: RequestUser): IActor => ({ id: user.id, name: user.name ?? ROLE_LABEL[user.role] ?? user.role });

// Bank details and the people a policy covers are shown only to the roles that run purchasing
// and insurance; a store manager reads the rest.
export const isBackOffice = (user: RequestUser): boolean =>
  user.role === "super_admin" || user.role === "admin" || user.role === "hr";

export const notFoundError = (what: string) => new CustomException(`${what} not found.`, notFound);

// A store-bound caller touching another store's record gets 404, never 403.
export const assertStoreInScope = (scope: StoreScope, storeId: string): void => {
  if (scope && scope !== storeId) throw notFoundError("Store");
};

// The store a list is limited to: the caller's scope, narrowed by ?storeId=. `empty` is
// true when the two disagree, so the answer is an empty page, not another store's rows.
export const listStore = (scope: StoreScope, query: Record<string, unknown>): { storeId: string | null; empty: boolean } => {
  const asked = optionalUuid(queryString(query.storeId, "storeId"), "storeId") ?? null;
  if (scope && asked && scope !== asked) return { storeId: scope, empty: true };
  return { storeId: scope ?? asked, empty: false };
};

// ?from= and ?to= are inclusive IST calendar days; the result is [from, to) as instants.
export const parseRange = (query: Record<string, unknown>): { from?: Date; to?: Date } => {
  const from = optionalDateInput(queryString(query.from, "from"), "from");
  const to = optionalDateInput(queryString(query.to, "to"), "to");
  if (from && to && to < from) throw new CustomException("to must not be before from.", badRequest);
  return { from: from ? istDayStart(from) : undefined, to: to ? istDayEnd(to) : undefined };
};
