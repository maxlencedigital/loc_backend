import http from "http";
import { AddressInfo } from "net";
import crypto from "crypto";
import bcrypt from "bcrypt";
import express from "express";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "t".repeat(40);
process.env.TWO_FACTOR_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.OTP_DELIVERY = "response";

// Real router, guards, controllers and services; only the data layer is an in-memory fake.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({
  prisma: { $queryRaw: jest.fn(), user: {}, otpChallenge: {}, activityLog: {} },
}));
jest.mock("../Queries/RefreshToken.Query.js", () => ({
  RefreshTokenQuery: require("../Testing/P13.Fakes").fakes.refreshTokenQuery,
}));
jest.mock("../Queries/User.Query.js", () => ({ UserQuery: require("../Testing/P13.Fakes").fakes.userQuery }));
jest.mock("../Queries/TwoFactor.Query.js", () => ({
  TwoFactorQuery: require("../Testing/P13.Fakes").fakes.twoFactorQuery,
}));
jest.mock("../Queries/UserToken.Query.js", () => ({
  UserTokenQuery: require("../Testing/P13.Fakes").fakes.userTokenQuery,
}));
jest.mock("../Queries/OtpChallenge.Query.js", () => ({
  OtpChallengeQuery: require("../Testing/P13.Fakes").fakes.otpChallengeQuery,
}));
jest.mock("./../Services/OtpSender.Service.js", () => ({
  OtpSender: { sendSms: jest.fn(), sendEmail: jest.fn(), sendLinkEmail: jest.fn() },
}));
jest.mock("../Services/Password.js", () => ({ ...jest.requireActual("../Services/Password.js"), SALT_ROUNDS: 4 }));

import router from "./Gateway.Routes.js";
import { fakes, addUser } from "../Testing/P13.Fakes.js";
import { decryptSecret } from "../Services/TwoFactorCrypto.js";
import { currentStep, hotp } from "../Services/Totp.js";

const PASSWORD = "Correct-Horse-9";
const STORE_A = "11111111-1111-4111-8111-111111111101";
const STORE_B = "11111111-1111-4111-8111-111111111102";

let server: http.Server;
let base: string;
let errorSpy: jest.SpyInstance;

beforeAll(async () => {
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const app = express();
  app.use(express.json());
  app.use("/", router);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  errorSpy.mockRestore();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => fakes.reset());

const tokenFor = (user: Record<string, any>) =>
  jwt.sign({ userId: user.id, role: user.role, storeId: user.storeId }, process.env.JWT_SECRET as string, {
    algorithm: "HS256",
    expiresIn: "5m",
  });
const call = async (method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, body: (await res.json()) as any, headers: res.headers };
};
const withPassword = (overrides: Record<string, unknown> = {}) =>
  addUser({ passwordHash: bcrypt.hashSync(PASSWORD, 4), ...overrides });
const codeFor = (userId: string, steps = 0) =>
  hotp(decryptSecret(fakes.credentials.get(userId)!.secretEnc, userId), currentStep(Date.now()) + steps);

