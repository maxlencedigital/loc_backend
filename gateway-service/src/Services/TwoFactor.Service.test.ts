import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { CustomException } from "../../commons/Exception/CustomException.js";

process.env.JWT_SECRET = "j".repeat(40);

jest.mock("../Queries/RefreshToken.Query.js", () => ({
  RefreshTokenQuery: require("../Testing/P13.Fakes").fakes.refreshTokenQuery,
}));
jest.mock("../Queries/User.Query.js", () => ({ UserQuery: require("../Testing/P13.Fakes").fakes.userQuery }));
jest.mock("../Queries/TwoFactor.Query.js", () => ({
  TwoFactorQuery: require("../Testing/P13.Fakes").fakes.twoFactorQuery,
}));
jest.mock("../Queries/OtpChallenge.Query.js", () => ({
  OtpChallengeQuery: require("../Testing/P13.Fakes").fakes.otpChallengeQuery,
}));
jest.mock("./OtpSender.Service.js", () => ({ OtpSender: { sendSms: jest.fn(), sendEmail: jest.fn() } }));
jest.mock("./OAuth.Service.js", () => ({ OAuthService: { verify: jest.fn() } }));

import { TwoFactorService } from "./TwoFactor.Service.js";
import { AuthService } from "./Auth.Service.js";
import { decryptSecret } from "./TwoFactorCrypto.js";
import { currentStep, hotp } from "./Totp.js";
import { fakes, addUser } from "../Testing/P13.Fakes.js";

const PASSWORD = "Correct-Horse-9";
const KEY = crypto.randomBytes(32).toString("base64");
const T0 = Date.parse("2026-10-01T10:00:00Z");

// Only Date is frozen: bcrypt and promises keep running for real.
const clockAt = (ms: number) =>
  jest.useFakeTimers({
    now: ms,
    doNotFake: [
      "hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame",
      "requestIdleCallback", "cancelIdleCallback", "setImmediate", "clearImmediate", "setInterval",
      "clearInterval", "setTimeout", "clearTimeout",
    ],
  });

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a rejection");
};

const secretOf = (userId: string) => decryptSecret(fakes.credentials.get(userId)!.secretEnc, userId);
const codeNow = (userId: string, offsetSteps = 0) =>
  hotp(secretOf(userId), currentStep(Date.now()) + offsetSteps);

const newAdmin = (overrides: Record<string, unknown> = {}) =>
  addUser({ role: "admin", passwordHash: bcrypt.hashSync(PASSWORD, 4), ...overrides });
const actorOf = (user: Record<string, any>) => ({ id: user.id, role: user.role });

// Enrols a user completely and returns the recovery codes. Leaves the clock 30s later, so the code
// that proved enrolment (now spent) is not the one the next test needs.
const enrol = async (user: Record<string, any>) => {
  await TwoFactorService.enable(actorOf(user));
  const result = await TwoFactorService.confirm(actorOf(user), codeNow(user.id));
  jest.setSystemTime(Date.now() + 30_000);
  return result.recoveryCodes;
};

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  fakes.reset();
  process.env.TWO_FACTOR_ENCRYPTION_KEY = KEY;
  clockAt(T0);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  errorSpy.mockRestore();
  delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
});

