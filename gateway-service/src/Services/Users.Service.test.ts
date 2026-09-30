import bcrypt from "bcrypt";
import { CustomException } from "../../commons/Exception/CustomException.js";

// Sessions are covered in Session.Service.test.ts; here the store just has to accept writes.
jest.mock("../Queries/RefreshToken.Query.js", () => ({
  RefreshTokenQuery: {
    create: jest.fn().mockResolvedValue({}),
    purgeExpired: jest.fn().mockResolvedValue(0),
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  },
}));

// Factory-mocked so this never loads the Prisma client, which needs a database URL to import.
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
    search: jest.fn(),
    updateProfile: jest.fn(),
    setActive: jest.fn(),
    countActiveByRole: jest.fn(),
  },
}));

// Auth.Service, used below to prove a created account can really sign in, reaches the OTP queries.
jest.mock("../Queries/OtpChallenge.Query.js", () => ({
  OtpChallengeQuery: {},
}));
jest.mock("./OtpSender.Service.js", () => ({ OtpSender: {} }));
jest.mock("./OAuth.Service.js", () => ({ OAuthService: {} }));

import { UserQuery } from "../Queries/User.Query.js";
import { RefreshTokenQuery } from "../Queries/RefreshToken.Query.js";
import { UsersService, UserActor } from "./Users.Service.js";
import { AuthService } from "./Auth.Service.js";

const queries = UserQuery as jest.Mocked<typeof UserQuery>;

const STORE_A = "11111111-1111-4111-8111-111111111101";
const STORE_B = "11111111-1111-4111-8111-111111111102";
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const superAdmin: UserActor = { id: UUID(1), role: "super_admin", storeId: null };
const admin: UserActor = { id: UUID(2), role: "admin", storeId: null };
const manager: UserActor = { id: UUID(3), role: "manager", storeId: STORE_A };

const row = (overrides: Record<string, unknown> = {}) => ({
  id: UUID(10),
  name: "Sanjay Kulkarni",
  email: "sanjay@loclaundry.in",
  passwordHash: "hash",
  phoneNumber: "+919876500006",
  isPhoneVerified: false,
  oauthProvider: null,
  oauthSubject: null,
  role: "staff",
  isActive: true,
  storeId: STORE_A,
  lastLoginAt: null,
  createdAt: new Date("2026-01-05T08:00:00.000Z"),
  ...overrides,
});

const newUser = {
  name: "  Nikhil Bhat ",
  email: "  Nikhil.Bhat@LocLaundry.in ",
  phone: "+91 98765-00012",
  role: "staff",
  storeId: STORE_A,
};

// Caught rather than matched: Jest compares thrown Errors by message, so a status check
// written as toMatchObject would pass vacuously.
const failure = async (promise: Promise<unknown>): Promise<CustomException> => {
  const error = await promise.then(
    () => undefined,
    (e) => e
  );
  expect(error).toBeInstanceOf(CustomException);
  return error as CustomException;
};

let errorSpy: jest.SpyInstance;

beforeEach(() => {
  process.env.JWT_SECRET = "test-secret";
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  queries.create.mockImplementation(async (data: any) => row({ ...data, id: UUID(99) }) as any);
  queries.updateProfile.mockImplementation(async (id: string, patch: any) => row({ id, ...patch }) as any);
  queries.setActive.mockImplementation(async (id: string, isActive: boolean) => row({ id, isActive }) as any);
});

afterEach(() => errorSpy.mockRestore());

