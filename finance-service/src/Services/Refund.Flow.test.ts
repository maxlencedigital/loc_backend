import crypto from "crypto";
import http from "http";
import { AddressInfo } from "net";

// The database is faked in memory with the same semantics that matter here: lockById holds a
// per-payment lock until the surrounding transaction ends (like SELECT ... FOR UPDATE), and the
// guarded refund claim is atomic. Razorpay is a real HTTP server, so the real PaymentClient runs.
jest.mock("../Queries/Payment.Query.js", () => {
  const payments = new Map<string, any>();
  const events = new Set<string>();
  const queues = new Map<string, Promise<void>>();
  const lag = () => new Promise((resolve) => setTimeout(resolve, 1));
  const clone = (p: any) => (p ? { ...p } : null);
  return {
    __payments: payments,
    __events: events,
    PaymentQuery: {
      inTransaction: async (work: any) => {
        const tx = { releases: [] as Array<() => void> };
        try {
          return await work(tx);
        } finally {
          tx.releases.forEach((release) => release());
        }
      },
      lockById: async (id: string, tx: any) => {
        const previous = queues.get(id) ?? Promise.resolve();
        let release!: () => void;
        queues.set(id, new Promise<void>((resolve) => (release = resolve)));
        await previous;
        tx.releases.push(release);
        return clone(payments.get(id));
      },
      findById: async (id: string) => clone(payments.get(id)),
      lockByRazorpayOrderId: async (orderId: string) => clone([...payments.values()].find((p) => p.razorpayOrderId === orderId)),
      update: async (id: string, data: any) => {
        await lag();
        const row = { ...payments.get(id), ...data };
        payments.set(id, row);
        return clone(row);
      },
      recordWebhookEvent: async (event: { eventId: string }) => {
        if (events.has(event.eventId)) return false;
        events.add(event.eventId);
        return true;
      },
    },
  };
});

jest.mock("../Queries/Refund.Query.js", () => {
  const refunds = new Map<string, any>();
  let seq = 0;
  const lag = () => new Promise((resolve) => setTimeout(resolve, 1));
  const clone = (r: any) => (r ? { ...r } : null);
  return {
    __refunds: refunds,
    RefundQuery: {
      create: async (data: any) => {
        await lag();
        const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
        const row = {
          id,
          status: "requested",
          razorpayRefundId: null,
          failureReason: null,
          approvedByUserId: null,
          approvedAt: null,
          processedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        refunds.set(id, row);
        return clone(row);
      },
      findById: async (id: string) => clone(refunds.get(id)),
      findByKey: async (paymentId: string, key: string) =>
        clone([...refunds.values()].find((r) => r.paymentId === paymentId && r.idempotencyKey === key)),
      findByGatewayId: async (gatewayId: string) => clone([...refunds.values()].find((r) => r.razorpayRefundId === gatewayId)),
      sumInFlight: async (paymentId: string) => {
        await lag();
        return [...refunds.values()]
          .filter((r) => r.paymentId === paymentId && ["requested", "approved"].includes(r.status))
          .reduce((n, r) => n + r.amountPaise, 0);
      },
      claimApproval: async (id: string, approver: string) => {
        const row = refunds.get(id);
        if (!row || row.status !== "requested") return false;
        Object.assign(row, { status: "approved", approvedByUserId: approver, approvedAt: new Date() });
        return true;
      },
      update: async (id: string, data: any) => {
        const row = refunds.get(id);
        Object.assign(row, data);
        return clone(row);
      },
      search: jest.fn(async () => ({ items: [], total: 0 })),
    },
  };
});

const ledgerPosts: any[] = [];
jest.mock("../Queries/Ledger.Query.js", () => ({ LedgerQuery: { post: async (posting: any) => (globalThis as any).__ledger.push(posting) } }));
(globalThis as any).__ledger = ledgerPosts;

import { CustomException } from "../../commons/Exception/CustomException.js";
import { Actor } from "../Middleware/StoreScope.js";
import { PaymentService } from "./Payment.Service.js";
import { RefundService } from "./Refund.Service.js";

const { __payments: payments, __events: events } = jest.requireMock("../Queries/Payment.Query.js");
const { __refunds: refunds, RefundQuery } = jest.requireMock("../Queries/Refund.Query.js");

const KEY_SECRET = "key_secret_for_tests";
const WEBHOOK_SECRET = "webhook_secret_for_tests";
const PAYMENT_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const STORE = "11111111-1111-4111-8111-111111111101";
const requester: Actor = { id: "admin-1", role: "admin", name: "Asha", storeId: null, scopeStoreId: null };
const approver: Actor = { id: "admin-2", role: "admin", name: "Ben", storeId: null, scopeStoreId: null };
const superAdmin: Actor = { id: "admin-1", role: "super_admin", name: "Asha", storeId: null, scopeStoreId: null };

// ------------------------------------------------------------ fake Razorpay
let razorpay: http.Server;
const gatewayRefunds = new Map<string, any>();
const refundCalls: Array<{ url: string; idempotency?: string; body: any }> = [];
let refundBehaviour: "ok" | "reject" | "fail" = "ok";

beforeAll(async () => {
  razorpay = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const reply = (status: number, json: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      };
      const match = /^\/v1\/payments\/([^/]+)\/refund$/.exec(req.url as string);
      if (req.method === "POST" && match) {
        const idem = req.headers["x-refund-idempotency"] as string | undefined;
        refundCalls.push({ url: req.url as string, idempotency: idem, body });
        if (refundBehaviour === "reject") return reply(400, { error: { description: "refund exceeds payment" } });
        if (refundBehaviour === "fail") return reply(500, {});
        // Like Razorpay's refund idempotency header: the same key returns the same refund.
        const found = idem ? gatewayRefunds.get(idem) : undefined;
        if (found) return reply(200, found);
        const refund = { id: `rfnd_${gatewayRefunds.size + 1}`, payment_id: match[1], amount: body.amount, status: "processed" };
        if (idem) gatewayRefunds.set(idem, refund);
        return reply(200, refund);
      }
      return reply(404, {});
    });
  });
  await new Promise<void>((resolve) => razorpay.listen(0, "127.0.0.1", resolve));
});
afterAll(() => new Promise<void>((resolve) => razorpay.close(() => resolve())));

