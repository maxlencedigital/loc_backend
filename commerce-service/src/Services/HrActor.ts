import type { RequestUser } from "../Middleware/Identity.js";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  hr: "HR",
  manager: "Store manager",
  staff: "Employee",
  driver: "Rider",
};

// Who to show on an audit row: the forwarded name, else the role.
export const actorName = (user: RequestUser): string => user.name ?? ROLE_LABEL[user.role] ?? user.role;

// Sensitive HR fields (bank, date of birth, pay grade, exit reason) are for HR and admins only.
export const canSeeSensitive = (role: string): boolean => role === "hr" || role === "admin" || role === "super_admin";