describe("two-factor over HTTP: enrol, then sign in in two steps", () => {
  it("enable -> verify -> login returns a challenge -> verify with the challenge returns the session", async () => {
    const admin = withPassword({ role: "admin" });
    const token = tokenFor(admin);

    const enable = await call("POST", "/auth/2fa/enable", { token });
    expect(enable.status).toBe(200);
    expect(enable.headers.get("cache-control")).toBe("no-store");
    expect(enable.body.result.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);

    const confirm = await call("POST", "/auth/2fa/verify", { token, body: { code: codeFor(admin.id) } });
    expect(confirm.status).toBe(200);
    expect(confirm.body.result).toMatchObject({ enabled: true });
    expect(confirm.body.result.recoveryCodes).toHaveLength(10);
    expect(confirm.headers.get("cache-control")).toBe("no-store");

    const login = await call("POST", "/auth/login", { body: { email: admin.email, password: PASSWORD } });
    expect(login.status).toBe(200);
    expect(login.body.result.twoFactorRequired).toBe(true);
    expect(login.body.result.token).toBeUndefined();

    const finish = await call("POST", "/auth/2fa/verify", {
      body: {
        challengeId: login.body.result.challengeId,
        challengeToken: login.body.result.challengeToken,
        code: confirm.body.result.recoveryCodes[0],
      },
    });
    expect(finish.status).toBe(200);
    expect(finish.body.result).toMatchObject({ user: { id: admin.id } });
    expect(finish.body.result.token).toEqual(expect.any(String));
    expect(finish.body.result.refreshToken).toEqual(expect.any(String));

    const me = await call("GET", "/auth/me", { token: finish.body.result.token });
    expect(me.body.result.twoFactorEnabled).toBe(true);
  });

  it("login for an account without two-factor keeps the old response shape", async () => {
    const manager = withPassword({ role: "manager", storeId: STORE_A });

    const login = await call("POST", "/auth/login", { body: { email: manager.email, password: PASSWORD } });

    expect(Object.keys(login.body.result).sort()).toEqual(["expiresIn", "refreshToken", "token", "user"]);
  });

  it("the shared verify route needs a token or a challenge: anonymous with only a code is 401", async () => {
    const anonymous = await call("POST", "/auth/2fa/verify", { body: { code: "123456" } });
    const garbageToken = await call("POST", "/auth/2fa/verify", { token: "garbage", body: { code: "123456" } });
    const noCode = await call("POST", "/auth/2fa/verify", { body: {} });

    expect(anonymous.status).toBe(401);
    expect(garbageToken.status).toBe(401);
    expect(noCode.status).toBe(400);
  });

  it("a signed-in caller who is not allowed (staff, customer, super_admin) gets 403 on every 2FA route", async () => {
    for (const role of ["staff", "customer", "super_admin"]) {
      const user = addUser({ role });
      const token = tokenFor(user);

      expect((await call("POST", "/auth/2fa/enable", { token })).status).toBe(403);
      expect((await call("POST", "/auth/2fa/verify", { token, body: { code: "123456" } })).status).toBe(403);
    }
    const staff = addUser({ role: "staff" });
    expect((await call("POST", "/auth/2fa/disable", { token: tokenFor(staff), body: { code: "123456" } })).status).toBe(403);
  });

  it("disable with a code turns it off and sign-in is single-step again", async () => {
    const hr = withPassword({ role: "hr" });
    const token = tokenFor(hr);
    await call("POST", "/auth/2fa/enable", { token });
    await call("POST", "/auth/2fa/verify", { token, body: { code: codeFor(hr.id) } });

    const wrong = await call("POST", "/auth/2fa/disable", { token, body: { code: "000000" } });
    expect(wrong.status).toBe(400);
    const off = await call("POST", "/auth/2fa/disable", { token, body: { code: codeFor(hr.id, 1) } });
    expect(off.status).toBe(200);

    const login = await call("POST", "/auth/login", { body: { email: hr.email, password: PASSWORD } });
    expect(login.body.result.token).toBeDefined();
  });

  it("answers 503 on the 2FA routes when the server has no key, and enrolled accounts cannot sign in", async () => {
    const admin = withPassword({ role: "admin" });
    const token = tokenFor(admin);
    await call("POST", "/auth/2fa/enable", { token });
    await call("POST", "/auth/2fa/verify", { token, body: { code: codeFor(admin.id) } });
    const saved = process.env.TWO_FACTOR_ENCRYPTION_KEY;
    delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
    try {
      expect((await call("POST", "/auth/2fa/enable", { token: tokenFor(withPassword({ role: "manager" })) })).status).toBe(503);
      const login = await call("POST", "/auth/login", { body: { email: admin.email, password: PASSWORD } });
      expect(login.status).toBe(503);
      expect(login.body.result).toBeNull();
    } finally {
      process.env.TWO_FACTOR_ENCRYPTION_KEY = saved;
    }
  });
});