const seedPayment = (overrides: Record<string, unknown> = {}) => {
  payments.set(PAYMENT_ID, {
    id: PAYMENT_ID,
    orderRef: "LOC-100",
    razorpayOrderId: "order_R1",
    razorpayPaymentId: "pay_R1",
    amountPaise: 100_000,
    gatewayAmountPaise: 100_000,
    currency: "INR",
    status: "captured",
    method: "upi",
    refundedPaise: 0,
    capturedAt: new Date(),
    amountMismatch: false,
    storeId: STORE,
    ...overrides,
  });
};

beforeEach(() => {
  process.env.RAZORPAY_KEY_ID = "rzp_test_key";
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.RAZORPAY_API_BASE = `http://127.0.0.1:${(razorpay.address() as AddressInfo).port}/v1`;
  payments.clear();
  events.clear();
  refunds.clear();
  gatewayRefunds.clear();
  refundCalls.length = 0;
  ledgerPosts.length = 0;
  refundBehaviour = "ok";
  seedPayment();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const ask = (body: Record<string, unknown>, actor = requester, key?: string) =>
  RefundService.createRefund({ paymentId: PAYMENT_ID, reason: "Customer returned the order", ...body }, actor, key);

const failure = async (promise: Promise<unknown>): Promise<CustomException> => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a refusal");
};

const refundWebhook = (gatewayRefundId: string, amount: number, eventId = `evt-${crypto.randomUUID()}`) => {
  const raw = Buffer.from(
    JSON.stringify({
      event: "refund.processed",
      payload: {
        payment: { entity: { id: "pay_R1", order_id: "order_R1", status: "captured", amount: 100_000 } },
        refund: { entity: { id: gatewayRefundId, amount } },
      },
    })
  );
  const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
  return PaymentService.handleWebhook(raw, signature, eventId);
};

// ------------------------------------------------------------------- tests
describe("requesting a refund", () => {
  it("records a requested refund in paise against a captured payment, tagged with the store", async () => {
    const refund = await ask({ amount: 250.5 });
    expect(refund).toMatchObject({ paymentId: PAYMENT_ID, amount: 250.5, amountPaise: 25_050, status: "requested" });
    expect([...refunds.values()][0]).toMatchObject({ storeId: STORE, requestedByUserId: "admin-1", status: "requested" });
    expect(refundCalls).toHaveLength(0);
  });

  it("refuses a missing, zero, over-precise or malformed request, and an unknown payment", async () => {
    for (const body of [{ amount: undefined }, { amount: 0 }, { amount: 10.005 }, { amount: "abc" }, { reason: "" }, { paymentId: "nope" }]) {
      expect((await failure(ask({ amount: 10, ...body }))).errorCode).toBe(400);
    }
    expect((await failure(ask({ amount: 10, paymentId: "bbbbbbbb-0000-4000-8000-000000000009" }))).errorCode).toBe(404);
    expect(refunds.size).toBe(0);
  });

  it("only refunds a captured payment", async () => {
    for (const status of ["created", "authorized", "failed", "refunded"]) {
      seedPayment({ status });
      expect((await failure(ask({ amount: 10 }))).errorCode).toBe(409);
    }
  });

  it("cannot exceed what was captured minus what is refunded and what is already in flight", async () => {
    seedPayment({ refundedPaise: 20_000 });
    await ask({ amount: 300 }); // in flight: 30,000
    expect((await failure(ask({ amount: 500.01 }))).errorCode).toBe(409);
    await expect(ask({ amount: 500 })).resolves.toMatchObject({ amountPaise: 50_000 });
    const none = await failure(ask({ amount: 0.01 }));
    expect(none.errorCode).toBe(409);
    expect(none.displayMessage).toMatch(/0\.00 remaining/);
  });

  it("measures against the amount the gateway actually captured when it differed from the request", async () => {
    seedPayment({ amountPaise: 100_000, gatewayAmountPaise: 90_000, amountMismatch: true });
    expect((await failure(ask({ amount: 900.01 }))).errorCode).toBe(409);
    await expect(ask({ amount: 900 })).resolves.toBeDefined();
  });

  it("two requests that each fit alone but not together: exactly one is accepted", async () => {
    const results = await Promise.allSettled([ask({ amount: 600 }), ask({ amount: 600 })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.errorCode).toBe(409);
    expect(refunds.size).toBe(1);
  });

  it("ten simultaneous requests for a tenth each never refund more than was captured", async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => ask({ amount: 100 })));
    const accepted = results.filter((r) => r.status === "fulfilled").length;
    expect(accepted).toBe(10);
    expect([...refunds.values()].reduce((n, r) => n + r.amountPaise, 0)).toBe(100_000);
  });
});

