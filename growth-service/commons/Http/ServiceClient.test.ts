import http from "http";
import { AddressInfo } from "net";
import { CustomException } from "../Exception/CustomException.js";
import { ServiceClient } from "./ServiceClient.js";

// A real HTTP server stands in for the other service, so headers, retries and the
// breaker are exercised over the wire rather than against a mocked fetch.
interface Seen {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let server: http.Server;
let seen: Seen[];
let respond: (index: number) => { status: number; body: unknown; delayMs?: number };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: raw });
      const plan = respond(seen.length - 1);
      setTimeout(() => {
        res.writeHead(plan.status, { "content-type": "application/json" });
        res.end(JSON.stringify(plan.body));
      }, plan.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.GROWTH_SERVICE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  seen = [];
  respond = () => ({ status: 200, body: { status: true, statusCode: 200, result: { ok: true } } });
  process.env.INTERNAL_SERVICE_SECRET = "s".repeat(40);
  process.env.DB_SCHEMA = "commerce";
  ServiceClient.reset();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a rejection");
};

describe("ServiceClient", () => {
  it("returns the envelope result and sends the internal secret and the caller's name", async () => {
    const result = await ServiceClient.post("growth", "/internal/notifications/dispatch", { body: { a: 1 } });

    expect(result).toEqual({ ok: true });
    expect(seen[0].headers["x-internal-secret"]).toBe("s".repeat(40));
    expect(seen[0].headers["x-service-name"]).toBe("commerce");
    expect(JSON.parse(seen[0].body)).toEqual({ a: 1 });
    expect(seen[0].headers["x-user-id"]).toBeUndefined();
  });

  it("runs as a user when asked: identity headers, with the name percent-encoded", async () => {
    await ServiceClient.get("growth", "/offers", {
      as: { userId: "u1", role: "customer", storeId: "s1", name: "Zoë Nair" },
      query: { page: 2, skipped: undefined },
    });

    expect(seen[0].url).toBe("/offers?page=2");
    expect(seen[0].headers["x-user-id"]).toBe("u1");
    expect(seen[0].headers["x-user-role"]).toBe("customer");
    expect(seen[0].headers["x-user-store-id"]).toBe("s1");
    expect(decodeURIComponent(seen[0].headers["x-user-name"] as string)).toBe("Zoë Nair");
  });

  it("passes a 4xx refusal through unchanged and does not retry it", async () => {
    respond = () => ({ status: 404, body: { status: false, statusCode: 404, displayMessage: "No such coupon.", result: null } });

    const error = await failure(ServiceClient.get("growth", "/coupons/x"));

    expect(error.errorCode).toBe(404);
    expect(error.displayMessage).toBe("No such coupon.");
    expect(seen).toHaveLength(1);
  });

  it("retries a read after a 5xx and succeeds", async () => {
    respond = (i) =>
      i === 0
        ? { status: 503, body: { status: false } }
        : { status: 200, body: { status: true, statusCode: 200, result: { n: i } } };

    const result = await ServiceClient.get("growth", "/offers");

    expect(result).toEqual({ n: 1 });
    expect(seen).toHaveLength(2);
  });

  it("never retries a write unless it is marked idempotent", async () => {
    respond = () => ({ status: 503, body: { status: false } });

    const error = await failure(ServiceClient.post("growth", "/internal/x", { body: {} }));

    expect(error.errorCode).toBe(503);
    expect(seen).toHaveLength(1);
  });

  it("retries an idempotent write", async () => {
    respond = (i) => (i < 2 ? { status: 502, body: {} } : { status: 200, body: { status: true, result: "done" } });

    expect(await ServiceClient.post("growth", "/internal/x", { body: {}, idempotent: true })).toBe("done");
    expect(seen).toHaveLength(3);
  });

  it("gives up after the retries with a 503 that hides the details", async () => {
    respond = () => ({ status: 500, body: { status: false, displayMessage: "stack trace here" } });

    const error = await failure(ServiceClient.get("growth", "/offers"));

    expect(error.errorCode).toBe(503);
    expect(error.displayMessage).not.toContain("stack trace");
    expect(seen).toHaveLength(3);
  });

  it("times out a slow service", async () => {
    respond = () => ({ status: 200, body: { status: true }, delayMs: 400 });

    const error = await failure(ServiceClient.post("growth", "/internal/x", { body: {}, timeoutMs: 50 }));

    expect(error.errorCode).toBe(503);
  });

  it("opens the circuit after repeated failures and then fails fast without calling", async () => {
    respond = () => ({ status: 500, body: {} });
    await failure(ServiceClient.post("growth", "/internal/x", { body: {} }));
    for (let i = 0; i < 4; i++) await failure(ServiceClient.post("growth", "/internal/x", { body: {} }));
    const callsBefore = seen.length;

    const error = await failure(ServiceClient.get("growth", "/offers"));

    expect(error.errorCode).toBe(503);
    expect(seen).toHaveLength(callsBefore);
  });

  it("a success resets the failure count", async () => {
    respond = () => ({ status: 500, body: {} });
    for (let i = 0; i < 3; i++) await failure(ServiceClient.post("growth", "/internal/x", { body: {} }));
    respond = () => ({ status: 200, body: { status: true, result: 1 } });
    await ServiceClient.post("growth", "/internal/x", { body: {} });
    respond = () => ({ status: 500, body: {} });
    for (let i = 0; i < 3; i++) await failure(ServiceClient.post("growth", "/internal/x", { body: {} }));
    respond = () => ({ status: 200, body: { status: true, result: 2 } });

    expect(await ServiceClient.get("growth", "/offers")).toBe(2);
  });

  it("reports a service with no configured URL as unavailable", async () => {
    delete process.env.LOGISTICS_SERVICE_URL;

    const error = await failure(ServiceClient.get("logistics", "/jobs"));

    expect(error.errorCode).toBe(503);
  });
});
