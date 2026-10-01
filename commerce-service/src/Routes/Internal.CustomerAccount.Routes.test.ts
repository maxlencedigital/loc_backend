import http from "http";
import type { AddressInfo } from "net";
import express from "express";

jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Services/OrderInternal.Service.js", () => ({
  OrderInternalService: {
    summary: jest.fn(async () => ({ orders: 0 })),
    getOrder: jest.fn(async (id: string) => ({ id })),
    updatePaymentStatus: jest.fn(async (id: string) => ({ id, paid: true })),
    changeStatus: jest.fn(async (id: string) => ({ id, moved: true })),
  },
}));

import { OrderInternalService } from "../Services/OrderInternal.Service.js";
import router from "./Internal.CustomerAccount.Routes.js";

let server: http.Server;
let port: number;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(router);
  server = app.listen(0);
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const call = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
  new Promise<{ status: number; json: any }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers: { "content-type": "application/json", ...headers } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode as number, json: data ? JSON.parse(data) : null }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });

const fromService = { "x-service-name": "finance" };
const id = "8d1c3a2e-0000-4000-8000-000000000001";

describe("the internal order routes", () => {
  it("answers /orders/summary as the summary, not as an order called 'summary'", async () => {
    const res = await call("GET", "/internal/orders/summary?from=2026-10-01", fromService);
    expect(res.status).toBe(200);
    expect(OrderInternalService.summary).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-10-01" }));
    expect(OrderInternalService.getOrder).not.toHaveBeenCalled();
  });

  it("routes the three order calls to their handlers with the id and body", async () => {
    expect((await call("GET", `/internal/orders/${id}`, fromService)).json.result).toEqual({ id });
    const paid = await call("POST", `/internal/orders/${id}/payment-status`, fromService, { paymentStatus: "paid", paidPaise: 100 });
    expect(paid.json.result).toEqual({ id, paid: true });
    expect(OrderInternalService.updatePaymentStatus).toHaveBeenCalledWith(id, { paymentStatus: "paid", paidPaise: 100 });
    const moved = await call("POST", `/internal/orders/${id}/status`, fromService, { status: "picked_up", actor: { name: "Logistics" } });
    expect(moved.json.result).toEqual({ id, moved: true });
  });

  it.each([
    ["no service name (an end user's forwarded request)", {}],
    ["an unknown service name", { "x-service-name": "browser" }],
    ["a forged user identity and no service name", { "x-user-id": "u1", "x-user-role": "admin" }],
  ])("refuses %s with 401 and runs nothing", async (_name, headers) => {
    for (const [method, path] of [["GET", "/internal/orders/summary"], ["GET", `/internal/orders/${id}`], ["POST", `/internal/orders/${id}/payment-status`], ["POST", `/internal/orders/${id}/status`]] as const) {
      expect((await call(method, path, headers, method === "POST" ? {} : undefined)).status).toBe(401);
    }
    expect(OrderInternalService.summary).not.toHaveBeenCalled();
    expect(OrderInternalService.changeStatus).not.toHaveBeenCalled();
    expect(OrderInternalService.updatePaymentStatus).not.toHaveBeenCalled();
  });
});