describe("UsersService.createUser", () => {
  it("normalises input, stores a bcrypt hash and returns the temporary password once", async () => {
    const result = await UsersService.createUser(admin, newUser);

    const stored = queries.create.mock.calls[0][0];
    expect(stored).toMatchObject({
      name: "Nikhil Bhat",
      email: "nikhil.bhat@loclaundry.in",
      phoneNumber: "+919876500012",
      role: "staff",
      storeId: STORE_A,
      isActive: true,
    });
    const temporaryPassword = result.temporaryPassword as string;
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(14);
    expect(stored.passwordHash).not.toBe(temporaryPassword);
    await expect(bcrypt.compare(temporaryPassword, stored.passwordHash as string)).resolves.toBe(true);
    // The hash is never part of the response.
    expect(JSON.stringify(result)).not.toContain(stored.passwordHash as string);
    expect(result).toMatchObject({ role: "staff", status: "active", initials: "NB" });
  });

  it("generates a different temporary password every time", async () => {
    const first = await UsersService.createUser(admin, newUser);
    const second = await UsersService.createUser(admin, newUser);
    expect(first.temporaryPassword).not.toBe(second.temporaryPassword);
  });

  it("does not log the temporary password", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const result = await UsersService.createUser(admin, newUser);
    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ");
    expect(logged).not.toContain(result.temporaryPassword as string);
    logSpy.mockRestore();
  });

  it("uses a supplied password instead and returns no temporary one", async () => {
    const result = await UsersService.createUser(admin, { ...newUser, password: "Chosen-pass-1" });

    expect(result.temporaryPassword).toBeUndefined();
    const stored = queries.create.mock.calls[0][0];
    await expect(bcrypt.compare("Chosen-pass-1", stored.passwordHash as string)).resolves.toBe(true);
  });

  it("rejects a supplied password below the minimum length", async () => {
    const error = await failure(UsersService.createUser(admin, { ...newUser, password: "short" }));
    expect(error.errorCode).toBe(400);
    expect(queries.create).not.toHaveBeenCalled();
  });

  it("lets an account sign in with its temporary password, and stops it once deactivated", async () => {
    const created = await UsersService.createUser(admin, newUser);
    const stored = queries.create.mock.calls[0][0];
    const account = row({ ...stored, id: UUID(99) });

    queries.findByEmail.mockResolvedValue(account as any);
    queries.recordLogin.mockResolvedValue(account as any);
    await expect(
      AuthService.login("nikhil.bhat@loclaundry.in", created.temporaryPassword as string)
    ).resolves.toMatchObject({ user: { email: "nikhil.bhat@loclaundry.in", storeId: STORE_A } });

    queries.findByEmail.mockResolvedValue({ ...account, isActive: false } as any);
    const error = await failure(
      AuthService.login("nikhil.bhat@loclaundry.in", created.temporaryPassword as string)
    );
    expect(error.errorCode).toBe(401);
  });

  it.each(["hr", "driver", "customer", "super_admin", "owner", undefined, 5])(
    "refuses the role %p",
    async (role) => {
      const error = await failure(UsersService.createUser(superAdmin, { ...newUser, role }));
      expect(error.errorCode).toBe(400);
      expect(queries.create).not.toHaveBeenCalled();
    }
  );

  it.each([
    [{ name: "" }],
    [{ name: "x".repeat(101) }],
    [{ email: "not-an-email" }],
    [{ phone: "12" }],
    [{ phone: "call me" }],
    [{ storeId: "store-1" }],
    [{ storeId: 7 }],
  ])("rejects invalid input %p", async (patch) => {
    const error = await failure(UsersService.createUser(admin, { ...newUser, ...patch }));
    expect(error.errorCode).toBe(400);
    expect(queries.create).not.toHaveBeenCalled();
  });

  describe("privilege rules", () => {
    it("lets only a super_admin create an admin", async () => {
      const refused = await failure(UsersService.createUser(admin, { ...newUser, role: "admin" }));
      expect(refused.errorCode).toBe(403);
      expect(queries.create).not.toHaveBeenCalled();

      await expect(
        UsersService.createUser(superAdmin, { ...newUser, role: "admin" })
      ).resolves.toMatchObject({ role: "admin" });
    });

    it.each(["manager", "staff"])("lets an admin create a %s", async (role) => {
      await expect(UsersService.createUser(admin, { ...newUser, role })).resolves.toMatchObject({ role });
    });

    it("does not pin an admin to a store", async () => {
      await UsersService.createUser(superAdmin, { ...newUser, role: "admin" });
      expect(queries.create.mock.calls[0][0].storeId).toBeNull();
    });
  });

  describe("duplicates", () => {
    it("answers 409 for a duplicate email in Prisma's classic shape", async () => {
      queries.create.mockRejectedValue({ code: "P2002", meta: { target: ["email"] } });
      const error = await failure(UsersService.createUser(admin, newUser));
      expect(error.errorCode).toBe(409);
      expect(error.displayMessage).toMatch(/email/);
    });

    it("answers 409 for a duplicate phone in the pg driver-adapter shape", async () => {
      queries.create.mockRejectedValue({
        code: "P2002",
        message: "Unique constraint failed",
        meta: {
          driverAdapterError: {
            cause: { constraint: { index: "gateway_users_phoneNumber_key" } },
          },
        },
      });
      const error = await failure(UsersService.createUser(admin, newUser));
      expect(error.errorCode).toBe(409);
      expect(error.displayMessage).toMatch(/phone/);
    });

    it("turns any other database failure into a generic 500", async () => {
      queries.create.mockRejectedValue(new Error("connection terminated"));
      const error = await failure(UsersService.createUser(admin, newUser));
      expect(error.errorCode).toBe(500);
    });
  });
});

