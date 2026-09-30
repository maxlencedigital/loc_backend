import bcrypt from "bcrypt";
import { UserQuery, UserProfilePatch } from "../Queries/User.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, conflict, forbidden, notFound } from "../../commons/Utils/StatusCode.js";
import { IUser, UserRole } from "../Models/User/User.Interface.js";
import { IDashboardUser, toDashboardUser } from "../Models/User/DashboardUser.js";
import { SessionService } from "./Session.Service.js";
import {
  MIN_PASSWORD_LENGTH,
  SALT_ROUNDS,
  generateTemporaryPassword,
} from "./Password.js";

export interface UserActor {
  id: string;
  role: UserRole;
  storeId: string | null;
}

// The roles the dashboard team screens manage; customers, hr and drivers are not part of it.
const TEAM_ROLES: UserRole[] = ["super_admin", "admin", "manager", "staff"];
// super_admin is never assigned through the API, only seeded.
const ASSIGNABLE_ROLES: UserRole[] = ["admin", "manager", "staff"];
const PRIVILEGED_ROLES: UserRole[] = ["super_admin", "admin"];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_PATTERN = /^\+?[0-9]{8,15}$/;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 150;
const MAX_SEARCH_LENGTH = 100;

const isPrivileged = (role: UserRole) => PRIVILEGED_ROLES.includes(role);

const invalid = (message: string) => new CustomException(message, badRequest);
const userNotFound = () => new CustomException("User not found.", notFound);

const parseName = (value: unknown): string => {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    throw invalid(`name is required and must be at most ${MAX_NAME_LENGTH} characters.`);
  }
  return name;
};

const parseEmail = (value: unknown): string => {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!EMAIL_PATTERN.test(email) || email.length > MAX_EMAIL_LENGTH) {
    throw invalid("A valid email address is required.");
  }
  return email;
};

// Spaces and dashes are typed freely ("+91 98765 43210"); one canonical form keeps the unique index honest.
const parsePhone = (value: unknown): string => {
  const phone = typeof value === "string" ? value.replace(/[\s()-]/g, "") : "";
  if (!PHONE_PATTERN.test(phone)) {
    throw invalid("A valid phone number is required, e.g. +919876543210.");
  }
  return phone;
};

const parseStoreId = (value: unknown): string => {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw invalid("storeId must be a store id (UUID).");
  }
  return value;
};

const parseAssignableRole = (value: unknown): UserRole => {
  if (typeof value !== "string" || !ASSIGNABLE_ROLES.includes(value as UserRole)) {
    throw invalid(`role must be one of: ${ASSIGNABLE_ROLES.join(", ")}.`);
  }
  return value as UserRole;
};

const requireSuperAdminFor = (actor: UserActor, ...roles: UserRole[]) => {
  if (actor.role !== "super_admin" && roles.some(isPrivileged)) {
    throw new CustomException(
      "Only a super admin can manage admin and super admin accounts.",
      forbidden
    );
  }
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

const loadTeamMember = async (id: string): Promise<IUser> => {
  if (!UUID_PATTERN.test(id)) throw userNotFound();
  const user = await UserQuery.findById(id);
  if (!user || !TEAM_ROLES.includes(user.role)) throw userNotFound();
  return user;
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

const deactivateUser = async (actor: UserActor, id: string): Promise<IDashboardUser> => {
  try {
    const target = await loadTeamMember(id);
    if (target.id === actor.id) {
      throw invalid("You cannot deactivate your own account.");
    }
    requireSuperAdminFor(actor, target.role);
    await assertNotLastSuperAdmin(target, "deactivated");
    const updated = await UserQuery.setActive(id, false);
    // Ends every sign-in now; the refresh check would also catch it, but not for hours.
    await SessionService.revokeAllFor(id, "deactivated");
    return toDashboardUser(updated);
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

export const UsersService = { listUsers, createUser, updateUser, deactivateUser, reactivateUser };
