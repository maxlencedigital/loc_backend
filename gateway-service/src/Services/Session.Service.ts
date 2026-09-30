import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { unauthorized } from "../../commons/Utils/StatusCode.js";
import { Db, RefreshTokenQuery } from "../Queries/RefreshToken.Query.js";
import { UserQuery } from "../Queries/User.Query.js";
import { IRefreshToken, RevokeReason } from "../Models/RefreshToken/RefreshToken.Interface.js";
import { UserRole } from "../Models/User/User.Interface.js";
import { toDashboardUser } from "../Models/User/DashboardUser.js";
import { accessTtlSeconds, signAccessToken } from "./Token.js";

// A session is an access token (15 min, stateless) plus a refresh token: opaque,
// single-use and rotated on every refresh. Only the refresh token's SHA-256 is stored.

const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_BYTES = 32;
const MAX_REFRESH_TOKEN_LENGTH = 200;
// Two tabs refreshing together both hold the same old token; the loser is told to retry
// with the winner's token instead of being treated as a thief.
const ROTATION_GRACE_MS = 10_000;
const PURGE_EVERY_MS = 60 * 60 * 1000;

const positiveInt = (raw: string | undefined, fallback: number) => {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};
const refreshTtlMs = () => positiveInt(process.env.REFRESH_TOKEN_TTL_DAYS, 14) * DAY_MS;
const sessionMaxMs = () => positiveInt(process.env.SESSION_MAX_DAYS, 30) * DAY_MS;

interface SessionUser {
  id: string;
  name: string;
  role: UserRole;
  storeId: string | null;
}

const hashToken = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");
const newRawToken = () => crypto.randomBytes(REFRESH_BYTES).toString("base64url");

const invalidSession = (retry = false) =>
  new CustomException("Your session has expired. Please sign in again.", unauthorized, retry ? { retry: true } : undefined);

let lastPurgeAt = 0;
const purgeOccasionally = () => {
  const now = Date.now();
  if (now - lastPurgeAt < PURGE_EVERY_MS) return;
  lastPurgeAt = now;
  RefreshTokenQuery.purgeExpired(new Date(now - DAY_MS)).catch((error) =>
    console.error("[session] purging expired refresh tokens failed:", (error as Error).message)
  );
};

const mint = async (
  user: SessionUser,
  familyId: string,
  sessionExpiresAt: Date,
  tx?: Db
) => {
  const raw = newRawToken();
  const expiresAt = new Date(Math.min(Date.now() + refreshTtlMs(), sessionExpiresAt.getTime()));
  await RefreshTokenQuery.create(
    { userId: user.id, familyId, tokenHash: hashToken(raw), expiresAt, sessionExpiresAt },
    tx
  );
  return {
    token: signAccessToken(user),
    refreshToken: raw,
    expiresIn: accessTtlSeconds(),
  };
};

/** Starts a new sign-in: a fresh family, capped at SESSION_MAX_DAYS. */
const issue = async (user: SessionUser) => {
  try {
    purgeOccasionally();
    return await mint(user, crypto.randomUUID(), new Date(Date.now() + sessionMaxMs()));
  } catch (error) {
    throw toCustomException(error);
  }
};

const revokeStolenFamily = async (row: IRefreshToken) => {
  console.error(`[session] refresh token reuse detected for user ${row.userId}; family ${row.familyId} revoked.`);
  await RefreshTokenQuery.revokeFamily(row.familyId, "reuse_detected");
};

/** Trades a refresh token for a new access token and a new refresh token. */
const refresh = async (rawToken: unknown) => {
  try {
    if (typeof rawToken !== "string" || !rawToken || rawToken.length > MAX_REFRESH_TOKEN_LENGTH) {
      throw invalidSession();
    }
    const row = await RefreshTokenQuery.findByHash(hashToken(rawToken));
    if (!row) throw invalidSession();

    const now = Date.now();
    if (row.revokedAt) {
      if (row.revokedReason === "rotated") {
        if (now - row.revokedAt.getTime() <= ROTATION_GRACE_MS) throw invalidSession(true);
        await revokeStolenFamily(row);
      }
      throw invalidSession();
    }
    if (row.expiresAt.getTime() <= now || row.sessionExpiresAt.getTime() <= now) {
      throw invalidSession();
    }

    // The user is re-read every time, so a deactivation ends the session here and a
    // role or store change takes effect at the next refresh, not the next login.
    const user = await UserQuery.findById(row.userId);
    if (!user || !user.isActive) {
      await RefreshTokenQuery.revokeFamily(row.familyId, "deactivated");
      throw invalidSession();
    }

    const minted = await RefreshTokenQuery.inTransaction(async (tx) => {
      if (!(await RefreshTokenQuery.claimForRotation(row.id, tx))) return null;
      return await mint(user, row.familyId, row.sessionExpiresAt, tx);
    });
    if (!minted) throw invalidSession(true);

    return { ...minted, user: toDashboardUser(user) };
  } catch (error) {
    throw toCustomException(error);
  }
};

/** Ends one sign-in (by its refresh token) or every sign-in of the user. Idempotent. */
const logout = async (userId: string, rawToken: unknown, allDevices: boolean) => {
  try {
    if (allDevices) {
      await RefreshTokenQuery.revokeAllForUser(userId, "logout_all");
      return;
    }
    if (typeof rawToken !== "string" || !rawToken || rawToken.length > MAX_REFRESH_TOKEN_LENGTH) return;
    const row = await RefreshTokenQuery.findByHash(hashToken(rawToken));
    // A token belonging to someone else is ignored, never revoked on a stranger's say-so.
    if (row && row.userId === userId) await RefreshTokenQuery.revokeFamily(row.familyId, "logout");
  } catch (error) {
    throw toCustomException(error);
  }
};

const revokeAllFor = async (userId: string, reason: RevokeReason) => {
  try {
    await RefreshTokenQuery.revokeAllForUser(userId, reason);
  } catch (error) {
    throw toCustomException(error);
  }
};

export const SessionService = { issue, refresh, logout, revokeAllFor };
