import http from "http";
import { AddressInfo } from "net";
import express from "express";

// The real router and controllers over real HTTP; only the P07 Query modules are the in-memory fake.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/Store.Query.js", () => ({ StoreQuery: require("../Testing/InMemoryOps.js").storeQuery }));
jest.mock("../Queries/OpsVendor.Query.js", () => ({ OpsVendorQuery: require("../Testing/InMemoryOps.js").vendorQuery }));
jest.mock("../Queries/OpsMaterial.Query.js", () => ({ OpsMaterialQuery: require("../Testing/InMemoryOps.js").materialQuery }));
jest.mock("../Queries/OpsPurchaseOrder.Query.js", () => ({ OpsPurchaseOrderQuery: require("../Testing/InMemoryOps.js").purchaseOrderQuery }));
jest.mock("../Queries/OpsPolicy.Query.js", () => ({ OpsPolicyQuery: require("../Testing/InMemoryOps.js").policyQuery }));
jest.mock("../Queries/OpsClaim.Query.js", () => ({ OpsClaimQuery: require("../Testing/InMemoryOps.js").claimQuery }));

import { reset, seed } from "../Testing/InMemoryOps.js";
import router from "./Commerce.Routes.js";

let server: http.Server;
let base: string;
let storeA: any;
let storeB: any;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", router);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  reset();
  storeA = seed.store();
  storeB = seed.store();
});

const call = async (role: string, method: string, path: string, body?: unknown, store: string | null = null, extra: Record<string, string> = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-user-id": `${role}-1`, "x-user-role": role, ...(store ? { "x-user-store-id": store } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
};

describe("role matrix on the vendor and insurance routes", () => {
  it("admits back office to writes and refuses managers, staff, riders and customers", async () => {
    expect((await call("manager", "POST", "/operations/vendors", { name: "x" }, storeA.id)).status).toBe(403);
    expect((await call("staff", "GET", "/operations/vendors", undefined, storeA.id)).status).toBe(403);
    expect((await call("manager", "POST", "/operations/purchase-orders", {}, storeA.id)).status).toBe(403);
    expect((await call("manager", "POST", "/operations/purchase-orders/x/send", {}, storeA.id)).status).toBe(403);
    expect((await call("manager", "GET", "/operations/purchase/spend", undefined, storeA.id)).status).toBe(403);
    expect((await call("manager", "GET", "/operations/insurance/claims", undefined, storeA.id)).status).toBe(403);
    expect((await call("manager", "POST", "/operations/insurance/policies/x/renew", {}, storeA.id)).status).toBe(403);
    expect((await call("driver", "GET", "/operations/materials")).status).toBe(403);
    expect((await call("customer", "GET", "/operations/insurance/policies")).status).toBe(403);
    expect((await call("hr", "POST", "/operations/vendors", { name: "HR vendor" })).status).toBe(201);
    expect((await call("admin", "GET", "/operations/insurance/claims")).status).toBe(200);
    expect((await call("staff", "GET", "/operations/materials", undefined, storeA.id)).status).toBe(200);
    expect((await call("manager", "GET", "/operations/purchase-orders", undefined, storeA.id)).status).toBe(200);
  });

  it("answers 403 to a manager with no store on a store-scoped route", async () => {
    expect((await call("manager", "GET", "/operations/purchase-orders")).status).toBe(403);
    expect((await call("manager", "GET", "/operations/insurance/policies")).status).toBe(403);
  });
});

describe("purchasing over HTTP", () => {
  it("raises, sends and receives an order, with the response envelope, 404 across stores and 400 on bad input", async () => {
    const vendor = (await call("admin", "POST", "/operations/vendors", { name: "Acme", bankAccountNumber: "9988776655" })).json;
    expect(vendor).toMatchObject({ statusCode: 201, status: true });
    expect(JSON.stringify(vendor)).not.toContain("9988776655");
    const material = (await call("admin", "POST", "/operations/materials", { name: "Soap", unit: "kg" })).json.result;
    const body = { vendorId: vendor.result.id, storeId: storeA.id, items: [{ materialId: material.id, quantity: 4, unitPrice: 25 }] };
    const first = await call("admin", "POST", "/operations/purchase-orders", body, null, { "idempotency-key": "http-key-0001" });
    const again = await call("admin", "POST", "/operations/purchase-orders", body, null, { "idempotency-key": "http-key-0001" });
    expect([first.status, again.status, again.json.result.id]).toEqual([201, 201, first.json.result.id]);
    const id = first.json.result.id;
    expect((await call("admin", "POST", `/operations/purchase-orders/${id}/send`, {})).json.result.status).toBe("sent");
    expect((await call("manager", "GET", `/operations/purchase-orders/${id}`, undefined, storeB.id)).status).toBe(404);
    expect((await call("manager", "POST", `/operations/purchase-orders/${id}/receive`, { items: [{ materialId: material.id, receivedQty: 1 }] }, storeB.id)).status).toBe(404);
    const received = await call("manager", "POST", `/operations/purchase-orders/${id}/receive`, { items: [{ materialId: material.id, receivedQty: 4 }] }, storeA.id);
    expect([received.status, received.json.result.status]).toEqual([200, "received"]);
    const bad = await call("admin", "POST", "/operations/purchase-orders", { vendorId: "x" });
    expect([bad.status, bad.json.status]).toEqual([400, false]);
    expect((await call("manager", "GET", `/operations/vendors/${vendor.result.id}`, undefined, storeA.id)).json.result).not.toHaveProperty("bankAccountMasked");
    expect((await call("admin", "GET", "/operations/purchase-orders?limit=5000")).json.result.limit).toBe(100);
  });
});
