import bcrypt from "bcrypt";
import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, conflict, forbidden, tooManyRequests, unauthorized } from "../../commons/Utils/StatusCode.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { TwoFactorQuery } from "../Queries/TwoFactor.Query.js";
import { UserQuery } from "../Queries/User.Query.js";
import { ITwoFactorCredential } from "../Models/TwoFactor/TwoFactor.Interface.js";
import { IUser, UserRole } from "../Models/User/User.Interface.js";
import { toDashboardUser } from "../Models/User/DashboardUser.js";
import { SessionService } from "./Session.Service.js";
import { getJwtSecret } from "./Token.js";
import { assertTwoFactorConfigured, decryptSecret, encryptSecret } from "./TwoFactorCrypto.js";
import { base32Encode, generateSecret, matchStep, otpauthUrl } from "./Totp.js";

// Authenticator-app second factor. Enrolment is two calls (enable returns the secret, verify
// proves the first code and returns the backup codes); once on, a password sign-in stops at a
// challenge that POST /auth/2fa/verify completes.

// The contract's roles. super_admin is deliberately outside it: it is never challenged, so a lost
// phone, a lost key or a lost recovery sheet cannot lock out the root account.
const TWO_FACTOR_ROLES: UserRole[] = ["admin", "hr", "manager"];

const CHALLENGE_TTL_SECONDS = 5 * 60;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;
// Backup codes carry about 50 bits, so a moderate cost is plenty and keeps a worst-case check
// (ten comparisons) well under a second.
const RECOVERY_HASH_ROUNDS = 10;
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_LENGTH = 10;
const MAX_CODE_LENGTH = 32;
const PURGE_EVERY_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const issuer = () => process.env.TWO_FACTOR_ISSUER?.trim() || "LOC";

const invalidCode = (attemptsRemaining?: number) =>
  new CustomException(
    "That code is invalid or has expired.",
    badRequest,
    attemptsRemaining === undefined ? undefined : { attemptsRemaining }
  );
const lockedOut = (until: Date) =>
  new CustomException(
    `Too many incorrect codes. Try again in ${Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000))} minute(s).`,
    tooManyRequests,
    { attemptsRemaining: 0 }
  );
const expiredSignIn = () => new CustomException("This sign-in has expired. Please sign in again.", unauthorized);

// ---------------- The signed challenge handed back after a correct password ----------------

// A separate HMAC key derived from JWT_SECRET: the token can never verify as an access token, and
// an access token can never verify as a challenge.
const challengeKey = () =>
  Buffer.from(crypto.hkdfSync("sha256", getJwtSecret(), Buffer.alloc(0), "gateway-service/2fa-challenge/v1", 32));

const sign = (payload: string) => crypto.createHmac("sha256", challengeKey()).update(payload).digest("base64url");

const signChallenge = (challengeId: string, userId: string, expiresAtMs: number): string => {
  const payload = Buffer.from(JSON.stringify({ cid: challengeId, uid: userId, exp: expiresAtMs })).toString("base64url");
  return `${payload}.${sign(payload)}`;
};

const readChallengeToken = (token: string): { cid: string; uid: string } | null => {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      cid?: unknown;
      uid?: unknown;
      exp?: unknown;
    };
    if (typeof claims.cid !== "string" || typeof claims.uid !== "string" || typeof claims.exp !== "number") return null;
    if (claims.exp <= Date.now()) return null;
    return { cid: claims.cid, uid: claims.uid };
  } catch {
    return null;
  }
};

let lastPurgeAt = 0;
const purgeOccasionally = () => {
  const now = Date.now();
  if (now - lastPurgeAt < PURGE_EVERY_MS) return;
  lastPurgeAt = now;
  TwoFactorQuery.purgeChallenges(new Date(now - DAY_MS)).catch((error) =>
    console.error("[two-factor] purging expired challenges failed:", (error as Error).message)
  );
};

// ------------------------------------ Codes ------------------------------------

const parseCode = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_CODE_LENGTH) {
    throw new CustomException("code is required.", badRequest);
  }
  return value.trim();
};

const newRecoveryCode = (): string =>
  Array.from({ length: RECOVERY_LENGTH }, () => RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)]).join("");
const formatRecoveryCode = (code: string) => `${code.slice(0, 5)}-${code.slice(5)}`;