describe("password change over HTTP", () => {
  it("keeps the caller's session, ends the others, and the dashboard can keep refreshing", async () => {
    const user = withPassword({ role: "staff", storeId: STORE_A });
    const first = (await call("POST", "/auth/login", { body: { email: user.email, password: PASSWORD } })).body.result;
    const second = (await call("POST", "/auth/login", { body: { email: user.email, password: PASSWORD } })).body.result;

    const change = await call("POST", "/auth/password/change", {
      token: first.token,
      body: { currentPassword: PASSWORD, newPassword: "Brand-New-Pass-7", refreshToken: first.refreshToken },
    });

    expect(change.status).toBe(200);
    expect(change.body.result.currentSessionKept).toBe(true);
    expect((await call("POST", "/auth/refresh", { body: { refreshToken: first.refreshToken } })).status).toBe(200);
    expect((await call("POST", "/auth/refresh", { body: { refreshToken: second.refreshToken } })).status).toBe(401);
    expect((await call("POST", "/auth/login", { body: { email: user.email, password: PASSWORD } })).status).toBe(401);
    expect((await call("POST", "/auth/login", { body: { email: user.email, password: "Brand-New-Pass-7" } })).status).toBe(200);
  });

  it("a wrong current password is 400 (not 401), and a missing field is 400", async () => {
    const user = withPassword({ role: "customer" });
    const token = tokenFor(user);

    const wrong = await call("POST", "/auth/password/change", { token, body: { currentPassword: "nope-nope-1", newPassword: "Brand-New-Pass-7" } });
    const missing = await call("POST", "/auth/password/change", { token, body: { newPassword: "Brand-New-Pass-7" } });

    expect(wrong.status).toBe(400);
    expect(missing.status).toBe(400);
  });
});

describe("profile over HTTP", () => {
  it("PATCH /auth/me changes the name only and refuses an email change", async () => {
    const user = withPassword({ role: "driver" });
    const token = tokenFor(user);

    const ok = await call("PATCH", "/auth/me", { token, body: { name: "New Name" } });
    const email = await call("PATCH", "/auth/me", { token, body: { name: "New Name", email: "x@y.test" } });

    expect(ok.status).toBe(200);
    expect(ok.body.result.name).toBe("New Name");
    expect(email.status).toBe(400);
    expect(fakes.users.get(user.id)!.email).toBe(user.email);
  });

  it("phone change over HTTP: send, verify, and the number is saved and verified", async () => {
    const user = withPassword({ role: "customer" });
    const token = tokenFor(user);

    const sent = await call("POST", "/auth/me/phone/send-otp", { token, body: { phoneNumber: "+919800011122" } });
    expect(sent.status).toBe(200);
    const done = await call("POST", "/auth/me/phone/verify-otp", {
      token,
      body: { verificationId: sent.body.result.verificationId, otp: sent.body.result.otp },
    });

    expect(done.status).toBe(200);
    expect(done.body.result.phone).toBe("+919800011122");
    expect(fakes.users.get(user.id)!.isPhoneVerified).toBe(true);
  });
});

describe("invite and reset over HTTP", () => {
  it("admin resends an invite (integration mode returns the token), the person accepts it, and signs in with the new password", async () => {
    const admin = addUser({ role: "admin" });
    const invitee = withPassword({ role: "staff", storeId: STORE_A });

    const sent = await call("POST", `/users/${invitee.id}/invite/resend`, { token: tokenFor(admin) });
    expect(sent.status).toBe(200);
    const accept = await call("POST", "/auth/invite/accept", { body: { inviteToken: sent.body.result.inviteToken, newPassword: "My-Own-Password-1" } });
    const again = await call("POST", "/auth/invite/accept", { body: { inviteToken: sent.body.result.inviteToken, newPassword: "My-Own-Password-2" } });

    expect(accept.status).toBe(200);
    expect(again.status).toBe(410);
    expect((await call("POST", "/auth/login", { body: { email: invitee.email, password: "My-Own-Password-1" } })).status).toBe(200);
  });

  it("admin reset-password returns no password, and the reset link works once", async () => {
    const admin = addUser({ role: "admin" });
    const target = withPassword({ role: "manager", lastLoginAt: new Date() });

    const sent = await call("POST", `/users/${target.id}/reset-password`, { token: tokenFor(admin) });

    expect(sent.status).toBe(200);
    expect(JSON.stringify(sent.body)).not.toMatch(/temporaryPassword/);
    const accept = await call("POST", "/auth/invite/accept", { body: { inviteToken: sent.body.result.resetToken, newPassword: "Fresh-Start-Pass-3" } });
    expect(accept.status).toBe(200);
  });

  it("only admin may send them: manager, staff and customer get 403", async () => {
    const target = addUser({ role: "staff" });
    for (const role of ["manager", "staff", "customer", "hr"]) {
      const caller = addUser({ role });
      expect((await call("POST", `/users/${target.id}/invite/resend`, { token: tokenFor(caller) })).status).toBe(403);
      expect((await call("POST", `/users/${target.id}/reset-password`, { token: tokenFor(caller) })).status).toBe(403);
    }
  });

  it("an unknown user is 404", async () => {
    const admin = addUser({ role: "admin" });

    expect((await call("POST", "/users/00000000-0000-4000-8000-00000000ffff/invite/resend", { token: tokenFor(admin) })).status).toBe(404);
    expect((await call("POST", "/users/00000000-0000-4000-8000-00000000ffff/reset-password", { token: tokenFor(admin) })).status).toBe(404);
  });
});

