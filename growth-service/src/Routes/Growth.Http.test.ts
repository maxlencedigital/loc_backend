import http from "http";
import { AddressInfo } from "net";
import express from "express";

const mockSmsSend = jest.fn();
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Clients/Sms.Client.js", () => ({
  SmsClient: { send: (...a: unknown[]) => mockSmsSend(...a), sendText: jest.fn(), isConfigured: () => true },
}));
jest.mock("../Clients/Email.Client.js", () => ({ EmailClient: { send: jest.fn(), isConfigured: () => false } }));
jest.mock("../Clients/WhatsApp.Client.js", () => ({ WhatsAppClient: { sendTemplateMessage: jest.fn(), isConfigured: () => false } }));
jest.mock("../Clients/Gateway.Client.js", () => ({ GatewayClient: { lookupUsers: jest.fn(async () => []), getUser: jest.fn(async () => null) } }));
jest.mock("../Clients/Finance.Client.js", () => ({ FinanceClient: { createPaymentOrder: jest.fn() } }));
jest.mock("../Queries/Db.js", () => ({ inTransaction: (work: any) => require("../Testing/FakeQueries").inTransaction(work) }));
jest.mock("../Queries/Coupon.Query.js", () => require("../Testing/FakeQueries").queryModule("Coupon"));
jest.mock("../Queries/Counter.Query.js", () => require("../Testing/FakeQueries").queryModule("Counter"));
jest.mock("../Queries/Package.Query.js", () => require("../Testing/FakeQueries").queryModule("Package"));
jest.mock("../Queries/Loyalty.Query.js", () => require("../Testing/FakeQueries").queryModule("Loyalty"));
jest.mock("../Queries/Customer.Query.js", () => require("../Testing/FakeQueries").queryModule("Customer"));
jest.mock("../Queries/Notification.Query.js", () => require("../Testing/FakeQueries").queryModule("Notification"));
jest.mock("../Queries/Campaign.Query.js", () => require("../Testing/FakeQueries").queryModule("Campaign"));

import router from "./Growth.Routes.js";
import { reset } from "../Testing/FakeQueries.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

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

let logSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
beforeEach(() => {
  reset();
  mockSmsSend.mockReset().mockResolvedValue("sms-1");
  logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

const as = (id: string, role: string) => ({ "x-user-id": id, "x-user-role": role });
const SERVICE = { "x-service-name": "commerce" };

const call = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
};

const dispatch = (customerId: string, over: Record<string, unknown> = {}) =>
  call("POST", "/internal/notifications/dispatch", SERVICE, {
    channel: "sms", to: "+919812345678", templateId: "order_confirmed", customerId,
    params: { name: "Asha", orderId: "LOC-1", total: "Rs 100" }, ...over,
  });

describe("notifications over HTTP", () => {
  it("a dispatch shows up in that customer's inbox and in nobody else's", async () => {
    const sent = await dispatch(ALICE);

    const alice = await call("GET", "/me/notifications", as(ALICE, "customer"));
    const bob = await call("GET", "/me/notifications", as(BOB, "customer"));

    expect(sent).toMatchObject({ status: 200, json: { status: true, result: { delivered: true } } });
    expect(alice.json.result).toMatchObject({ total: 1, items: [{ title: "Order confirmed", channel: "sms", read: false }] });
    expect(bob.json.result.total).toBe(0);
  });

  it("answers a provider failure with 200 and delivered:false, never 5xx", async () => {
    mockSmsSend.mockRejectedValue(new Error("provider exploded"));

    const res = await dispatch(ALICE);

    expect(res.status).toBe(200);
    expect(res.json.result).toEqual({ delivered: false, error: "delivery failed" });
  });

  it("a caller bug is a 400, and the internal route refuses callers that are not a service", async () => {
    expect((await dispatch(ALICE, { templateId: "nope" })).status).toBe(400);
    expect((await call("POST", "/internal/notifications/dispatch", {}, {})).status).toBe(401);
    expect((await call("POST", "/internal/notifications/dispatch", { ...as(ALICE, "customer"), "x-service-name": "mallory" }, {})).status).toBe(401);
  });

  it("marking someone else's notification read is 404; marking your own works", async () => {
    await dispatch(ALICE);
    const [mine] = (await call("GET", "/me/notifications", as(ALICE, "customer"))).json.result.items;

    const stolen = await call("POST", `/me/notifications/${mine.id}/read`, as(BOB, "customer"));
    const own = await call("POST", `/me/notifications/${mine.id}/read`, as(ALICE, "customer"));

    expect(stolen.status).toBe(404);
    expect(own.status).toBe(200);
  });
});

describe("role matrix and envelopes", () => {
  it("customer routes refuse staff and admins refuse customers", async () => {
    expect((await call("GET", "/me/coupons", as(ALICE, "staff"))).status).toBe(403);
    expect((await call("GET", "/me/loyalty", as(ALICE, "driver"))).status).toBe(403);
    expect((await call("GET", "/coupons", as(ALICE, "customer"))).status).toBe(403);
    expect((await call("POST", "/campaigns", as(ALICE, "staff"), {})).status).toBe(403);
    expect((await call("POST", "/internal/loyalty/expire", as(ALICE, "admin"))).status).toBe(401);
  });

  it("managers may read packages but not change them", async () => {
    expect((await call("GET", "/packages", as(ALICE, "manager"))).status).toBe(200);
    expect((await call("POST", "/packages", as(ALICE, "manager"), { name: "x" })).status).toBe(403);
    expect((await call("GET", "/coupons", as(ALICE, "manager"))).status).toBe(403);
  });

  it("an admin creates a coupon (201), reads it back, and gets 404 for unknown and malformed ids", async () => {
    const created = await call("POST", "/coupons", as(BOB, "admin"), {
      code: "http10", title: "HTTP", type: "percent", value: 10, validFrom: "2020-01-01", validUntil: "2099-12-31",
    });
    const read = await call("GET", `/coupons/${created.json.result.id}`, as(BOB, "admin"));

    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ status: true, result: { code: "HTTP10" } });
    expect(read.status).toBe(200);
    expect((await call("GET", "/coupons/00000000-0000-4000-8000-0000000000ff", as(BOB, "admin"))).status).toBe(404);
    expect((await call("GET", "/coupons/not-a-uuid", as(BOB, "admin"))).status).toBe(404);
    expect((await call("POST", "/coupons", as(BOB, "admin"), { code: "x" })).status).toBe(400);
  });

  it("a customer's loyalty and validate calls are scoped to the caller", async () => {
    await call("POST", "/internal/loyalty/earn", SERVICE, { customerId: ALICE, orderRef: "o1", amountPaise: 50_000 });

    const alice = await call("GET", "/me/loyalty", as(ALICE, "customer"));
    const bob = await call("GET", "/me/loyalty", as(BOB, "customer"));
    const bobSpends = await call("POST", "/me/loyalty/redeem", as(BOB, "customer"), { points: 100 });

    expect(alice.json.result.points).toBe(500);
    expect(bob.json.result.points).toBe(0);
    expect(bobSpends.status).toBe(409);
  });
});
