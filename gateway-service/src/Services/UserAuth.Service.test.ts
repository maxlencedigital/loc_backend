import bcrypt from "bcrypt";
import { CustomException } from "../../commons/Exception/CustomException.js";

// Same factory-mock approach as Auth.Service.test.ts: keeps the Prisma client
// chain, which throws at import without a database URL, out of these tests.
jest.mock("../Queries/User.Query.js", () => ({
  UserQuery: {
    create: jest.fn(),
    findByEmail: jest.fn(),
    findById: jest.fn(),
    findByPhoneNumber: jest.fn(),
    findByOAuthIdentity: jest.fn(),
    setPassword: jest.fn(),
    linkOAuthIdentity: jest.fn(),
  },
}));

jest.mock("../Queries/OtpChallenge.Query.js", () => ({
  OtpChallengeQuery: {
    create: jest.fn(),
    findById: jest.fn(),
    recordAttempt: jest.fn(),
    markVerified: jest.fn(),
    markConsumed: jest.fn(),
    countRecentFor: jest.fn(),
    findLatestFor: jest.fn(),
    deleteExpiredBefore: jest.fn(),
  },
}));

// Nothing here should dispatch a real SMS or email.
jest.mock("./OtpSender.Service.js", () => ({
  OtpSender: {
    // Must resolve, not return undefined: the anti-enumeration paths call
    // .catch() on the result to swallow provider outages.
    sendSms: jest.fn().mockResolvedValue(undefined),
    sendEmail: jest.fn().mockResolvedValue(undefined),
  },
}));

// Would otherwise make real network calls to Google/Facebook.
jest.mock("./OAuth.Service.js", () => ({
  OAuthService: { verify: jest.fn() },
}));

import { UserQuery } from "../Queries/User.Query.js";
import { OtpChallengeQuery } from "../Queries/OtpChallenge.Query.js";
import { OAuthService } from "./OAuth.Service.js";
import { AuthService } from "./Auth.Service.js";

const users = UserQuery as jest.Mocked<typeof UserQuery>;
const otps = OtpChallengeQuery as jest.Mocked<typeof OtpChallengeQuery>;
const oauth = OAuthService as jest.Mocked<typeof OAuthService>;

const validRegistration = {
  name: "Asha Rao",
  email: "asha@example.com",
  phoneNumber: "+919876543210",
  password: "Passw0rd!",
};

beforeEach(() => {
  process.env.JWT_SECRET = "test-secret";
  otps.findLatestFor.mockResolvedValue(null);
  otps.countRecentFor.mockResolvedValue(0);
  otps.create.mockImplementation(async (c: any) => ({ id: "chal-1", ...c }) as any);
});

describe("registerSendOtp (step 1)", () => {
  it("takes only a phone number — email/password aren't collected yet", async () => {
    users.findByPhoneNumber.mockResolvedValue(null);

    await AuthService.registerSendOtp(validRegistration.phoneNumber);

    expect(users.create).not.toHaveBeenCalled();
    const stored: any = otps.create.mock.calls[0][0];
    expect(stored.destination).toBe(validRegistration.phoneNumber);
    expect(stored.purpose).toBe("register");
  });

  it("rejects a number that is already registered, before spending an SMS", async () => {
    users.findByPhoneNumber.mockResolvedValue({ id: "existing" } as any);
    await expect(AuthService.registerSendOtp(validRegistration.phoneNumber)).rejects.toThrow(
      CustomException
    );
    expect(otps.create).not.toHaveBeenCalled();
  });

  it("rejects a missing phone number", async () => {
    await expect(AuthService.registerSendOtp("")).rejects.toThrow(CustomException);
  });
});

describe("registerVerifyOtp (step 2)", () => {
  const challenge = async (code: string, overrides: Record<string, unknown> = {}) => ({
    id: "chal-1",
    purpose: "register",
    destination: validRegistration.phoneNumber,
    otpHash: await bcrypt.hash(code, 8),
    userId: null,
    attempts: 0,
    verifiedAt: null,
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });

  it("verifies the number WITHOUT creating an account", async () => {
    otps.findById.mockResolvedValue((await challenge("111222")) as any);

    const result = await AuthService.registerVerifyOtp("chal-1", "111222");

    expect(result.verified).toBe(true);
    expect(result.phoneNumber).toBe(validRegistration.phoneNumber);
    // The form still has email and password to collect.
    expect(users.create).not.toHaveBeenCalled();
    expect(otps.markConsumed).not.toHaveBeenCalled();
  });

  it("returns attemptsRemaining on a wrong code, for the inline error", async () => {
    otps.findById.mockResolvedValue((await challenge("111222")) as any);
    const err: any = await AuthService.registerVerifyOtp("chal-1", "999999").catch((e) => e);
    expect(err.data).toEqual({ attemptsRemaining: 4 });
  });
});

