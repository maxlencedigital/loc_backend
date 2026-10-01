import bcrypt from "bcrypt";
import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";

process.env.JWT_SECRET = "i".repeat(40);

jest.mock("../Queries/RefreshToken.Query.js", () => ({
  RefreshTokenQuery: require("../Testing/P13.Fakes").fakes.refreshTokenQuery,
}));
jest.mock("../Queries/User.Query.js", () => ({ UserQuery: require("../Testing/P13.Fakes").fakes.userQuery }));
jest.mock("../Queries/UserToken.Query.js", () => ({
  UserTokenQuery: require("../Testing/P13.Fakes").fakes.userTokenQuery,
}));
jest.mock("./OtpSender.Service.js", () => ({ OtpSender: { sendLinkEmail: jest.fn() } }));
jest.mock("./Password.js", () => ({ ...jest.requireActual("./Password.js"), SALT_ROUNDS: 4 }));

import { InviteService } from "./Invite.Service.js";
import { SessionService } from "./Session.Service.js";
import { OtpSender } from "./OtpSender.Service.js";
import { fakes, addUser } from "../Testing/P13.Fakes.js";

const sender = OtpSender as unknown as { sendLinkEmail: jest.Mock };
const HOUR = 60 * 60 * 1000;
const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a rejection");
};

const superAdmin = () => ({ id: "00000000-0000-4000-8000-0000000000aa", role: "super_admin" as const, storeId: null });
const admin = () => ({ id: "00000000-0000-4000-8000-0000000000ab", role: "admin" as const, storeId: null });
const newcomer = (overrides: Record<string, unknown> = {}) =>
  addUser({ role: "staff", passwordHash: bcrypt.hashSync("Temp-Passw0rd-1", 4), ...overrides });

// What was emailed: the raw token is the only thing that ever leaves the service.
const emailedToken = () => sender.sendLinkEmail.mock.calls[sender.sendLinkEmail.mock.calls.length - 1][2] as string;

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  fakes.reset();
  delete process.env.OTP_DELIVERY;
  sender.sendLinkEmail.mockReset();
  sender.sendLinkEmail.mockResolvedValue(undefined);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  errorSpy.mockRestore();
});

describe("resendInvite", () => {
  it("emails a 256-bit token valid 72 hours, and stores only its SHA-256", async () => {
    const user = newcomer();

    const result = await InviteService.resendInvite(admin(), user.id);

    const raw = emailedToken();
    expect(sender.sendLinkEmail).toHaveBeenCalledWith(user.email, "invite", raw, 72);
    expect(Buffer.from(raw, "base64url")).toHaveLength(32);
    const [row] = [...fakes.tokens.values()];
    expect(row).toMatchObject({ userId: user.id, purpose: "invite", tokenHash: sha256(raw), createdById: admin().id });
    expect(JSON.stringify(row)).not.toContain(raw);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(71.9 * HOUR);
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(72 * HOUR);
    expect(result).toEqual({ message: expect.any(String), expiresAt: row.expiresAt.toISOString() });
  });

  it("never returns the token in the response unless OTP_DELIVERY=response, and then sends no email", async () => {
    const user = newcomer();
    const normal = await InviteService.resendInvite(admin(), user.id);
    expect(JSON.stringify(normal)).not.toContain(emailedToken());

    process.env.OTP_DELIVERY = "response";
    jest.useFakeTimers({ now: Date.now() + 2 * 60 * 1000, doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "queueMicrotask"] });
    sender.sendLinkEmail.mockClear();
    const integration = await InviteService.resendInvite(admin(), user.id);

    expect(integration.inviteToken).toBeDefined();
    expect(sender.sendLinkEmail).not.toHaveBeenCalled();
    expect([...fakes.tokens.values()].some((t) => t.tokenHash === sha256(integration.inviteToken!))).toBe(true);
  });

  it("a new invite voids the previous one, and a minute must pass between sends", async () => {
    const user = newcomer();
    await InviteService.resendInvite(admin(), user.id);
    const first = emailedToken();

    expect((await rejection(InviteService.resendInvite(admin(), user.id))).errorCode).toBe(429);

    jest.useFakeTimers({ now: Date.now() + 61_000, doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "queueMicrotask"] });
    await InviteService.resendInvite(admin(), user.id);
    expect((await rejection(InviteService.acceptInvite(first, "Brand-New-Pass-7"))).errorCode).toBe(410);
    await expect(InviteService.acceptInvite(emailedToken(), "Brand-New-Pass-7")).resolves.toBeDefined();
  });

  it("voids the new token again if the email cannot be sent", async () => {
    const user = newcomer();
    sender.sendLinkEmail.mockRejectedValue(new CustomException("down", 503));

    const error = await rejection(InviteService.resendInvite(admin(), user.id));

    expect(error.errorCode).toBe(503);
    expect([...fakes.tokens.values()].every((t) => t.consumedAt)).toBe(true);
  });

  it("is refused for a deactivated account, for someone who has already signed in, and for unknown or non-team ids", async () => {
    const inactive = newcomer({ isActive: false });
    const active = newcomer({ lastLoginAt: new Date() });
    const customer = addUser({ role: "customer" });

    expect((await rejection(InviteService.resendInvite(admin(), inactive.id))).errorCode).toBe(409);
    expect((await rejection(InviteService.resendInvite(admin(), active.id))).errorCode).toBe(409);
    expect((await rejection(InviteService.resendInvite(admin(), customer.id))).errorCode).toBe(404);
    expect((await rejection(InviteService.resendInvite(admin(), "00000000-0000-4000-8000-00000000ffff"))).errorCode).toBe(404);
    expect((await rejection(InviteService.resendInvite(admin(), "not-a-uuid"))).errorCode).toBe(404);
    expect(fakes.tokens.size).toBe(0);
  });

  it("only a super_admin may invite an admin or a super_admin", async () => {
    const target = addUser({ role: "admin" });

    expect((await rejection(InviteService.resendInvite(admin(), target.id))).errorCode).toBe(403);
    await expect(InviteService.resendInvite(superAdmin(), target.id)).resolves.toBeDefined();
  });
});

