import http from "http";
import { AddressInfo } from "net";
import express from "express";

// The real router and controllers over real HTTP; only the Query modules and the other
// services are in-memory fakes. This proves what the service tests cannot: the role matrix on
// the wire, header handling (identity, Idempotency-Key), status codes and the response envelope.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../../commons/Http/ServiceClient.js", () => require("../Testing/InMemorySupport.js").serviceClientMock);
jest.mock("../Queries/Store.Query.js", () => ({ StoreQuery: require("../Testing/InMemoryCommerce.js").storeQuery }));
jest.mock("../Queries/Customer.Query.js", () => ({ CustomerQuery: require("../Testing/InMemoryCommerce.js").customerQuery }));
jest.mock("../Queries/Catalog.Query.js", () => ({ CatalogQuery: require("../Testing/InMemoryCommerce.js").catalogQuery }));
jest.mock("../Queries/Order.Query.js", () => ({ OrderQuery: require("../Testing/InMemoryCommerce.js").orderQuery }));
jest.mock("../Queries/CustomerProfile.Query.js", () => ({ CustomerProfileQuery: require("../Testing/InMemoryCustomerAccount.js").profileQuery }));
jest.mock("../Queries/OrderInternal.Query.js", () => ({ OrderInternalQuery: require("../Testing/InMemoryCustomerAccount.js").internalOrderQuery }));
jest.mock("../Queries/CustomerOrder.Query.js", () => ({ CustomerOrderQuery: require("../Testing/InMemoryCustomerAccount.js").customerOrderQuery }));
jest.mock("../Queries/Complaint.Query.js", () => ({ ComplaintQuery: require("../Testing/InMemorySupport.js").complaintQuery }));
jest.mock("../Queries/Ticket.Query.js", () => ({ TicketQuery: require("../Testing/InMemorySupport.js").ticketQuery }));
jest.mock("../Queries/Feedback.Query.js", () => ({ FeedbackQuery: require("../Testing/InMemorySupport.js").feedbackQuery }));
jest.mock("../Queries/CustomerPayment.Query.js", () => ({ CustomerPaymentQuery: require("../Testing/InMemorySupport.js").paymentQuery }));
jest.mock("../Queries/SupportOrder.Query.js", () => ({ SupportOrderQuery: require("../Testing/InMemorySupport.js").supportOrderQuery }));

import { IShopper, addOrder, buildSupportWorld, shopper } from "../Testing/SupportWorld.js";
import router from "./Commerce.Routes.js";

let server: http.Server;
let base: string;
let world: any;
let ana: IShopper;
let bob: IShopper;
let order: any;
let errorSpy: jest.SpyInstance;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", router);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(async () => {
  world = buildSupportWorld();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  ana = await shopper();
  bob = await shopper();
  order = addOrder(ana.customerId, world.storeA.id);
});
afterEach(() => errorSpy.mockRestore());

interface Who {
  role: string | null;
  id?: string;
  storeId?: string | null;
  service?: string;
  key?: string;
}

const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (who.role) {
    headers["x-user-id"] = who.id ?? "11111111-1111-4111-8111-111111111111";
    headers["x-user-role"] = who.role;
    if (who.storeId) headers["x-user-store-id"] = who.storeId;
  }
  if (who.service) headers["x-service-name"] = who.service;
  if (who.key) headers["idempotency-key"] = who.key;
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined || body === null ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
};

const customer = (s: IShopper, key?: string): Who => ({ role: "customer", id: s.user.id, key });
const asStore = (role: string): Who => ({ role, storeId: world.storeA.id });

const GUARD_STATUSES = [401, 403];

