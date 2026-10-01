import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { CustomException } from "../../commons/Exception/CustomException.js";

// Sessions are covered in Session.Service.test.ts; here the store just has to accept writes.
jest.mock("../Queries/RefreshToken.Query.js", () => ({
  RefreshTokenQuery: {
    create: jest.fn().mockResolvedValue({}),
    purgeExpired: jest.fn().mockResolvedValue(0),
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  },
}));

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
    recordLogin: jest.fn(),
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

const STORE_ID = "11111111-1111-4111-8111-111111111101";

const accountRow = (overrides: object = {}) => ({
  id: "1",
  name: "Asha Rao",
  email: "a@x.com",
  phoneNumber: "+919876500001",
  isActive: true,
  role: "manager",
  storeId: STORE_ID,
  lastLoginAt: null,
  createdAt: new Date("2026-01-05T08:00:00.000Z"),
  ...overrides,
});

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

  it("reports a non-unique database failure as a generic 500, never as a 409", async () => {
    const logSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedUserQuery.findByEmail.mockResolvedValue(null);
    const outage = Object.assign(new Error("connection terminated"), { code: "P1001" });
    mockedUserQuery.create.mockRejectedValue(outage);

    const error = await AuthService.register({
      name: "A",
      email: "a@x.com",
      phoneNumber: "1",
      password: "plaintext-pw",
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(CustomException);
    expect(error.errorCode).toBe(500);
    // The driver's own message must not reach the client.
    expect(error.displayMessage).not.toContain("connection terminated");
    // ...but it is logged, so the real cause is still findable.
    expect(logSpy).toHaveBeenCalledWith(outage);
    logSpy.mockRestore();
  });

  it("puts an unexpected query failure into the standard error format (login)", async () => {
    const logSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedUserQuery.findByEmail.mockRejectedValue(new Error("pool exhausted"));

    const error = await AuthService.login("a@x.com", "plaintext-pw").catch((caught) => caught);

    expect(error).toBeInstanceOf(CustomException);
    expect(error.errorCode).toBe(500);
    logSpy.mockRestore();
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

  it.each(["manager", "hr", "staff", "driver"] as const)(
    "creates a %s account — the store manager, HR & Operations, staff and rider roles",
    async (role) => {
      mockedUserQuery.findByEmail.mockResolvedValue(null);
      mockedUserQuery.create.mockResolvedValue({ id: "new-id", email: "x@x.com", role } as any);

      const result = await AuthService.createPrivilegedUser({
        name: "Person",
        email: "x@x.com",
        phoneNumber: "1",
        password: "plaintext-pw",
        role,
      });

      expect(result.role).toBe(role);
      expect(mockedUserQuery.create.mock.calls[0][0].role).toBe(role);
    }
  );

  it("store manager and HR accounts can never be given super_admin or customer through this API", async () => {
    for (const role of ["super_admin", "customer"] as const) {
      const error = await AuthService.createPrivilegedUser({
        name: "P",
        email: "p@x.com",
        phoneNumber: "1",
        password: "plaintext-pw",
        role,
      }).catch((caught) => caught);

      expect(error).toBeInstanceOf(CustomException);
      expect(error.errorCode).toBe(400);
    }
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

  it("returns the dashboard user shape and a token carrying the store", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 4);
    mockedUserQuery.findByEmail.mockResolvedValue(accountRow({ passwordHash }) as any);
    const loggedInAt = new Date("2026-09-30T10:00:00.000Z");
    mockedUserQuery.recordLogin.mockResolvedValue(
      accountRow({ passwordHash, lastLoginAt: loggedInAt }) as any
    );

    const result = await AuthService.login("a@x.com", "correct-password");

    expect(result.user).toEqual({
      id: "1",
      name: "Asha Rao",
      email: "a@x.com",
      phone: "+919876500001",
      role: "manager",
      storeId: STORE_ID,
      initials: "AR",
      status: "active",
      lastActiveAt: "2026-09-30T10:00:00.000Z",
      joinedAt: "2026-01-05T08:00:00.000Z",
    });
    expect(AuthService.verifyToken(result.token)).toEqual({
      userId: "1",
      role: "manager",
      storeId: STORE_ID,
      name: "Asha Rao",
    });
  });

  it("stamps lastLoginAt on success", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 4);
    mockedUserQuery.findByEmail.mockResolvedValue(accountRow({ passwordHash }) as any);
    mockedUserQuery.recordLogin.mockResolvedValue(accountRow({ passwordHash }) as any);

    await AuthService.login("a@x.com", "correct-password");

    expect(mockedUserQuery.recordLogin).toHaveBeenCalledWith("1");
  });

  it("does not stamp lastLoginAt on a wrong password or an inactive account", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 4);
    mockedUserQuery.findByEmail.mockResolvedValue(accountRow({ passwordHash }) as any);
    await expect(AuthService.login("a@x.com", "wrong-password")).rejects.toThrow(CustomException);

    mockedUserQuery.findByEmail.mockResolvedValue(
      accountRow({ passwordHash, isActive: false }) as any
    );
    await expect(AuthService.login("a@x.com", "correct-password")).rejects.toThrow(CustomException);

    expect(mockedUserQuery.recordLogin).not.toHaveBeenCalled();
  });

  it("falls back to createdAt for lastActiveAt when the row has no login stamp", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 4);
    mockedUserQuery.findByEmail.mockResolvedValue(accountRow({ passwordHash }) as any);
    mockedUserQuery.recordLogin.mockResolvedValue(
      accountRow({ passwordHash, lastLoginAt: null }) as any
    );

    const { user } = await AuthService.login("a@x.com", "correct-password");

    expect(user.lastActiveAt).toBe(user.joinedAt);
  });
});

