import bcrypt from "bcrypt";
import { CustomException } from "../../commons/Exception/CustomException.js";

// Factory-mocked so this test never loads the real Query -> Prisma client
// chain, which would otherwise need DATABASE_URL just to import.
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

// Auth.Service also reaches the OTP flows, which go through the Prisma client;
// mocking the Query keeps that chain out of this unit test.
jest.mock("../Queries/OtpChallenge.Query.js", () => ({
  OtpChallengeQuery: {
    create: jest.fn(),
    findById: jest.fn(),
    recordAttempt: jest.fn(),
    markConsumed: jest.fn(),
    countRecentFor: jest.fn().mockResolvedValue(0),
    findLatestFor: jest.fn().mockResolvedValue(null),
    deleteExpiredBefore: jest.fn(),
  },
}));

// Keeps OTP codes out of the test output, and makes it explicit that nothing
// here actually dispatches an SMS or email.
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
import { AuthService } from "./Auth.Service.js";

const mockedUserQuery = UserQuery as jest.Mocked<typeof UserQuery>;

beforeEach(() => {
  process.env.JWT_SECRET = "test-secret";
});

describe("AuthService.register", () => {
  it("rejects a duplicate email", async () => {
    mockedUserQuery.findByEmail.mockResolvedValue({ id: "1" } as any);
    await expect(
      AuthService.register({
        name: "A",
        email: "a@x.com",
        phoneNumber: "1",
        password: "plaintext-pw",
      })
    ).rejects.toThrow(CustomException);
  });

  it("ignores any client-supplied role and always registers as customer", async () => {
    mockedUserQuery.findByEmail.mockResolvedValue(null);
    mockedUserQuery.create.mockResolvedValue({
      id: "new-id",
      email: "a@x.com",
      role: "customer",
    } as any);

    await AuthService.register({
      name: "A",
      email: "a@x.com",
      phoneNumber: "1",
      password: "plaintext-pw",
      // @ts-expect-error role is intentionally not part of the public input type
      role: "admin",
    });

    const createArg = mockedUserQuery.create.mock.calls[0][0];
    expect(createArg.role).toBe("customer");
  });

  it("rejects a password shorter than the minimum length", async () => {
    mockedUserQuery.findByEmail.mockResolvedValue(null);
    await expect(
      AuthService.register({ name: "A", email: "a@x.com", phoneNumber: "1", password: "short" })
    ).rejects.toThrow(CustomException);
    expect(mockedUserQuery.create).not.toHaveBeenCalled();
  });

  it("rejects a malformed email", async () => {
    mockedUserQuery.findByEmail.mockResolvedValue(null);
    await expect(
      AuthService.register({
        name: "A",
        email: "not-an-email",
        phoneNumber: "1",
        password: "plaintext-pw",
      })
    ).rejects.toThrow(CustomException);
    expect(mockedUserQuery.create).not.toHaveBeenCalled();
  });

  it("maps a concurrent duplicate-email race (DB unique constraint) to a 409", async () => {
    mockedUserQuery.findByEmail.mockResolvedValue(null);
    // Asserted against Prisma's real error shape: the previous version matched
    // an ORM-specific string and kept passing after the code stopped working.
    mockedUserQuery.create.mockRejectedValue({ code: "P2002", meta: { target: ["email"] } });

    // Caught rather than matched: Jest compares thrown Errors by message, so
    // toMatchObject on errorCode would pass vacuously.
    const error = await AuthService.register({
      name: "A",
      email: "a@x.com",
      phoneNumber: "1",
      password: "plaintext-pw",
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(CustomException);
    expect(error.errorCode).toBe(409);
    expect(error.displayMessage).toContain("email");
  });

  it("reports the phone number, not the email, when the phone number is what clashed", async () => {
    mockedUserQuery.findByEmail.mockResolvedValue(null);
    mockedUserQuery.create.mockRejectedValue({ code: "P2002", meta: { target: ["phoneNumber"] } });

    const error = await AuthService.register({
      name: "A",
      email: "a@x.com",
      phoneNumber: "1",
      password: "plaintext-pw",
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(CustomException);
    expect(error.errorCode).toBe(409);
    expect(error.displayMessage).toContain("phone number");
  });

  it("does not swallow a database error that is not a unique violation", async () => {
    mockedUserQuery.findByEmail.mockResolvedValue(null);
    const outage = Object.assign(new Error("connection terminated"), { code: "P1001" });
    mockedUserQuery.create.mockRejectedValue(outage);

    await expect(
      AuthService.register({
        name: "A",
        email: "a@x.com",
        phoneNumber: "1",
        password: "plaintext-pw",
      })
    ).rejects.toBe(outage);
  });

  it("creates the user with a hashed (never plaintext) password", async () => {
    mockedUserQuery.findByEmail.mockResolvedValue(null);
    mockedUserQuery.create.mockResolvedValue({
      id: "new-id",
      email: "a@x.com",
      role: "customer",
    } as any);

    const result = await AuthService.register({
      name: "A",
      email: "a@x.com",
      phoneNumber: "1",
      password: "plaintext-pw",
    });

    expect(result).toEqual({ id: "new-id", email: "a@x.com", role: "customer" });
    const createArg = mockedUserQuery.create.mock.calls[0][0];
    expect(createArg.passwordHash).not.toBe("plaintext-pw");
    expect(await bcrypt.compare("plaintext-pw", createArg.passwordHash)).toBe(true);
  });
});

describe("AuthService.createPrivilegedUser", () => {
  it("rejects role: super_admin — only the seed script can create one", async () => {
    mockedUserQuery.findByEmail.mockResolvedValue(null);
    await expect(
      AuthService.createPrivilegedUser({
        name: "A",
        email: "a@x.com",
        phoneNumber: "1",
        password: "plaintext-pw",
        role: "super_admin",
      })
    ).rejects.toThrow(CustomException);
    expect(mockedUserQuery.create).not.toHaveBeenCalled();
  });

  it("rejects role: customer — that's what public /auth/register is for", async () => {
    mockedUserQuery.findByEmail.mockResolvedValue(null);
    await expect(
      AuthService.createPrivilegedUser({
        name: "A",
        email: "a@x.com",
        phoneNumber: "1",
        password: "plaintext-pw",
        role: "customer",
      })
    ).rejects.toThrow(CustomException);
    expect(mockedUserQuery.create).not.toHaveBeenCalled();
  });

  it("creates an admin account with the requested role", async () => {
    mockedUserQuery.findByEmail.mockResolvedValue(null);
    mockedUserQuery.create.mockResolvedValue({
      id: "new-id",
      email: "admin@x.com",
      role: "admin",
    } as any);

    const result = await AuthService.createPrivilegedUser({
      name: "Admin",
      email: "admin@x.com",
      phoneNumber: "1",
      password: "plaintext-pw",
      role: "admin",
    });

    expect(result).toEqual({ id: "new-id", email: "admin@x.com", role: "admin" });
    expect(mockedUserQuery.create.mock.calls[0][0].role).toBe("admin");
  });

  it("still enforces the same input validation as register", async () => {
    await expect(
      AuthService.createPrivilegedUser({
        name: "A",
        email: "a@x.com",
        phoneNumber: "1",
        password: "short",
        role: "staff",
      })
    ).rejects.toThrow(CustomException);
    expect(mockedUserQuery.create).not.toHaveBeenCalled();
  });
});

describe("AuthService.login", () => {
  it("rejects a missing password without hitting the database", async () => {
    await expect(AuthService.login("a@x.com", "")).rejects.toThrow(CustomException);
    expect(mockedUserQuery.findByEmail).not.toHaveBeenCalled();
  });

  it("rejects an unknown email", async () => {
    mockedUserQuery.findByEmail.mockResolvedValue(null);
    await expect(AuthService.login("nobody@x.com", "pw")).rejects.toThrow(CustomException);
  });

  it("rejects a deactivated account even with the correct password", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 4);
    mockedUserQuery.findByEmail.mockResolvedValue({
      id: "1",
      email: "a@x.com",
      passwordHash,
      isActive: false,
      role: "customer",
    } as any);
    await expect(AuthService.login("a@x.com", "correct-password")).rejects.toThrow(CustomException);
  });

  it("rejects the wrong password for an active account", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 4);
    mockedUserQuery.findByEmail.mockResolvedValue({
      id: "1",
      email: "a@x.com",
      passwordHash,
      isActive: true,
      role: "customer",
    } as any);
    await expect(AuthService.login("a@x.com", "wrong-password")).rejects.toThrow(CustomException);
  });

  it("issues a token and the user summary on correct credentials", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 4);
    mockedUserQuery.findByEmail.mockResolvedValue({
      id: "1",
      name: "A",
      email: "a@x.com",
      passwordHash,
      isActive: true,
      role: "staff",
    } as any);

    const result = await AuthService.login("a@x.com", "correct-password");

    expect(result.token).toEqual(expect.any(String));
    expect(result.user).toEqual({ id: "1", name: "A", email: "a@x.com", role: "staff" });
  });
});

describe("AuthService.verifyToken", () => {
  it("throws CustomException on a garbage token", () => {
    expect(() => AuthService.verifyToken("not-a-real-token")).toThrow(CustomException);
  });

  it("round-trips exactly what login() issued", async () => {
    const passwordHash = await bcrypt.hash("pw", 4);
    mockedUserQuery.findByEmail.mockResolvedValue({
      id: "42",
      name: "A",
      email: "a@x.com",
      passwordHash,
      isActive: true,
      role: "admin",
    } as any);

    const { token } = await AuthService.login("a@x.com", "pw");
    const decoded = AuthService.verifyToken(token);

    // jwt.verify() also returns standard "iat"/"exp" claims — only assert
    // the payload this service actually put there.
    expect(decoded).toEqual(expect.objectContaining({ userId: "42", role: "admin" }));
  });
});
