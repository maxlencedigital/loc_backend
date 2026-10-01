import bcrypt from "bcrypt";
import { UserQuery, UserProfilePatch } from "../Queries/User.Query.js";
import { UserTokenQuery } from "../Queries/UserToken.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { conflict, forbidden } from "../../commons/Utils/StatusCode.js";
import { IUser, UserRole } from "../Models/User/User.Interface.js";
import { IDashboardUser, toDashboardUser } from "../Models/User/DashboardUser.js";
import { IInternalUser, toInternalUser } from "../Models/User/InternalUser.js";
import { SessionService } from "./Session.Service.js";
import { MIN_PASSWORD_LENGTH, SALT_ROUNDS, generateTemporaryPassword } from "./Password.js";
import { invalid, parseEmail, parseName, parsePhone, parseStoreId, UUID_PATTERN } from "./UserInput.js";
import {
  ASSIGNABLE_ROLES,
  TEAM_ROLES,
  UserActor,
  isPrivileged,
  loadTeamMember,
  requireSuperAdminFor,
  userNotFound,
} from "./TeamAccess.js";

export type { UserActor };

const MAX_SEARCH_LENGTH = 100;
const MAX_LOOKUP_IDS = 200;

const ROLE_DESCRIPTIONS: Partial<Record<UserRole, string>> = {
  admin: "Runs operations across every store: team, stores, pricing, finance and settings.",
  manager: "Runs one store: its team, orders, stock and day-to-day operations.",
  staff: "Works the floor of one store: intake, processing and handover of orders.",
};

const parseAssignableRole = (value: unknown): UserRole => {
  if (typeof value !== "string" || !ASSIGNABLE_ROLES.includes(value as UserRole)) {
    throw invalid(`role must be one of: ${ASSIGNABLE_ROLES.join(", ")}.`);
  }
  return value as UserRole;
};

// The unique constraint, not a pre-check, is the guard: two concurrent writes can both pass a pre-check.
const rethrowDuplicate = (error: unknown): void => {
  if (isUniqueViolation(error, "email")) {
    throw new CustomException("An account with this email already exists.", conflict);
  }
  if (isUniqueViolation(error, "phoneNumber")) {
    throw new CustomException("An account with this phone number already exists.", conflict);
  }
};

// An inactive last super_admin is already locked out, so only an active one is protected.
const assertNotLastSuperAdmin = async (target: IUser, action: string) => {
  if (target.role !== "super_admin" || !target.isActive) return;
  if ((await UserQuery.countActiveByRole("super_admin")) <= 1) {
    throw new CustomException(`The last active super admin cannot be ${action}.`, conflict);
  }
};

const listUsers = async (
  actor: UserActor,
  filters: { storeId?: unknown; role?: unknown; q?: unknown }
): Promise<IDashboardUser[]> => {
  try {
    let storeId: string | undefined;
    if (actor.role === "manager") {
      if (!actor.storeId) {
        throw new CustomException("Your account is not assigned to a store.", forbidden);
      }
      storeId = actor.storeId;
    } else if (filters.storeId !== undefined && filters.storeId !== "") {
      storeId = parseStoreId(filters.storeId);
    }

    let roles = TEAM_ROLES;
    if (filters.role !== undefined && filters.role !== "") {
      if (typeof filters.role !== "string" || !TEAM_ROLES.includes(filters.role as UserRole)) {
        throw invalid(`role must be one of: ${TEAM_ROLES.join(", ")}.`);
      }
      roles = [filters.role as UserRole];
    }

    const q = typeof filters.q === "string" ? filters.q.slice(0, MAX_SEARCH_LENGTH) : undefined;
    const users = await UserQuery.search({ roles, storeId, q });
    return users.map(toDashboardUser);
  } catch (error) {
    throw toCustomException(error);
  }
};

