import crypto from "crypto";
import jwt from "jsonwebtoken";
import { CustomException } from "../../commons/Exception/CustomException.js";

process.env.JWT_SECRET = "s".repeat(40);

// Only the database is faked, in memory, keeping the one property rotation depends on:
// claimForRotation is an atomic compare-and-set.
jest.mock("../Queries/RefreshToken.Query.js", () => {
  const rows = new Map<string, any>();
  let seq = 0;
  return {
    __rows: rows,
    RefreshTokenQuery: {
      inTransaction: async (work: any) => work({}),
      create: async (data: any) => {
        const row = { id: `rt-${++seq}`, createdAt: new Date(), revokedAt: null, revokedReason: null, ...data };
        rows.set(row.id, row);
        return { ...row };
      },
      findByHash: async (hash: string) => {
        const row = [...rows.values()].find((r) => r.tokenHash === hash);
        return row ? { ...row } : null;
      },
      claimForRotation: async (id: string) => {
        const row = rows.get(id);
        if (!row || row.revokedAt) return false;
        row.revokedAt = new Date();
        row.revokedReason = "rotated";
        return true;
      },
      revokeFamily: async (familyId: string, reason: string) => {
        for (const r of rows.values()) if (r.familyId === familyId && !r.revokedAt) Object.assign(r, { revokedAt: new Date(), revokedReason: reason });
      },
      revokeAllForUser: async (userId: string, reason: string) => {
        for (const r of rows.values()) if (r.userId === userId && !r.revokedAt) Object.assign(r, { revokedAt: new Date(), revokedReason: reason });
      },
      purgeExpired: jest.fn().mockResolvedValue(0),
    },
  };
});
jest.mock("../Queries/User.Query.js", () => ({ UserQuery: { findById: jest.fn() } }));

import { SessionService } from "./Session.Service.js";
import { UserQuery } from "../Queries/User.Query.js";

const { __rows: rows } = jest.requireMock("../Queries/RefreshToken.Query.js");
const findById = UserQuery.findById as jest.Mock;

const STORE = "11111111-1111-4111-8111-111111111101";
const dbUser = (overrides: Record<string, unknown> = {}) => ({
  id: "user-1",
  name: "Meera Nair",
  email: "meera@loc.test",
  phoneNumber: "+919876500003",
  role: "manager",
  storeId: STORE,
  isActive: true,
  lastLoginAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});
const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const DAY = 24 * 60 * 60 * 1000;

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a rejection");
};
const rowFor = (raw: string) => [...rows.values()].find((r: any) => r.tokenHash === sha256(raw));
const signIn = async (user = dbUser()) => SessionService.issue(user as any);

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  rows.clear();
  findById.mockReset();
  findById.mockResolvedValue(dbUser());
  delete process.env.ACCESS_TOKEN_TTL_SECONDS;
  delete process.env.REFRESH_TOKEN_TTL_DAYS;
  delete process.env.SESSION_MAX_DAYS;
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  errorSpy.mockRestore();
  jest.useRealTimers();
});

describe("issue", () => {
  it("returns a 15 minute access token and an opaque refresh token", async () => {
    const session = await signIn();

    const claims = jwt.verify(session.token, process.env.JWT_SECRET as string) as any;
    expect(claims).toMatchObject({ userId: "user-1", role: "manager", storeId: STORE, name: "Meera Nair" });
    expect(claims.exp - claims.iat).toBe(900);
    expect(session.expiresIn).toBe(900);
    expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(() => jwt.decode(session.refreshToken, { complete: true })).not.toThrow();
    expect(jwt.decode(session.refreshToken)).toBeNull();
  });

  it("stores only the SHA-256 of the refresh token, never the token", async () => {
    const session = await signIn();

    const stored = JSON.stringify([...rows.values()]);
    expect(stored).not.toContain(session.refreshToken);
    expect(rowFor(session.refreshToken)).toBeDefined();
  });

  it("gives every sign-in its own family and a different token", async () => {
    const a = await signIn();
    const b = await signIn();

    expect(a.refreshToken).not.toBe(b.refreshToken);
    expect(rowFor(a.refreshToken).familyId).not.toBe(rowFor(b.refreshToken).familyId);
  });

  it("applies the 14 day sliding window and the 30 day absolute cap by default", async () => {
    const session = await signIn();
    const row = rowFor(session.refreshToken);

    expect(Math.round((row.expiresAt.getTime() - Date.now()) / DAY)).toBe(14);
    expect(Math.round((row.sessionExpiresAt.getTime() - Date.now()) / DAY)).toBe(30);
  });

  it("honours ACCESS_TOKEN_TTL_SECONDS but ignores an unsafe value", async () => {
    process.env.ACCESS_TOKEN_TTL_SECONDS = "300";
    expect((await signIn()).expiresIn).toBe(300);

    process.env.ACCESS_TOKEN_TTL_SECONDS = "5";
    expect((await signIn()).expiresIn).toBe(900);
  });
});

