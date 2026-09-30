export type UserRole = "super_admin" | "admin" | "manager" | "hr" | "staff" | "driver" | "customer";

export type OAuthProvider = "google" | "facebook" | "apple";

export interface IUser {
  id: string;
  name: string;
  email: string;
  /**
   * Nullable because a social-login account has no password. Storing "" would
   * be dangerous: an empty string is still hashable and could be matched on.
   */
  passwordHash: string | null;
  /**
   * Nullable because no OAuth provider guarantees a phone number. Still
   * unique — Postgres permits many NULLs in a unique index.
   */
  phoneNumber: string | null;
  /**
   * Only ever set by completing an OTP challenge. A number typed into a form
   * is a claim, not a verified fact.
   */
  isPhoneVerified: boolean;
  oauthProvider: OAuthProvider | null;
  /**
   * The provider's stable user id ("sub"). Matched in preference to email,
   * which a user can change while `sub` stays fixed.
   */
  oauthSubject: string | null;
  role: UserRole;
  isActive: boolean;
  /**
   * Carried in the JWT. Not a foreign key: stores live in commerce, which this
   * service never reads.
   */
  storeId: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

// storeId is optional so flows that never assign a store (register, OAuth) stay as they were.
export type IUserCreate = Omit<IUser, "id" | "storeId" | "lastLoginAt" | "createdAt"> & {
  storeId?: string | null;
};
