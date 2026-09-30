import http from "http";
import { AddressInfo } from "net";
import express from "express";

// The router is exercised as-is over real HTTP; only the database client is faked,
// with empty lists, so a request that clears its guards answers 200.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    order: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    service: { findMany: jest.fn().mockResolvedValue([]) },
    store: { findMany: jest.fn().mockResolvedValue([]) },
    customer: { findMany: jest.fn().mockResolvedValue([]) },
    priceList: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

import router from "./Commerce.Routes.js";

const STORE = "11111111-1111-4111-8111-111111111101";

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

const call = async (role: string | null, method: string, path: string, withStore = true) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (role) {
    headers["x-user-id"] = "user-1";
    headers["x-user-role"] = role;
    if (withStore) headers["x-user-store-id"] = STORE;
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: method === "GET" || method === "DELETE" ? undefined : "{}",
  });
  return res.status;
};

// 200 = cleared the guards and ran; 400 = cleared them and rejected the empty body;
// 501 = a contract-only scaffold; 401/403 = refused.
describe("role guards are scoped to their own routes", () => {
  it("lets a customer reach the customer-facing preferences route", async () => {
    // Regression: an unscoped router.use(requireRole("admin","staff")) in an earlier
    // router used to answer 403 here, before this route was ever reached.
    expect(await call("customer", "GET", "/customers/c1/preferences")).toBe(501);
  });

  it("still refuses a customer on staff-only routes", async () => {
    expect(await call("customer", "GET", "/orders")).toBe(403);
    expect(await call("customer", "GET", "/customers")).toBe(403);
    expect(await call("customer", "GET", "/stores/s1/holidays")).toBe(403);
    expect(await call("customer", "GET", "/stores")).toBe(403);
  });

  it("refuses a rider on store routes", async () => {
    expect(await call("driver", "GET", "/orders")).toBe(403);
  });

  it.each(["admin", "manager", "staff"])("lets %s into the read routes", async (role) => {
    for (const path of ["/orders", "/orders/pipeline", "/services", "/stores", "/customers", "/price-lists"]) {
      expect(await call(role, "GET", path)).toBe(200);
    }
  });

  it("lets super_admin into everything", async () => {
    expect(await call("super_admin", "GET", "/orders")).toBe(200);
    expect(await call("super_admin", "POST", "/stores")).toBe(400);
  });

  it("answers 401 when the verified identity headers are missing", async () => {
    expect(await call(null, "GET", "/orders")).toBe(401);
  });
});

describe("contract role rules", () => {
  it.each(["manager", "staff"])("keeps store and price-list writes admin-only for %s", async (role) => {
    expect(await call(role, "POST", "/stores")).toBe(403);
    expect(await call(role, "PATCH", "/stores/x")).toBe(403);
    expect(await call(role, "POST", "/stores/x/deactivate")).toBe(403);
    expect(await call(role, "POST", "/price-lists")).toBe(403);
    expect(await call(role, "PATCH", "/price-lists/x")).toBe(403);
    expect(await call(role, "POST", "/price-lists/x/duplicate")).toBe(403);
    expect(await call(role, "PUT", "/price-lists/x/rows/y")).toBe(403);
  });

  it("lets an admin reach the admin-only writes", async () => {
    expect(await call("admin", "POST", "/stores")).toBe(400);
    expect(await call("admin", "POST", "/price-lists")).toBe(400);
    expect(await call("admin", "PUT", "/price-lists/x/rows/y")).toBe(400);
  });

  it("lets staff book and move orders but not cancel them", async () => {
    expect(await call("staff", "POST", "/orders")).toBe(400);
    expect(await call("staff", "POST", "/orders/x/status")).toBe(400);
    expect(await call("staff", "POST", "/orders/x/cancel")).toBe(403);
    expect(await call("manager", "POST", "/orders/x/cancel")).toBe(400);
  });

  it.each(["manager", "staff"])("answers 403 to a %s with no store on a scoped route", async (role) => {
    expect(await call(role, "GET", "/orders", false)).toBe(403);
    expect(await call(role, "GET", "/customers", false)).toBe(403);
    expect(await call(role, "GET", "/stores", false)).toBe(403);
  });

  it("does not let /stores/:id swallow the literal /stores/compare", async () => {
    // Served by the scaffold router, which admits admin, hr and manager: 501 = reached.
    expect(await call("manager", "GET", "/stores/compare")).toBe(501);
  });
});
