import { IUser, UserRole } from "./User.Interface.js";

// What other services may learn about an account: the contract of /internal/users.
export interface IInternalUser {
  id: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  role: UserRole;
  storeId: string | null;
  isActive: boolean;
}

export const toInternalUser = (user: IUser): IInternalUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phoneNumber: user.phoneNumber,
  role: user.role,
  storeId: user.storeId,
  isActive: user.isActive,
});