describe("the role matrix", () => {
  const OTHER = "11111111-1111-4111-8111-111111111111";
  const customerRoutes: Array<[string, string, unknown?]> = [
    ["GET", "/me/complaints"],
    ["POST", "/me/complaints", {}],
    ["GET", `/me/complaints/${OTHER}`],
    ["POST", `/me/complaints/${OTHER}/comments`, {}],
    ["POST", `/me/complaints/${OTHER}/photos`, {}],
    ["POST", `/me/orders/${OTHER}/feedback`, {}],
    ["GET", `/me/orders/${OTHER}/feedback`],
    ["POST", "/me/support-tickets", {}],
    ["GET", "/me/support-tickets"],
    ["GET", `/me/support-tickets/${OTHER}`],
    ["POST", `/me/support-tickets/${OTHER}/messages`, {}],
    ["POST", `/me/orders/${OTHER}/payment/initiate`, {}],
    ["POST", `/me/orders/${OTHER}/payment/verify`, {}],
    ["GET", "/me/payment-methods"],
    ["POST", "/me/payment-methods", {}],
    ["DELETE", `/me/payment-methods/${OTHER}`],
    ["GET", "/me/payments"],
  ];
  const storeRoutes: Array<[string, string, unknown?]> = [
    ["POST", "/complaints", {}],
    ["GET", "/complaints"],
    ["GET", `/complaints/${OTHER}`],
    ["POST", `/complaints/${OTHER}/assign`, {}],
    ["POST", `/complaints/${OTHER}/comments`, {}],
    ["POST", `/complaints/${OTHER}/escalate`, {}],
    ["POST", `/complaints/${OTHER}/resolve`, {}],
  ];

  it.each(customerRoutes.map(([m, p, b]) => [m, p, b ?? null]))("%s %s admits customers and refuses every staff role with 403", async (method, path, body) => {
    expect(GUARD_STATUSES).not.toContain((await call({ role: "customer", id: ana.user.id }, method, path, body)).status);
    for (const role of ["staff", "manager", "admin", "hr", "driver"]) {
      expect((await call(asStore(role), method, path, body)).status).toBe(403);
    }
  });

  it.each(storeRoutes.map(([m, p, b]) => [m, p, b ?? null]))("%s %s admits admin, manager and staff and refuses customers, riders and hr", async (method, path, body) => {
    for (const role of ["admin", "manager", "staff"]) {
      expect(GUARD_STATUSES).not.toContain((await call(asStore(role), method, path, body)).status);
    }
    for (const role of ["customer", "driver", "hr"]) {
      expect((await call(asStore(role), method, path, body)).status).toBe(403);
    }
  });

  it("keeps escalations for admins, and feedback for admin, hr and manager", async () => {
    for (const role of ["manager", "staff", "hr", "customer", "driver"]) {
      expect((await call(asStore(role), "GET", "/escalations")).status).toBe(403);
      expect((await call(asStore(role), "POST", `/escalations/${OTHER}/decision`, {})).status).toBe(403);
    }
    expect((await call({ role: "admin" }, "GET", "/escalations")).status).toBe(200);
    for (const role of ["staff", "customer", "driver"]) {
      expect((await call(asStore(role), "GET", "/feedback")).status).toBe(403);
      expect((await call(asStore(role), "GET", "/feedback/summary")).status).toBe(403);
    }
    for (const role of ["admin", "hr", "manager"]) {
      expect((await call(asStore(role), "GET", "/feedback")).status).toBe(200);
      expect((await call(asStore(role), "GET", "/feedback/summary")).status).toBe(200);
    }
  });

  it("lets super_admin through the guard, then refuses the customer-only features by role", async () => {
    expect((await call({ role: "super_admin", id: ana.user.id }, "GET", "/complaints")).status).toBe(200);
    expect((await call({ role: "super_admin", id: ana.user.id }, "GET", "/me/complaints")).status).toBe(403);
  });

  it("answers 401 without a verified identity and 403 for a store role with no store", async () => {
    expect((await call({ role: null }, "GET", "/me/complaints")).status).toBe(401);
    expect((await call({ role: null }, "GET", "/complaints")).status).toBe(401);
    expect((await call({ role: "manager" }, "GET", "/complaints")).status).toBe(403);
    expect((await call({ role: "manager" }, "GET", "/feedback")).status).toBe(403);
  });
});

