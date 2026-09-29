export type OtpPurpose = "register" | "login" | "password_reset";

export interface IOtpChallenge {
  /** Handed to the client as `verificationId`. Opaque; not the OTP. */
  id: string;
  purpose: OtpPurpose;
  /**
   * Phone or email the code went to. For registration this is authoritative:
   * read back from here at account creation, never re-accepted from the client.
   */
  destination: string;
  /**
   * bcrypt hash of the code. A plaintext OTP would be directly usable by
   * anyone who could read a backup, a log or a dump.
   */
  otpHash: string;
  /** Set for `login`/`password_reset` once the account is resolved. */
  userId: string | null;
  attempts: number;
  /**
   * Stamped when the correct code is entered. Separate from `consumedAt`
   * because registration proves the phone mid-form, before the account exists.
   */
  verifiedAt: Date | null;
  /**
   * Stamped when the challenge is finally spent. Once set, it can never be
   * used again.
   */
  consumedAt: Date | null;
  expiresAt: Date;
  /** Database-managed; always present on a row that was read back. */
  createdAt: Date;
}

export type IOtpChallengeCreate = Omit<
  IOtpChallenge,
  "id" | "attempts" | "verifiedAt" | "consumedAt" | "createdAt"
>;
