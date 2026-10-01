import bcrypt from "bcrypt";
import { CustomException } from "../../commons/Exception/CustomException.js";

process.env.JWT_SECRET = "a".repeat(40);

jest.mock("../Queries/RefreshToken.Query.js", () => ({
  RefreshTokenQuery: require("../Testing/P13.Fakes").fakes.refreshTokenQuery,
}));
jest.mock("../Queries/User.Query.js", () => ({ UserQuery: require("../Testing/P13.Fakes").fakes.userQuery }));
jest.mock("../Queries/OtpChallenge.Query.js", () => ({
  OtpChallengeQuery: require("../Testing/P13.Fakes").fakes.otpChallengeQuery,
}));
jest.mock("./OtpSender.Service.js", () => ({ OtpSender: { sendSms: jest.fn(), sendEmail: jest.fn() } }));
jest.mock("./Password.js", () => ({ ...jest.requireActual("./Password.js"), SALT_ROUNDS: 4 }));

import { AccountService } from "./Account.Service.js";
import { SessionService } from "./Session.Service.js";
import { OtpSender } from "./OtpSender.Service.js";
import { fakes, addUser } from "../Testing/P13.Fakes.js";

const PASSWORD = "Correct-Horse-9";
const NEW_PASSWORD = "Brand-New-Pass-7";
const sender = OtpSender as unknown as { sendSms: jest.Mock };

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a rejection");
};

const member = (overrides: Record<string, unknown> = {}) =>
  addUser({ role: "staff", passwordHash: bcrypt.hashSync(PASSWORD, 4), ...overrides });
const liveSessions = (userId: string) => [...fakes.refresh.values()].filter((r) => r.userId === userId && !r.revokedAt);

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  fakes.reset();
  delete process.env.OTP_DELIVERY;
  sender.sendSms.mockReset();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

describe("updateMe", () => {
  it("changes the name and returns the fresh profile", async () => {
    const user = member();

    const result = await AccountService.updateMe(user.id, { name: "  Meera N.  " });

    expect(result).toMatchObject({ id: user.id, name: "Meera N.", initials: "MN" });
    expect(fakes.users.get(user.id)!.name).toBe("Meera N.");
  });

  it("refuses an email change, with the reason", async () => {
    const user = member();

    const error = await rejection(AccountService.updateMe(user.id, { email: "new@loc.test" }));

    expect(error.errorCode).toBe(400);
    expect(error.displayMessage).toMatch(/email/i);
    expect(fakes.users.get(user.id)!.email).toBe(user.email);
  });

  it("refuses a phone change here and points to the OTP steps", async () => {
    const user = member();

    for (const body of [{ phone: "+911234567890" }, { phoneNumber: "+911234567890" }]) {
      const error = await rejection(AccountService.updateMe(user.id, body));
      expect(error.errorCode).toBe(400);
      expect(error.displayMessage).toMatch(/phone/i);
    }
    expect(fakes.users.get(user.id)!.phoneNumber).toBeNull();
  });

  it("writes only the name: role, store and active flags in the body are ignored, never applied", async () => {
    const user = member({ storeId: "11111111-1111-4111-8111-111111111101" });

    await AccountService.updateMe(user.id, {
      name: "Safe Name",
      role: "super_admin",
      isActive: false,
      storeId: null,
      passwordHash: "x",
    });

    expect(fakes.users.get(user.id)).toMatchObject({
      name: "Safe Name",
      role: "staff",
      isActive: true,
      storeId: "11111111-1111-4111-8111-111111111101",
    });
    expect(fakes.users.get(user.id)!.passwordHash).not.toBe("x");
  });

  it("rejects an empty body, a blank name and an over-long name", async () => {
    const user = member();

    for (const body of [{}, { name: "" }, { name: "   " }, { name: "x".repeat(101) }, { name: 5 }]) {
      expect((await rejection(AccountService.updateMe(user.id, body))).errorCode).toBe(400);
    }
  });

  it("a deactivated account cannot edit its profile", async () => {
    const user = member({ isActive: false });

    expect((await rejection(AccountService.updateMe(user.id, { name: "X Y" }))).errorCode).toBe(401);
  });
});

