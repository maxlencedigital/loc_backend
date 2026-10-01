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
const STORE_B = "11111111-1111-4111-8111-111111111102";
const superAdmin = { id: "00000000-0000-4000-8000-0000000000aa", role: "super_admin" as const, storeId: null };
const admin = { id: "00000000-0000-4000-8000-0000000000ab", role: "admin" as const, storeId: null };
const managerOf = (storeId: string | null) => ({ id: "00000000-0000-4000-8000-0000000000ac", role: "manager" as const, storeId });

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

describe("getUser", () => {
  it("returns the list row plus the detail fields, with the single store as storeIds", async () => {
    const user = addUser({ role: "staff", storeId: STORE_A, phoneNumber: "+919800000001", isPhoneVerified: true });

    const result = await UsersService.getUser(admin, user.id);

    expect(result).toMatchObject({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: "+919800000001",
      phoneNumber: "+919800000001",
      role: "staff",
      storeId: STORE_A,
      storeIds: [STORE_A],
      isActive: true,
      isPhoneVerified: true,
      status: "active",
    });
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("an account with no store has an empty storeIds and a null phoneNumber", async () => {
    const user = addUser({ role: "admin", storeId: null });

    expect(await UsersService.getUser(admin, user.id)).toMatchObject({ storeIds: [], phoneNumber: null });
  });

  it("a manager sees their own store's team and nobody else: other stores and unassigned accounts are 404", async () => {
    const mine = addUser({ role: "staff", storeId: STORE_A });
    const theirs = addUser({ role: "staff", storeId: STORE_B });
    const unassigned = addUser({ role: "staff", storeId: null });
    const adminAccount = addUser({ role: "admin", storeId: null });

    await expect(UsersService.getUser(managerOf(STORE_A), mine.id)).resolves.toMatchObject({ id: mine.id });
    for (const target of [theirs, unassigned, adminAccount]) {
      expect((await rejection(UsersService.getUser(managerOf(STORE_A), target.id))).errorCode).toBe(404);
    }
  });

  it("a manager with no store is refused with 403, as in the list", async () => {
    const user = addUser({ role: "staff", storeId: STORE_A });

    expect((await rejection(UsersService.getUser(managerOf(null), user.id))).errorCode).toBe(403);
  });

  it("customers, drivers, unknown and malformed ids are 404 (the team screens only reach team roles)", async () => {
    const customer = addUser({ role: "customer" });
    const driver = addUser({ role: "driver" });

    for (const id of [customer.id, driver.id, "00000000-0000-4000-8000-00000000ffff", "not-a-uuid", "1; drop table"]) {
      expect((await rejection(UsersService.getUser(admin, id))).errorCode).toBe(404);
    }
  });
});

describe("listRoles", () => {
  it("a super_admin may hand out admin, manager and staff, never super_admin", async () => {
    const { roles } = await UsersService.listRoles(superAdmin);

    expect(roles.map((r) => r.role)).toEqual(["admin", "manager", "staff"]);
    expect(roles.every((r) => r.description.length > 10)).toBe(true);
  });

  it("an admin may hand out only manager and staff", async () => {
    const { roles } = await UsersService.listRoles(admin);

    expect(roles.map((r) => r.role)).toEqual(["manager", "staff"]);
  });
});

describe("setUserStores", () => {
  it("assigns the store and ends the account's refresh tokens so it applies at once", async () => {
    const user = addUser({ role: "staff", storeId: STORE_A });
    await SessionService.issue(user as any);
    await SessionService.issue(user as any);

    const result = await UsersService.setUserStores(admin, user.id, { storeIds: [STORE_B] });

    expect(result).toMatchObject({ storeId: STORE_B, storeIds: [STORE_B] });
    expect(fakes.users.get(user.id)!.storeId).toBe(STORE_B);
    expect(liveSessions(user.id)).toHaveLength(0);
    expect([...fakes.refresh.values()].every((r) => r.revokedReason === "store_changed")).toBe(true);
  });

  it("other users' sessions are untouched", async () => {
    const user = addUser({ role: "staff", storeId: STORE_A });
    const bystander = addUser({ role: "staff", storeId: STORE_A });
    await SessionService.issue(bystander as any);

    await UsersService.setUserStores(admin, user.id, { storeIds: [STORE_B] });

    expect(liveSessions(bystander.id)).toHaveLength(1);
  });

  it("an empty list takes the store away", async () => {
    const user = addUser({ role: "manager", storeId: STORE_A });

    const result = await UsersService.setUserStores(admin, user.id, { storeIds: [] });

    expect(result.storeIds).toEqual([]);
    expect(fakes.users.get(user.id)!.storeId).toBeNull();
  });

  it("setting the store the account already has changes nothing and does not sign anyone out", async () => {
    const user = addUser({ role: "staff", storeId: STORE_A });
    await SessionService.issue(user as any);

    await UsersService.setUserStores(admin, user.id, { storeIds: [STORE_A] });

    expect(liveSessions(user.id)).toHaveLength(1);
  });

  it("validates the list: an array of at most one UUID", async () => {
    const user = addUser({ role: "staff", storeId: STORE_A });

    for (const storeIds of [undefined, null, "x", STORE_B, ["not-a-uuid"], [STORE_A, STORE_B], [5], [null], { 0: STORE_A }]) {
      expect((await rejection(UsersService.setUserStores(admin, user.id, { storeIds }))).errorCode).toBe(400);
    }
    expect(fakes.users.get(user.id)!.storeId).toBe(STORE_A);
  });

  it("an admin account is not store-bound: a store for it is refused, clearing it is fine", async () => {
    const target = addUser({ role: "admin", storeId: null });

    expect((await rejection(UsersService.setUserStores(superAdmin, target.id, { storeIds: [STORE_A] }))).errorCode).toBe(400);
    await expect(UsersService.setUserStores(superAdmin, target.id, { storeIds: [] })).resolves.toBeDefined();
  });

  it("only a super_admin may change an admin; unknown, non-team and malformed ids are 404", async () => {
    const adminTarget = addUser({ role: "admin" });
    const customer = addUser({ role: "customer" });

    expect((await rejection(UsersService.setUserStores(admin, adminTarget.id, { storeIds: [] }))).errorCode).toBe(403);
    for (const id of [customer.id, "00000000-0000-4000-8000-00000000ffff", "nope"]) {
      expect((await rejection(UsersService.setUserStores(admin, id, { storeIds: [STORE_A] }))).errorCode).toBe(404);
    }
  });
});

describe("deactivateUser voids unused invite and reset links", () => {
  it("so a link issued earlier cannot reach the switched-off account", async () => {
    const user = addUser({ role: "staff" });
    fakes.tokens.set("t1", { id: "t1", userId: user.id, purpose: "invite", tokenHash: "h", expiresAt: new Date(Date.now() + 1e6), consumedAt: null, createdAt: new Date(), createdById: null });
    fakes.tokens.set("t2", { id: "t2", userId: user.id, purpose: "password_reset", tokenHash: "g", expiresAt: new Date(Date.now() + 1e6), consumedAt: null, createdAt: new Date(), createdById: null });

    await UsersService.deactivateUser(admin, user.id);

    expect([...fakes.tokens.values()].every((t) => t.consumedAt)).toBe(true);
  });
});

describe("internal lookups", () => {
  it("getInternalUser returns exactly the agreed shape and no secrets", async () => {
    const user = addUser({ role: "staff", storeId: STORE_A, phoneNumber: "+919800000001", passwordHash: "hash" });

    const result = await UsersService.getInternalUser(user.id);

    expect(result).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      phoneNumber: "+919800000001",
      role: "staff",
      storeId: STORE_A,
      isActive: true,
    });
  });

  it("an inactive account is still returned, flagged isActive false (services need to know)", async () => {
    const user = addUser({ isActive: false });

    expect((await UsersService.getInternalUser(user.id)).isActive).toBe(false);
  });

  it("unknown and malformed ids are 404", async () => {
    for (const id of ["00000000-0000-4000-8000-00000000ffff", "x", ""]) {
      expect((await rejection(UsersService.getInternalUser(id))).errorCode).toBe(404);
    }
  });

  it("lookup answers many ids with one query, omits unknown ids and de-duplicates", async () => {
    const a = addUser();
    const b = addUser();
    const findMany = fakes.userQuery.findManyByIds as jest.Mock;
    findMany.mockClear();

    const result = await UsersService.lookupInternalUsers([a.id, b.id, a.id.toUpperCase(), "00000000-0000-4000-8000-00000000ffff"]);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toHaveLength(3);
    expect(result.users.map((u) => u.id).sort()).toEqual([a.id, b.id].sort());
    expect(Object.keys(result.users[0]).sort()).toEqual(["email", "id", "isActive", "name", "phoneNumber", "role", "storeId"]);
  });

  it("lookup is bounded: 200 ids are fine, 201 are refused, and the ids must be UUIDs", async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

    await expect(UsersService.lookupInternalUsers(ids)).resolves.toEqual({ users: [] });
    expect((await rejection(UsersService.lookupInternalUsers([...ids, "00000000-0000-4000-8000-0000000000ff"]))).errorCode).toBe(400);
    for (const bad of [undefined, null, "x", [], ["x"], [1], [null], { length: 1 }, [...ids.slice(0, 2), "nope"]]) {
      expect((await rejection(UsersService.lookupInternalUsers(bad))).errorCode).toBe(400);
    }
  });
});