describe("UsersService.listUsers", () => {
  beforeEach(() => queries.search.mockResolvedValue([row() as any]));

  it("returns the dashboard shape", async () => {
    const result = await UsersService.listUsers(admin, {});
    expect(result).toEqual([
      expect.objectContaining({ id: UUID(10), phone: "+919876500006", status: "active", initials: "SK" }),
    ]);
    expect(result[0]).not.toHaveProperty("passwordHash");
  });

  it("covers only the team roles, never customers", async () => {
    await UsersService.listUsers(admin, {});
    expect(queries.search).toHaveBeenCalledWith({
      roles: ["super_admin", "admin", "manager", "staff"],
      storeId: undefined,
      q: undefined,
    });
  });

  it("lets an admin filter by store, role and search text", async () => {
    await UsersService.listUsers(admin, { storeId: STORE_B, role: "staff", q: "san" });
    expect(queries.search).toHaveBeenCalledWith({ roles: ["staff"], storeId: STORE_B, q: "san" });
  });

  it("forces a manager to their own store whatever they ask for", async () => {
    await UsersService.listUsers(manager, { storeId: STORE_B });
    expect(queries.search).toHaveBeenCalledWith(expect.objectContaining({ storeId: STORE_A }));
  });

  it("refuses a manager who is not assigned to a store", async () => {
    const error = await failure(UsersService.listUsers({ ...manager, storeId: null }, {}));
    expect(error.errorCode).toBe(403);
    expect(error.displayMessage).toBe("Your account is not assigned to a store.");
    expect(queries.search).not.toHaveBeenCalled();
  });

  it.each([[{ role: "customer" }], [{ role: ["staff"] }], [{ storeId: "all" }]])(
    "rejects the bad filter %p",
    async (filters) => {
      const error = await failure(UsersService.listUsers(admin, filters));
      expect(error.errorCode).toBe(400);
    }
  );
});

describe("UsersService.updateUser", () => {
  const staff = row();

  it("changes only the fields supplied", async () => {
    queries.findById.mockResolvedValue(staff as any);

    await UsersService.updateUser(admin, staff.id, { name: " Sanjay K ", storeId: STORE_B });

    expect(queries.updateProfile).toHaveBeenCalledWith(staff.id, { name: "Sanjay K", storeId: STORE_B });
  });

  it("clears the store with an explicit null", async () => {
    queries.findById.mockResolvedValue(staff as any);
    await UsersService.updateUser(admin, staff.id, { storeId: null });
    expect(queries.updateProfile).toHaveBeenCalledWith(staff.id, { storeId: null });
  });

  it("rejects an empty update and a malformed store id", async () => {
    queries.findById.mockResolvedValue(staff as any);
    expect((await failure(UsersService.updateUser(admin, staff.id, {}))).errorCode).toBe(400);
    expect(
      (await failure(UsersService.updateUser(admin, staff.id, { storeId: "store-1" }))).errorCode
    ).toBe(400);
    expect(queries.updateProfile).not.toHaveBeenCalled();
  });

  it("answers 404 for a malformed id, a missing user and a non-team account", async () => {
    expect((await failure(UsersService.updateUser(admin, "nope", { name: "X" }))).errorCode).toBe(404);

    queries.findById.mockResolvedValue(null);
    expect((await failure(UsersService.updateUser(admin, UUID(5), { name: "X" }))).errorCode).toBe(404);

    queries.findById.mockResolvedValue(row({ role: "customer" }) as any);
    expect((await failure(UsersService.updateUser(admin, UUID(5), { name: "X" }))).errorCode).toBe(404);
    expect(queries.findById).toHaveBeenCalledTimes(2);
  });

  it("answers 409 when the new phone number is taken", async () => {
    queries.findById.mockResolvedValue(staff as any);
    queries.updateProfile.mockRejectedValue({ code: "P2002", meta: { target: ["phoneNumber"] } });
    const error = await failure(UsersService.updateUser(admin, staff.id, { phone: "+919876500099" }));
    expect(error.errorCode).toBe(409);
  });

  describe("privilege matrix", () => {
    it("lets an admin change staff and managers", async () => {
      queries.findById.mockResolvedValue(staff as any);
      await expect(UsersService.updateUser(admin, staff.id, { role: "manager" })).resolves.toMatchObject({
        role: "manager",
      });
    });

    it("stops an admin promoting anyone to admin", async () => {
      queries.findById.mockResolvedValue(staff as any);
      const error = await failure(UsersService.updateUser(admin, staff.id, { role: "admin" }));
      expect(error.errorCode).toBe(403);
      expect(queries.updateProfile).not.toHaveBeenCalled();
    });

    it("stops an admin editing an admin or a super_admin", async () => {
      for (const role of ["admin", "super_admin"]) {
        queries.findById.mockResolvedValue(row({ role, storeId: null }) as any);
        const error = await failure(UsersService.updateUser(admin, UUID(20), { name: "Renamed" }));
        expect(error.errorCode).toBe(403);
      }
      expect(queries.updateProfile).not.toHaveBeenCalled();
    });

    it("lets a super_admin promote to admin, which drops the store", async () => {
      queries.findById.mockResolvedValue(staff as any);
      await UsersService.updateUser(superAdmin, staff.id, { role: "admin" });
      expect(queries.updateProfile).toHaveBeenCalledWith(staff.id, { role: "admin", storeId: null });
    });

    it("never assigns super_admin through the API", async () => {
      queries.findById.mockResolvedValue(staff as any);
      const error = await failure(UsersService.updateUser(superAdmin, staff.id, { role: "super_admin" }));
      expect(error.errorCode).toBe(400);
    });

    it("lets a super_admin rename a super_admin, re-sending the unchanged role", async () => {
      queries.findById.mockResolvedValue(row({ role: "super_admin", storeId: null }) as any);
      await UsersService.updateUser(superAdmin, UUID(20), { name: "Anita R", role: "super_admin" });
      expect(queries.updateProfile).toHaveBeenCalledWith(UUID(20), { name: "Anita R", storeId: null });
    });
  });

  describe("last super_admin", () => {
    const lastSuper = row({ id: UUID(30), role: "super_admin", storeId: null });

    it("cannot be demoted", async () => {
      queries.findById.mockResolvedValue(lastSuper as any);
      queries.countActiveByRole.mockResolvedValue(1);
      const error = await failure(UsersService.updateUser(superAdmin, UUID(30), { role: "admin" }));
      expect(error.errorCode).toBe(409);
      expect(queries.updateProfile).not.toHaveBeenCalled();
    });

    it("can be demoted once another active super_admin exists", async () => {
      queries.findById.mockResolvedValue(lastSuper as any);
      queries.countActiveByRole.mockResolvedValue(2);
      await expect(
        UsersService.updateUser(superAdmin, UUID(30), { role: "admin" })
      ).resolves.toMatchObject({ role: "admin" });
    });
  });
});