describe("refresh", () => {
  it("rotates: a new pair in the same family, the old token spent", async () => {
    const first = await signIn();

    const second = await SessionService.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(rowFor(first.refreshToken)).toMatchObject({ revokedReason: "rotated" });
    expect(rowFor(second.refreshToken).revokedAt).toBeNull();
    expect(rowFor(second.refreshToken).familyId).toBe(rowFor(first.refreshToken).familyId);
    expect(second.user).toMatchObject({ id: "user-1", role: "manager", storeId: STORE });
  });

  it("re-reads the user, so a role or store change applies at the next refresh", async () => {
    const first = await signIn();
    findById.mockResolvedValue(dbUser({ role: "admin", storeId: null }));

    const second = await SessionService.refresh(first.refreshToken);

    expect(jwt.decode(second.token)).toMatchObject({ role: "admin", storeId: null });
  });

  it("never extends a sign-in past its absolute cap", async () => {
    jest.useFakeTimers({ now: new Date("2026-06-01T00:00:00Z") });
    let session = await signIn();
    const cap = rowFor(session.refreshToken).sessionExpiresAt.getTime();

    for (let step = 0; step < 2; step++) {
      jest.setSystemTime(Date.now() + 12 * DAY);
      session = await SessionService.refresh(session.refreshToken);
    }

    const last = rowFor(session.refreshToken);
    expect(last.sessionExpiresAt.getTime()).toBe(cap);
    expect(last.expiresAt.getTime()).toBe(cap);
  });

  it("refuses a chain once the absolute cap has passed, even if it was used recently", async () => {
    jest.useFakeTimers({ now: new Date("2026-06-01T00:00:00Z") });
    let session = await signIn();
    for (let i = 0; i < 4; i++) {
      jest.setSystemTime(Date.now() + 9 * DAY);
      if (i < 3) session = await SessionService.refresh(session.refreshToken);
    }

    const error = await rejection(SessionService.refresh(session.refreshToken));

    expect(error.errorCode).toBe(401);
  });

  it("refuses an expired refresh token", async () => {
    jest.useFakeTimers({ now: new Date("2026-06-01T00:00:00Z") });
    const session = await signIn();
    jest.setSystemTime(Date.now() + 15 * DAY);

    expect((await rejection(SessionService.refresh(session.refreshToken))).errorCode).toBe(401);
  });

  it.each([[undefined], [null], [""], [42], [{}], ["not-a-token"], ["x".repeat(500)]])("refuses %p", async (value) => {
    const error = await rejection(SessionService.refresh(value));

    expect(error).toBeInstanceOf(CustomException);
    expect(error.errorCode).toBe(401);
  });

  it("does not reveal whether a token was unknown, expired or revoked", async () => {
    const live = await signIn();
    await SessionService.logout("user-1", live.refreshToken, false);

    const unknown = await rejection(SessionService.refresh("nope"));
    const revoked = await rejection(SessionService.refresh(live.refreshToken));

    expect(revoked.displayMessage).toBe(unknown.displayMessage);
  });

  it("ends the session when the account has been deactivated", async () => {
    const session = await signIn();
    findById.mockResolvedValue(dbUser({ isActive: false }));

    expect((await rejection(SessionService.refresh(session.refreshToken))).errorCode).toBe(401);
    expect(rowFor(session.refreshToken)).toMatchObject({ revokedReason: "deactivated" });
  });

  it("ends the session when the account no longer exists", async () => {
    const session = await signIn();
    findById.mockResolvedValue(null);

    expect((await rejection(SessionService.refresh(session.refreshToken))).errorCode).toBe(401);
  });
});