describe("adminResetPassword", () => {
  it("emails a one-time link valid 24 hours and never returns or sets a password", async () => {
    const user = newcomer({ lastLoginAt: new Date() });
    const before = fakes.users.get(user.id)!.passwordHash;

    const result = await InviteService.adminResetPassword(admin(), user.id);

    expect(sender.sendLinkEmail).toHaveBeenCalledWith(user.email, "reset", emailedToken(), 24);
    expect(JSON.stringify(result)).not.toMatch(/password"|temporary/i);
    expect(result).not.toHaveProperty("resetToken");
    expect(fakes.users.get(user.id)!.passwordHash).toBe(before);
    const [row] = [...fakes.tokens.values()];
    expect(row.purpose).toBe("password_reset");
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(24 * HOUR);
  });

  it("returns resetToken only in OTP_DELIVERY=response mode", async () => {
    process.env.OTP_DELIVERY = "response";
    const user = newcomer();

    const result = await InviteService.adminResetPassword(admin(), user.id);

    expect(result.resetToken).toBeDefined();
    expect(result.inviteToken).toBeUndefined();
  });

  it("keeps the person's sign-ins alive until they redeem the link", async () => {
    const user = newcomer({ lastLoginAt: new Date() });
    await SessionService.issue(user as any);

    await InviteService.adminResetPassword(admin(), user.id);

    expect([...fakes.refresh.values()].filter((r) => !r.revokedAt)).toHaveLength(1);
  });

  it("is refused for a deactivated account, a non-team account and an admin target by a plain admin", async () => {
    const inactive = newcomer({ isActive: false });
    const driver = addUser({ role: "driver" });
    const target = addUser({ role: "super_admin" });

    expect((await rejection(InviteService.adminResetPassword(admin(), inactive.id))).errorCode).toBe(409);
    expect((await rejection(InviteService.adminResetPassword(admin(), driver.id))).errorCode).toBe(404);
    expect((await rejection(InviteService.adminResetPassword(admin(), target.id))).errorCode).toBe(403);
  });
});

describe("acceptInvite", () => {
  const issue = async (user: Record<string, any>, mode: "invite" | "reset" = "invite") => {
    if (mode === "invite") await InviteService.resendInvite(admin(), user.id);
    else await InviteService.adminResetPassword(admin(), user.id);
    return emailedToken();
  };

  it("sets the password, spends the token, and ends every sign-in (the temporary password may be known)", async () => {
    const user = newcomer();
    await SessionService.issue(user as any);
    const token = await issue(user);

    const result = await InviteService.acceptInvite(token, "Brand-New-Pass-7");

    expect(result.message).toMatch(/sign in/i);
    expect(await bcrypt.compare("Brand-New-Pass-7", fakes.users.get(user.id)!.passwordHash)).toBe(true);
    expect([...fakes.refresh.values()].every((r) => r.revokedAt)).toBe(true);
    expect((await rejection(InviteService.acceptInvite(token, "Another-Pass-88"))).errorCode).toBe(410);
    expect(await bcrypt.compare("Brand-New-Pass-7", fakes.users.get(user.id)!.passwordHash)).toBe(true);
  });

  it("redeems an admin-issued reset link the same way", async () => {
    const user = newcomer({ lastLoginAt: new Date() });
    const token = await issue(user, "reset");

    await InviteService.acceptInvite(token, "Reset-To-This-55");

    expect(await bcrypt.compare("Reset-To-This-55", fakes.users.get(user.id)!.passwordHash)).toBe(true);
  });

  it("a token cannot be used after it expires (72h invite, 24h reset)", async () => {
    const invitee = newcomer();
    const inviteToken = await issue(invitee);
    const resetee = newcomer({ lastLoginAt: new Date() });
    const resetToken = await issue(resetee, "reset");

    jest.useFakeTimers({ now: Date.now() + 25 * HOUR, doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "queueMicrotask"] });
    expect((await rejection(InviteService.acceptInvite(resetToken, "Brand-New-Pass-7"))).errorCode).toBe(410);
    await expect(InviteService.acceptInvite(inviteToken, "Brand-New-Pass-7")).resolves.toBeDefined();
  });

  it("an invite older than 72 hours is refused with the generic 410", async () => {
    const user = newcomer();
    const token = await issue(user);

    jest.useFakeTimers({ now: Date.now() + 72 * HOUR + 1000, doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "queueMicrotask"] });
    const error = await rejection(InviteService.acceptInvite(token, "Brand-New-Pass-7"));

    expect(error.errorCode).toBe(410);
    expect(await bcrypt.compare("Temp-Passw0rd-1", fakes.users.get(user.id)!.passwordHash)).toBe(true);
  });

  it("two simultaneous redemptions: exactly one wins", async () => {
    const user = newcomer();
    const token = await issue(user);

    const results = await Promise.allSettled([
      InviteService.acceptInvite(token, "First-Winner-11"),
      InviteService.acceptInvite(token, "Second-Winner-22"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((loser.reason as CustomException).errorCode).toBe(410);
  });

  it("unknown, malformed and empty tokens look the same as an expired one", async () => {
    const unknown = await rejection(InviteService.acceptInvite(crypto.randomBytes(32).toString("base64url"), "Brand-New-Pass-7"));
    const garbage = await rejection(InviteService.acceptInvite("garbage", "Brand-New-Pass-7"));

    expect(unknown.errorCode).toBe(410);
    expect(garbage.errorCode).toBe(410);
    expect(unknown.displayMessage).toBe(garbage.displayMessage);
    for (const token of [undefined, "", 123, "x".repeat(201)]) {
      expect((await rejection(InviteService.acceptInvite(token, "Brand-New-Pass-7"))).errorCode).toBe(400);
    }
  });

  it("validates the password before touching the token, so a typo does not burn the invite", async () => {
    const user = newcomer();
    const token = await issue(user);

    for (const password of ["short", "x".repeat(73), undefined, 12345678]) {
      expect((await rejection(InviteService.acceptInvite(token, password))).errorCode).toBe(400);
    }
    await expect(InviteService.acceptInvite(token, "Brand-New-Pass-7")).resolves.toBeDefined();
  });

  it("never revives a deactivated account, and an unused link dies with the deactivation", async () => {
    const user = newcomer();
    const token = await issue(user);
    fakes.users.get(user.id)!.isActive = false;

    expect((await rejection(InviteService.acceptInvite(token, "Brand-New-Pass-7"))).errorCode).toBe(410);
    expect(fakes.users.get(user.id)!.isActive).toBe(false);
    expect(await bcrypt.compare("Temp-Passw0rd-1", fakes.users.get(user.id)!.passwordHash)).toBe(true);
  });

  it("redeeming voids the person's other outstanding links", async () => {
    const user = newcomer({ lastLoginAt: new Date() });
    const resetToken = await issue(user, "reset");
    fakes.tokens.set("extra", {
      id: "extra", userId: user.id, purpose: "invite", tokenHash: sha256("other"), expiresAt: new Date(Date.now() + HOUR),
      consumedAt: null, createdAt: new Date(), createdById: null,
    });

    await InviteService.acceptInvite(resetToken, "Brand-New-Pass-7");

    expect((await rejection(InviteService.acceptInvite("other", "Brand-New-Pass-7"))).errorCode).toBe(410);
  });
});