describe("UsersService.deactivateUser and reactivateUser", () => {
  const staff = row();

  it("deactivates a staff member", async () => {
    queries.findById.mockResolvedValue(staff as any);
    const result = await UsersService.deactivateUser(admin, staff.id);
    expect(queries.setActive).toHaveBeenCalledWith(staff.id, false);
    expect(result.status).toBe("suspended");
  });

  it("ends every sign-in of a deactivated account straight away", async () => {
    queries.findById.mockResolvedValue(staff as any);

    await UsersService.deactivateUser(admin, staff.id);

    expect(RefreshTokenQuery.revokeAllForUser).toHaveBeenCalledWith(staff.id, "deactivated");
  });

  it("refuses to let you deactivate yourself", async () => {
    queries.findById.mockResolvedValue(
      row({ id: superAdmin.id, role: "super_admin", storeId: null }) as any
    );
    queries.countActiveByRole.mockResolvedValue(3);
    const error = await failure(UsersService.deactivateUser(superAdmin, superAdmin.id));
    expect(error.errorCode).toBe(400);
    expect(queries.setActive).not.toHaveBeenCalled();
  });

  it("refuses to deactivate the last active super_admin", async () => {
    queries.findById.mockResolvedValue(row({ id: UUID(30), role: "super_admin", storeId: null }) as any);
    queries.countActiveByRole.mockResolvedValue(1);
    const error = await failure(UsersService.deactivateUser(superAdmin, UUID(30)));
    expect(error.errorCode).toBe(409);
    expect(queries.setActive).not.toHaveBeenCalled();
  });

  it("can deactivate a super_admin while another remains", async () => {
    queries.findById.mockResolvedValue(row({ id: UUID(30), role: "super_admin", storeId: null }) as any);
    queries.countActiveByRole.mockResolvedValue(2);
    await UsersService.deactivateUser(superAdmin, UUID(30));
    expect(queries.setActive).toHaveBeenCalledWith(UUID(30), false);
  });

  it("stops an admin deactivating or reactivating an admin", async () => {
    queries.findById.mockResolvedValue(row({ id: UUID(31), role: "admin", storeId: null }) as any);
    expect((await failure(UsersService.deactivateUser(admin, UUID(31)))).errorCode).toBe(403);
    expect((await failure(UsersService.reactivateUser(admin, UUID(31)))).errorCode).toBe(403);
    expect(queries.setActive).not.toHaveBeenCalled();
  });

  it("reactivates an account", async () => {
    queries.findById.mockResolvedValue(row({ isActive: false }) as any);
    const result = await UsersService.reactivateUser(admin, staff.id);
    expect(queries.setActive).toHaveBeenCalledWith(staff.id, true);
    expect(result.status).toBe("active");
  });

  it("answers 404 for an unknown user", async () => {
    queries.findById.mockResolvedValue(null);
    expect((await failure(UsersService.deactivateUser(admin, UUID(40)))).errorCode).toBe(404);
    expect((await failure(UsersService.reactivateUser(admin, UUID(40)))).errorCode).toBe(404);
  });
});
