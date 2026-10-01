// In-memory stand-ins for the Query layer, used by the account / two-factor / invite tests. The
// services run for real on top of them. Each fake keeps the one property its rule depends on:
// every "spend" (step, recovery code, challenge, token, refresh token) is an atomic compare-and-set,
// and the unique phone index is simulated with the same error shape Prisma raises.
// Excluded from the build (tsconfig) and loaded only from test mocks.

import crypto from "crypto";

type Row = Record<string, any>;

const uniqueViolation = (field: string) =>
  Object.assign(new Error(`Unique constraint failed on ${field}`), { code: "P2002", meta: { target: [field] } });

const id = () => crypto.randomUUID();

// ------------------------------------------------------------------ users
const users = new Map<string, Row>();

export const makeUser = (overrides: Row = {}): Row => ({
  id: id(),
  name: "Meera Nair",
  email: `u${Math.random().toString(36).slice(2)}@loc.test`,
  passwordHash: null,
  phoneNumber: null,
  isPhoneVerified: false,
  oauthProvider: null,
  oauthSubject: null,
  role: "manager",
  isActive: true,
  storeId: null,
  lastLoginAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

export const addUser = (overrides: Row = {}): Row => {
  const user = makeUser(overrides);
  users.set(user.id, user);
  return user;
};

const userQuery = {
  findById: async (userId: string) => (users.has(userId) ? { ...users.get(userId)! } : null),
  findByEmail: async (email: string) => {
    const found = [...users.values()].find((u) => u.email === email.toLowerCase().trim());
    return found ? { ...found } : null;
  },
  findByPhoneNumber: async (phone: string) => {
    const found = [...users.values()].find((u) => u.phoneNumber === phone.trim());
    return found ? { ...found } : null;
  },
  findManyByIds: jest.fn(async (ids: string[]) => ids.filter((x) => users.has(x)).map((x) => ({ ...users.get(x)! }))),
  recordLogin: async (userId: string) => {
    users.get(userId)!.lastLoginAt = new Date();
    return { ...users.get(userId)! };
  },
  setPassword: async (userId: string, passwordHash: string) => {
    users.get(userId)!.passwordHash = passwordHash;
  },
  updateProfile: async (userId: string, patch: Row) => {
    if (patch.phoneNumber && [...users.values()].some((u) => u.id !== userId && u.phoneNumber === patch.phoneNumber)) {
      throw uniqueViolation("phoneNumber");
    }
    Object.assign(users.get(userId)!, patch);
    return { ...users.get(userId)! };
  },
  setVerifiedPhone: async (userId: string, phoneNumber: string) => {
    if ([...users.values()].some((u) => u.id !== userId && u.phoneNumber === phoneNumber)) {
      throw uniqueViolation("phoneNumber");
    }
    Object.assign(users.get(userId)!, { phoneNumber, isPhoneVerified: true });
    return { ...users.get(userId)! };
  },
  setActive: async (userId: string, isActive: boolean) => {
    users.get(userId)!.isActive = isActive;
    return { ...users.get(userId)! };
  },
  countActiveByRole: async (role: string) => [...users.values()].filter((u) => u.role === role && u.isActive).length,
  search: async () => [...users.values()],
};

// ------------------------------------------------------------------ two-factor
const credentials = new Map<string, Row>();
const recoveryCodes = new Map<string, Row>();
const challenges = new Map<string, Row>();

const twoFactorQuery = {
  findCredential: async (userId: string) => (credentials.has(userId) ? { ...credentials.get(userId)! } : null),
  replacePending: async (userId: string, secretEnc: string) => {
    const existing = credentials.get(userId);
    if (existing?.enabledAt) throw uniqueViolation("userId");
    credentials.set(userId, {
      id: id(),
      userId,
      secretEnc,
      enabledAt: null,
      lastUsedStep: 0,
      failedAttempts: 0,
      lockedUntil: null,
    });
  },
  activate: async (userId: string, step: number, hashes: string[]) => {
    const row = credentials.get(userId);
    if (!row || row.enabledAt) return false;
    Object.assign(row, { enabledAt: new Date(), lastUsedStep: step, failedAttempts: 0, lockedUntil: null });
    for (const [key, code] of recoveryCodes) if (code.userId === userId) recoveryCodes.delete(key);
    for (const codeHash of hashes) {
      const code = { id: id(), userId, codeHash, usedAt: null };
      recoveryCodes.set(code.id, code);
    }
    return true;
  },
  remove: async (userId: string) => {
    credentials.delete(userId);
    for (const [key, code] of recoveryCodes) if (code.userId === userId) recoveryCodes.delete(key);
    for (const [key, ch] of challenges) if (ch.userId === userId) challenges.delete(key);
  },
  advanceStep: async (userId: string, step: number) => {
    const row = credentials.get(userId);
    if (!row || !row.enabledAt || row.lastUsedStep >= step) return false;
    row.lastUsedStep = step;
    return true;
  },
  recordFailure: async (userId: string, max: number, lockUntil: Date) => {
    const row = credentials.get(userId)!;
    row.failedAttempts += 1;
    if (row.failedAttempts < max) return max - row.failedAttempts;
    Object.assign(row, { failedAttempts: 0, lockedUntil: lockUntil });
    return 0;
  },
  resetFailures: async (userId: string) => {
    const row = credentials.get(userId);
    if (row) Object.assign(row, { failedAttempts: 0, lockedUntil: null });
  },
  listUnusedRecoveryCodes: async (userId: string) =>
    [...recoveryCodes.values()].filter((c) => c.userId === userId && !c.usedAt).map((c) => ({ ...c })),
  claimRecoveryCode: async (codeId: string) => {
    const code = recoveryCodes.get(codeId);
    if (!code || code.usedAt) return false;
    code.usedAt = new Date();
    return true;
  },
  createChallenge: async (userId: string, expiresAt: Date) => {
    const challenge = { id: id(), userId, expiresAt, consumedAt: null };
    challenges.set(challenge.id, challenge);
    return { ...challenge };
  },
  findChallenge: async (challengeId: string) => (challenges.has(challengeId) ? { ...challenges.get(challengeId)! } : null),
  consumeChallenge: async (challengeId: string, now: Date) => {
    const ch = challenges.get(challengeId);
    if (!ch || ch.consumedAt || ch.expiresAt <= now) return false;
    ch.consumedAt = now;
    return true;
  },
  purgeChallenges: async () => 0,
};

// ------------------------------------------------------------------ user tokens (invite / reset)
const tokens = new Map<string, Row>();

const userTokenQuery = {
  inTransaction: async (work: (tx: object) => Promise<unknown>) => work({}),
  create: async (data: Row) => {
    const row = { id: id(), createdAt: new Date(), consumedAt: null, ...data };
    tokens.set(row.id, row);
    return { ...row };
  },
  findByHash: async (hash: string) => {
    const found = [...tokens.values()].find((t) => t.tokenHash === hash);
    return found ? { ...found } : null;
  },
  findLatest: async (userId: string, purpose: string) => {
    const mine = [...tokens.values()].filter((t) => t.userId === userId && t.purpose === purpose);
    mine.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return mine[0] ? { ...mine[0] } : null;
  },
  consume: async (tokenId: string, now: Date) => {
    const row = tokens.get(tokenId);
    if (!row || row.consumedAt || row.expiresAt <= now) return false;
    row.consumedAt = now;
    return true;
  },
  invalidateOutstanding: async (userId: string, purpose?: string) => {
    for (const row of tokens.values()) {
      if (row.userId === userId && !row.consumedAt && (!purpose || row.purpose === purpose)) row.consumedAt = new Date();
    }
  },
  purgeExpired: async () => 0,
};

// ------------------------------------------------------------------ refresh tokens
const refresh = new Map<string, Row>();

const refreshTokenQuery = {
  inTransaction: async (work: (tx: object) => Promise<unknown>) => work({}),
  create: async (data: Row) => {
    const row = { id: id(), createdAt: new Date(), revokedAt: null, revokedReason: null, ...data };
    refresh.set(row.id, row);
    return { ...row };
  },
  findByHash: async (hash: string) => {
    const found = [...refresh.values()].find((r) => r.tokenHash === hash);
    return found ? { ...found } : null;
  },
  claimForRotation: async (rowId: string) => {
    const row = refresh.get(rowId);
    if (!row || row.revokedAt) return false;
    Object.assign(row, { revokedAt: new Date(), revokedReason: "rotated" });
    return true;
  },
  revokeFamily: async (familyId: string, reason: string) => {
    for (const r of refresh.values()) if (r.familyId === familyId && !r.revokedAt) Object.assign(r, { revokedAt: new Date(), revokedReason: reason });
  },
  revokeAllForUser: async (userId: string, reason: string) => {
    for (const r of refresh.values()) if (r.userId === userId && !r.revokedAt) Object.assign(r, { revokedAt: new Date(), revokedReason: reason });
  },
  revokeAllForUserExceptFamily: async (userId: string, familyId: string, reason: string) => {
    for (const r of refresh.values()) {
      if (r.userId === userId && r.familyId !== familyId && !r.revokedAt) Object.assign(r, { revokedAt: new Date(), revokedReason: reason });
    }
  },
  purgeExpired: async () => 0,
};

// ------------------------------------------------------------------ otp challenges (phone change)
const otps = new Map<string, Row>();

const otpChallengeQuery = {
  create: async (data: Row) => {
    const row = { id: id(), attempts: 0, verifiedAt: null, consumedAt: null, createdAt: new Date(), ...data };
    otps.set(row.id, row);
    return { ...row };
  },
  findById: async (otpId: string) => (otps.has(otpId) ? { ...otps.get(otpId)! } : null),
  recordAttempt: async (otpId: string) => {
    otps.get(otpId)!.attempts += 1;
  },
  markVerified: async (otpId: string, expiresAt: Date) => {
    Object.assign(otps.get(otpId)!, { verifiedAt: new Date(), expiresAt });
  },
  markConsumed: async (otpId: string) => {
    otps.get(otpId)!.consumedAt = new Date();
  },
  countRecentFor: async (destination: string, purpose: string, since: Date) =>
    [...otps.values()].filter((o) => o.destination === destination && o.purpose === purpose && o.createdAt >= since).length,
  findLatestFor: async (destination: string, purpose: string) => {
    const mine = [...otps.values()].filter((o) => o.destination === destination && o.purpose === purpose);
    mine.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return mine[0] ? { ...mine[0] } : null;
  },
  deleteExpiredBefore: async () => 0,
};

export const fakes = {
  users,
  credentials,
  recoveryCodes,
  challenges,
  tokens,
  refresh,
  otps,
  userQuery,
  twoFactorQuery,
  userTokenQuery,
  refreshTokenQuery,
  otpChallengeQuery,
  reset: () => {
    for (const store of [users, credentials, recoveryCodes, challenges, tokens, refresh, otps]) store.clear();
  },
};
