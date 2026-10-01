import { CustomException } from "../../commons/Exception/CustomException.js";

process.env.JWT_SECRET = "u".repeat(40);

jest.mock("../Queries/RefreshToken.Query.js", () => ({
  RefreshTokenQuery: require("../Testing/P13.Fakes").fakes.refreshTokenQuery,
}));
jest.mock("../Queries/User.Query.js", () => ({ UserQuery: require("../Testing/P13.Fakes").fakes.userQuery }));
jest.mock("../Queries/UserToken.Query.js", () => ({
  UserTokenQuery: require("../Testing/P13.Fakes").fakes.userTokenQuery,
}));

import { UsersService } from "./Users.Service.js";
import { SessionService } from "./Session.Service.js";
import { fakes, addUser } from "../Testing/P13.Fakes.js";

const STORE_A = "11111111-1111-4111-8111-111111111101";

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a rejection");
};
const liveSessions = (userId: string) => [...fakes.refresh.values()].filter((r) => r.userId === userId && !r.revokedAt);

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  fakes.reset();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

describe("internal deactivate", () => {
  it("switches the account off, ends every sign-in as deactivated, voids unused links, returns the internal shape", async () => {
    const user = addUser({ role: "staff", storeId: STORE_A });
    await SessionService.issue(user as any);
    await SessionService.issue(user as any);
    fakes.tokens.set("t1", {
      id: "t1", userId: user.id, purpose: "invite", tokenHash: "h", expiresAt: new Date(Date.now() + 1e6),
      consumedAt: null, createdAt: new Date(), createdById: null,
    });

    const result = await UsersService.deactivateInternalUser(user.id);

    expect(result).toEqual({
      id: user.id, name: user.name, email: user.email, phoneNumber: null, role: "staff", storeId: STORE_A, isActive: false,
    });
    expect(fakes.users.get(user.id)!.isActive).toBe(false);
    expect(liveSessions(user.id)).toHaveLength(0);
    expect([...fakes.refresh.values()].every((r) => r.revokedReason === "deactivated")).toBe(true);
    expect(fakes.tokens.get("t1")!.consumedAt).not.toBeNull();
  });

  it("leaves other users' sessions alone", async () => {
    const user = addUser({ role: "driver" });
    const other = addUser({ role: "driver" });
    await SessionService.issue(other as any);

    await UsersService.deactivateInternalUser(user.id);

    expect(liveSessions(other.id)).toHaveLength(1);
  });

  it("is idempotent: repeating it succeeds and still returns isActive false", async () => {
    const user = addUser({ role: "hr" });

    await UsersService.deactivateInternalUser(user.id);
    const again = await UsersService.deactivateInternalUser(user.id);

    expect(again.isActive).toBe(false);
  });

  it("works on any role, since HR offboards more than the dashboard team", async () => {
    for (const role of ["driver", "hr", "customer", "manager", "admin", "staff"]) {
      const user = addUser({ role });
      expect((await UsersService.deactivateInternalUser(user.id)).isActive).toBe(false);
    }
  });

  it("refuses the last active super_admin (409) and changes nothing; one of two is allowed, and repeating is fine", async () => {
    const only = addUser({ role: "super_admin" });
    await SessionService.issue(only as any);

    expect((await rejection(UsersService.deactivateInternalUser(only.id))).errorCode).toBe(409);
    expect(fakes.users.get(only.id)!.isActive).toBe(true);
    expect(liveSessions(only.id)).toHaveLength(1);

    const second = addUser({ role: "super_admin" });
    await expect(UsersService.deactivateInternalUser(second.id)).resolves.toMatchObject({ isActive: false });
    await expect(UsersService.deactivateInternalUser(second.id)).resolves.toMatchObject({ isActive: false });
  });

  it("is 404 for an unknown or malformed id", async () => {
    for (const id of ["00000000-0000-4000-8000-00000000ffff", "nope", ""]) {
      expect((await rejection(UsersService.deactivateInternalUser(id))).errorCode).toBe(404);
    }
  });
});

describe("internal reactivate", () => {
  it("switches it on, returns the internal shape, and is idempotent", async () => {
    const user = addUser({ role: "staff", isActive: false, storeId: STORE_A });

    const first = await UsersService.reactivateInternalUser(user.id);
    const second = await UsersService.reactivateInternalUser(user.id);

    expect(first).toEqual({
      id: user.id, name: user.name, email: user.email, phoneNumber: null, role: "staff", storeId: STORE_A, isActive: true,
    });
    expect(second.isActive).toBe(true);
    expect(fakes.users.get(user.id)!.isActive).toBe(true);
  });

  it("does not bring back sessions or links that deactivation ended", async () => {
    const user = addUser({ role: "staff" });
    await SessionService.issue(user as any);
    await UsersService.deactivateInternalUser(user.id);

    await UsersService.reactivateInternalUser(user.id);

    expect(liveSessions(user.id)).toHaveLength(0);
  });

  it("is 404 for an unknown or malformed id", async () => {
    for (const id of ["00000000-0000-4000-8000-00000000ffff", "nope"]) {
      expect((await rejection(UsersService.reactivateInternalUser(id))).errorCode).toBe(404);
    }
  });
});