describe("Idempotency-Key", () => {
  it("replays the original refund for the same key and creates nothing new", async () => {
    const first = await ask({ amount: 100 }, requester, "key-1");
    const second = await ask({ amount: 100 }, requester, "key-1");
    expect(second.id).toBe(first.id);
    expect(refunds.size).toBe(1);
  });

  it("answers 409 when the key is reused for a different amount or reason", async () => {
    await ask({ amount: 100 }, requester, "key-1");
    expect((await failure(ask({ amount: 200 }, requester, "key-1"))).errorCode).toBe(409);
    expect((await failure(ask({ amount: 100, reason: "Something else" }, requester, "key-1"))).errorCode).toBe(409);
  });

  it("replays even after the payment can take no more refunds", async () => {
    const first = await ask({ amount: 1000 }, requester, "key-full");
    expect((await ask({ amount: 1000 }, requester, "key-full")).id).toBe(first.id);
  });

  it("two simultaneous sends of one key make one refund", async () => {
    const [a, b] = await Promise.all([ask({ amount: 100 }, requester, "key-race"), ask({ amount: 100 }, requester, "key-race")]);
    expect(a.id).toBe(b.id);
    expect(refunds.size).toBe(1);
  });

  it("rejects a malformed key", async () => {
    expect((await failure(ask({ amount: 100 }, requester, "has space"))).errorCode).toBe(400);
  });

  it("without a key, two identical requests are two refunds (each is checked against the cap)", async () => {
    await ask({ amount: 100 });
    await ask({ amount: 100 });
    expect(refunds.size).toBe(2);
  });
});

