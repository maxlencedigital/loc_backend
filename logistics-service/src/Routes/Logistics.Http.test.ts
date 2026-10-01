import http from "http";
import { AddressInfo } from "net";
import express from "express";

// Real router, controllers and services over real HTTP; only the database and the other
// services are fakes. This is where the role matrix and the response envelope are proven.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/Job.Query.js", () => ({ JobQuery: require("../Testing/InMemoryLogistics.js").jobQuery }));
jest.mock("../Queries/Rider.Query.js", () => ({ RiderQuery: require("../Testing/InMemoryLogistics.js").riderQuery }));
jest.mock("../Queries/Earnings.Query.js", () => ({ EarningsQuery: require("../Testing/InMemoryLogistics.js").earningsQuery }));
jest.mock("../Queries/Outbox.Query.js", () => ({ OutboxQuery: require("../Testing/InMemoryLogistics.js").outboxQuery }));
jest.mock("../Clients/Maps.Client.js", () => ({ MapsClient: { isConfigured: () => false, geocode: jest.fn(), getRoute: jest.fn() } }));
jest.mock("../../commons/Http/ServiceClient.js", () => ({ ServiceClient: { get: jest.fn(), post: jest.fn() } }));

import { ServiceClient } from "../../commons/Http/ServiceClient.js";
import { reset, seed, state } from "../Testing/InMemoryLogistics.js";
import router from "./Logistics.Routes.js";

const STORE_A = "11111111-1111-4111-8111-111111111101";
const STORE_B = "11111111-1111-4111-8111-111111111102";

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

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  reset();
  (ServiceClient.post as jest.Mock).mockReset().mockResolvedValue({});
  (ServiceClient.get as jest.Mock).mockReset().mockResolvedValue({ paidPaise: 0, amountPaise: 10_000 });
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

const as = (role: string, id = "00000000-0000-4000-9000-000000000001", storeId?: string) => ({
  "x-user-id": id,
  "x-user-role": role,
  ...(storeId ? { "x-user-store-id": storeId } : {}),
});
const service = { "x-service-name": "commerce" };

const call = async (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
};

describe("role matrix", () => {
  it.each([
    ["driver", "GET", "/jobs"],
    ["driver", "POST", "/jobs/auto-assign"],
    ["driver", "GET", "/riders"],
    ["customer", "GET", "/rider/jobs"],
    ["staff", "GET", "/rider/jobs"],
    ["manager", "POST", "/rider/shift/start"],
    ["staff", "GET", "/rider-applications"],
    ["manager", "POST", "/riders/00000000-0000-4000-8000-000000000001/suspend"],
    ["hr", "GET", "/jobs"],
    ["hr", "POST", "/field-payments/00000000-0000-4000-8000-000000000001/settle"],
    ["customer", "GET", "/riders/available"],
  ])("%s may not %s %s", async (role, method, path) => {
    const { status, json } = await call(method, path, as(role), method === "GET" ? undefined : {});
    expect(status).toBe(403);
    expect(json).toMatchObject({ status: false, statusCode: 403 });
  });

  it.each([
    ["hr", "GET", "/riders"],
    ["staff", "GET", "/riders/00000000-0000-4000-8000-000000000001/eligibility"],
    ["manager", "GET", "/jobs/unassigned"],
  ])("%s may %s %s", async (role, method, path) => {
    const { status } = await call(method, path, as(role, undefined, STORE_A));
    expect([200, 404]).toContain(status);
  });

  it("lets a store-bound manager with no store through the role check but not the store check", async () => {
    const { status, json } = await call("GET", "/jobs", as("manager"));
    expect(status).toBe(403);
    expect(json.displayMessage).toBe("Your account is not assigned to a store.");
  });
});