describe("changePassword", () => {
  it("sets the new password, ends every other sign-in and keeps the caller's own", async () => {
    const user = member();
    const phone = await SessionService.issue(user as any);
    const laptop = await SessionService.issue(user as any);
    const tablet = await SessionService.issue(user as any);

    const result = await AccountService.changePassword(user.id, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      refreshToken: laptop.refreshToken,
    });

    expect(result.currentSessionKept).toBe(true);
    expect(await bcrypt.compare(NEW_PASSWORD, fakes.users.get(user.id)!.passwordHash)).toBe(true);
    const live = liveSessions(user.id);
    expect(live).toHaveLength(1);
    // The surviving one is the laptop's: refreshing with it still works, the others do not.
    await expect(SessionService.refresh(laptop.refreshToken)).resolves.toBeDefined();
    await expect(SessionService.refresh(phone.refreshToken)).rejects.toMatchObject({ errorCode: 401 });
    await expect(SessionService.refresh(tablet.refreshToken)).rejects.toMatchObject({ errorCode: 401 });
  });

  it("with no refresh token, ends every sign-in including this one, and says so", async () => {
    const user = member();
    await SessionService.issue(user as any);
    await SessionService.issue(user as any);

    const result = await AccountService.changePassword(user.id, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

    expect(result.currentSessionKept).toBe(false);
    expect(liveSessions(user.id)).toHaveLength(0);
  });

  it("someone else's refresh token keeps nothing, and never revokes or protects a stranger", async () => {
    const user = member();
    const other = member();
    await SessionService.issue(user as any);
    const strangers = await SessionService.issue(other as any);

    const result = await AccountService.changePassword(user.id, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      refreshToken: strangers.refreshToken,
    });

    expect(result.currentSessionKept).toBe(false);
    expect(liveSessions(user.id)).toHaveLength(0);
    expect(liveSessions(other.id)).toHaveLength(1);
  });

  it("a refresh token that was already spent (rotated) keeps nothing", async () => {
    const user = member();
    const old = await SessionService.issue(user as any);
    await SessionService.refresh(old.refreshToken);

    const result = await AccountService.changePassword(user.id, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      refreshToken: old.refreshToken,
    });

    expect(result.currentSessionKept).toBe(false);
    expect(liveSessions(user.id)).toHaveLength(0);
  });

  it("a wrong current password is a clear 400 and changes nothing", async () => {
    const user = member();
    const session = await SessionService.issue(user as any);
    const before = fakes.users.get(user.id)!.passwordHash;

    const error = await rejection(
      AccountService.changePassword(user.id, { currentPassword: "nope-nope-1", newPassword: NEW_PASSWORD, refreshToken: session.refreshToken })
    );

    expect(error.errorCode).toBe(400);
    expect(error.displayMessage).toMatch(/current password/i);
    expect(fakes.users.get(user.id)!.passwordHash).toBe(before);
    expect(liveSessions(user.id)).toHaveLength(1);
  });

  it("enforces the password rules: minimum, bcrypt's 72-byte ceiling, and not the same as before", async () => {
    const user = member();

    for (const newPassword of ["short", "x".repeat(73), "é".repeat(37), undefined, 12345678, null]) {
      const error = await rejection(AccountService.changePassword(user.id, { currentPassword: PASSWORD, newPassword }));
      expect(error.errorCode).toBe(400);
    }
    const same = await rejection(AccountService.changePassword(user.id, { currentPassword: PASSWORD, newPassword: PASSWORD }));
    expect(same.errorCode).toBe(400);
    expect(await bcrypt.compare(PASSWORD, fakes.users.get(user.id)!.passwordHash)).toBe(true);
    await expect(
      AccountService.changePassword(user.id, { currentPassword: PASSWORD, newPassword: "x".repeat(72) })
    ).resolves.toBeDefined();
  });

  it("requires the current password as a string", async () => {
    const user = member();

    for (const currentPassword of [undefined, "", 123, { a: 1 }, "x".repeat(201)]) {
      expect((await rejection(AccountService.changePassword(user.id, { currentPassword, newPassword: NEW_PASSWORD }))).errorCode).toBe(400);
    }
  });

  it("a social account with no password gets a clear 400, not a crash", async () => {
    const user = addUser({ role: "customer", passwordHash: null });

    const error = await rejection(AccountService.changePassword(user.id, { currentPassword: "whatever1", newPassword: NEW_PASSWORD }));

    expect(error.errorCode).toBe(400);
    expect(error.displayMessage).toMatch(/social/i);
  });

  it("the old password stops working and the new one signs in", async () => {
    const user = member();
    await AccountService.changePassword(user.id, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

    const hash = fakes.users.get(user.id)!.passwordHash;
    expect(await bcrypt.compare(PASSWORD, hash)).toBe(false);
    expect(await bcrypt.compare(NEW_PASSWORD, hash)).toBe(true);
  });
});