describe("approving a refund", () => {
  const requested = async (amount = 400) => (await ask({ amount })).id;

  it("sends the refund to Razorpay once, keyed by the refund id, and keeps it approved until the webhook", async () => {
    const id = await requested(400);
    const approved = await RefundService.approveRefund(id, approver);
    expect(approved.status).toBe("approved");
    expect(refundCalls).toHaveLength(1);
    expect(refundCalls[0]).toMatchObject({ url: "/v1/payments/pay_R1/refund", idempotency: id, body: { amount: 40_000 } });
    expect(refunds.get(id)).toMatchObject({ approvedByUserId: "admin-2", razorpayRefundId: "rfnd_1", status: "approved" });
  });

  it("will not let the requester approve their own refund, except a super_admin", async () => {
    const id = await requested();
    const refused = await failure(RefundService.approveRefund(id, requester));
    expect(refused.errorCode).toBe(403);
    expect(refundCalls).toHaveLength(0);
    expect(refunds.get(id).status).toBe("requested");
    await expect(RefundService.approveRefund(id, superAdmin)).resolves.toMatchObject({ status: "approved" });
  });

  it("answers 404 for an unknown or malformed refund", async () => {
    expect((await failure(RefundService.approveRefund("cccccccc-0000-4000-8000-000000000009", approver))).errorCode).toBe(404);
    expect((await failure(RefundService.approveRefund("nope", approver))).errorCode).toBe(404);
  });

  it("approving again, even concurrently, still means exactly one refund at the provider", async () => {
    const id = await requested(400);
    const results = await Promise.all([
      RefundService.approveRefund(id, approver),
      RefundService.approveRefund(id, approver),
      RefundService.approveRefund(id, approver),
    ]);
    expect(results.every((r) => r.status === "approved")).toBe(true);
    expect(gatewayRefunds.size).toBe(1);
    expect(new Set(refundCalls.map((c) => c.idempotency))).toEqual(new Set([id]));
    // Once settled, a further approval does not call the provider again.
    const calls = refundCalls.length;
    await RefundService.approveRefund(id, approver);
    expect(refundCalls).toHaveLength(calls);
  });

  it("marks a refund Razorpay refuses as failed, frees its amount and says so", async () => {
    const id = await requested(1000);
    refundBehaviour = "reject";
    const refused = await failure(RefundService.approveRefund(id, approver));
    expect(refused.errorCode).toBe(409);
    expect(refused.displayMessage).not.toMatch(/exceeds/);
    expect(refunds.get(id)).toMatchObject({ status: "failed" });
    await expect(ask({ amount: 1000 })).resolves.toBeDefined();
    expect((await failure(RefundService.approveRefund(id, approver))).errorCode).toBe(409);
  });

  it("leaves the refund approved when Razorpay cannot be reached, and a retry completes it without a duplicate", async () => {
    const id = await requested(400);
    refundBehaviour = "fail";
    expect((await failure(RefundService.approveRefund(id, approver))).errorCode).toBe(503);
    expect(refunds.get(id)).toMatchObject({ status: "approved", razorpayRefundId: null });
    refundBehaviour = "ok";
    await RefundService.approveRefund(id, approver);
    expect(refunds.get(id).razorpayRefundId).toBe("rfnd_1");
    expect(gatewayRefunds.size).toBe(1);
  });

  it("keeps an unconfirmed refund counted against the payment until the webhook settles it", async () => {
    const id = await requested(1000);
    await RefundService.approveRefund(id, approver);
    expect((await failure(ask({ amount: 0.01 }))).errorCode).toBe(409);
  });
});

describe("the refund.processed webhook", () => {
  it("settles our refund and the payment together, so the amount is neither lost nor counted twice", async () => {
    const id = (await ask({ amount: 400 })).id;
    await RefundService.approveRefund(id, approver);
    await refundWebhook("rfnd_1", 40_000);

    expect(refunds.get(id)).toMatchObject({ status: "processed" });
    expect(refunds.get(id).processedAt).toBeInstanceOf(Date);
    expect(payments.get(PAYMENT_ID).refundedPaise).toBe(40_000);
    // 100,000 captured - 40,000 refunded: 600 still refundable, not 200 (no double count).
    await expect(ask({ amount: 600 })).resolves.toBeDefined();
    expect((await failure(ask({ amount: 0.01 }))).errorCode).toBe(409);
  });

  it("journals the money leaving once, however many times the event is delivered", async () => {
    const id = (await ask({ amount: 400 })).id;
    await RefundService.approveRefund(id, approver);
    await refundWebhook("rfnd_1", 40_000, "evt-1");
    await refundWebhook("rfnd_1", 40_000, "evt-1");
    expect(payments.get(PAYMENT_ID).refundedPaise).toBe(40_000);
    const posts = ledgerPosts.filter((p) => p.sourceType === "refund");
    expect(posts.length).toBeGreaterThanOrEqual(1);
    expect(posts[0]).toMatchObject({ sourceId: "rfnd_1", storeId: STORE, reference: "LOC-100" });
    expect(posts[0].lines).toEqual([
      { account: "refunds", debitPaise: 40_000, creditPaise: 0 },
      { account: "razorpay_clearing", debitPaise: 0, creditPaise: 40_000 },
    ]);
  });

  it("still counts a refund made outside this service (from the Razorpay dashboard)", async () => {
    await refundWebhook("rfnd_external", 25_000);
    expect(payments.get(PAYMENT_ID).refundedPaise).toBe(25_000);
    expect(refunds.size).toBe(0);
    expect(ledgerPosts.find((p) => p.sourceId === "rfnd_external")).toBeDefined();
  });
});

describe("listing", () => {
  it("passes the status and an IST day window to the query", async () => {
    await RefundService.listRefunds({ status: "approved", from: "2026-10-01", to: "2026-10-02" }, { page: 2, limit: 10, offset: 10 });
    const [filter, page] = RefundQuery.search.mock.calls[0];
    expect(filter.status).toBe("approved");
    expect(filter.from.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(filter.to.toISOString()).toBe("2026-10-02T18:30:00.000Z");
    expect(page).toMatchObject({ page: 2, limit: 10 });
    expect((await failure(RefundService.listRefunds({ status: "bogus" }, { page: 1, limit: 20, offset: 0 }))).errorCode).toBe(400);
    expect((await failure(RefundService.listRefunds({ from: "2026-10-05", to: "2026-10-01" }, { page: 1, limit: 20, offset: 0 }))).errorCode).toBe(400);
  });
});
