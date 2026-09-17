export type UserRole = "super_admin" | "admin" | "staff" | "driver" | "customer";

export interface IUser {
  id: string;
  name: string;
  email: string;
  phoneNumber: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
}

export type IUserCreate = Omit<IUser, "id">;
