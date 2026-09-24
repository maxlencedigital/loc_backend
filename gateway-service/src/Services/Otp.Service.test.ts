import bcrypt from "bcrypt";
import { CustomException } from "../../commons/Exception/CustomException.js";

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

import { OtpChallengeQuery } from "../Queries/OtpChallenge.Query.js";
import { OtpService } from "./Otp.Service.js";

const mockQuery = OtpChallengeQuery as jest.Mocked<typeof OtpChallengeQuery>;

const futureDate = () => new Date(Date.now() + 60_000);
const pastDate = () => new Date(Date.now() - 1_000);

beforeEach(() => {
  mockQuery.findLatestFor.mockResolvedValue(null);
  mockQuery.countRecentFor.mockResolvedValue(0);
  mockQuery.create.mockImplementation(async (c: any) => ({ id: "challenge-1", ...c }) as any);
});

describe("issue", () => {
  it("returns a challenge and a separate code, and never puts the code in the challenge", async () => {
    const { challenge, code } = await OtpService.issue({
      purpose: "login",
      destination: "+911234567890",
      userId: "u1",
    });

    expect(challenge.verificationId).toBe("challenge-1");
    expect(code).toMatch(/^\d{6}$/);
    // The object handed back to the client must not carry the code.
    expect(JSON.stringify(challenge)).not.toContain(code);
  });

  it("stores the code hashed, never in plaintext", async () => {
    const { code } = await OtpService.issue({ purpose: "login", destination: "+911", userId: "u1" });
    const stored = mockQuery.create.mock.calls[0][0];

    expect(stored.otpHash).not.toBe(code);
    expect(await bcrypt.compare(code, stored.otpHash)).toBe(true);
  });

  it("enforces the resend cooldown", async () => {
    mockQuery.findLatestFor.mockResolvedValue({ createdAt: new Date() } as any);
    await expect(
      OtpService.issue({ purpose: "login", destination: "+911", userId: "u1" })
    ).rejects.toThrow(CustomException);
  });

  it("allows a resend once the cooldown has elapsed", async () => {
    mockQuery.findLatestFor.mockResolvedValue({
      createdAt: new Date(Date.now() - 60_000),
    } as any);
    await expect(
      OtpService.issue({ purpose: "login", destination: "+911", userId: "u1" })
    ).resolves.toBeDefined();
  });

  it("caps how many codes one destination can be sent per hour", async () => {
    mockQuery.countRecentFor.mockResolvedValue(5);
    await expect(
      OtpService.issue({ purpose: "login", destination: "+911", userId: "u1" })
    ).rejects.toThrow(CustomException);
  });
});

