import http from "http";
import { AddressInfo } from "net";
import express from "express";

process.env.JWT_SECRET = "t".repeat(40);
const SECRET = "s3cret-".padEnd(48, "x");
process.env.INTERNAL_SERVICE_SECRET = SECRET;

// Only the data layer is faked: the real router, guard, controller and service run.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({
  prisma: { $queryRaw: jest.fn(), user: {}, otpChallenge: {}, activityLog: {} },
}));
jest.mock("../Queries/User.Query.js", () => ({
  UserQuery: { findById: jest.fn(), setActive: jest.fn(), countActiveByRole: jest.fn() },
}));
jest.mock("../Queries/RefreshToken.Query.js", () => ({
  RefreshTokenQuery: { revokeAllForUser: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("../Queries/UserToken.Query.js", () => ({
  UserTokenQuery: { invalidateOutstanding: jest.fn().mockResolvedValue(undefined) },
}));

import router from "./Gateway.Routes.js";
import { UserQuery } from "../Queries/User.Query.js";
import { RefreshTokenQuery } from "../Queries/RefreshToken.Query.js";

const queries = UserQuery as jest.Mocked<typeof UserQuery>;
const revoke = RefreshTokenQuery.revokeAllForUser as jest.Mock;

const USER_ID = "00000000-0000-4000-8000-000000000010";
const STORE = "11111111-1111-4111-8111-111111111101";
const row = (overrides: Record<string, unknown> = {}) => ({
  id: USER_ID,
  name: "Sanjay Kulkarni",
  email: "sanjay@loclaundry.in",
  passwordHash: "must-never-leave",
  phoneNumber: "+919876500006",
  isPhoneVerified: true,
  oauthProvider: null,
  oauthSubject: null,
  role: "staff",
  isActive: true,
  storeId: STORE,
  lastLoginAt: null,
  createdAt: new Date("2026-01-05T08:00:00.000Z"),
  ...overrides,
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
beforeEach(() => {
  queries.findById.mockReset();
  queries.setActive.mockReset();
  queries.countActiveByRole.mockReset();
  revoke.mockClear();
});

const service = { "x-internal-secret": SECRET, "x-service-name": "growth" };
const post = async (path: string, headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
    signal: AbortSignal.timeout(5000),
  });
  return { status: res.status, body: (await res.json()) as any };
};

describe.each(["deactivate", "reactivate"])("POST /internal/users/:id/%s", (action) => {
  const path = (id = USER_ID) => `/internal/users/${id}/${action}`;

  it.each([
    ["no headers", {}],
    ["only the secret", { "x-internal-secret": SECRET }],
    ["only a service name", { "x-service-name": "growth" }],
    ["a wrong secret", { "x-internal-secret": "wrong", "x-service-name": "growth" }],
    ["an unknown service name", { "x-internal-secret": SECRET, "x-service-name": "evil" }],
  ])("is 401 with %s and writes nothing", async (_label, headers) => {
    const { status } = await post(path(), headers as Record<string, string>);

    expect(status).toBe(401);
    expect(queries.findById).not.toHaveBeenCalled();
    expect(queries.setActive).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("is 404 for an unknown id and for a malformed one, without writing", async () => {
    queries.findById.mockResolvedValue(null);

    expect((await post(path(), service)).status).toBe(404);
    expect((await post(path("not-a-uuid"), service)).status).toBe(404);
    expect(queries.setActive).not.toHaveBeenCalled();
  });
});

describe("deactivate", () => {
  it("answers the GET /internal/users/:id shape, sets isActive false and revokes refresh tokens as deactivated", async () => {
    queries.findById.mockResolvedValue(row() as any);
    queries.setActive.mockResolvedValue(row({ isActive: false }) as any);

    const { status, body } = await post(`/internal/users/${USER_ID}/deactivate`, service);

    expect(status).toBe(200);
    expect(body.result).toEqual({
      id: USER_ID, name: "Sanjay Kulkarni", email: "sanjay@loclaundry.in", phoneNumber: "+919876500006",
      role: "staff", storeId: STORE, isActive: false,
    });
    expect(JSON.stringify(body)).not.toContain("must-never-leave");
    expect(queries.setActive).toHaveBeenCalledWith(USER_ID, false);
    expect(revoke).toHaveBeenCalledWith(USER_ID, "deactivated");
  });

  it("refuses the last active super_admin with 409 and writes nothing", async () => {
    queries.findById.mockResolvedValue(row({ role: "super_admin" }) as any);
    queries.countActiveByRole.mockResolvedValue(1);

    const { status } = await post(`/internal/users/${USER_ID}/deactivate`, service);

    expect(status).toBe(409);
    expect(queries.setActive).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("an already-inactive account answers 200 again (idempotent)", async () => {
    queries.findById.mockResolvedValue(row({ isActive: false }) as any);
    queries.setActive.mockResolvedValue(row({ isActive: false }) as any);

    const { status, body } = await post(`/internal/users/${USER_ID}/deactivate`, service);

    expect(status).toBe(200);
    expect(body.result.isActive).toBe(false);
  });
});

describe("reactivate", () => {
  it("sets isActive true, answers the same shape and leaves sessions alone", async () => {
    queries.findById.mockResolvedValue(row({ isActive: false }) as any);
    queries.setActive.mockResolvedValue(row() as any);

    const { status, body } = await post(`/internal/users/${USER_ID}/reactivate`, service);

    expect(status).toBe(200);
    expect(body.result).toMatchObject({ id: USER_ID, isActive: true, role: "staff" });
    expect(queries.setActive).toHaveBeenCalledWith(USER_ID, true);
    expect(revoke).not.toHaveBeenCalled();
  });
});