describe("registerComplete (step 3)", () => {
  const verifiedChallenge = (overrides: Record<string, unknown> = {}) => ({
    id: "chal-1",
    purpose: "register",
    destination: validRegistration.phoneNumber,
    otpHash: "x",
    userId: null,
    attempts: 0,
    verifiedAt: new Date(),
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });

  const completion = {
    verificationId: "chal-1",
    name: validRegistration.name,
    email: validRegistration.email,
    password: validRegistration.password,
  };

  it("creates the account with the phone marked verified", async () => {
    otps.findById.mockResolvedValue(verifiedChallenge() as any);
    users.findByEmail.mockResolvedValue(null);
    users.findByPhoneNumber.mockResolvedValue(null);
    users.create.mockResolvedValue({
      id: "new-user",
      name: validRegistration.name,
      email: validRegistration.email,
      phoneNumber: validRegistration.phoneNumber,
      role: "customer",
    } as any);

    const result = await AuthService.registerComplete(completion);

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({ isPhoneVerified: true, role: "customer" })
    );
    expect(result.token).toEqual(expect.any(String));
  });

  it("takes the phone number from the VERIFIED challenge, not the request body", async () => {
    otps.findById.mockResolvedValue(verifiedChallenge() as any);
    users.findByEmail.mockResolvedValue(null);
    users.findByPhoneNumber.mockResolvedValue(null);
    users.create.mockResolvedValue({
      id: "u", name: "n", email: "e", phoneNumber: validRegistration.phoneNumber, role: "customer",
    } as any);

    // A caller trying to register someone else's number after verifying their own.
    await AuthService.registerComplete({ ...completion, phoneNumber: "+910000000000" } as any);

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: validRegistration.phoneNumber })
    );
  });

  it("refuses when the phone was never verified", async () => {
    otps.findById.mockResolvedValue(verifiedChallenge({ verifiedAt: null }) as any);
    await expect(AuthService.registerComplete(completion)).rejects.toThrow(CustomException);
    expect(users.create).not.toHaveBeenCalled();
  });

  it("refuses to reuse a verification that already created an account", async () => {
    otps.findById.mockResolvedValue(verifiedChallenge({ consumedAt: new Date() }) as any);
    await expect(AuthService.registerComplete(completion)).rejects.toThrow(CustomException);
    expect(users.create).not.toHaveBeenCalled();
  });

  it("rejects a password below the minimum length", async () => {
    otps.findById.mockResolvedValue(verifiedChallenge() as any);
    await expect(
      AuthService.registerComplete({ ...completion, password: "short" })
    ).rejects.toThrow(CustomException);
    expect(users.create).not.toHaveBeenCalled();
  });

  it("rejects if the email was taken while the form was being filled in", async () => {
    otps.findById.mockResolvedValue(verifiedChallenge() as any);
    users.findByEmail.mockResolvedValue({ id: "sniped" } as any);
    await expect(AuthService.registerComplete(completion)).rejects.toThrow(CustomException);
    expect(users.create).not.toHaveBeenCalled();
  });
});

describe("loginOtpRequest — account enumeration", () => {
  it("returns a challenge for an unknown number, but issues no code", async () => {
    users.findByPhoneNumber.mockResolvedValue(null);

    const result = await AuthService.loginOtpRequest("+910000000000");

    expect(result.verificationId).toEqual(expect.any(String));
    expect(otps.create).not.toHaveBeenCalled();
  });

  it("returns the identical response shape for a known number", async () => {
    users.findByPhoneNumber.mockResolvedValue({ id: "u1", isActive: true } as any);

    const result = await AuthService.loginOtpRequest("+919876543210");

    expect(Object.keys(result).sort()).toEqual([
      "expiresInSeconds",
      "resendAvailableInSeconds",
      "verificationId",
    ]);
  });
});