describe("verifyCode", () => {
  const challengeWith = async (code: string, overrides: Record<string, unknown> = {}) => ({
    id: "challenge-1",
    purpose: "login",
    destination: "+911",
    otpHash: await bcrypt.hash(code, 8),
    userId: "u1",
    attempts: 0,
    verifiedAt: null,
    consumedAt: null,
    expiresAt: futureDate(),
    ...overrides,
  });

  it("marks the challenge verified but NOT consumed — the form still has fields to fill", async () => {
    mockQuery.findById.mockResolvedValue((await challengeWith("123456")) as any);
    await expect(OtpService.verifyCode("challenge-1", "123456", "login")).resolves.toBeDefined();
    expect(mockQuery.markVerified).toHaveBeenCalled();
    // Spending it here would break registration, where the account is only
    // created by a later call.
    expect(mockQuery.markConsumed).not.toHaveBeenCalled();
  });

  it("extends the deadline on verification so the user can finish the form", async () => {
    mockQuery.findById.mockResolvedValue((await challengeWith("123456")) as any);
    await OtpService.verifyCode("challenge-1", "123456", "login");

    const [, newExpiry] = mockQuery.markVerified.mock.calls[0];
    // Comfortably beyond the 5-minute life of the code itself.
    expect(newExpiry.getTime()).toBeGreaterThan(Date.now() + 10 * 60 * 1000);
  });

  it("rejects a wrong code and counts the attempt", async () => {
    mockQuery.findById.mockResolvedValue((await challengeWith("123456")) as any);
    await expect(OtpService.verifyCode("challenge-1", "999999", "login")).rejects.toThrow(
      CustomException
    );
    expect(mockQuery.recordAttempt).toHaveBeenCalledWith("challenge-1");
    expect(mockQuery.markVerified).not.toHaveBeenCalled();
  });

  it("reports attemptsRemaining so the form can show 'N attempts left'", async () => {
    mockQuery.findById.mockResolvedValue((await challengeWith("123456", { attempts: 0 })) as any);
    const err = await OtpService.verifyCode("challenge-1", "999999", "login").catch((e) => e);
    // 5 allowed, 1 just used.
    expect(err.data).toEqual({ attemptsRemaining: 4 });

    mockQuery.findById.mockResolvedValue((await challengeWith("123456", { attempts: 3 })) as any);
    const err2 = await OtpService.verifyCode("challenge-1", "999999", "login").catch((e) => e);
    expect(err2.data).toEqual({ attemptsRemaining: 1 });
  });

  it("rejects an expired challenge", async () => {
    mockQuery.findById.mockResolvedValue(
      (await challengeWith("123456", { expiresAt: pastDate() })) as any
    );
    await expect(OtpService.verifyCode("challenge-1", "123456", "login")).rejects.toThrow(
      CustomException
    );
  });

  it("rejects replay of an already-consumed challenge, even with the right code", async () => {
    mockQuery.findById.mockResolvedValue(
      (await challengeWith("123456", { consumedAt: new Date() })) as any
    );
    await expect(OtpService.verifyCode("challenge-1", "123456", "login")).rejects.toThrow(
      CustomException
    );
  });

  it("refuses once the attempt cap is reached", async () => {
    mockQuery.findById.mockResolvedValue(
      (await challengeWith("123456", { attempts: 5 })) as any
    );
    await expect(OtpService.verifyCode("challenge-1", "123456", "login")).rejects.toThrow(
      CustomException
    );
  });

  it("refuses a challenge issued for a different purpose", async () => {
    // A password-reset code must not be usable to log in.
    mockQuery.findById.mockResolvedValue(
      (await challengeWith("123456", { purpose: "password_reset" })) as any
    );
    await expect(OtpService.verifyCode("challenge-1", "123456", "login")).rejects.toThrow(
      CustomException
    );
  });

  it("rejects an unknown verificationId", async () => {
    mockQuery.findById.mockResolvedValue(null);
    await expect(OtpService.verifyCode("nope", "123456", "login")).rejects.toThrow(CustomException);
  });

  it("gives the same message for wrong, expired and unknown — no oracle", async () => {
    const messages: string[] = [];

    mockQuery.findById.mockResolvedValue((await challengeWith("123456")) as any);
    await OtpService.verifyCode("challenge-1", "000000", "login").catch((e) => messages.push(e.message));

    mockQuery.findById.mockResolvedValue(
      (await challengeWith("123456", { expiresAt: pastDate() })) as any
    );
    await OtpService.verifyCode("challenge-1", "123456", "login").catch((e) => messages.push(e.message));

    mockQuery.findById.mockResolvedValue(null);
    await OtpService.verifyCode("unknown", "123456", "login").catch((e) => messages.push(e.message));

    expect(new Set(messages).size).toBe(1);
  });
});

describe("consumeVerified", () => {
  const verified = (overrides: Record<string, unknown> = {}) => ({
    id: "challenge-1",
    purpose: "register",
    destination: "+919876543210",
    otpHash: "x",
    userId: null,
    attempts: 0,
    verifiedAt: new Date(),
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });

  it("returns the challenge and burns it", async () => {
    mockQuery.findById.mockResolvedValue(verified() as any);
    const result = await OtpService.consumeVerified("challenge-1", "register");
    expect(result.destination).toBe("+919876543210");
    expect(mockQuery.markConsumed).toHaveBeenCalledWith("challenge-1");
  });

  it("refuses a challenge whose code was never verified", async () => {
    mockQuery.findById.mockResolvedValue(verified({ verifiedAt: null }) as any);
    await expect(OtpService.consumeVerified("challenge-1", "register")).rejects.toThrow(
      CustomException
    );
    expect(mockQuery.markConsumed).not.toHaveBeenCalled();
  });

  it("refuses a second use — one verification, one account", async () => {
    mockQuery.findById.mockResolvedValue(verified({ consumedAt: new Date() }) as any);
    await expect(OtpService.consumeVerified("challenge-1", "register")).rejects.toThrow(
      CustomException
    );
  });

  it("refuses once the completion window has passed", async () => {
    mockQuery.findById.mockResolvedValue(
      verified({ expiresAt: new Date(Date.now() - 1000) }) as any
    );
    await expect(OtpService.consumeVerified("challenge-1", "register")).rejects.toThrow(
      CustomException
    );
  });

  it("refuses a challenge from a different flow", async () => {
    mockQuery.findById.mockResolvedValue(verified({ purpose: "login" }) as any);
    await expect(OtpService.consumeVerified("challenge-1", "register")).rejects.toThrow(
      CustomException
    );
  });
});