describe("phone change", () => {
  const PHONE = "+919800011122";

  it("step 1 sends a code to the new number; step 2 saves exactly that number, verified", async () => {
    const user = member({ phoneNumber: "+919800000001" });

    const challenge = (await AccountService.sendPhoneChangeOtp(user.id, "+91 98000 11122")) as any;
    expect(sender.sendSms).toHaveBeenCalledWith(PHONE, expect.stringMatching(/^\d{6}$/));
    expect(challenge.otp).toBeUndefined();
    const code = sender.sendSms.mock.calls[0][1];
    const updated = await AccountService.verifyPhoneChangeOtp(user.id, challenge.verificationId, code);

    expect(updated.phone).toBe(PHONE);
    expect(fakes.users.get(user.id)).toMatchObject({ phoneNumber: PHONE, isPhoneVerified: true });
  });

  it("returns the code in the response only in OTP_DELIVERY=response mode, and then sends nothing", async () => {
    process.env.OTP_DELIVERY = "response";
    const user = member();

    const challenge = (await AccountService.sendPhoneChangeOtp(user.id, PHONE)) as any;

    expect(challenge.otp).toMatch(/^\d{6}$/);
    expect(sender.sendSms).not.toHaveBeenCalled();
  });

  it("refuses a number another account already has (409) and an invalid number (400)", async () => {
    member({ phoneNumber: PHONE });
    const user = member();

    expect((await rejection(AccountService.sendPhoneChangeOtp(user.id, PHONE))).errorCode).toBe(409);
    expect((await rejection(AccountService.sendPhoneChangeOtp(user.id, "12"))).errorCode).toBe(400);
    expect((await rejection(AccountService.sendPhoneChangeOtp(user.id, undefined))).errorCode).toBe(400);
  });

  it("refuses to re-verify the number the account already has verified", async () => {
    const user = member({ phoneNumber: PHONE, isPhoneVerified: true });

    expect((await rejection(AccountService.sendPhoneChangeOtp(user.id, PHONE))).errorCode).toBe(400);
  });

  it("a wrong code is refused with the attempts left and leaves the phone alone", async () => {
    const user = member({ phoneNumber: "+919800000001" });
    const challenge = (await AccountService.sendPhoneChangeOtp(user.id, PHONE)) as any;

    const error = await rejection(AccountService.verifyPhoneChangeOtp(user.id, challenge.verificationId, "000000"));

    expect(error.errorCode).toBe(400);
    expect(error.data).toEqual({ attemptsRemaining: 4 });
    expect(fakes.users.get(user.id)!.phoneNumber).toBe("+919800000001");
  });

  it("another account cannot redeem my verification, and cannot burn my attempts", async () => {
    process.env.OTP_DELIVERY = "response";
    const me = member();
    const intruder = member();
    const challenge = (await AccountService.sendPhoneChangeOtp(me.id, PHONE)) as any;

    const error = await rejection(AccountService.verifyPhoneChangeOtp(intruder.id, challenge.verificationId, challenge.otp));

    expect(error.errorCode).toBe(400);
    expect(fakes.otps.get(challenge.verificationId)!.attempts).toBe(0);
    expect(fakes.users.get(intruder.id)!.phoneNumber).toBeNull();
  });

  it("a code is single-use: the second redemption fails", async () => {
    process.env.OTP_DELIVERY = "response";
    const user = member();
    const challenge = (await AccountService.sendPhoneChangeOtp(user.id, PHONE)) as any;
    await AccountService.verifyPhoneChangeOtp(user.id, challenge.verificationId, challenge.otp);

    const again = await rejection(AccountService.verifyPhoneChangeOtp(user.id, challenge.verificationId, challenge.otp));

    expect(again.errorCode).toBe(400);
  });

  it("a code issued for another purpose (login) cannot change a phone", async () => {
    const user = member();
    fakes.otps.set("login-otp", {
      id: "login-otp", purpose: "login", destination: PHONE, otpHash: bcrypt.hashSync("123456", 4), userId: user.id,
      attempts: 0, verifiedAt: null, consumedAt: null, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    });

    const error = await rejection(AccountService.verifyPhoneChangeOtp(user.id, "login-otp", "123456"));

    expect(error.errorCode).toBe(400);
  });

  it("a number taken between the two steps is a 409, not a 500", async () => {
    process.env.OTP_DELIVERY = "response";
    const user = member();
    const challenge = (await AccountService.sendPhoneChangeOtp(user.id, PHONE)) as any;
    member({ phoneNumber: PHONE });

    const error = await rejection(AccountService.verifyPhoneChangeOtp(user.id, challenge.verificationId, challenge.otp));

    expect(error.errorCode).toBe(409);
  });

  it("malformed ids and codes are a 400, never a database error", async () => {
    const user = member();

    for (const [id, otp] of [["not-a-uuid", "123456"], [undefined, "1"], ["00000000-0000-4000-8000-000000000000", "123456"], ["00000000-0000-4000-8000-000000000000", undefined]]) {
      expect((await rejection(AccountService.verifyPhoneChangeOtp(user.id, id, otp))).errorCode).toBe(400);
    }
  });
});
