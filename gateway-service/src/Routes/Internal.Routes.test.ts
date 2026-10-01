import fs from "fs";
import path from "path";
import http from "http";
import { AddressInfo } from "net";
import express from "express";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "t".repeat(40);
const SECRET = "s3cret-".padEnd(48, "x");
process.env.INTERNAL_SERVICE_SECRET = SECRET;

// Only the data layer is faked: the real router, guard, controller and service run.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({
  prisma: { $queryRaw: jest.fn(), user: {}, otpChallenge: {}, activityLog: {} },
}));
jest.mock("../Queries/User.Query.js", () => ({
  UserQuery: { findById: jest.fn(), findManyByIds: jest.fn() },
}));

import router from "./Gateway.Routes.js";
import { UserQuery } from "../Queries/User.Query.js";

const queries = UserQuery as jest.Mocked<typeof UserQuery>;

const USER_ID = "00000000-0000-4000-8000-000000000010";
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
  storeId: "11111111-1111-4111-8111-111111111101",
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
  queries.findManyByIds.mockReset();
});

const service = { "x-internal-secret": SECRET, "x-service-name": "commerce" };
const call = async (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: res.status, body: (await res.json()) as any };
};

describe("the /internal gate: secret and service name, answered 401 and nothing else", () => {
  const paths: Array<[string, string, unknown?]> = [
    ["GET", `/internal/users/${USER_ID}`, undefined],
    ["POST", "/internal/users/lookup", { ids: [USER_ID] }],
    ["GET", "/internal/anything-else", undefined],
    ["DELETE", `/internal/users/${USER_ID}`, undefined],
  ];

  it.each(paths)("%s %s with no headers is 401 and never reaches the database", async (method, path, body) => {
    const { status } = await call(method, path, {}, body);

    expect(status).toBe(401);
    expect(queries.findById).not.toHaveBeenCalled();
    expect(queries.findManyByIds).not.toHaveBeenCalled();
  });

  it.each([
    ["only the secret", { "x-internal-secret": SECRET }],
    ["only a service name", { "x-service-name": "commerce" }],
    ["a wrong secret", { "x-internal-secret": "wrong", "x-service-name": "commerce" }],
    ["a secret one character short", { "x-internal-secret": SECRET.slice(0, -1), "x-service-name": "commerce" }],
    ["a secret one character long", { "x-internal-secret": `${SECRET}x`, "x-service-name": "commerce" }],
    ["an empty secret", { "x-internal-secret": "", "x-service-name": "commerce" }],
    ["an unknown service name", { "x-internal-secret": SECRET, "x-service-name": "attacker" }],
    ["a service name in the wrong case", { "x-internal-secret": SECRET, "x-service-name": "Commerce" }],
  ])("is 401 with %s", async (_label, headers) => {
    const { status, body } = await call("GET", `/internal/users/${USER_ID}`, headers as Record<string, string>);

    expect(status).toBe(401);
    expect(body.status).toBe(false);
    expect(queries.findById).not.toHaveBeenCalled();
  });

  it("answers every refusal with the same message, so a probe learns nothing", async () => {
    const a = await call("GET", `/internal/users/${USER_ID}`, {});
    const b = await call("GET", `/internal/users/${USER_ID}`, { "x-internal-secret": "wrong", "x-service-name": "commerce" });
    const c = await call("GET", `/internal/users/${USER_ID}`, { "x-internal-secret": SECRET, "x-service-name": "nope" });

    expect(new Set([a.body.displayMessage, b.body.displayMessage, c.body.displayMessage]).size).toBe(1);
  });

  it("is not satisfied by a user's access token or by forged identity headers", async () => {
    const token = jwt.sign({ userId: USER_ID, role: "super_admin" }, process.env.JWT_SECRET as string, { algorithm: "HS256" });

    const { status } = await call("GET", `/internal/users/${USER_ID}`, {
      authorization: `Bearer ${token}`,
      "x-user-id": USER_ID,
      "x-user-role": "super_admin",
    });

    expect(status).toBe(401);
  });

  it("every known service name is admitted", async () => {
    queries.findById.mockResolvedValue(row() as any);

    for (const name of ["gateway", "commerce", "logistics", "finance", "growth"]) {
      const { status } = await call("GET", `/internal/users/${USER_ID}`, { ...service, "x-service-name": name });
      expect(status).toBe(200);
    }
  });
});

describe("GET /internal/users/:id", () => {
  it("returns the agreed shape in the standard envelope, with no password hash", async () => {
    queries.findById.mockResolvedValue(row() as any);

    const { status, body } = await call("GET", `/internal/users/${USER_ID}`, service);

    expect(status).toBe(200);
    expect(body).toMatchObject({ statusCode: 200, status: true });
    expect(body.result).toEqual({
      id: USER_ID,
      name: "Sanjay Kulkarni",
      email: "sanjay@loclaundry.in",
      phoneNumber: "+919876500006",
      role: "staff",
      storeId: "11111111-1111-4111-8111-111111111101",
      isActive: true,
    });
    expect(JSON.stringify(body)).not.toContain("must-never-leave");
  });

  it("is 404 for an unknown id and for a malformed one (without a database call)", async () => {
    queries.findById.mockResolvedValue(null);

    expect((await call("GET", `/internal/users/${USER_ID}`, service)).status).toBe(404);
    queries.findById.mockClear();
    expect((await call("GET", "/internal/users/not-a-uuid", service)).status).toBe(404);
    expect(queries.findById).not.toHaveBeenCalled();
  });
});

describe("POST /internal/users/lookup", () => {
  it("returns the users found, in the agreed shape, omitting unknown ids", async () => {
    queries.findManyByIds.mockResolvedValue([row() as any]);

    const { status, body } = await call("POST", "/internal/users/lookup", service, {
      ids: [USER_ID, "00000000-0000-4000-8000-0000000000ff"],
    });

    expect(status).toBe(200);
    expect(body.result.users).toHaveLength(1);
    expect(body.result.users[0]).toMatchObject({ id: USER_ID, role: "staff", isActive: true });
    expect(JSON.stringify(body)).not.toContain("must-never-leave");
    expect(queries.findManyByIds).toHaveBeenCalledTimes(1);
  });

  it("is 400 for a missing, empty, non-list, malformed or oversized ids list", async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

    for (const ids of [undefined, [], "x", ["nope"], tooMany]) {
      const { status } = await call("POST", "/internal/users/lookup", service, { ids });
      expect(status).toBe(400);
    }
    expect((await call("POST", "/internal/users/lookup", service, {})).status).toBe(400);
    expect(queries.findManyByIds).not.toHaveBeenCalled();
  });

  it("an unknown /internal path with the secret is a JSON 404, not a proxied or HTML answer", async () => {
    const { status, body } = await call("GET", "/internal/orders/1", service);

    expect(status).toBe(404);
    expect(body.status).toBe(false);
  });
});

describe("the public Swagger page", () => {
  it("never sees the internal endpoints: the swagger scan finds no @openapi block in their files", () => {
    const read = (file: string) => fs.readFileSync(path.join(__dirname, file), "utf8");

    expect(read("../Controllers/Internal.Controller.ts")).not.toContain("@openapi");
    expect(read("./Internal.Routes.ts")).not.toContain("@openapi");
  });
});