const createUser = async (
  actor: UserActor,
  input: Record<string, unknown>
): Promise<IDashboardUser & { temporaryPassword?: string }> => {
  try {
    const name = parseName(input.name);
    const email = parseEmail(input.email);
    const phoneNumber = parsePhone(input.phone);
    const role = parseAssignableRole(input.role);
    requireSuperAdminFor(actor, role);

    const hasStore = input.storeId !== undefined && input.storeId !== null;
    const storeId = hasStore ? parseStoreId(input.storeId) : null;

    let password: string;
    let temporaryPassword: string | undefined;
    if (input.password === undefined || input.password === null || input.password === "") {
      password = temporaryPassword = generateTemporaryPassword();
    } else if (typeof input.password === "string" && input.password.length >= MIN_PASSWORD_LENGTH) {
      password = input.password;
    } else {
      throw invalid(`password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    let user: IUser;
    try {
      user = await UserQuery.create({
        name,
        email,
        phoneNumber,
        passwordHash: await bcrypt.hash(password, SALT_ROUNDS),
        // Typed in by an admin, never proven by an OTP.
        isPhoneVerified: false,
        oauthProvider: null,
        oauthSubject: null,
        role,
        isActive: true,
        // Admins are not pinned to one store.
        storeId: isPrivileged(role) ? null : storeId,
      });
    } catch (error) {
      rethrowDuplicate(error);
      throw error;
    }
    return { ...toDashboardUser(user), ...(temporaryPassword ? { temporaryPassword } : {}) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const updateUser = async (
  actor: UserActor,
  id: string,
  input: Record<string, unknown>
): Promise<IDashboardUser> => {
  try {
    const target = await loadTeamMember(id);

    const patch: UserProfilePatch = {};
    if (input.name !== undefined) patch.name = parseName(input.name);
    if (input.phone !== undefined) patch.phoneNumber = parsePhone(input.phone);
    // Re-sending the current role is not a change, so a super_admin can still be renamed.
    if (input.role !== undefined && input.role !== target.role) {
      patch.role = parseAssignableRole(input.role);
    }
    if (input.storeId !== undefined) {
      patch.storeId = input.storeId === null ? null : parseStoreId(input.storeId);
    }
    if (Object.keys(patch).length === 0) {
      throw invalid("Provide at least one of: name, phone, role, storeId.");
    }

    requireSuperAdminFor(actor, target.role, patch.role ?? target.role);
    if (patch.role && target.role === "super_admin") {
      await assertNotLastSuperAdmin(target, "demoted");
    }
    if (isPrivileged(patch.role ?? target.role)) patch.storeId = null;

    let user: IUser;
    try {
      user = await UserQuery.updateProfile(id, patch);
    } catch (error) {
      rethrowDuplicate(error);
      throw error;
    }
    return toDashboardUser(user);
  } catch (error) {
    throw toCustomException(error);
  }
};

// The one place an account is switched off, shared by the admin endpoint and the internal one.
const switchOff = async (target: IUser): Promise<IUser> => {
  await assertNotLastSuperAdmin(target, "deactivated");
  const updated = await UserQuery.setActive(target.id, false);
  // Ends every sign-in now; the refresh check would also catch it, but not for hours.
  await SessionService.revokeAllFor(target.id, "deactivated");
  // An unused invite or reset link must not be able to reach a switched-off account.
  await UserTokenQuery.invalidateOutstanding(target.id);
  return updated;
};

const deactivateUser = async (actor: UserActor, id: string): Promise<IDashboardUser> => {
  try {
    const target = await loadTeamMember(id);
    if (target.id === actor.id) {
      throw invalid("You cannot deactivate your own account.");
    }
    requireSuperAdminFor(actor, target.role);
    return toDashboardUser(await switchOff(target));
  } catch (error) {
    throw toCustomException(error);
  }
};

const reactivateUser = async (actor: UserActor, id: string): Promise<IDashboardUser> => {
  try {
    const target = await loadTeamMember(id);
    requireSuperAdminFor(actor, target.role);
    return toDashboardUser(await UserQuery.setActive(id, true));
  } catch (error) {
    throw toCustomException(error);
  }
};

export interface IUserDetail extends IDashboardUser {
  phoneNumber: string | null;
  isActive: boolean;
  isPhoneVerified: boolean;
  storeIds: string[];
}

// The same row the list shows, plus the contract's detail fields. A user belongs to one store,
// so storeIds holds zero or one id.
const toUserDetail = (user: IUser): IUserDetail => ({
  ...toDashboardUser(user),
  phoneNumber: user.phoneNumber,
  isActive: user.isActive,
  isPhoneVerified: user.isPhoneVerified,
  storeIds: user.storeId ? [user.storeId] : [],
});

// Same scoping as the list: a manager sees only their own store's team, and anything outside it is a 404.
const getUser = async (actor: UserActor, id: string): Promise<IUserDetail> => {
  try {
    if (actor.role === "manager" && !actor.storeId) {
      throw new CustomException("Your account is not assigned to a store.", forbidden);
    }
    const target = await loadTeamMember(id);
    if (actor.role === "manager" && target.storeId !== actor.storeId) throw userNotFound();
    return toUserDetail(target);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Only what the caller may actually hand out: an admin cannot create admins, a super admin can.
const listRoles = async (actor: UserActor): Promise<{ roles: { role: UserRole; description: string }[] }> => {
  try {
    const roles = ASSIGNABLE_ROLES.filter((role) => actor.role === "super_admin" || !isPrivileged(role));
    return { roles: roles.map((role) => ({ role, description: ROLE_DESCRIPTIONS[role] ?? "" })) };
  } catch (error) {
    throw toCustomException(error);
  }
};

// An account has one store (it travels in the token), so the list holds at most one id; an empty
// list takes the store away. Admins are never store-bound.
const setUserStores = async (actor: UserActor, id: string, input: Record<string, unknown>): Promise<IUserDetail> => {
  try {
    const raw = input.storeIds;
    if (!Array.isArray(raw)) throw invalid("storeIds must be a list of store ids (UUID).");
    if (raw.length > 1) throw invalid("An account belongs to one store: send at most one store id.");
    const storeId = raw.length === 1 ? parseStoreId(raw[0]) : null;

    const target = await loadTeamMember(id);
    requireSuperAdminFor(actor, target.role);
    if (isPrivileged(target.role) && storeId) throw invalid("Admin accounts are not tied to a store.");
    if (target.storeId === storeId) return toUserDetail(target);

    const updated = await UserQuery.updateProfile(id, { storeId });
    // The store rides in the access token and is re-read at refresh, so ending the refresh tokens
    // makes the new store apply at the next sign-in instead of up to 14 days later.
    await SessionService.revokeAllFor(id, "store_changed");
    return toUserDetail(updated);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Internal (service-to-service) lookups. Nothing role-scoped: there is no user, only a calling service.
const getInternalUser = async (id: string): Promise<IInternalUser> => {
  try {
    if (!UUID_PATTERN.test(id)) throw userNotFound();
    const user = await UserQuery.findById(id);
    if (!user) throw userNotFound();
    return toInternalUser(user);
  } catch (error) {
    throw toCustomException(error);
  }
};

// One query for the whole batch; unknown ids are simply absent from the answer.
const lookupInternalUsers = async (ids: unknown): Promise<{ users: IInternalUser[] }> => {
  try {
    if (!Array.isArray(ids) || ids.length === 0) throw invalid("ids must be a non-empty list of user ids (UUID).");
    if (ids.length > MAX_LOOKUP_IDS) throw invalid(`ids can hold at most ${MAX_LOOKUP_IDS} ids.`);
    if (!ids.every((value) => typeof value === "string" && UUID_PATTERN.test(value))) {
      throw invalid("ids must all be user ids (UUID).");
    }
    const unique = [...new Set((ids as string[]).map((value) => value.toLowerCase()))];
    return { users: (await UserQuery.findManyByIds(unique)).map(toInternalUser) };
  } catch (error) {
    throw toCustomException(error);
  }
};

// Service-to-service switch (the HR service on offboarding). No acting user, so no self or privilege
// check; the last-active-super_admin guard still applies. Repeating either call is harmless.
const setInternalActive = async (id: string, isActive: boolean): Promise<IInternalUser> => {
  try {
    if (!UUID_PATTERN.test(id)) throw userNotFound();
    const target = await UserQuery.findById(id);
    if (!target) throw userNotFound();
    return toInternalUser(isActive ? await UserQuery.setActive(id, true) : await switchOff(target));
  } catch (error) {
    throw toCustomException(error);
  }
};

const deactivateInternalUser = (id: string) => setInternalActive(id, false);
const reactivateInternalUser = (id: string) => setInternalActive(id, true);

export const UsersService = {
  listUsers,
  createUser,
  updateUser,
  deactivateUser,
  reactivateUser,
  getUser,
  listRoles,
  setUserStores,
  getInternalUser,
  lookupInternalUsers,
  deactivateInternalUser,
  reactivateInternalUser,
};