describe("over the wire", () => {
  it("uses the standard envelope and 201 then 200 for a repeated Idempotency-Key", async () => {
    const body = { orderId: order.id, type: "damaged_item", description: "Torn sleeve" };
    const first = await call(customer(ana, "wire-1"), "POST", "/me/complaints", body);
    const again = await call(customer(ana, "wire-1"), "POST", "/me/complaints", body);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ statusCode: 201, status: true, result: { status: "open", orderId: order.id } });
    expect(again.status).toBe(200);
    expect(again.body.result.id).toBe(first.body.result.id);
  });

  it("maps refusals to 400, 404 and 409 with a readable message and no internals", async () => {
    const bad = await call(customer(ana), "POST", "/me/complaints", { orderId: order.id, type: "nonsense", description: "x" });
    expect(bad).toMatchObject({ status: 400, body: { status: false, displayMessage: expect.stringMatching(/type/) } });
    const foreign = await call(customer(bob), "POST", "/me/complaints", { orderId: order.id, type: "other", description: "x" });
    expect(foreign.status).toBe(404);
    const keyed = await call(customer(ana, "bad key!"), "POST", "/me/complaints", { orderId: order.id, type: "other", description: "x" });
    expect(keyed.status).toBe(400);
    const early = addOrder(ana.customerId, world.storeA.id, { status: "washing" });
    const notYet = await call(customer(ana), "POST", `/me/orders/${early.id}/feedback`, { rating: 5 });
    expect(notYet.status).toBe(409);
    expect(JSON.stringify(notYet.body)).not.toMatch(/at .*\.ts|stack/i);
  });

  it("runs a complaint from the customer's app through the store and back", async () => {
    const raised = await call(customer(ana), "POST", "/me/complaints", { orderId: order.id, type: "quality", description: "Stain remains" });
    const id = raised.body.result.id as string;
    const manager = { ...asStore("manager"), id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    expect((await call(manager, "POST", `/complaints/${id}/comments`, { message: "We will re-wash it" })).status).toBe(200);
    const resolved = await call(manager, "POST", `/complaints/${id}/resolve`, { resolution: "Re-washed", refundAmount: 20 });
    expect(resolved).toMatchObject({ status: 200, body: { result: { status: "resolved", decision: "refund", refundAmount: 20 } } });
    const mine = await call(customer(ana), "GET", `/me/complaints/${id}`);
    expect(mine.body.result).toMatchObject({ status: "resolved", decision: "refund", resolution: "Re-washed" });
    expect((await call(customer(bob), "GET", `/me/complaints/${id}`)).status).toBe(404);
    const otherStore = { role: "manager", id: manager.id, storeId: world.storeB.id };
    expect((await call(otherStore, "GET", `/complaints/${id}`)).status).toBe(404);
  });

  it("lists with the standard page shape", async () => {
    await call(customer(ana), "POST", "/me/complaints", { orderId: order.id, type: "quality", description: "x" });
    const list = await call(customer(ana), "GET", "/me/complaints?limit=500");
    expect(list.body.result).toMatchObject({ page: 1, limit: 100, total: 1, items: [{ type: "quality", status: "open" }] });
  });
});

describe("the internal endpoints", () => {
  it("need a service name: no identity and a user role are refused, a service is let in", async () => {
    const path = "/internal/complaints/close-resolved";
    expect((await call({ role: null }, "POST", path, {})).status).toBe(401);
    expect((await call({ role: "admin" }, "POST", path, {})).status).toBe(401);
    expect(await call({ role: null, service: "growth" }, "POST", path, {})).toMatchObject({ status: 200, body: { result: { closed: 0 } } });
  });

  it("answers a malformed ticket id with 400 and an unknown one with 404", async () => {
    const service = { role: null, service: "growth" };
    expect((await call(service, "POST", "/internal/support-tickets/x/close")).status).toBe(400);
    expect((await call(service, "POST", "/internal/support-tickets/x/messages", { message: "m", authorUserId: "u", authorName: "n" })).status).toBe(400);
    expect((await call(service, "POST", "/internal/support-tickets/11111111-1111-4111-8111-111111111111/close")).status).toBe(404);
  });

  it("lets a support console answer a ticket the customer opened", async () => {
    const opened = await call(customer(ana, "ticket-1"), "POST", "/me/support-tickets", { subject: "Help", message: "Where is it?" });
    expect(opened.status).toBe(201);
    const id = opened.body.result.id as string;
    const reply = await call({ role: null, service: "growth" }, "POST", `/internal/support-tickets/${id}/messages`, {
      message: "Out for delivery", authorUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", authorName: "Priya",
    });
    expect(reply).toMatchObject({ status: 200, body: { result: { status: "answered" } } });
    const view = await call(customer(ana), "GET", `/me/support-tickets/${id}`);
    expect(view.body.result.messages.map((m: any) => m.from)).toEqual(["customer", "support"]);
  });
});
