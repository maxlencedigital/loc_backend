import { CustomException } from "../../commons/Exception/CustomException.js";
import { forbidden, notFound } from "../../commons/Utils/StatusCode.js";
import { UserQuery } from "../Queries/User.Query.js";
import { IUser, UserRole } from "../Models/User/User.Interface.js";
import { UUID_PATTERN } from "./UserInput.js";

// Who may touch which team account. Shared by user management and the invite / reset flows
// so the privilege rules cannot drift apart.

export interface UserActor {
  id: string;
  role: UserRole;
  storeId: string | null;
}

// The roles the dashboard team screens manage; customers, hr and drivers are not part of it.
export const TEAM_ROLES: UserRole[] = ["super_admin", "admin", "manager", "staff"];
// super_admin is never assigned through the API, only seeded.
export const ASSIGNABLE_ROLES: UserRole[] = ["admin", "manager", "staff"];
const PRIVILEGED_ROLES: UserRole[] = ["super_admin", "admin"];

export const isPrivileged = (role: UserRole) => PRIVILEGED_ROLES.includes(role);

export const userNotFound = () => new CustomException("User not found.", notFound);

export const requireSuperAdminFor = (actor: UserActor, ...roles: UserRole[]) => {
  if (actor.role !== "super_admin" && roles.some(isPrivileged)) {
    throw new CustomException("Only a super admin can manage admin and super admin accounts.", forbidden);
  }
};

export const loadTeamMember = async (id: string): Promise<IUser> => {
  if (!UUID_PATTERN.test(id)) throw userNotFound();
  const user = await UserQuery.findById(id);
  if (!user || !TEAM_ROLES.includes(user.role)) throw userNotFound();
  return user;
};
