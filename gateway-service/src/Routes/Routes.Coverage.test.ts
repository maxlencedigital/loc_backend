import http from "http";
import { AddressInfo } from "net";
import express from "express";
import jwt from "jsonwebtoken";

// The token secret must exist before the real auth middleware is imported.
process.env.JWT_SECRET = "t".repeat(40);

// Only the database client is faked; the real router is walked route by route.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({
  prisma: { $queryRaw: jest.fn(), user: {}, otpChallenge: {}, activityLog: {} },
}));

import router from "./Gateway.Routes.js";

interface RouteInfo {
  method: string;
  path: string;
}

// Hundreds of routes are each called over real HTTP, so the default 5s is not enough.
jest.setTimeout(120_000);

// Every route registered anywhere in the router tree, including nested routers.
const collect = (stack: any[]): RouteInfo[] => {
  const found: RouteInfo[] = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        found.push({ method: method.toUpperCase(), path: layer.route.path as string });
      }
    } else if (layer.name === "router" && layer.handle?.stack) {
      found.push(...collect(layer.handle.stack));
    }
  }
  return found;
};

// The COMPLETE list of gateway routes that need no token. Adding to it is a
// deliberate, reviewed act: anything not listed here must refuse an anonymous caller.
const PUBLIC_ROUTES = [
  "/auth/register",
  "/auth/login",
  "/auth/customer/login",
  "/auth/refresh",
  "/auth/register/send-otp",
  "/auth/register/verify-otp",
  "/auth/register/complete",
  "/auth/login/otp/request",
  "/auth/login/otp/verify",
  "/auth/login/oauth",
  "/auth/password/forgot",
  "/auth/password/reset",
  "/auth/invite/accept",
];

const routes = collect((router as any).stack).filter((r) => r.path !== "/health");
const isPublic = (path: string) => PUBLIC_ROUTES.includes(path);
const concrete = (path: string) => path.replace(/:\w+/g, "x");
const tokenFor = (role: string) =>
  jwt.sign({ userId: "u1", role }, process.env.JWT_SECRET as string, { algorithm: "HS256", expiresIn: "5m" });

let server: http.Server;
let base: string;
let logSpy: jest.SpyInstance;

beforeAll(async () => {
  logSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const app = express();
  app.use(express.json());
  app.use("/", router);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  logSpy.mockRestore();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const call = async (method: string, path: string, role?: string) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (role) headers.authorization = `Bearer ${tokenFor(role)}`;
  const res = await fetch(`${base}${concrete(path)}`, {
    method,
    headers,
    body: method === "GET" || method === "DELETE" ? undefined : "{}",
    signal: AbortSignal.timeout(5000),
  });
  return res.status;
};

describe("every gateway route is guarded", () => {
  it("actually finds the routes (so the checks below cannot pass by checking nothing)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(39);
  });

  it("every allowlisted public route really exists (a typo would silently hide a route)", () => {
    const registered = new Set(routes.map((r) => r.path));
    expect(PUBLIC_ROUTES.filter((p) => !registered.has(p))).toEqual([]);
  });

  it("refuses EVERY route that is not on the public allowlist when there is no token", async () => {
    const leaked: string[] = [];
    for (const r of routes.filter((x) => !isPublic(x.path))) {
      const status = await call(r.method, r.path);
      if (status !== 401) leaked.push(`${r.method} ${r.path} -> ${status}`);
    }
    expect(leaked).toEqual([]);
  });

  it("leaves the allowlisted public routes reachable without a token", async () => {
    const blocked: string[] = [];
    for (const r of routes.filter((x) => isPublic(x.path))) {
      const status = await call(r.method, r.path);
      if (status === 401 || status === 403 || status === 404) blocked.push(`${r.method} ${r.path} -> ${status}`);
    }
    expect(blocked).toEqual([]);
  });

  it("refuses a valid token carrying an unknown role on every guarded route", async () => {
    const admitted: string[] = [];
    for (const r of routes.filter((x) => !isPublic(x.path))) {
      const status = await call(r.method, r.path, "not_a_real_role");
      if (status !== 403) admitted.push(`${r.method} ${r.path} -> ${status}`);
    }
    expect(admitted).toEqual([]);
  });

  it("admits at least one real role on every guarded route (no typo locks everyone out)", async () => {
    const roles = ["admin", "manager", "hr", "staff", "driver", "customer"];
    const unreachable: string[] = [];
    for (const r of routes.filter((x) => !isPublic(x.path))) {
      let reached = false;
      for (const role of roles) {
        const status = await call(r.method, r.path, role);
        if (status !== 403 && status !== 401) {
          reached = true;
          break;
        }
      }
      // POST /auth/admin-users is deliberately super_admin-only, so no plain role reaches it.
      if (!reached && r.path !== "/auth/admin-users") unreachable.push(`${r.method} ${r.path}`);
    }
    expect(unreachable).toEqual([]);
  });
});
