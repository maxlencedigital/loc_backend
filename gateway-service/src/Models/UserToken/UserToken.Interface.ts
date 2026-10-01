export type UserTokenPurpose = "invite" | "password_reset";

export interface IUserToken {
  id: string;
  userId: string;
  purpose: UserTokenPurpose;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
}

export type IUserTokenCreate = Pick<IUserToken, "userId" | "purpose" | "tokenHash" | "expiresAt" | "createdById">;