describe("reuse detection", () => {
  it("revokes the whole family when a spent token is replayed after the grace window", async () => {
    jest.useFakeTimers({ now: new Date("2026-06-01T00:00:00Z") });
    const first = await signIn();
    const second = await SessionService.refresh(first.refreshToken);
    jest.setSystemTime(Date.now() + 60_000);

    const error = await rejection(SessionService.refresh(first.refreshToken));

    expect(error.errorCode).toBe(401);
    expect(error.data).toBeNull();
    expect(rowFor(second.refreshToken)).toMatchObject({ revokedReason: "reuse_detected" });
    expect((await rejection(SessionService.refresh(second.refreshToken))).errorCode).toBe(401);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("reuse detected"));
  });

  it("does not leak the token into the log", async () => {
    jest.useFakeTimers({ now: new Date("2026-06-01T00:00:00Z") });
    const first = await signIn();
    await SessionService.refresh(first.refreshToken);
    jest.setSystemTime(Date.now() + 60_000);

    await rejection(SessionService.refresh(first.refreshToken));

    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(first.refreshToken);
  });

  it("only flags a retry, and keeps the family alive, inside the grace window", async () => {
    const first = await signIn();
    const second = await SessionService.refresh(first.refreshToken);

    const error = await rejection(SessionService.refresh(first.refreshToken));

    expect(error.errorCode).toBe(401);
    expect(error.data).toEqual({ retry: true });
    expect(rowFor(second.refreshToken).revokedAt).toBeNull();
  });

  it("lets exactly one of two simultaneous refreshes win", async () => {
    const session = await signIn();

    const results = await Promise.allSettled([
      SessionService.refresh(session.refreshToken),
      SessionService.refresh(session.refreshToken),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((lost.reason as CustomException).data).toEqual({ retry: true });
    const live = [...rows.values()].filter((r: any) => !r.revokedAt);
    expect(live).toHaveLength(1);
  });
});

describe("logout and revocation", () => {
  it("revokes the signed-in session's whole family and leaves other sign-ins alone", async () => {
    const phone = await signIn();
    const laptop = await signIn();
    const rotated = await SessionService.refresh(phone.refreshToken);

    await SessionService.logout("user-1", rotated.refreshToken, false);

    expect((await rejection(SessionService.refresh(rotated.refreshToken))).errorCode).toBe(401);
    expect(rowFor(laptop.refreshToken).revokedAt).toBeNull();
  });

  it("revokes every sign-in with allDevices", async () => {
    const a = await signIn();
    const b = await signIn();

    await SessionService.logout("user-1", undefined, true);

    expect(rowFor(a.refreshToken).revokedAt).not.toBeNull();
    expect(rowFor(b.refreshToken).revokedAt).not.toBeNull();
  });

  it("ignores a refresh token that belongs to another user", async () => {
    const victim = await signIn(dbUser({ id: "user-2" }));

    await SessionService.logout("user-1", victim.refreshToken, false);

    expect(rowFor(victim.refreshToken).revokedAt).toBeNull();
  });

  it("is idempotent and quiet for an unknown or missing token", async () => {
    await expect(SessionService.logout("user-1", "unknown", false)).resolves.toBeUndefined();
    await expect(SessionService.logout("user-1", undefined, false)).resolves.toBeUndefined();
  });

  it("revokeAllFor ends every sign-in, recording why", async () => {
    const a = await signIn();
    await SessionService.refresh(a.refreshToken);
    const b = await signIn();

    await SessionService.revokeAllFor("user-1", "password_reset");

    expect(rowFor(b.refreshToken)).toMatchObject({ revokedReason: "password_reset" });
    expect([...rows.values()].every((r: any) => r.revokedAt)).toBe(true);
  });
});
