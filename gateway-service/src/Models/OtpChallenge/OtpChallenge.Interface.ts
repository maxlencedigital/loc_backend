export type OtpPurpose = "register" | "login" | "password_reset";

export interface IOtpChallenge {
  /** Handed to the client as `verificationId`. Opaque; not the OTP. */
  id: string;
  purpose: OtpPurpose;
  /**
   * Phone number or email the code was sent to, depending on purpose. For
   * registration this is the authoritative phone number — it is read back
   * from here when the account is finally created, never re-accepted from
   * the client, so the number that was proven is the number that gets saved.
   */
  destination: string;
  /**
   * bcrypt hash of the code. A 6-digit OTP in plaintext would be directly
   * usable by anyone who could read the table (a backup, a log, a dump).
   */
  otpHash: string;
  /** Set for `login`/`password_reset` once the account is resolved. */
  userId: string | null;
  attempts: number;
  /**
   * Stamped when the correct code is entered. Separate from `consumedAt`
   * because the registration form verifies the phone *mid-form* — the user
   * still has to type an email and password before the account is created,
   * so there is a real gap between "this number is proven" and "this
   * challenge has been used up".
   */
  verifiedAt: Date | null;
  /**
   * Stamped when the challenge is finally spent (account created, password
   * reset, logged in). Once set, the challenge can never be used again.
   */
  consumedAt: Date | null;
  expiresAt: Date;
  /** Sequelize-managed. Declared so it can be used in where clauses. */
  createdAt?: Date;
}

export type IOtpChallengeCreate = Omit<
  IOtpChallenge,
  "id" | "attempts" | "verifiedAt" | "consumedAt" | "createdAt"
>;
