import { IUser, UserRole } from "./User.Interface.js";

// The dashboard's `User` type (Dashboard/src/types/domain.ts), except that
// `role` stays the backend value: the dashboard maps it in one place.
export interface IDashboardUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  storeId: string | null;
  initials: string;
  status: "active" | "suspended";
  lastActiveAt: string;
  joinedAt: string;
}

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

export const toDashboardUser = (user: IUser): IDashboardUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phoneNumber ?? "",
  role: user.role,
  storeId: user.storeId,
  initials: initialsOf(user.name),
  status: user.isActive ? "active" : "suspended",
  lastActiveAt: (user.lastLoginAt ?? user.createdAt).toISOString(),
  joinedAt: user.createdAt.toISOString(),
});
