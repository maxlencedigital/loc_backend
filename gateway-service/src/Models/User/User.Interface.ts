export type UserRole = "super_admin" | "admin" | "staff" | "driver" | "customer";

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
}

export type IUserCreate = Omit<IUser, "id">;
