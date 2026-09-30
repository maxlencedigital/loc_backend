import http from "http";
import { AddressInfo } from "net";
import express from "express";
import jwt from "jsonwebtoken";

// The token secret must exist before the real auth middleware is imported.
process.env.JWT_SECRET = "t".repeat(40);

// Only the data layer is faked: real router, real guards, real controller and service.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({
  prisma: { $queryRaw: jest.fn(), user: {}, otpChallenge: {}, activityLog: {} },
}));
jest.mock("../Queries/User.Query.js", () => ({
  UserQuery: {
    create: jest.fn(),
    findById: jest.fn(),
    search: jest.fn(),
    updateProfile: jest.fn(),
    setActive: jest.fn(),
    countActiveByRole: jest.fn(),
  },
}));

import router from "./Gateway.Routes.js";
import { UserQuery } from "../Queries/User.Query.js";

const queries = UserQuery as jest.Mocked<typeof UserQuery>;

const STORE_A = "11111111-1111-4111-8111-111111111101";
const STORE_B = "11111111-1111-4111-8111-111111111102";
const MANAGER_ID = "00000000-0000-4000-8000-000000000003";

const account = (overrides: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-000000000010",
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

const tokenFor = (role: string, storeId: string | null = null, userId = MANAGER_ID) =>
  jwt.sign({ userId, role, storeId }, process.env.JWT_SECRET as string, {
    algorithm: "HS256",
    expiresIn: "5m",
  });

let server: http.Server;
let base: string;
let errorSpy: jest.SpyInstance;

beforeAll(async () => {
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const app = express();
  app.use(express.json());
  app.use("/", router);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  errorSpy.mockRestore();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const call = async (method: string, path: string, token?: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: res.status, body: (await res.json()) as any };
};

describe("GET /users", () => {
  beforeEach(() => queries.search.mockResolvedValue([account() as any]));

  it("lists the team for an admin inside the standard envelope", async () => {
    const { status, body } = await call("GET", `/users?storeId=${STORE_B}&role=staff&q=san`, tokenFor("admin"));

    expect(status).toBe(200);
    expect(body).toMatchObject({ statusCode: 200, status: true });
    expect(body.result).toEqual([
      expect.objectContaining({ email: "sanjay@loclaundry.in", role: "staff", storeId: STORE_A }),
    ]);
    expect(queries.search).toHaveBeenCalledWith({ roles: ["staff"], storeId: STORE_B, q: "san" });
  });

  it("scopes a manager to the store in their token, ignoring the storeId they ask for", async () => {
    const { status } = await call("GET", `/users?storeId=${STORE_B}`, tokenFor("manager", STORE_A));

    expect(status).toBe(200);
    expect(queries.search).toHaveBeenCalledWith(expect.objectContaining({ storeId: STORE_A }));
  });

  it("refuses a manager whose token carries no store (an older token)", async () => {
    const { status, body } = await call("GET", "/users", tokenFor("manager", null));

    expect(status).toBe(403);
    expect(body.displayMessage).toBe("Your account is not assigned to a store.");
  });

  it.each(["staff", "hr", "driver", "customer"])("refuses %s", async (role) => {
    expect((await call("GET", "/users", tokenFor(role, STORE_A))).status).toBe(403);
    expect(queries.search).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller", async () => {
    expect((await call("GET", "/users")).status).toBe(401);
  });
});

describe("POST /users", () => {
  const payload = {
    name: "Nikhil Bhat",
    email: "nikhil@loclaundry.in",
    phone: "+919876500012",
    role: "staff",
    storeId: STORE_A,
  };

  beforeEach(() =>
    queries.create.mockImplementation(async (data: any) => account({ ...data }) as any)
  );

  it("creates the account for an admin and returns the temporary password with the user", async () => {
    const { status, body } = await call("POST", "/users", tokenFor("admin"), payload);

    expect(status).toBe(201);
    expect(body.result).toMatchObject({ email: "nikhil@loclaundry.in", role: "staff" });
    expect(body.result.temporaryPassword).toEqual(expect.any(String));
    expect(body.result).not.toHaveProperty("passwordHash");
  });

  it.each(["manager", "staff"])("refuses %s", async (role) => {
    expect((await call("POST", "/users", tokenFor(role, STORE_A), payload)).status).toBe(403);
    expect(queries.create).not.toHaveBeenCalled();
  });

  it("answers 409 in the error envelope for a duplicate phone number", async () => {
    queries.create.mockRejectedValue({ code: "P2002", meta: { target: ["phoneNumber"] } });

    const { status, body } = await call("POST", "/users", tokenFor("admin"), payload);

    expect(status).toBe(409);
    expect(body).toMatchObject({ statusCode: 409, status: false, result: null });
  });

  it("keeps an admin from creating another admin", async () => {
    const { status } = await call("POST", "/users", tokenFor("admin"), { ...payload, role: "admin" });
    expect(status).toBe(403);
  });
});

describe("user management routes stay admin-only", () => {
  const id = "00000000-0000-4000-8000-000000000010";

  it.each([
    ["PATCH", `/users/${id}`, { name: "X" }],
    ["POST", `/users/${id}/deactivate`, {}],
    ["POST", `/users/${id}/reactivate`, {}],
  ])("%s %s refuses a manager", async (method, path, body) => {
    expect((await call(method, path, tokenFor("manager", STORE_A), body)).status).toBe(403);
  });

  it("PATCH updates for an admin", async () => {
    queries.findById.mockResolvedValue(account() as any);
    queries.updateProfile.mockResolvedValue(account({ name: "X" }) as any);
    const { status, body } = await call("PATCH", `/users/${id}`, tokenFor("admin"), { name: "X" });
    expect(status).toBe(200);
    expect(body.result.name).toBe("X");
  });

  it("POST deactivate refuses a self-deactivation", async () => {
    queries.findById.mockResolvedValue(account({ id: MANAGER_ID, role: "manager" }) as any);
    const { status } = await call("POST", `/users/${MANAGER_ID}/deactivate`, tokenFor("admin", null, MANAGER_ID));
    expect(status).toBe(400);
    expect(queries.setActive).not.toHaveBeenCalled();
  });
});

describe("GET /auth/me", () => {
  it("returns the fresh dashboard user for any signed-in role", async () => {
    queries.findById.mockResolvedValue(account({ storeId: STORE_B }) as any);

    const { status, body } = await call("GET", "/auth/me", tokenFor("staff", STORE_A, account().id));

    expect(status).toBe(200);
    // Fresh from the database, not echoed from the token.
    expect(body.result).toMatchObject({ role: "staff", storeId: STORE_B, status: "active" });
    expect(queries.findById).toHaveBeenCalledWith(account().id);
  });

  it("answers 401 once the account is deactivated or gone", async () => {
    queries.findById.mockResolvedValue(account({ isActive: false }) as any);
    expect((await call("GET", "/auth/me", tokenFor("staff"))).status).toBe(401);

    queries.findById.mockResolvedValue(null);
    expect((await call("GET", "/auth/me", tokenFor("staff"))).status).toBe(401);
  });

  it("answers 401 with no token", async () => {
    expect((await call("GET", "/auth/me")).status).toBe(401);
  });
});