describe("the public application flow, over HTTP", () => {
  it("applies, uploads and checks status without any token, with the standard envelope", async () => {
    const created = await call("POST", "/public/rider-applications", {}, {
      name: "Asha Devi", phone: "9845012345", city: "Bengaluru", vehicleType: "bike", vehicleNumber: "KA01AB1234",
      drivingLicenceNumber: "KA0120230012345", idType: "aadhaar", idNumber: "123456789012",
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ status: true, statusCode: 201, result: { status: "submitted" } });

    const { applicationId, uploadToken } = created.json.result;
    const uploaded = await call("POST", `/public/rider-applications/${applicationId}/documents`, {}, { uploadToken, type: "photo", fileUrl: "https://files.example.com/p.jpg" });
    expect(uploaded.status).toBe(201);

    const status = await call("GET", `/public/rider-application-status?applicationId=${applicationId}&phone=9845012345`);
    expect(status.json.result.missingDocuments).toEqual(["id_proof", "licence", "vehicle_rc", "insurance"]);
    expect((await call("GET", `/public/rider-application-status?applicationId=${applicationId}&phone=9000000000`)).status).toBe(404);
    expect((await call("POST", "/public/rider-applications", {}, { name: "x" })).status).toBe(400);
  });
});

describe("a rider's own jobs, over HTTP", () => {
  it("answers 200 for the owner and 404 for any other rider", async () => {
    const owner = seed.rider();
    const other = seed.rider({ phone: "+919800000301" });
    const job = seed.job({ riderId: owner.id, status: "assigned" });

    const mine = await call("GET", `/rider/jobs/${job.id}`, as("driver", owner.userId));
    expect(mine.status).toBe(200);
    expect(mine.json.result).toMatchObject({ id: job.id, orderNumber: "ORD-1001", amountToCollect: 0 });
    expect(mine.json.result.handoverCode).toBeUndefined();

    const theirs = await call("GET", `/rider/jobs/${job.id}`, as("driver", other.userId));
    expect(theirs.status).toBe(404);
    expect((await call("POST", `/rider/jobs/${job.id}/start`, as("driver", other.userId), {})).status).toBe(404);
  });

  it("passes the Idempotency-Key header through to the door payment", async () => {
    const rider = seed.rider();
    seed.shift(rider.id);
    const job = seed.job({ riderId: rider.id, status: "arrived", type: "delivery", amountToCollectPaise: 10_000 });
    const headers = { ...as("driver", rider.userId), "idempotency-key": "pay-1" };

    const first = await call("POST", `/rider/jobs/${job.id}/payment`, headers, { method: "cash", amount: 100 });
    const replay = await call("POST", `/rider/jobs/${job.id}/payment`, headers, { method: "cash", amount: 100 });

    expect(first.status).toBe(200);
    expect(replay.json.result.paymentId).toBe(first.json.result.paymentId);
    expect(state.payments).toHaveLength(1);
  });

  it("answers 201 for created photos and carries the 409 for a wrong step", async () => {
    const rider = seed.rider();
    seed.shift(rider.id);
    const job = seed.job({ riderId: rider.id, status: "arrived" });
    const photo = await call("POST", `/rider/jobs/${job.id}/pickup/photos`, as("driver", rider.userId), { photoUrl: "https://files.example.com/a.jpg" });
    expect(photo.status).toBe(201);
    const early = seed.job({ riderId: rider.id, status: "assigned" });
    expect((await call("POST", `/rider/jobs/${early.id}/pickup/scan`, as("driver", rider.userId), { tagId: "T" })).status).toBe(409);
    expect((await call("POST", `/rider/jobs/${early.id}/pickup/scan`, as("driver", rider.userId), {})).status).toBe(400);
  });
});