// Whether the code is right, spending it if so: a TOTP code only for a later time-step than the
// last accepted one, a backup code only while unused. Both spends are compare-and-set in the database.
const codeMatches = async (
  userId: string,
  credential: ITwoFactorCredential,
  code: string,
  allowRecovery: boolean
): Promise<boolean> => {
  if (/^\d{6}$/.test(code)) {
    const step = matchStep(decryptSecret(credential.secretEnc, userId), code, Date.now());
    return step !== null && (await TwoFactorQuery.advanceStep(userId, step));
  }
  if (!allowRecovery) return false;
  const normalised = code.replace(/[\s-]/g, "").toUpperCase();
  if (!new RegExp(`^[${RECOVERY_ALPHABET}]{${RECOVERY_LENGTH}}$`).test(normalised)) return false;
  for (const row of await TwoFactorQuery.listUnusedRecoveryCodes(userId)) {
    if (await bcrypt.compare(normalised, row.codeHash)) return await TwoFactorQuery.claimRecoveryCode(row.id);
  }
  return false;
};

// Checks a code against an enabled credential with the lockout around it: five wrong codes in a
// row (across every flow) lock the credential for 15 minutes. Throws unless the code was good.
const checkEnabledCode = async (userId: string, credential: ITwoFactorCredential, rawCode: unknown) => {
  const code = parseCode(rawCode);
  if (credential.lockedUntil && credential.lockedUntil.getTime() > Date.now()) throw lockedOut(credential.lockedUntil);

  if (!(await codeMatches(userId, credential, code, true))) {
    const until = new Date(Date.now() + LOCK_MS);
    const remaining = await TwoFactorQuery.recordFailure(userId, MAX_FAILURES, until);
    throw remaining === 0 ? lockedOut(until) : invalidCode(remaining);
  }
  if (credential.failedAttempts > 0 || credential.lockedUntil) await TwoFactorQuery.resetFailures(userId);
};

// ---------------------------------- Enrolment ----------------------------------

const assertEligible = (role: UserRole) => {
  if (role === "super_admin") {
    throw new CustomException(
      "Two-factor sign-in is not used for super admin accounts, so the root account can never be locked out.",
      forbidden
    );
  }
  if (!TWO_FACTOR_ROLES.includes(role)) {
    throw new CustomException("You do not have permission to perform this action.", forbidden);
  }
};

const loadActiveUser = async (userId: string): Promise<IUser> => {
  const user = await UserQuery.findById(userId);
  if (!user || !user.isActive) throw new CustomException("Your account is no longer active.", unauthorized);
  return user;
};

/** Step 1: issues a new secret (pending until the first code is proved). Shown once. */
const enable = async (actor: { id: string; role: UserRole }) => {
  try {
    assertEligible(actor.role);
    assertTwoFactorConfigured();
    const user = await loadActiveUser(actor.id);
    const existing = await TwoFactorQuery.findCredential(user.id);
    if (existing?.enabledAt) throw new CustomException("Two-factor sign-in is already on. Turn it off first.", conflict);

    const secret = generateSecret();
    try {
      await TwoFactorQuery.replacePending(user.id, encryptSecret(secret, user.id));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new CustomException("Two-factor sign-in is already on. Turn it off first.", conflict);
      }
      throw error;
    }
    return { secret: base32Encode(secret), otpauthUrl: otpauthUrl(secret, user.email, issuer()) };
  } catch (error) {
    throw toCustomException(error);
  }
};

/** Step 2: proves the first code, switches it on and returns the single-use backup codes (once). */
const confirm = async (actor: { id: string; role: UserRole }, rawCode: unknown) => {
  try {
    assertEligible(actor.role);
    assertTwoFactorConfigured();
    const code = parseCode(rawCode);
    const credential = await TwoFactorQuery.findCredential(actor.id);
    if (!credential) throw new CustomException("Start with POST /auth/2fa/enable to get a secret.", badRequest);
    if (credential.enabledAt) throw new CustomException("Two-factor sign-in is already on.", conflict);
    if (credential.lockedUntil && credential.lockedUntil.getTime() > Date.now()) throw lockedOut(credential.lockedUntil);

    const step = /^\d{6}$/.test(code) ? matchStep(decryptSecret(credential.secretEnc, actor.id), code, Date.now()) : null;
    if (step === null) {
      const until = new Date(Date.now() + LOCK_MS);
      const remaining = await TwoFactorQuery.recordFailure(actor.id, MAX_FAILURES, until);
      throw remaining === 0 ? lockedOut(until) : invalidCode(remaining);
    }

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    const hashes = await Promise.all(recoveryCodes.map((value) => bcrypt.hash(value, RECOVERY_HASH_ROUNDS)));
    if (!(await TwoFactorQuery.activate(actor.id, step, hashes))) {
      throw new CustomException("Two-factor sign-in is already on.", conflict);
    }
    return { enabled: true, recoveryCodes: recoveryCodes.map(formatRecoveryCode) };
  } catch (error) {
    throw toCustomException(error);
  }
};

