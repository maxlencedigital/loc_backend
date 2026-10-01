import crypto from "crypto";
import http from "http";
import { AddressInfo } from "net";
import express from "express";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { captureRawBody } from "../Middleware/RawBody.js";

// Only the database is faked (in memory, with the same replay and row semantics);
// Razorpay is a real HTTP server on localhost, so the real PaymentClient, signature
// checks and request shapes all run. This is the checkout flow end to end.
jest.mock("../Queries/Payment.Query.js", () => {
  const payments = new Map<string, any>();
  const events = new Set<string>();
  let seq = 0;
  const clone = (p: any) => (p ? { ...p } : null);
  const byOrder = (orderId: string) => [...payments.values()].find((p) => p.razorpayOrderId === orderId);
  return {
    __store: { payments, events },
    PaymentQuery: {
      inTransaction: async (work: any) => work({}),
      create: async (data: any) => {
        const row = {
          id: `pay-${++seq}`,
          razorpayPaymentId: null,
          status: "created",
          method: null,
          failureReason: null,
          refundedPaise: 0,
          capturedAt: null,
          amountMismatch: false,
          gatewayAmountPaise: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        payments.set(row.id, row);
        return clone(row);
      },
      findById: async (id: string) => clone(payments.get(id)),
      findByRazorpayOrderId: async (orderId: string) => clone(byOrder(orderId)),
      lockByRazorpayOrderId: async (orderId: string) => clone(byOrder(orderId)),
      hasPaidForOrder: async (orderRef: string) =>
        [...payments.values()].some((p) => p.orderRef === orderRef && ["captured", "refunded"].includes(p.status)),
      update: async (id: string, data: any) => {
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

// The ledger and refund tables are covered by their own tests; here they only need to exist.
jest.mock("../Queries/Ledger.Query.js", () => ({ LedgerQuery: { post: async () => true } }));
jest.mock("../Queries/Refund.Query.js", () => ({ RefundQuery: { findByGatewayId: async () => null } }));

import { PaymentService, mergeStatus } from "./Payment.Service.js";
import { PaymentsWebhookController } from "../Controllers/PaymentsWebhook.Controller.js";

const { __store: store } = jest.requireMock("../Queries/Payment.Query.js");

const KEY_ID = "rzp_test_key";
const KEY_SECRET = "key_secret_for_tests";
const WEBHOOK_SECRET = "webhook_secret_for_tests";
const hmac = (secret: string, data: string | Buffer) => crypto.createHmac("sha256", secret).update(data).digest("hex");

// ------------------------------------------------------------ fake Razorpay
let razorpay: http.Server;
let orderSeq = 0;
const gatewayPayments = new Map<string, any>();
const razorpayCalls: Array<{ method: string; url: string; auth?: string; body: any }> = [];

beforeAll(async () => {
  razorpay = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      razorpayCalls.push({ method: req.method as string, url: req.url as string, auth: req.headers.authorization, body });
      const reply = (status: number, json: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      };
      if (req.method === "POST" && req.url === "/v1/orders") {
        return reply(200, { id: `order_T${++orderSeq}`, amount: body.amount, currency: body.currency, status: "created" });
      }
      const capture = /^\/v1\/payments\/([^/]+)\/capture$/.exec(req.url as string);
      if (req.method === "POST" && capture) {
        const p = gatewayPayments.get(capture[1]);
        if (!p) return reply(400, { error: { description: "no such payment" } });
        p.status = "captured";
        return reply(200, p);
      }
      const one = /^\/v1\/payments\/([^/]+)$/.exec(req.url as string);
      if (req.method === "GET" && one) {
        const p = gatewayPayments.get(one[1]);
        return p ? reply(200, p) : reply(400, { error: { description: "no such payment" } });
      }
      return reply(404, {});
    });
  });
  await new Promise<void>((resolve) => razorpay.listen(0, "127.0.0.1", resolve));
});
afterAll(() => new Promise<void>((resolve) => razorpay.close(() => resolve())));

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.RAZORPAY_API_BASE = `http://127.0.0.1:${(razorpay.address() as AddressInfo).port}/v1`;
  delete process.env.RAZORPAY_CAPTURE_MODE;
  store.payments.clear();
  store.events.clear();
  gatewayPayments.clear();
  razorpayCalls.length = 0;
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

// ------------------------------------------------------------------ helpers
const gatewayPayment = (orderId: string, overrides: Record<string, unknown> = {}) => ({
  id: "pay_T1",
  order_id: orderId,
  status: "captured",
  amount: 49950,
  method: "upi",
  ...overrides,
});

const newCheckout = async (amount = 499.5, orderRef = "order-1") =>
  PaymentService.createCheckout({ orderRef, amount }, "user-1");

const webhookEvent = (event: string, entity: Record<string, unknown>, refund?: Record<string, unknown>) => {
  const raw = Buffer.from(
    JSON.stringify({ event, payload: { payment: { entity }, ...(refund ? { refund: { entity: refund } } : {}) } })
  );
  return { raw, signature: hmac(WEBHOOK_SECRET, raw) };
};

const deliver = (event: { raw: Buffer; signature: string }, eventId = `evt-${crypto.randomUUID()}`) =>
  PaymentService.handleWebhook(event.raw, event.signature, eventId);

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a rejection");
};

const onlyPayment = () => [...store.payments.values()][0];

// ------------------------------------------------------------------- tests
describe("createCheckout", () => {
  it("creates the Razorpay order in paise and stores the payment", async () => {
    const checkout = await newCheckout(499.5);

    expect(checkout).toMatchObject({ amountPaise: 49950, currency: "INR", keyId: KEY_ID });
    expect(checkout.razorpayOrderId).toMatch(/^order_T/);
    expect(razorpayCalls[0].body).toMatchObject({ amount: 49950, currency: "INR", receipt: "order-1" });
    expect(razorpayCalls[0].auth).toBe(`Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`);
    expect(onlyPayment()).toMatchObject({ orderRef: "order-1", amountPaise: 49950, status: "created", createdByUserId: "user-1" });
  });

  it("rounds floating-point rupees to whole paise", async () => {
    // 0.1 + 0.2 = 0.30000000000000004; a naive *100 would send 30.000000000000004.
    const checkout = await newCheckout(0.1 + 0.2 + 1);

    expect(checkout.amountPaise).toBe(130);
  });

  it.each([[0], [0.5], [-5], ["abc"], [Number.NaN], [3_000_000_000]])("rejects amount %p without calling Razorpay", async (amount) => {
    const error = await rejection(newCheckout(amount as number));

    expect(error.errorCode).toBe(400);
    expect(razorpayCalls).toHaveLength(0);
  });

  it("requires orderRef and amount", async () => {
    const error = await rejection(PaymentService.createCheckout({}, "u"));

    expect(error.errorCode).toBe(400);
    expect(error.displayMessage).toContain("orderRef, amount");
  });

  it("refuses to take a second payment for an order that is already paid", async () => {
    const checkout = await newCheckout();
    onlyPayment().status = "captured";

    const error = await rejection(newCheckout(499.5, "order-1"));

    expect(error.errorCode).toBe(409);
    expect(checkout.razorpayOrderId).toBeDefined();
    expect(razorpayCalls.filter((c) => c.url === "/v1/orders")).toHaveLength(1);
  });

  it("reports an unreachable or unconfigured provider as 503 without leaking details", async () => {
    delete process.env.RAZORPAY_KEY_SECRET;

    const error = await rejection(newCheckout());

    expect(error.errorCode).toBe(503);
    expect(error.displayMessage).not.toMatch(/razorpay|secret|key/i);
    expect(store.payments.size).toBe(0);
  });
});

describe("confirmCheckout", () => {
  const confirmInput = (checkout: { razorpayOrderId: string }, paymentId = "pay_T1", secret = KEY_SECRET) => ({
    razorpayOrderId: checkout.razorpayOrderId,
    razorpayPaymentId: paymentId,
    razorpaySignature: hmac(secret, `${checkout.razorpayOrderId}|${paymentId}`),
  });

  it("verifies the signature, reads the real status from Razorpay and marks the payment captured", async () => {
    const checkout = await newCheckout();
    gatewayPayments.set("pay_T1", gatewayPayment(checkout.razorpayOrderId));

    const result = await PaymentService.confirmCheckout(confirmInput(checkout));

    expect(result).toMatchObject({ status: "captured", method: "upi", amountPaise: 49950 });
    expect(onlyPayment()).toMatchObject({ razorpayPaymentId: "pay_T1", amountMismatch: false });
    expect(onlyPayment().capturedAt).toBeInstanceOf(Date);
  });

  it("rejects a forged signature and never asks Razorpay about the payment", async () => {
    const checkout = await newCheckout();

    const error = await rejection(PaymentService.confirmCheckout(confirmInput(checkout, "pay_T1", "attacker-secret")));

    expect(error.errorCode).toBe(400);
    expect(razorpayCalls.some((c) => c.url.startsWith("/v1/payments"))).toBe(false);
    expect(onlyPayment().status).toBe("created");
  });

  it("rejects a valid signature for a payment that belongs to a different order", async () => {
    const checkout = await newCheckout();
    gatewayPayments.set("pay_T1", gatewayPayment("order_SOMEONE_ELSE"));

    const error = await rejection(PaymentService.confirmCheckout(confirmInput(checkout)));

    expect(error.errorCode).toBe(400);
    expect(onlyPayment().status).toBe("created");
  });

  it("returns 404 for an unknown order and 400 for missing fields", async () => {
    expect((await rejection(PaymentService.confirmCheckout({ razorpayOrderId: "order_x", razorpayPaymentId: "p", razorpaySignature: "s" }))).errorCode).toBe(404);
    expect((await rejection(PaymentService.confirmCheckout({}))).errorCode).toBe(400);
  });

  it("captures explicitly when the account is on manual capture", async () => {
    process.env.RAZORPAY_CAPTURE_MODE = "manual";
    const checkout = await newCheckout();
    gatewayPayments.set("pay_T1", gatewayPayment(checkout.razorpayOrderId, { status: "authorized" }));

    const result = await PaymentService.confirmCheckout(confirmInput(checkout));

    const capture = razorpayCalls.find((c) => c.url === "/v1/payments/pay_T1/capture");
    expect(capture?.body).toEqual({ amount: 49950, currency: "INR" });
    expect(result.status).toBe("captured");
  });

  it("leaves an authorized payment authorized when capture is automatic", async () => {
    const checkout = await newCheckout();
    gatewayPayments.set("pay_T1", gatewayPayment(checkout.razorpayOrderId, { status: "authorized" }));

    const result = await PaymentService.confirmCheckout(confirmInput(checkout));

    expect(result.status).toBe("authorized");
    expect(razorpayCalls.some((c) => c.url.endsWith("/capture"))).toBe(false);
  });
});

describe("handleWebhook", () => {
  it("rejects a missing or wrong signature and changes nothing", async () => {
    const checkout = await newCheckout();
    const event = webhookEvent("payment.captured", gatewayPayment(checkout.razorpayOrderId));

    expect((await rejection(PaymentService.handleWebhook(event.raw, undefined, "e1"))).errorCode).toBe(400);
    expect((await rejection(PaymentService.handleWebhook(event.raw, "0".repeat(64), "e1"))).errorCode).toBe(400);
    expect((await rejection(PaymentService.handleWebhook(undefined, event.signature, "e1"))).errorCode).toBe(400);
    expect(onlyPayment().status).toBe("created");
    expect(store.events.size).toBe(0);
  });

  it("rejects a body that was altered after signing", async () => {
    const checkout = await newCheckout();
    const signed = webhookEvent("payment.failed", gatewayPayment(checkout.razorpayOrderId, { status: "failed" }));
    const tampered = Buffer.from(signed.raw.toString().replace("failed", "captured"));

    const error = await rejection(PaymentService.handleWebhook(tampered, signed.signature, "e1"));

    expect(error.errorCode).toBe(400);
  });

  it("refuses every event when the webhook secret is not configured", async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const raw = Buffer.from("{}");

    const error = await rejection(PaymentService.handleWebhook(raw, hmac("", raw), "e1"));

    expect(error.errorCode).toBe(503);
  });

  it("marks the payment captured on payment.captured", async () => {
    const checkout = await newCheckout();

    const result = await deliver(webhookEvent("payment.captured", gatewayPayment(checkout.razorpayOrderId)));

    expect(result.outcome).toBe("processed");
    expect(onlyPayment()).toMatchObject({ status: "captured", razorpayPaymentId: "pay_T1", method: "upi" });
  });

  it("ignores a replayed event instead of applying it twice", async () => {
    const checkout = await newCheckout();
    const refund = webhookEvent("refund.processed", gatewayPayment(checkout.razorpayOrderId), { id: "rfnd_1", amount: 10000 });
    await deliver(webhookEvent("payment.captured", gatewayPayment(checkout.razorpayOrderId)));

    const first = await deliver(refund, "evt-refund-1");
    const replay = await deliver(refund, "evt-refund-1");

    expect(first.outcome).toBe("processed");
    expect(replay.outcome).toBe("duplicate");
    expect(onlyPayment().refundedPaise).toBe(10000);
  });

  it("deduplicates by body hash when Razorpay sends no event id", async () => {
    const checkout = await newCheckout();
    const refund = webhookEvent("refund.processed", gatewayPayment(checkout.razorpayOrderId), { id: "rfnd_1", amount: 10000 });

    await PaymentService.handleWebhook(refund.raw, refund.signature, undefined);
    const replay = await PaymentService.handleWebhook(refund.raw, refund.signature, undefined);

    expect(replay.outcome).toBe("duplicate");
    expect(onlyPayment().refundedPaise).toBe(10000);
  });

  it("does not let a late payment.failed undo a capture", async () => {
    const checkout = await newCheckout();
    await deliver(webhookEvent("payment.captured", gatewayPayment(checkout.razorpayOrderId)));

    await deliver(webhookEvent("payment.failed", gatewayPayment(checkout.razorpayOrderId, { id: "pay_T0", status: "failed" })));

    expect(onlyPayment().status).toBe("captured");
  });

  it("lets a retry succeed after a failed attempt on the same order", async () => {
    const checkout = await newCheckout();
    await deliver(
      webhookEvent("payment.failed", gatewayPayment(checkout.razorpayOrderId, { id: "pay_T0", status: "failed", error_description: "Card declined" }))
    );
    expect(onlyPayment()).toMatchObject({ status: "failed", failureReason: "Card declined" });

    await deliver(webhookEvent("payment.captured", gatewayPayment(checkout.razorpayOrderId)));

    expect(onlyPayment()).toMatchObject({ status: "captured", razorpayPaymentId: "pay_T1" });
  });

  it("flags, but still records, a payment whose amount differs from the order", async () => {
    const checkout = await newCheckout(499.5);

    await deliver(webhookEvent("payment.captured", gatewayPayment(checkout.razorpayOrderId, { amount: 100 })));

    expect(onlyPayment()).toMatchObject({ status: "captured", amountMismatch: true, gatewayAmountPaise: 100, amountPaise: 49950 });
  });

  it("tracks partial refunds and marks the payment refunded only when fully refunded", async () => {
    const checkout = await newCheckout(499.5);
    await deliver(webhookEvent("payment.captured", gatewayPayment(checkout.razorpayOrderId)));

    await deliver(webhookEvent("refund.processed", gatewayPayment(checkout.razorpayOrderId), { id: "r1", amount: 20000 }));
    expect(onlyPayment()).toMatchObject({ status: "captured", refundedPaise: 20000 });

    await deliver(webhookEvent("refund.processed", gatewayPayment(checkout.razorpayOrderId), { id: "r2", amount: 29950 }));
    expect(onlyPayment()).toMatchObject({ status: "refunded", refundedPaise: 49950 });
  });

  it("accepts but ignores events for orders it does not know, and unrelated event types", async () => {
    const checkout = await newCheckout();

    const unknown = await deliver(webhookEvent("payment.captured", gatewayPayment("order_NOT_OURS")));
    const other = await deliver(webhookEvent("settlement.processed", gatewayPayment(checkout.razorpayOrderId)));

    expect(unknown.outcome).toBe("ignored");
    expect(other.outcome).toBe("ignored");
    expect(onlyPayment().status).toBe("created");
  });
});