describe("enrolment: enable then verify", () => {
  it("enable returns a secret and a provisioning URL, stores the secret only encrypted, and does not switch it on", async () => {
    const admin = newAdmin();

    const result = await TwoFactorService.enable(actorOf(admin));

    expect(result.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(result.otpauthUrl).toContain(`secret=${result.secret}`);
    const row = fakes.credentials.get(admin.id)!;
    expect(row.enabledAt).toBeNull();
    expect(JSON.stringify(row)).not.toContain(result.secret);
    expect(await TwoFactorService.isEnabled(admin.id)).toBe(false);
  });

  it("verify with a right first code switches it on and returns ten distinct recovery codes, stored hashed", async () => {
    const admin = newAdmin();
    await TwoFactorService.enable(actorOf(admin));

    const result = await TwoFactorService.confirm(actorOf(admin), codeNow(admin.id));

    expect(result.enabled).toBe(true);
    expect(result.recoveryCodes).toHaveLength(10);
    expect(new Set(result.recoveryCodes).size).toBe(10);
    expect(result.recoveryCodes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const stored = JSON.stringify([...fakes.recoveryCodes.values()]);
    for (const code of result.recoveryCodes) expect(stored).not.toContain(code.replace("-", ""));
    expect([...fakes.recoveryCodes.values()].every((row) => row.codeHash.startsWith("$2"))).toBe(true);
    expect(await TwoFactorService.isEnabled(admin.id)).toBe(true);
  });

  it("verify with a wrong code leaves it off and counts down the attempts", async () => {
    const admin = newAdmin();
    await TwoFactorService.enable(actorOf(admin));

    const error = await rejection(TwoFactorService.confirm(actorOf(admin), "000000"));

    expect(error.errorCode).toBe(400);
    expect(error.data).toEqual({ attemptsRemaining: 4 });
    expect(await TwoFactorService.isEnabled(admin.id)).toBe(false);
  });

  it("verify before enable is a clear 400, and verify after it is on is a 409", async () => {
    const admin = newAdmin();
    expect((await rejection(TwoFactorService.confirm(actorOf(admin), "123456"))).errorCode).toBe(400);

    await enrol(admin);
    expect((await rejection(TwoFactorService.confirm(actorOf(admin), codeNow(admin.id)))).errorCode).toBe(409);
  });

  it("enable when already on is a 409; enable again while only pending replaces the secret", async () => {
    const admin = newAdmin();
    await TwoFactorService.enable(actorOf(admin));
    const first = secretOf(admin.id);
    await TwoFactorService.enable(actorOf(admin));
    expect(secretOf(admin.id).equals(first)).toBe(false);

    await TwoFactorService.confirm(actorOf(admin), codeNow(admin.id));
    expect((await rejection(TwoFactorService.enable(actorOf(admin)))).errorCode).toBe(409);
  });

  it("is refused for super_admin (never challenged) and for roles outside admin, hr, manager", async () => {
    const root = addUser({ role: "super_admin" });
    const staff = addUser({ role: "staff" });
    const customer = addUser({ role: "customer" });

    for (const user of [root, staff, customer]) {
      expect((await rejection(TwoFactorService.enable(actorOf(user)))).errorCode).toBe(403);
      expect((await rejection(TwoFactorService.confirm(actorOf(user), "123456"))).errorCode).toBe(403);
    }
    for (const role of ["admin", "hr", "manager"]) {
      await expect(TwoFactorService.enable(actorOf(addUser({ role })))).resolves.toBeDefined();
    }
  });

  it("answers 503 and stores nothing when no encryption key is configured", async () => {
    const admin = newAdmin();
    delete process.env.TWO_FACTOR_ENCRYPTION_KEY;

    const error = await rejection(TwoFactorService.enable(actorOf(admin)));

    expect(error.errorCode).toBe(503);
    expect(fakes.credentials.size).toBe(0);
  });

  it("rejects a missing or non-string code", async () => {
    const admin = newAdmin();
    await TwoFactorService.enable(actorOf(admin));

    for (const code of [undefined, "", "   ", 123456, { a: 1 }, "x".repeat(40)]) {
      expect((await rejection(TwoFactorService.confirm(actorOf(admin), code))).errorCode).toBe(400);
    }
  });
});

describe("lockout and replay", () => {
  it("locks the credential after five wrong codes in a row, and a right code is refused while locked", async () => {
    const admin = newAdmin();
    await enrol(admin);

    for (let i = 0; i < 4; i++) {
      const error = await rejection(TwoFactorService.disable(actorOf(admin), "111111"));
      expect(error.errorCode).toBe(400);
    }
    const fifth = await rejection(TwoFactorService.disable(actorOf(admin), "111111"));
    expect(fifth.errorCode).toBe(429);

    const whileLocked = await rejection(TwoFactorService.disable(actorOf(admin), codeNow(admin.id)));
    expect(whileLocked.errorCode).toBe(429);
    expect(await TwoFactorService.isEnabled(admin.id)).toBe(true);

    jest.setSystemTime(Date.now() + 16 * 60 * 1000);
    await expect(TwoFactorService.disable(actorOf(admin), codeNow(admin.id))).resolves.toBeUndefined();
  });

  it("a right code resets the failure count", async () => {
    const admin = newAdmin();
    await enrol(admin);
    for (let i = 0; i < 3; i++) await rejection(TwoFactorService.disable(actorOf(admin), "111111"));
    expect(fakes.credentials.get(admin.id)!.failedAttempts).toBe(3);

    const challenge = (await AuthService.login(admin.email, PASSWORD)) as any;
    await TwoFactorService.completeLogin({ ...challenge, code: codeNow(admin.id) });

    expect(fakes.credentials.get(admin.id)!.failedAttempts).toBe(0);
  });

  it("refuses a TOTP code that was already used, even inside its 30 second window", async () => {
    const admin = newAdmin();
    await enrol(admin);
    const code = codeNow(admin.id);

    const first = (await AuthService.login(admin.email, PASSWORD)) as any;
    await TwoFactorService.completeLogin({ ...first, code });
    const second = (await AuthService.login(admin.email, PASSWORD)) as any;
    const replay = await rejection(TwoFactorService.completeLogin({ ...second, code }));

    expect(replay.errorCode).toBe(400);
  });

  it("refuses the code that proved enrolment when it is replayed for sign-in", async () => {
    const admin = newAdmin();
    await TwoFactorService.enable(actorOf(admin));
    const code = codeNow(admin.id);
    await TwoFactorService.confirm(actorOf(admin), code);

    const challenge = (await AuthService.login(admin.email, PASSWORD)) as any;
    const error = await rejection(TwoFactorService.completeLogin({ ...challenge, code }));

    expect(error.errorCode).toBe(400);
  });

  it("accepts an earlier-step code only if it is newer than the last one used, never an older one", async () => {
    const admin = newAdmin();
    await enrol(admin);
    const future = codeNow(admin.id, 1);
    const current = codeNow(admin.id, 0);

    const a = (await AuthService.login(admin.email, PASSWORD)) as any;
    await TwoFactorService.completeLogin({ ...a, code: future });
    const b = (await AuthService.login(admin.email, PASSWORD)) as any;

    expect((await rejection(TwoFactorService.completeLogin({ ...b, code: current }))).errorCode).toBe(400);
  });

  it("two simultaneous requests with the same code: exactly one signs in", async () => {
    const admin = newAdmin();
    await enrol(admin);
    const code = codeNow(admin.id);
    const a = (await AuthService.login(admin.email, PASSWORD)) as any;
    const b = (await AuthService.login(admin.email, PASSWORD)) as any;

    const results = await Promise.allSettled([
      TwoFactorService.completeLogin({ ...a, code }),
      TwoFactorService.completeLogin({ ...b, code }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("recovery codes", () => {
  it("sign in once and are then spent", async () => {
    const admin = newAdmin();
    const [recovery] = await enrol(admin);

    const first = (await AuthService.login(admin.email, PASSWORD)) as any;
    const session = await TwoFactorService.completeLogin({ ...first, code: recovery });
    const second = (await AuthService.login(admin.email, PASSWORD)) as any;
    const again = await rejection(TwoFactorService.completeLogin({ ...second, code: recovery }));

    expect(session.refreshToken).toBeDefined();
    expect(again.errorCode).toBe(400);
  });

  it("are accepted in lower case and without the dash", async () => {
    const admin = newAdmin();
    const [recovery] = await enrol(admin);

    const challenge = (await AuthService.login(admin.email, PASSWORD)) as any;
    const session = await TwoFactorService.completeLogin({
      ...challenge,
      code: ` ${recovery.replace("-", "").toLowerCase()} `,
    });

    expect(session.token).toBeDefined();
  });

  it("a code from another account does not work", async () => {
    const alice = newAdmin();
    const bob = newAdmin();
    const [aliceCode] = await enrol(alice);
    await enrol(bob);

    const challenge = (await AuthService.login(bob.email, PASSWORD)) as any;
    const error = await rejection(TwoFactorService.completeLogin({ ...challenge, code: aliceCode }));

    expect(error.errorCode).toBe(400);
  });

  it("turn two-factor off, like an authenticator code, and the credential and codes are gone", async () => {
    const admin = newAdmin();
    const [recovery] = await enrol(admin);

    await TwoFactorService.disable(actorOf(admin), recovery);

    expect(await TwoFactorService.isEnabled(admin.id)).toBe(false);
    expect(fakes.recoveryCodes.size).toBe(0);
    expect((await rejection(TwoFactorService.disable(actorOf(admin), recovery))).errorCode).toBe(400);
  });
});

describe("sign-in becomes two steps", () => {
  it("login without two-factor is unchanged: token, refresh token, user", async () => {
    const admin = newAdmin();

    const result = (await AuthService.login(admin.email, PASSWORD)) as any;

    expect(Object.keys(result).sort()).toEqual(["expiresIn", "refreshToken", "token", "user"]);
    expect(result.twoFactorRequired).toBeUndefined();
  });

  it("a pending (unconfirmed) enrolment does not gate sign-in", async () => {
    const admin = newAdmin();
    await TwoFactorService.enable(actorOf(admin));

    const result = (await AuthService.login(admin.email, PASSWORD)) as any;

    expect(result.token).toBeDefined();
  });

  it("with two-factor on, login returns only a challenge and issues no session", async () => {
    const admin = newAdmin();
    await enrol(admin);
    const sessionsBefore = fakes.refresh.size;

    const result = (await AuthService.login(admin.email, PASSWORD)) as any;

    expect(result).toEqual({
      twoFactorRequired: true,
      challengeId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      challengeToken: expect.any(String),
      expiresInSeconds: 300,
    });
    expect(fakes.refresh.size).toBe(sessionsBefore);
    expect(fakes.users.get(admin.id)!.lastLoginAt).toBeNull();
  });

  it("a wrong password never reaches the second step and gives the usual 401", async () => {
    const admin = newAdmin();
    await enrol(admin);

    const error = await rejection(AuthService.login(admin.email, "wrong-password"));

    expect(error.errorCode).toBe(401);
    expect(fakes.challenges.size).toBe(0);
  });

  it("verify with the challenge and a right code issues the session and records the login", async () => {
    const admin = newAdmin();
    await enrol(admin);
    const challenge = (await AuthService.login(admin.email, PASSWORD)) as any;

    const session = await TwoFactorService.completeLogin({ ...challenge, code: codeNow(admin.id) });

    const claims = jwt.verify(session.token, process.env.JWT_SECRET as string) as any;
    expect(claims).toMatchObject({ userId: admin.id, role: "admin" });
    expect(session.user).toMatchObject({ id: admin.id, email: admin.email });
    expect(fakes.users.get(admin.id)!.lastLoginAt).not.toBeNull();
  });

  it("a challenge works once: replaying the whole request after success fails", async () => {
    const admin = newAdmin();
    await enrol(admin);
    const challenge = (await AuthService.login(admin.email, PASSWORD)) as any;

    await TwoFactorService.completeLogin({ ...challenge, code: codeNow(admin.id) });
    jest.setSystemTime(Date.now() + 30_000);
    const replay = await rejection(TwoFactorService.completeLogin({ ...challenge, code: codeNow(admin.id) }));

    expect(replay.errorCode).toBe(401);
  });

  it("refuses a forged or tampered token, another challenge's token, and a mismatched challenge id", async () => {
    const admin = newAdmin();
    await enrol(admin);
    const challenge = (await AuthService.login(admin.email, PASSWORD)) as any;
    const code = codeNow(admin.id);
    const [payload, signature] = challenge.challengeToken.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), uid: "someone-else" })
    ).toString("base64url");
    const otherChallenge = (await AuthService.login(admin.email, PASSWORD)) as any;

    const cases: Array<Record<string, unknown>> = [
      { ...challenge, challengeToken: `${forgedPayload}.${signature}` },
      { ...challenge, challengeToken: `${payload}.${signature.slice(0, -2)}AA` },
      { ...challenge, challengeToken: otherChallenge.challengeToken },
      { ...challenge, challengeToken: "garbage" },
      { ...challenge, challengeToken: `${payload}.${signature}.x` },
      { ...challenge, challengeId: otherChallenge.challengeId },
    ];
    for (const input of cases) {
      expect((await rejection(TwoFactorService.completeLogin({ ...input, code }))).errorCode).toBe(401);
    }
    // The untouched challenge still works afterwards: none of the above burned it.
    await expect(TwoFactorService.completeLogin({ ...challenge, code })).resolves.toBeDefined();
  });

  it("a challenge token is not an access token, and an access token is not a challenge", async () => {
    const admin = newAdmin();
    await enrol(admin);
    const challenge = (await AuthService.login(admin.email, PASSWORD)) as any;

    expect(() => AuthService.verifyToken(challenge.challengeToken)).toThrow();
    const access = jwt.sign({ userId: admin.id, role: "admin" }, process.env.JWT_SECRET as string, { algorithm: "HS256" });
    const error = await rejection(
      TwoFactorService.completeLogin({ challengeId: challenge.challengeId, challengeToken: access, code: "123456" })
    );
    expect(error.errorCode).toBe(401);
  });

  it("the challenge expires after five minutes", async () => {
    const admin = newAdmin();
    await enrol(admin);
    const challenge = (await AuthService.login(admin.email, PASSWORD)) as any;

    jest.setSystemTime(Date.now() + 5 * 60 * 1000 + 1000);
    const error = await rejection(TwoFactorService.completeLogin({ ...challenge, code: codeNow(admin.id) }));

    expect(error.errorCode).toBe(401);
  });

  it("a deactivated account cannot finish a sign-in it started", async () => {
    const admin = newAdmin();
    await enrol(admin);
    const challenge = (await AuthService.login(admin.email, PASSWORD)) as any;
    fakes.users.get(admin.id)!.isActive = false;

    const error = await rejection(TwoFactorService.completeLogin({ ...challenge, code: codeNow(admin.id) }));

    expect(error.errorCode).toBe(401);
  });

  it("missing fields are a 400", async () => {
    for (const input of [{}, { challengeId: "x" }, { challengeId: "x", challengeToken: "y" }, { challengeToken: "y", code: "1" }]) {
      expect((await rejection(TwoFactorService.completeLogin(input))).errorCode).toBe(400);
    }
  });

  it("super_admin is never challenged, even with a leftover credential", async () => {
    const root = addUser({ role: "super_admin", passwordHash: bcrypt.hashSync(PASSWORD, 4) });
    fakes.credentials.set(root.id, {
      id: "c1", userId: root.id, secretEnc: "x", enabledAt: new Date(), lastUsedStep: 0, failedAttempts: 0, lockedUntil: null,
    });

    const result = (await AuthService.login(root.email, PASSWORD)) as any;

    expect(result.token).toBeDefined();
    expect(result.twoFactorRequired).toBeUndefined();
  });

  it("fails closed with 503 when an enrolled account signs in while the key is missing", async () => {
    const admin = newAdmin();
    await enrol(admin);
    delete process.env.TWO_FACTOR_ENCRYPTION_KEY;

    const error = await rejection(AuthService.login(admin.email, PASSWORD));

    expect(error.errorCode).toBe(503);
    expect(fakes.refresh.size).toBe(0);
  });

  it("also guards the other first factors: a phone-code sign-in for an enrolled account asks for the second", async () => {
    const admin = newAdmin({ phoneNumber: "+919876500001" });
    await enrol(admin);
    fakes.otps.set("otp-1", {
      id: "otp-1", purpose: "login", destination: admin.phoneNumber, otpHash: bcrypt.hashSync("123456", 4),
      userId: admin.id, attempts: 0, verifiedAt: null, consumedAt: null, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    });

    const result = (await AuthService.loginOtpVerify("otp-1", "123456")) as any;

    expect(result.twoFactorRequired).toBe(true);
    expect(result.token).toBeUndefined();
  });
});
