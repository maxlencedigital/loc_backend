import bcrypt from "bcrypt";

// Same factory mocks as UserAuth.Service.test.ts: no database, no real SMS or email.
jest.mock("../Queries/RefreshToken.Query.js", () => ({
  RefreshTokenQuery: {
    create: jest.fn().mockResolvedValue({}),
    purgeExpired: jest.fn().mockResolvedValue(0),
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock("../Queries/User.Query.js", () => ({
  UserQuery: { findByEmail: jest.fn(), findByPhoneNumber: jest.fn() },
}));
jest.mock("../Queries/OtpChallenge.Query.js", () => ({
  OtpChallengeQuery: {
    create: jest.fn(),
    countRecentFor: jest.fn(),
    findLatestFor: jest.fn(),
  },
}));
jest.mock("../Queries/TwoFactor.Query.js", () => ({
  TwoFactorQuery: { findCredential: jest.fn().mockResolvedValue(null) },
}));
jest.mock("../Queries/UserToken.Query.js", () => ({
  UserTokenQuery: { invalidateOutstanding: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("./OtpSender.Service.js", () => ({
  OtpSender: {
    sendSms: jest.fn().mockResolvedValue(undefined),
    sendEmail: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock("./OAuth.Service.js", () => ({ OAuthService: { verify: jest.fn() } }));

import { UserQuery } from "../Queries/User.Query.js";
import { OtpChallengeQuery } from "../Queries/OtpChallenge.Query.js";
import { OtpSender } from "./OtpSender.Service.js";
import { AuthService } from "./Auth.Service.js";
import { assertValidOtpDelivery, decoyCode } from "./OtpDelivery.js";

const users = UserQuery as jest.Mocked<typeof UserQuery>;
const otps = OtpChallengeQuery as jest.Mocked<typeof OtpChallengeQuery>;
const sender = OtpSender as jest.Mocked<typeof OtpSender>;

const PHONE = "+919876543210";
const EMAIL = "asha@example.com";
const SIX_DIGITS = /^\d{6}$/;
const person = (role: string) => ({ id: "u1", role, isActive: true, phoneNumber: PHONE, email: EMAIL });

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.OTP_DELIVERY;
  otps.findLatestFor.mockResolvedValue(null);
  otps.countRecentFor.mockResolvedValue(0);
  otps.create.mockImplementation(async (c: any) => ({ id: "chal-1", createdAt: new Date(), ...c }));
  users.findByPhoneNumber.mockResolvedValue(null);
});
afterAll(() => {
  delete process.env.OTP_DELIVERY;
});

describe("OTP_DELIVERY unset (the default): codes are sent, never returned", () => {
  it("register: sends the SMS and the response has no otp", async () => {
    const result = await AuthService.registerSendOtp(PHONE);

    expect(sender.sendSms).toHaveBeenCalledWith(PHONE, expect.stringMatching(SIX_DIGITS));
    expect(result).not.toHaveProperty("otp");
  });

  it("login by OTP: sends the SMS and the response has no otp", async () => {
    users.findByPhoneNumber.mockResolvedValue(person("customer") as any);

    const result = await AuthService.loginOtpRequest(PHONE);

    expect(sender.sendSms).toHaveBeenCalled();
    expect(result).not.toHaveProperty("otp");
  });

  it("forgot password: sends the email and the response has no otp", async () => {
    users.findByEmail.mockResolvedValue(person("customer") as any);

    const result = await AuthService.passwordForgot(EMAIL);

    expect(sender.sendEmail).toHaveBeenCalled();
    expect(result).not.toHaveProperty("otp");
  });

  it('"send" behaves like unset', async () => {
    process.env.OTP_DELIVERY = "send";

    expect(await AuthService.registerSendOtp(PHONE)).not.toHaveProperty("otp");
    expect(sender.sendSms).toHaveBeenCalled();
  });
});

describe("OTP_DELIVERY=response: nothing is sent and the code comes back", () => {
  beforeEach(() => {
    process.env.OTP_DELIVERY = "response";
  });

  it("register: returns the real code, which verifies against the stored hash, and sends nothing", async () => {
    const result = (await AuthService.registerSendOtp(PHONE)) as any;

    expect(result.otp).toMatch(SIX_DIGITS);
    expect(sender.sendSms).not.toHaveBeenCalled();
    const stored = otps.create.mock.calls[0][0] as any;
    expect(await bcrypt.compare(result.otp, stored.otpHash)).toBe(true);
    expect(result.verificationId).toBe("chal-1");
  });

  it("login by OTP: a customer gets their real code and no SMS is sent", async () => {
    users.findByPhoneNumber.mockResolvedValue(person("customer") as any);

    const result = (await AuthService.loginOtpRequest(PHONE)) as any;

    expect(result.otp).toMatch(SIX_DIGITS);
    expect(sender.sendSms).not.toHaveBeenCalled();
    const stored = otps.create.mock.calls[0][0] as any;
    expect(stored).toMatchObject({ purpose: "login", userId: "u1" });
    expect(await bcrypt.compare(result.otp, stored.otpHash)).toBe(true);
  });

  it("forgot password: a customer gets their real code and no email is sent", async () => {
    users.findByEmail.mockResolvedValue(person("customer") as any);

    const result = (await AuthService.passwordForgot(EMAIL)) as any;

    expect(result.otp).toMatch(SIX_DIGITS);
    expect(sender.sendEmail).not.toHaveBeenCalled();
    expect(otps.create.mock.calls[0][0]).toMatchObject({ purpose: "password_reset", userId: "u1" });
  });

  it.each(["admin", "manager", "staff", "hr", "driver", "super_admin"])(
    "login by OTP never opens a %s account: no challenge exists, the code is a decoy",
    async (role) => {
      users.findByPhoneNumber.mockResolvedValue(person(role) as any);

      const result = (await AuthService.loginOtpRequest(PHONE)) as any;

      expect(otps.create).not.toHaveBeenCalled();
      expect(result.otp).toMatch(SIX_DIGITS);
    }
  );

  it.each(["admin", "manager", "staff", "hr", "driver", "super_admin"])(
    "password reset never opens a %s account: no challenge exists, the code is a decoy",
    async (role) => {
      users.findByEmail.mockResolvedValue(person(role) as any);

      const result = (await AuthService.passwordForgot(EMAIL)) as any;

      expect(otps.create).not.toHaveBeenCalled();
      expect(result.otp).toMatch(SIX_DIGITS);
    }
  );

  it("an unknown or deactivated account is indistinguishable from a real customer", async () => {
    users.findByPhoneNumber.mockResolvedValueOnce(person("customer") as any);
    const real = (await AuthService.loginOtpRequest(PHONE)) as any;
    users.findByPhoneNumber.mockResolvedValueOnce(null);
    const unknown = (await AuthService.loginOtpRequest("+910000000000")) as any;
    users.findByPhoneNumber.mockResolvedValueOnce({ ...person("customer"), isActive: false } as any);
    const inactive = (await AuthService.loginOtpRequest(PHONE)) as any;

    expect(Object.keys(unknown).sort()).toEqual(Object.keys(real).sort());
    expect(Object.keys(inactive).sort()).toEqual(Object.keys(real).sort());
    expect(unknown.otp).toMatch(SIX_DIGITS);
  });

  it("still applies the per-number throttles", async () => {
    otps.findLatestFor.mockResolvedValue({ createdAt: new Date() } as any);

    await expect(AuthService.registerSendOtp(PHONE)).rejects.toMatchObject({ errorCode: 429 });
  });
});

describe("assertValidOtpDelivery", () => {
  it.each([[undefined], [""], ["send"], ["response"]])("accepts %p", (value) => {
    if (value === undefined) delete process.env.OTP_DELIVERY;
    else process.env.OTP_DELIVERY = value;

    expect(() => assertValidOtpDelivery()).not.toThrow();
  });

  it.each([["respone"], ["RESPONSE"], ["true"], ["console"]])("refuses the typo %p instead of falling back to paid sending", (value) => {
    process.env.OTP_DELIVERY = value;

    expect(() => assertValidOtpDelivery()).toThrow(/OTP_DELIVERY/);
  });
});

describe("decoyCode", () => {
  it("is always six digits", () => {
    for (let i = 0; i < 200; i++) expect(decoyCode()).toMatch(SIX_DIGITS);
  });
});
