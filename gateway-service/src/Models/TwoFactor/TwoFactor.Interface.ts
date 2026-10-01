export interface ITwoFactorCredential {
  id: string;
  userId: string;
  /** AES-256-GCM envelope of the TOTP secret; never the plain secret. */
  secretEnc: string;
  /** Null while enrolment is pending (secret issued, first code not yet proved). */
  enabledAt: Date | null;
  lastUsedStep: number;
  failedAttempts: number;
  lockedUntil: Date | null;
}

export interface ITwoFactorRecoveryCode {
  id: string;
  userId: string;
  codeHash: string;
}

export interface ITwoFactorChallenge {
  id: string;
  userId: string;
  expiresAt: Date;
  consumedAt: Date | null;
}