/** Turns it off. Needs a current authenticator code or an unused backup code. */
const disable = async (actor: { id: string }, rawCode: unknown) => {
  try {
    assertTwoFactorConfigured();
    const credential = await TwoFactorQuery.findCredential(actor.id);
    if (!credential?.enabledAt) throw new CustomException("Two-factor sign-in is not on.", badRequest);
    await checkEnabledCode(actor.id, credential, rawCode);
    await TwoFactorQuery.remove(actor.id);
  } catch (error) {
    throw toCustomException(error);
  }
};

const isEnabled = async (userId: string): Promise<boolean> => {
  try {
    return Boolean((await TwoFactorQuery.findCredential(userId))?.enabledAt);
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------ Sign-in ------------------------------------

export interface TwoFactorChallengeResponse {
  twoFactorRequired: true;
  challengeId: string;
  challengeToken: string;
  expiresInSeconds: number;
}

/**
 * Called once a first factor has succeeded. Null when the account has no second factor; otherwise
 * the challenge to answer, and no session exists yet. An enrolled account is never let in without
 * its key being available: failing closed beats silently skipping the check.
 */
const challengeIfRequired = async (user: IUser): Promise<TwoFactorChallengeResponse | null> => {
  try {
    if (user.role === "super_admin") return null;
    const credential = await TwoFactorQuery.findCredential(user.id);
    if (!credential?.enabledAt) return null;
    assertTwoFactorConfigured();

    purgeOccasionally();
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);
    const challenge = await TwoFactorQuery.createChallenge(user.id, expiresAt);
    return {
      twoFactorRequired: true,
      challengeId: challenge.id,
      challengeToken: signChallenge(challenge.id, user.id, expiresAt.getTime()),
      expiresInSeconds: CHALLENGE_TTL_SECONDS,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

/** Completes a sign-in: the challenge from the first step plus an authenticator or backup code. */
const completeLogin = async (input: { challengeId?: unknown; challengeToken?: unknown; code?: unknown }) => {
  try {
    const { challengeId, challengeToken } = input;
    if (typeof challengeId !== "string" || typeof challengeToken !== "string" || !challengeId || !challengeToken) {
      throw new CustomException("challengeId, challengeToken and code are required.", badRequest);
    }
    const code = parseCode(input.code);

    const claims = readChallengeToken(challengeToken);
    if (!claims || claims.cid !== challengeId) throw expiredSignIn();

    const challenge = await TwoFactorQuery.findChallenge(claims.cid);
    if (!challenge || challenge.userId !== claims.uid || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()) {
      throw expiredSignIn();
    }
    const user = await UserQuery.findById(challenge.userId);
    const credential = user?.isActive ? await TwoFactorQuery.findCredential(challenge.userId) : null;
    if (!user || !credential?.enabledAt) throw expiredSignIn();
    assertTwoFactorConfigured();

    await checkEnabledCode(user.id, credential, code);
    // Spent only after the code was right, and only once: a replay of the whole request loses here.
    if (!(await TwoFactorQuery.consumeChallenge(challenge.id, new Date()))) throw expiredSignIn();

    const loggedIn = await UserQuery.recordLogin(user.id);
    return { ...(await SessionService.issue(loggedIn)), user: toDashboardUser(loggedIn) };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const TwoFactorService = {
  enable,
  confirm,
  disable,
  isEnabled,
  challengeIfRequired,
  completeLogin,
  TWO_FACTOR_ROLES,
  CHALLENGE_TTL_SECONDS,
  MAX_FAILURES,
};