describe("team routes over HTTP", () => {
  it("GET /users/roles is not swallowed by /users/:id and shows the caller's assignable roles", async () => {
    const root = addUser({ role: "super_admin" });
    const admin = addUser({ role: "admin" });

    const forRoot = await call("GET", "/users/roles", { token: tokenFor(root) });
    const forAdmin = await call("GET", "/users/roles", { token: tokenFor(admin) });

    expect(forRoot.body.result.roles.map((r: any) => r.role)).toEqual(["admin", "manager", "staff"]);
    expect(forAdmin.body.result.roles.map((r: any) => r.role)).toEqual(["manager", "staff"]);
  });

  it("GET /users/roles and PUT /users/:id/stores are 403 for a manager", async () => {
    const manager = addUser({ role: "manager", storeId: STORE_A });
    const staff = addUser({ role: "staff", storeId: STORE_A });

    expect((await call("GET", "/users/roles", { token: tokenFor(manager) })).status).toBe(403);
    expect((await call("PUT", `/users/${staff.id}/stores`, { token: tokenFor(manager), body: { storeIds: [STORE_B] } })).status).toBe(403);
  });

  it("GET /users/:id: a manager reads their own store's team and gets 404 for another store; staff get 403", async () => {
    const manager = addUser({ role: "manager", storeId: STORE_A });
    const mine = addUser({ role: "staff", storeId: STORE_A });
    const theirs = addUser({ role: "staff", storeId: STORE_B });

    expect((await call("GET", `/users/${mine.id}`, { token: tokenFor(manager) })).status).toBe(200);
    expect((await call("GET", `/users/${theirs.id}`, { token: tokenFor(manager) })).status).toBe(404);
    expect((await call("GET", `/users/${mine.id}`, { token: tokenFor(mine) })).status).toBe(403);
    expect((await call("GET", `/users/${mine.id}`)).status).toBe(401);
  });

  it("PUT /users/:id/stores assigns the store, signs the user out, and 404s an unknown user", async () => {
    const admin = addUser({ role: "admin" });
    const staff = withPassword({ role: "staff", storeId: STORE_A });
    const session = (await call("POST", "/auth/login", { body: { email: staff.email, password: PASSWORD } })).body.result;

    const put = await call("PUT", `/users/${staff.id}/stores`, { token: tokenFor(admin), body: { storeIds: [STORE_B] } });

    expect(put.status).toBe(200);
    expect(put.body.result.storeIds).toEqual([STORE_B]);
    expect((await call("POST", "/auth/refresh", { body: { refreshToken: session.refreshToken } })).status).toBe(401);
    const missing = await call("PUT", "/users/00000000-0000-4000-8000-00000000ffff/stores", { token: tokenFor(admin), body: { storeIds: [STORE_B] } });
    expect(missing.status).toBe(404);
    expect((await call("PUT", `/users/${staff.id}/stores`, { token: tokenFor(admin), body: {} })).status).toBe(400);
  });
});
