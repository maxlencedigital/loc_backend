import http from "http";
import { AddressInfo } from "net";
import express from "express";

// Only the database client is faked; the real router is walked route by route.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({
  prisma: { $queryRaw: jest.fn() },
}));

import router from "./Commerce.Routes.js";

// Hundreds of routes are each called over real HTTP, so the default 5s is not enough.
jest.setTimeout(120_000);

// Handlers that reach the faked database fail by design here; their logged errors are noise.
beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterAll(() => {
  jest.restoreAllMocks();
});

interface RouteInfo {
  method: string;
  path: string;
}

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

const routes = collect((router as any).stack).filter((r) => r.path !== "/health");
const isPublic = (path: string) => path.startsWith("/public/");
const concrete = (path: string) => path.replace(/:\w+/g, "x");

let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", router);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const call = async (method: string, path: string, headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}${concrete(path)}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "GET" || method === "DELETE" ? undefined : "{}",
    signal: AbortSignal.timeout(5000),
  });
  return res.status;
};

describe("every route is guarded", () => {
  it("actually finds the routes (so the checks below cannot pass by checking nothing)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(360);
  });

  it("refuses EVERY non-public route when there is no verified identity", async () => {
    const leaked: string[] = [];
    for (const r of routes.filter((x) => !isPublic(x.path))) {
      const status = await call(r.method, r.path);
      if (status !== 401) leaked.push(`${r.method} ${r.path} -> ${status}`);
    }
    // Any line here is an endpoint anyone with the internal secret could call unauthenticated.
    expect(leaked).toEqual([]);
  });

  it("leaves routes under /public/ reachable without identity", async () => {
    const blocked: string[] = [];
    for (const r of routes.filter((x) => isPublic(x.path))) {
      const status = await call(r.method, r.path);
      if ([401, 403, 404].includes(status)) blocked.push(`${r.method} ${r.path} -> ${status}`);
    }
    expect(blocked).toEqual([]);
  });

  it("admits at least one real role on every non-public route (no typo locks everyone out)", async () => {
    const roles = ["admin", "manager", "hr", "staff", "driver", "customer"];
    const unreachable: string[] = [];
    for (const r of routes.filter((x) => !isPublic(x.path))) {
      let reached = false;
      for (const role of roles) {
        const status = await call(r.method, r.path, { "x-user-id": "u1", "x-user-role": role });
        if (status !== 403 && status !== 401) {
          reached = true;
          break;
        }
      }
      if (!reached) unreachable.push(`${r.method} ${r.path}`);
    }
    expect(unreachable).toEqual([]);
  });

  it("refuses an unknown role on every non-public route", async () => {
    const admitted: string[] = [];
    for (const r of routes.filter((x) => !isPublic(x.path))) {
      const status = await call(r.method, r.path, { "x-user-id": "u1", "x-user-role": "not_a_real_role" });
      if (status !== 403) admitted.push(`${r.method} ${r.path} -> ${status}`);
    }
    expect(admitted).toEqual([]);
  });
});