describe("loginOAuth", () => {
  const identity = {
    provider: "google" as const,
    subject: "google-sub-1",
    email: "asha@example.com",
    name: "Asha",
    emailVerified: true,
  };

  it("signs in an already-linked account without creating another", async () => {
    oauth.verify.mockResolvedValue(identity);
    users.findByOAuthIdentity.mockResolvedValue({
      id: "u1",
      name: "Asha",
      email: identity.email,
      phoneNumber: null,
      role: "customer",
      isActive: true,
    } as any);

    const result = await AuthService.loginOAuth("google", "tok");

    expect(result.isNewUser).toBe(false);
    expect(users.create).not.toHaveBeenCalled();
  });

  it("links onto an existing password account with the same verified email", async () => {
    oauth.verify.mockResolvedValue(identity);
    users.findByOAuthIdentity.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue({
      id: "u-existing",
      name: "Asha",
      email: identity.email,
      phoneNumber: "+9199",
      role: "customer",
      isActive: true,
    } as any);

    const result = await AuthService.loginOAuth("google", "tok");

    expect(users.linkOAuthIdentity).toHaveBeenCalledWith("u-existing", "google", "google-sub-1");
    expect(users.create).not.toHaveBeenCalled();
    expect(result.isNewUser).toBe(false);
  });

  it("refuses to link when the provider email is UNVERIFIED — takeover guard", async () => {
    oauth.verify.mockResolvedValue({ ...identity, emailVerified: false });
    users.findByOAuthIdentity.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue({ id: "victim", isActive: true } as any);

    await expect(AuthService.loginOAuth("google", "tok")).rejects.toThrow(CustomException);
    expect(users.linkOAuthIdentity).not.toHaveBeenCalled();
  });

  it("creates a passwordless, phoneless account for a new social user", async () => {
    oauth.verify.mockResolvedValue(identity);
    users.findByOAuthIdentity.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue(null);
    users.create.mockResolvedValue({
      id: "new",
      name: "Asha",
      email: identity.email,
      phoneNumber: null,
      role: "customer",
      isActive: true,
    } as any);

    const result = await AuthService.loginOAuth("google", "tok");

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: null, phoneNumber: null, role: "customer" })
    );
    expect(result.isNewUser).toBe(true);
    // Delivery needs a number, and no provider gives one.
    expect(result.profileComplete).toBe(false);
  });

  it("refuses a deactivated account", async () => {
    oauth.verify.mockResolvedValue(identity);
    users.findByOAuthIdentity.mockResolvedValue({ id: "u1", isActive: false } as any);
    await expect(AuthService.loginOAuth("google", "tok")).rejects.toThrow(CustomException);
  });
});

describe("password reset", () => {
  it("forgot() reveals nothing for an unknown email", async () => {
    users.findByEmail.mockResolvedValue(null);

    const result = await AuthService.passwordForgot("nobody@example.com");

    expect(result.verificationId).toEqual(expect.any(String));
    expect(otps.create).not.toHaveBeenCalled();
  });

  it("reset() rejects a password below the minimum length", async () => {
    await expect(AuthService.passwordReset("chal-1", "111222", "short")).rejects.toThrow(
      CustomException
    );
  });

  it("reset() stores a new hash, never the raw password", async () => {
    otps.findById.mockResolvedValue({
      id: "chal-1",
      purpose: "password_reset",
      destination: "asha@example.com",
      otpHash: await bcrypt.hash("111222", 8),
      pendingRegistration: null,
      userId: "u1",
      attempts: 0,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as any);
    users.findById.mockResolvedValue({ id: "u1", isActive: true } as any);

    await AuthService.passwordReset("chal-1", "111222", "BrandNewPassw0rd");

    const [, newHash] = users.setPassword.mock.calls[0];
    expect(newHash).not.toBe("BrandNewPassw0rd");
    expect(await bcrypt.compare("BrandNewPassw0rd", newHash)).toBe(true);
  });

  it("reset() refuses a password-reset code that came from a different flow", async () => {
    otps.findById.mockResolvedValue({
      id: "chal-1",
      purpose: "login",
      destination: "+9199",
      otpHash: await bcrypt.hash("111222", 8),
      pendingRegistration: null,
      userId: "u1",
      attempts: 0,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as any);

    await expect(
      AuthService.passwordReset("chal-1", "111222", "BrandNewPassw0rd")
    ).rejects.toThrow(CustomException);
    expect(users.setPassword).not.toHaveBeenCalled();
  });
});
