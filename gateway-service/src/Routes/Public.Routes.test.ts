import fs from "fs";
import http from "http";
import path from "path";
import { AddressInfo } from "net";
import express from "express";
import { buildPublicRouter } from "./Public.Routes.js";

// The real rate limiter and audit logger are not under test here.
jest.mock("../Middleware/RateLimiter.js", () => ({
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock("../Middleware/ActivityLogger.js", () => ({
  activityLogger: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

interface Seen {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const listen = async (server: http.Server) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const startUpstream = async () => {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const url = await listen(server);
  return { seen, url, close: () => new Promise<void>((r) => server.close(() => r())) };
};

describe("public router", () => {
  beforeAll(() => {
    process.env.INTERNAL_SERVICE_SECRET = "s".repeat(40);
  });

  const startGateway = async (upstreamUrl: string) => {
    // Mirrors Gateway.Server.ts: the public router first, the JSON parser after it.
    const app = express();
    app.use(buildPublicRouter({ commerce: upstreamUrl, logistics: upstreamUrl }));
    app.use(express.json());
    // Anything not public falls through to an authenticated route.
    app.use((_req, res) => res.status(401).json({ reason: "JWT required" }));
    const server = http.createServer(app);
    const url = await listen(server);
    return { url, close: () => new Promise<void>((r) => server.close(() => r())) };
  };

  it("forwards /<service>/public/* with no token, path intact", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway(upstream.url);

    const res = await fetch(`${gateway.url}/logistics/public/rider-applications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Asha", phone: "+919876543210" }),
      signal: AbortSignal.timeout(5000),
    });

    expect(res.status).toBe(200);
    expect(upstream.seen[0].url).toBe("/public/rider-applications");
    expect(JSON.parse(upstream.seen[0].body)).toEqual({ name: "Asha", phone: "+919876543210" });
    await gateway.close();
    await upstream.close();
  });

  it("passes a webhook body through byte-for-byte, so its signature still verifies", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway(upstream.url);
    const raw = '{"event":"payment.captured",   "payload":{"payment":{"id":"pay_1"}}}\n';

    await fetch(`${gateway.url}/commerce/public/payments/razorpay-webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-razorpay-signature": "sig123" },
      body: raw,
      signal: AbortSignal.timeout(5000),
    });

    expect(upstream.seen[0].body).toBe(raw);
    expect(upstream.seen[0].headers["x-razorpay-signature"]).toBe("sig123");
    expect(upstream.seen[0].url).toBe("/public/payments/razorpay-webhook");
    await gateway.close();
    await upstream.close();
  });

  it("strips identity headers a caller forged", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway(upstream.url);

    await fetch(`${gateway.url}/commerce/public/anything`, {
      headers: { "x-user-id": "attacker", "x-user-role": "super_admin" },
      signal: AbortSignal.timeout(5000),
    });

    expect(upstream.seen[0].headers["x-user-id"]).toBeUndefined();
    expect(upstream.seen[0].headers["x-user-role"]).toBeUndefined();
    expect(upstream.seen[0].headers["x-internal-secret"]).toBe("s".repeat(40));
    await gateway.close();
    await upstream.close();
  });

  it("does NOT open anything outside /public/", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway(upstream.url);

    for (const p of ["/commerce/orders", "/commerce/hr/employees", "/logistics/riders", "/commerce/publicity"]) {
      const res = await fetch(`${gateway.url}${p}`, { signal: AbortSignal.timeout(5000) });
      expect(res.status).toBe(401);
    }
    expect(upstream.seen).toHaveLength(0);
    await gateway.close();
    await upstream.close();
  });
});

describe("Gateway.Server.ts ordering", () => {
  it("mounts the public router before express.json(), so webhook bodies are never re-serialised", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../Gateway.Server.ts"), "utf8");
    const publicAt = source.indexOf("app.use(publicRoutes)");
    const jsonAt = source.indexOf("app.use(express.json())");

    expect(publicAt).toBeGreaterThan(-1);
    expect(jsonAt).toBeGreaterThan(-1);
    expect(publicAt).toBeLessThan(jsonAt);
  });
});