describe("the webhook over real HTTP", () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ verify: captureRawBody }));
    app.post("/public/payments/reconcile", PaymentsWebhookController.receiveRazorpayWebhook);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const post = (raw: string, signature: string, eventId = "evt-http-1") =>
    fetch(`${base}/public/payments/reconcile`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-razorpay-signature": signature, "x-razorpay-event-id": eventId },
      body: raw,
    });

  it("verifies the signature against the exact bytes sent, whatever their formatting", async () => {
    const checkout = await newCheckout();
    // Pretty-printed with unusual spacing: re-serialising the parsed JSON would not match.
    const raw = `{ "event" : "payment.captured",\n  "payload":{"payment":{"entity":${JSON.stringify(gatewayPayment(checkout.razorpayOrderId))}}} }`;

    const response = await post(raw, hmac(WEBHOOK_SECRET, raw));

    expect(response.status).toBe(200);
    expect(onlyPayment().status).toBe("captured");
  });

  it("answers 400 to a bad signature and 200 to a replay", async () => {
    const checkout = await newCheckout();
    const raw = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: gatewayPayment(checkout.razorpayOrderId) } } });

    expect((await post(raw, "bad-signature")).status).toBe(400);
    expect((await post(raw, hmac(WEBHOOK_SECRET, raw), "evt-replay")).status).toBe(200);
    const replay = await post(raw, hmac(WEBHOOK_SECRET, raw), "evt-replay");
    expect(replay.status).toBe(200);
    expect((await replay.json()).result.outcome).toBe("duplicate");
  });
});

describe("mergeStatus", () => {
  it("only ever moves up the ladder", () => {
    expect(mergeStatus("created", "failed")).toBe("failed");
    expect(mergeStatus("failed", "authorized")).toBe("authorized");
    expect(mergeStatus("captured", "failed")).toBe("captured");
    expect(mergeStatus("captured", "authorized")).toBe("captured");
    expect(mergeStatus("refunded", "captured")).toBe("refunded");
  });
});
