export type UserRole = "super_admin" | "admin" | "staff" | "driver" | "customer";

export type OAuthProvider = "google" | "facebook" | "apple";

export interface IUser {
  id: string;
  name: string;
  email: string;
  /**
   * Nullable because a social-login account has no password at all. Treating
   * "" as "no password" instead would be dangerous — an empty string is still
   * a hashable value, and any code path that forgot to special-case it could
   * be tricked into authenticating against it.
   */
  passwordHash: string | null;
  /**
   * Nullable because no OAuth provider guarantees a phone number. Still
   * unique: MySQL permits many NULLs in a unique index, so unverified
   * social accounts don't collide with each other.
   */
  phoneNumber: string | null;
  /**
   * Only ever set by completing an OTP challenge. A number typed into a
   * registration form is a claim, not a verified fact.
   */
  isPhoneVerified: boolean;
  oauthProvider: OAuthProvider | null;
  /**
   * The provider's own stable user id ("sub"). Matched on in preference to
   * email, because a provider account's email can change while `sub` cannot.
   */
  oauthSubject: string | null;
  role: UserRole;
  isActive: boolean;
}

export type IUserCreate = Omit<IUser, "id">;
