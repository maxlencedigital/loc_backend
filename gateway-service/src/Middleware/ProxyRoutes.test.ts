import http from "http";
import { AddressInfo } from "net";
import express from "express";
import { buildServiceProxy } from "./ProxyRoutes.js";

// A real upstream on a real socket: the failure this guards against (a hung POST)
// only shows up when bytes actually have to cross the proxy.
interface Captured {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const startUpstream = async () => {
  const seen: Captured[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { seen, url, close: () => new Promise<void>((r) => server.close(() => r())) };
};

const startGateway = async (
  build: (app: express.Express) => void
): Promise<{ url: string; close: () => Promise<void> }> => {
  const app = express();
  build(app);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
};

const withVerifiedUser = (role: string, storeId: string | null = null) => (req: any, _res: any, next: any) => {
  req.user = { id: "user-1", role, storeId };
  next();
};

const STORE_OWN = "11111111-1111-4111-8111-111111111101";
const STORE_OTHER = "11111111-1111-4111-8111-111111111102";

describe("buildServiceProxy", () => {
  beforeAll(() => {
    process.env.INTERNAL_SERVICE_SECRET = "s".repeat(40);
  });

  it("delivers a JSON body to the upstream instead of hanging (express.json already consumed it)", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway((app) => {
      app.use(express.json());
      app.use("/commerce", withVerifiedUser("admin"), buildServiceProxy(upstream.url, "/commerce"));
    });

    const res = await fetch(`${gateway.url}/commerce/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId: "s1", items: [{ sku: "shirt", qty: 2 }] }),
      signal: AbortSignal.timeout(5000),
    });

    expect(res.status).toBe(200);
    expect(upstream.seen).toHaveLength(1);
    expect(upstream.seen[0].method).toBe("POST");
    expect(upstream.seen[0].url).toBe("/orders");
    expect(JSON.parse(upstream.seen[0].body)).toEqual({
      storeId: "s1",
      items: [{ sku: "shirt", qty: 2 }],
    });
    await gateway.close();
    await upstream.close();
  });

  it.each(["PATCH", "PUT"])("delivers the body of a %s as well", async (method) => {
    const upstream = await startUpstream();
    const gateway = await startGateway((app) => {
      app.use(express.json());
      app.use("/commerce", withVerifiedUser("admin"), buildServiceProxy(upstream.url, "/commerce"));
    });

    await fetch(`${gateway.url}/commerce/customers/c1`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
      signal: AbortSignal.timeout(5000),
    });

    expect(upstream.seen[0].method).toBe(method);
    expect(JSON.parse(upstream.seen[0].body)).toEqual({ name: "Renamed" });
    await gateway.close();
    await upstream.close();
  });

  it("forwards the verified identity and the internal secret", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway((app) => {
      app.use(express.json());
      app.use("/hr", withVerifiedUser("hr"), buildServiceProxy(upstream.url, "/hr"));
    });

    await fetch(`${gateway.url}/hr/ping`, { signal: AbortSignal.timeout(5000) });

    expect(upstream.seen[0].headers["x-user-id"]).toBe("user-1");
    expect(upstream.seen[0].headers["x-user-role"]).toBe("hr");
    expect(upstream.seen[0].headers["x-internal-secret"]).toBe("s".repeat(40));
    await gateway.close();
    await upstream.close();
  });

  it("strips identity headers a client forged on a route that has no JWT", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway((app) => {
      app.use(express.json());
      // no verifyToken here: a public route
      app.use("/public", buildServiceProxy(upstream.url, "/public"));
    });

    await fetch(`${gateway.url}/public/apply`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": "attacker",
        "x-user-role": "super_admin",
      },
      body: JSON.stringify({ name: "X" }),
      signal: AbortSignal.timeout(5000),
    });

    expect(upstream.seen[0].headers["x-user-id"]).toBeUndefined();
    expect(upstream.seen[0].headers["x-user-role"]).toBeUndefined();
    await gateway.close();
    await upstream.close();
  });

  it("removes store headers a client forged, on a route with no JWT", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway((app) => {
      app.use("/public", buildServiceProxy(upstream.url, "/public"));
    });

    await fetch(`${gateway.url}/public/apply`, {
      headers: {
        "x-user-store-id": STORE_OTHER,
        "x-store-scope": STORE_OTHER,
        "x-store-id": STORE_OTHER,
      },
      signal: AbortSignal.timeout(5000),
    });

    expect(upstream.seen[0].headers["x-user-store-id"]).toBeUndefined();
    expect(upstream.seen[0].headers["x-store-scope"]).toBeUndefined();
    expect(upstream.seen[0].headers["x-store-id"]).toBeUndefined();
    await gateway.close();
    await upstream.close();
  });

  it("replaces a forged x-user-store-id and x-store-scope with the verified identity's", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway((app) => {
      app.use("/commerce", withVerifiedUser("manager", STORE_OWN), buildServiceProxy(upstream.url, "/commerce"));
    });

    await fetch(`${gateway.url}/commerce/orders`, {
      headers: {
        "x-user-store-id": STORE_OTHER,
        "x-store-scope": STORE_OTHER,
        "x-user-role": "super_admin",
      },
      signal: AbortSignal.timeout(5000),
    });

    expect(upstream.seen[0].headers["x-user-store-id"]).toBe(STORE_OWN);
    expect(upstream.seen[0].headers["x-store-scope"]).toBeUndefined();
    expect(upstream.seen[0].headers["x-user-role"]).toBe("manager");
    await gateway.close();
    await upstream.close();
  });

  it("answers 404 for /internal paths and never reaches the upstream, even with a valid user", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway((app) => {
      app.use("/growth", withVerifiedUser("admin"), buildServiceProxy(upstream.url, "/growth"));
    });

    const direct = await fetch(`${gateway.url}/growth/internal/notifications/dispatch`, { method: "POST" });
    const bare = await fetch(`${gateway.url}/growth/internal`);
    const lookalike = await fetch(`${gateway.url}/growth/internals-report`);

    expect(direct.status).toBe(404);
    expect(bare.status).toBe(404);
    expect(lookalike.status).toBe(200);
    expect(upstream.seen.map((s) => s.url)).toEqual(["/internals-report"]);
    await gateway.close();
    await upstream.close();
  });

  it("forwards the verified name percent-encoded and drops a forged x-user-name", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway((app) => {
      app.use(
        "/commerce",
        (req: any, _res: any, next: any) => {
          req.user = { id: "user-1", role: "staff", storeId: null, name: "Zoë Nair" };
          next();
        },
        buildServiceProxy(upstream.url, "/commerce")
      );
    });

    await fetch(`${gateway.url}/commerce/orders`, {
      headers: { "x-user-name": "Forged Admin" },
      signal: AbortSignal.timeout(5000),
    });

    expect(decodeURIComponent(upstream.seen[0].headers["x-user-name"] as string)).toBe("Zoë Nair");
    await gateway.close();
    await upstream.close();
  });

  it("forwards no x-user-name on a route without a verified user", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway((app) => {
      app.use("/commerce", buildServiceProxy(upstream.url, "/commerce"));
    });

    await fetch(`${gateway.url}/commerce/public/x`, {
      headers: { "x-user-name": "Forged Admin" },
      signal: AbortSignal.timeout(5000),
    });

    expect(upstream.seen[0].headers["x-user-name"]).toBeUndefined();
    await gateway.close();
    await upstream.close();
  });

  it.each(["admin", "super_admin"])("passes a %s's X-Store-Id through as x-store-scope", async (role) => {
    const upstream = await startUpstream();
    const gateway = await startGateway((app) => {
      app.use("/commerce", withVerifiedUser(role), buildServiceProxy(upstream.url, "/commerce"));
    });

    await fetch(`${gateway.url}/commerce/orders`, {
      headers: { "x-store-id": STORE_OTHER },
      signal: AbortSignal.timeout(5000),
    });

    expect(upstream.seen[0].headers["x-store-scope"]).toBe(STORE_OTHER);
    // An admin has no store of their own, so nothing is claimed.
    expect(upstream.seen[0].headers["x-user-store-id"]).toBeUndefined();
    expect(upstream.seen[0].headers["x-store-id"]).toBeUndefined();
    await gateway.close();
    await upstream.close();
  });

  it.each(["all", "", "not-a-uuid", "1' OR '1'='1", `${STORE_OTHER}x`])(
    "ignores an admin's X-Store-Id of %p",
    async (value) => {
      const upstream = await startUpstream();
      const gateway = await startGateway((app) => {
        app.use("/commerce", withVerifiedUser("admin"), buildServiceProxy(upstream.url, "/commerce"));
      });

      await fetch(`${gateway.url}/commerce/orders`, {
        headers: { "x-store-id": value },
        signal: AbortSignal.timeout(5000),
      });

      expect(upstream.seen[0].headers["x-store-scope"]).toBeUndefined();
      await gateway.close();
      await upstream.close();
    }
  );

  it.each(["manager", "staff", "hr", "driver", "customer"])(
    "does not forward a %s's scope header, only their token's store",
    async (role) => {
      const upstream = await startUpstream();
      const gateway = await startGateway((app) => {
        app.use("/commerce", withVerifiedUser(role, STORE_OWN), buildServiceProxy(upstream.url, "/commerce"));
      });

      await fetch(`${gateway.url}/commerce/orders`, {
        headers: { "x-store-id": STORE_OTHER },
        signal: AbortSignal.timeout(5000),
      });

      expect(upstream.seen[0].headers["x-store-scope"]).toBeUndefined();
      expect(upstream.seen[0].headers["x-user-store-id"]).toBe(STORE_OWN);
      await gateway.close();
      await upstream.close();
    }
  );

  it("forwards no x-user-store-id for an account without a store", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway((app) => {
      app.use("/commerce", withVerifiedUser("staff", null), buildServiceProxy(upstream.url, "/commerce"));
    });

    await fetch(`${gateway.url}/commerce/orders`, { signal: AbortSignal.timeout(5000) });

    expect(upstream.seen[0].headers["x-user-store-id"]).toBeUndefined();
    await gateway.close();
    await upstream.close();
  });

  it("passes a raw body through byte-for-byte when no JSON parser ran (webhook signatures)", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway((app) => {
      // deliberately NO express.json(): an HMAC is computed over the exact bytes
      app.use("/webhooks", buildServiceProxy(upstream.url, "/webhooks"));
    });
    const raw = '{"event":"payment.captured",  "payload":{"id":"pay_1"}}\n';

    await fetch(`${gateway.url}/webhooks/razorpay`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-razorpay-signature": "abc" },
      body: raw,
      signal: AbortSignal.timeout(5000),
    });

    expect(upstream.seen[0].body).toBe(raw);
    expect(upstream.seen[0].headers["x-razorpay-signature"]).toBe("abc");
    await gateway.close();
    await upstream.close();
  });
});