describe("AuthService.getProfile", () => {
  it("returns the dashboard user read fresh from the database", async () => {
    mockedUserQuery.findById.mockResolvedValue(accountRow({ role: "admin", storeId: null }) as any);

    await expect(AuthService.getProfile("1")).resolves.toMatchObject({
      id: "1",
      role: "admin",
      storeId: null,
      status: "active",
    });
    expect(mockedUserQuery.findById).toHaveBeenCalledWith("1");
  });

  it("rejects with 401 when the account is gone", async () => {
    mockedUserQuery.findById.mockResolvedValue(null);
    const error = await AuthService.getProfile("missing").catch((e) => e);
    expect(error).toBeInstanceOf(CustomException);
    expect(error.errorCode).toBe(401);
  });

  it("rejects with 401 when the account was deactivated", async () => {
    mockedUserQuery.findById.mockResolvedValue(accountRow({ isActive: false }) as any);
    const error = await AuthService.getProfile("1").catch((e) => e);
    expect(error.errorCode).toBe(401);
  });
});

describe("AuthService.customerLogin", () => {
  const customer = (overrides: object = {}) =>
    accountRow({ role: "customer", storeId: null, isPhoneVerified: true, ...overrides });

  it("signs a customer in with email and password and returns a token pair", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 4);
    mockedUserQuery.findByEmail.mockResolvedValue(customer({ passwordHash }) as any);
    mockedUserQuery.recordLogin.mockResolvedValue(customer({ passwordHash }) as any);

    const result = await AuthService.customerLogin("a@x.com", "correct-password");

    expect(result.user).toEqual({
      id: "1",
      name: "Asha Rao",
      email: "a@x.com",
      phoneNumber: "+919876500001",
      isPhoneVerified: true,
      role: "customer",
    });
    expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.expiresIn).toBe(900);
    expect(AuthService.verifyToken(result.token)).toMatchObject({ userId: "1", role: "customer" });
    expect(mockedUserQuery.recordLogin).toHaveBeenCalledWith("1");
  });

  it.each(["admin", "manager", "staff", "hr", "driver", "super_admin"])(
    "refuses a %s account with the same 401 as a wrong password",
    async (role) => {
      const passwordHash = await bcrypt.hash("correct-password", 4);
      mockedUserQuery.findByEmail.mockResolvedValue(customer({ passwordHash, role }) as any);

      const error = await AuthService.customerLogin("a@x.com", "correct-password").catch((e) => e);

      expect(error).toBeInstanceOf(CustomException);
      expect(error.errorCode).toBe(401);
      expect(error.displayMessage).toBe("Invalid email or password.");
      expect(mockedUserQuery.recordLogin).not.toHaveBeenCalled();
    }
  );

  it("answers a wrong password, an unknown email, a social account and a deactivated account identically", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 4);
    const attempts: Array<[object | null, string]> = [
      [customer({ passwordHash }), "wrong-password"],
      [null, "correct-password"],
      [customer({ passwordHash: null }), "correct-password"],
      [customer({ passwordHash, isActive: false }), "correct-password"],
    ];

    const errors = [];
    for (const [row, password] of attempts) {
      mockedUserQuery.findByEmail.mockResolvedValue(row as any);
      errors.push(await AuthService.customerLogin("a@x.com", password).catch((e) => e));
    }

    for (const error of errors) {
      expect(error.errorCode).toBe(401);
      expect(error.displayMessage).toBe("Invalid email or password.");
    }
  });

  it.each([[undefined, "pw"], ["a@x.com", undefined], ["", "pw"], ["a@x.com", ""], [42, "pw"], [{}, "pw"]])(
    "rejects missing or malformed input (%p, %p) with a 400 before touching the database",
    async (email, password) => {
      mockedUserQuery.findByEmail.mockClear();

      const error = await AuthService.customerLogin(email as any, password as any).catch((e) => e);

      expect(error.errorCode).toBe(400);
      expect(mockedUserQuery.findByEmail).not.toHaveBeenCalled();
    }
  );
});

describe("AuthService.verifyToken", () => {
  it("throws CustomException on a garbage token", () => {
    expect(() => AuthService.verifyToken("not-a-real-token")).toThrow(CustomException);
  });

  it("round-trips exactly what login() issued", async () => {
    const passwordHash = await bcrypt.hash("pw", 4);
    const row = accountRow({ id: "42", passwordHash, role: "admin", storeId: null });
    mockedUserQuery.findByEmail.mockResolvedValue(row as any);
    mockedUserQuery.recordLogin.mockResolvedValue(row as any);

    const { token } = await AuthService.login("a@x.com", "pw");

    // verifyToken returns only the claims this service put there, not iat/exp.
    expect(AuthService.verifyToken(token)).toEqual({
      userId: "42",
      role: "admin",
      storeId: null,
      name: "Asha Rao",
    });
  });

  it("returns the storeId a token carries", () => {
    const token = jwt.sign({ userId: "7", role: "staff", storeId: "store-7", name: "Zoe" }, "test-secret", {
      algorithm: "HS256",
    });
    expect(AuthService.verifyToken(token)).toEqual({ userId: "7", role: "staff", storeId: "store-7", name: "Zoe" });
  });

  it("treats a token issued before storeId existed as having no store", () => {
    const token = jwt.sign({ userId: "7", role: "staff" }, "test-secret", { algorithm: "HS256" });
    expect(AuthService.verifyToken(token)).toEqual({ userId: "7", role: "staff", storeId: null, name: null });
  });
});