describe("dispatch over HTTP", () => {
  it("creates a job from the order, in the manager's own store, and refuses another store with 404", async () => {
    (ServiceClient.get as jest.Mock).mockResolvedValue({
      ref: "ORD-77", storeId: STORE_A, customerName: "Ana", customerPhone: "+919845012345", priority: "express",
      paymentStatus: "unpaid", amountPaise: 30_000, paidPaise: 5_000, address: "12 MG Road", deliveryAddress: "9 Brigade Rd",
    });
    const orderId = "00000000-0000-4000-8000-0000000abc01";

    const created = await call("POST", "/jobs", as("manager", undefined, STORE_A), { orderId, type: "delivery", storeId: STORE_A });
    expect(created.status).toBe(201);
    expect(created.json.result).toMatchObject({ orderNumber: "ORD-77", priority: "express", amountToCollect: 250, address: { line1: "9 Brigade Rd" } });

    expect((await call("POST", "/jobs", as("manager", undefined, STORE_A), { orderId, type: "delivery", storeId: STORE_A })).status).toBe(409);
    expect((await call("POST", "/jobs", as("manager", undefined, STORE_B), { orderId: "00000000-0000-4000-8000-0000000abc02", type: "delivery", storeId: STORE_A })).status).toBe(404);
    const wrongStore = await call("POST", "/jobs", as("admin"), { orderId: "00000000-0000-4000-8000-0000000abc03", type: "pickup", storeId: STORE_B });
    expect(wrongStore.status).toBe(400);
  });

  it("answers 404 when commerce does not know the order, and 503 when it cannot be asked", async () => {
    const { CustomException } = jest.requireActual("../../commons/Exception/CustomException.js");
    (ServiceClient.get as jest.Mock).mockRejectedValueOnce(new CustomException("Order not found.", 404));
    const body = { orderId: "00000000-0000-4000-8000-0000000abc04", type: "pickup", storeId: STORE_A };
    expect((await call("POST", "/jobs", as("admin"), body)).status).toBe(404);
    (ServiceClient.get as jest.Mock).mockRejectedValueOnce(new CustomException("A connected service is unavailable right now.", 503));
    expect((await call("POST", "/jobs", as("admin"), body)).status).toBe(503);
    expect(state.jobs).toHaveLength(0);
  });
});

describe("internal endpoints", () => {
  it("need a service name, and are not available to a user's request", async () => {
    expect((await call("GET", "/internal/jobs?orderId=x", as("admin"))).status).toBe(401);
    expect((await call("POST", "/internal/jobs/retry-sync", as("admin"), {})).status).toBe(401);
    expect((await call("GET", "/internal/jobs?orderId=00000000-0000-4000-8000-000000000001", { ...as("admin"), "x-service-name": "someone" })).status).toBe(401);
  });

  it("creates with 201, replays with 200, and looks jobs up by order", async () => {
    const body = { orderId: "00000000-0000-4000-8000-0000000abc10", orderRef: "ORD-5", type: "pickup", storeId: STORE_A, address: { line1: "1 Main" }, contactName: "Ana", contactPhone: "9845012345" };
    const first = await call("POST", "/internal/jobs", service, body);
    const second = await call("POST", "/internal/jobs", service, body);
    expect([first.status, second.status]).toEqual([201, 200]);
    expect(second.json.result.id).toBe(first.json.result.id);
    expect(first.json.result.handoverCode).toMatch(/^\d{6}$/);

    const found = await call("GET", `/internal/jobs?orderId=${body.orderId}`, service);
    expect(found.json.result.jobs).toHaveLength(1);
    expect((await call("GET", "/internal/jobs", service)).status).toBe(400);
    expect((await call("POST", "/internal/jobs", service, { ...body, orderId: "x" })).status).toBe(400);
  });

  it("retries the order updates that are due", async () => {
    state.outbox.push({ id: "00000000-0000-4000-8000-0000000abc20", kind: "order_status", orderId: "00000000-0000-4000-8000-0000000abc21", jobId: null, payload: { status: "picked_up", note: "n" }, dedupeKey: "k", state: "pending", attempts: 1, lastError: null, nextAttemptAt: new Date(Date.now() - 1000) });
    const result = await call("POST", "/internal/jobs/retry-sync", service, {});
    expect(result.status).toBe(200);
    expect(result.json.result).toMatchObject({ processed: 1, delivered: 1 });
    expect((await call("POST", "/internal/jobs/retry-sync", service, { limit: 0 })).status).toBe(400);
  });
});
