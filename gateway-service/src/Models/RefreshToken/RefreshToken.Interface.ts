export type RevokeReason =
  | "rotated"
  | "logout"
  | "logout_all"
  | "reuse_detected"
  | "password_reset"
  | "deactivated"
  | "password_change"
  | "store_changed";

export interface IRefreshToken {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  sessionExpiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export type IRefreshTokenCreate = Pick<
  IRefreshToken,
  "userId" | "familyId" | "tokenHash" | "expiresAt" | "sessionExpiresAt"
>;
