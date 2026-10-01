import crypto from "crypto";
import http from "http";
import { AddressInfo } from "net";

jest.mock("../Queries/Ledger.Query.js", () => ({ LedgerQuery: { post: async () => true } }));
jest.mock("../Queries/Refund.Query.js", () => ({ RefundQuery: { findByGatewayId: async () => null } }));
jest.mock("../Queries/Payment.Query.js", () => {
  const payments = new Map<string, any>();
  const resolutions = new Map<string, any>();
  let seq = 0;
  const clone = (p: any) => (p ? { ...p } : null);
  const lag = () => new Promise((resolve) => setTimeout(resolve, 1));
  return {
    __payments: payments,
    __resolutions: resolutions,
    PaymentQuery: {
      inTransaction: async (work: any) => work({}),
      create: async (data: any) => {
        await lag();
        if (data.idempotencyKey && [...payments.values()].some((p) => p.idempotencyOwner === data.idempotencyOwner && p.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        const row = {
          id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
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
      findByRazorpayOrderId: async (orderId: string) => clone([...payments.values()].find((p) => p.razorpayOrderId === orderId)),
      lockByRazorpayOrderId: async (orderId: string) => clone([...payments.values()].find((p) => p.razorpayOrderId === orderId)),
      findByIdempotency: async (owner: string, key: string) =>
        clone([...payments.values()].find((p) => p.idempotencyOwner === owner && p.idempotencyKey === key)),
      hasPaidForOrder: async (orderRef: string) =>
        [...payments.values()].some((p) => p.orderRef === orderRef && ["captured", "refunded"].includes(p.status)),
      listByOrderRef: async (orderRef: string, limit: number) =>
        [...payments.values()].filter((p) => p.orderRef === orderRef).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map(clone),
      update: async (id: string, data: any) => {
        const row = { ...payments.get(id), ...data };
        payments.set(id, row);
        return clone(row);
      },
      recordWebhookEvent: async () => true,
      search: jest.fn(async () => ({ items: [...payments.values()].map(clone), total: payments.size })),
      searchMismatches: jest.fn(async (status: string | undefined, scope: string | null) => {
        const items = [...payments.values()]
          .filter((p) => p.amountMismatch && (!scope || p.storeId === scope))
          .map((p) => ({ payment: clone(p), resolution: resolutions.get(p.id) ?? null }))
          .filter((m) => !status || (status === "open") === (m.resolution === null));
        return { items, total: items.length };
      }),
      findMismatch: async (id: string, scope: string | null) => {
        const p = payments.get(id);
        if (!p || !p.amountMismatch || (scope && p.storeId !== scope)) return null;
        return { payment: clone(p), resolution: resolutions.get(id) ?? null };
      },
      createResolution: async (data: any) => {
        await lag();
        if (resolutions.has(data.paymentId)) return false;
        resolutions.set(data.paymentId, { ...data, createdAt: new Date() });
        return true;
      },
    },
  };
});

import { CustomException } from "../../commons/Exception/CustomException.js";
import { Actor } from "../Middleware/StoreScope.js";
import { PaymentService } from "./Payment.Service.js";
import { PaymentAdminService } from "./PaymentAdmin.Service.js";

const { __payments: payments, __resolutions: resolutions, PaymentQuery } = jest.requireMock("../Queries/Payment.Query.js");

const STORE_A = "11111111-1111-4111-8111-111111111101";
const STORE_B = "11111111-1111-4111-8111-111111111102";
const CUSTOMER = "22222222-2222-4222-8222-222222222201";
const OTHER_CUSTOMER = "22222222-2222-4222-8222-222222222202";
const KEY_SECRET = "key_secret_for_tests";
const admin: Actor = { id: "admin-1", role: "admin", name: "Asha", storeId: null, scopeStoreId: null };
const staffA: Actor = { id: "s-1", role: "staff", name: "Sam", storeId: STORE_A, scopeStoreId: null };
const page = { page: 1, limit: 20, offset: 0 };

const failure = async (promise: Promise<unknown>): Promise<CustomException> => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a refusal");
};

// ------------------------------------------------------------ fake Razorpay
let razorpay: http.Server;
let orderSeq = 0;
const orderCalls: any[] = [];
const gatewayPayments = new Map<string, any>();

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
      if (req.method === "POST" && req.url === "/v1/orders") {
        orderCalls.push(body);
        return reply(200, { id: `order_T${++orderSeq}`, amount: body.amount, currency: body.currency, status: "created" });
      }
      const one = /^\/v1\/payments\/([^/]+)$/.exec(req.url as string);
      if (req.method === "GET" && one) return gatewayPayments.has(one[1]) ? reply(200, gatewayPayments.get(one[1])) : reply(400, {});
      return reply(404, {});
    });
  });
  await new Promise<void>((resolve) => razorpay.listen(0, "127.0.0.1", resolve));
});
afterAll(() => new Promise<void>((resolve) => razorpay.close(() => resolve())));

beforeEach(() => {
  process.env.RAZORPAY_KEY_ID = "rzp_test_key";
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_API_BASE = `http://127.0.0.1:${(razorpay.address() as AddressInfo).port}/v1`;
  payments.clear();
  resolutions.clear();
  orderCalls.length = 0;
  gatewayPayments.clear();
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const seed = (id: string, overrides: Record<string, unknown> = {}) => {
  const row = {
    id,
    orderRef: `LOC-${id.slice(-3)}`,
    razorpayOrderId: `order_${id.slice(-3)}`,
    razorpayPaymentId: `pay_${id.slice(-3)}`,
    amountPaise: 100_000,
    gatewayAmountPaise: 100_000,
    currency: "INR",
    status: "captured",
    method: "upi",
    refundedPaise: 0,
    capturedAt: new Date("2026-10-01T05:00:00Z"),
    amountMismatch: false,
    storeId: STORE_A,
    createdAt: new Date("2026-10-01T04:00:00Z"),
    updatedAt: new Date(),
    ...overrides,
  };
  payments.set(id, row);
  return row;
};
const P1 = "aaaaaaaa-0000-4000-8000-000000000001";
const P2 = "aaaaaaaa-0000-4000-8000-000000000002";

describe("listing and reading payments", () => {
  it("passes filters through, turning dates into IST day bounds, and shows rupees", async () => {
    seed(P1);
    const result = await PaymentAdminService.listPayments(
      { status: "captured", method: "upi", from: "2026-10-01", to: "2026-10-02", storeId: STORE_A },
      admin,
      { page: 2, limit: 10, offset: 10 }
    );
    const [filter, requested] = PaymentQuery.search.mock.calls[0];
    expect(filter).toMatchObject({ status: "captured", method: "upi", storeId: STORE_A });
    expect(filter.from.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(filter.to.toISOString()).toBe("2026-10-02T18:30:00.000Z");
    expect(requested).toMatchObject({ page: 2, limit: 10 });
    expect(result.items[0]).toMatchObject({ id: P1, orderId: "LOC-001", amount: 1000, status: "captured" });
  });

  it("narrows an admin to the chosen store (the query beats the header scope), and refuses bad filters", async () => {
    await PaymentAdminService.listPayments({}, { ...admin, scopeStoreId: STORE_A }, page);
    await PaymentAdminService.listPayments({ storeId: STORE_B }, { ...admin, scopeStoreId: STORE_A }, page);
    expect(PaymentQuery.search.mock.calls.map((c: any) => c[0].storeId)).toEqual([STORE_A, STORE_B]);
    for (const query of [{ status: "paid" }, { storeId: "x" }, { from: "2026-13-01" }, { from: "2026-10-05", to: "2026-10-01" }, { method: "x".repeat(31) }]) {
      expect((await failure(PaymentAdminService.listPayments(query, admin, page))).errorCode).toBe(400);
    }
  });

  it("gets one payment, and a store-pinned caller cannot read another store's (404)", async () => {
    seed(P1, { storeId: STORE_A });
    seed(P2, { storeId: STORE_B });
    expect(await PaymentAdminService.getPayment(P1, admin)).toMatchObject({ id: P1, amountPaise: 100_000, refundedAmount: 0, storeId: STORE_A });
    expect((await PaymentAdminService.getPayment(P2, admin)).id).toBe(P2);
    expect((await failure(PaymentAdminService.getPayment(P2, staffA))).errorCode).toBe(404);
    expect((await failure(PaymentAdminService.getPayment(P2, { ...admin, scopeStoreId: STORE_A }))).errorCode).toBe(404);
    expect((await failure(PaymentAdminService.getPayment("nope", admin))).errorCode).toBe(404);
    expect((await failure(PaymentAdminService.getPayment("bbbbbbbb-0000-4000-8000-000000000009", admin))).errorCode).toBe(404);
  });
});

describe("payment mismatches", () => {
  beforeEach(() => {
    seed(P1, { amountMismatch: true, amountPaise: 100_000, gatewayAmountPaise: 90_000, storeId: STORE_A });
    seed(P2, { amountMismatch: true, storeId: STORE_B });
  });

  it("lists flagged payments with expected and gateway amounts, open or resolved", async () => {
    const open = await PaymentAdminService.listMismatches({ status: "open" }, admin, page);
    expect(open.total).toBe(2);
    expect(open.items.find((i) => i.id === P1)).toMatchObject({ expectedAmount: 1000, gatewayAmount: 900, gatewayTransactionId: "pay_001", status: "open" });
    await PaymentAdminService.resolveMismatch(P1, { resolution: "matched", note: "Bank shows the 900" }, admin);
    expect((await PaymentAdminService.listMismatches({ status: "open" }, admin, page)).total).toBe(1);
    expect((await PaymentAdminService.listMismatches({ status: "resolved" }, admin, page)).items[0]).toMatchObject({ id: P1, status: "resolved", resolution: "matched" });
    expect((await failure(PaymentAdminService.listMismatches({ status: "closed" }, admin, page))).errorCode).toBe(400);
  });

  it("shows a staff member only their own store's mismatches", async () => {
    const result = await PaymentAdminService.listMismatches({}, staffA, page);
    expect(result.items.map((i) => i.id)).toEqual([P1]);
    expect(PaymentQuery.searchMismatches.mock.calls[0][1]).toBe(STORE_A);
  });

  it("records the decision once with who, when and why, and changes nothing on the payment", async () => {
    const before = { ...payments.get(P1) };
    const result = await PaymentAdminService.resolveMismatch(P1, { resolution: "written_off", note: "Customer gave 100 back in cash" }, admin);
    expect(result).toMatchObject({ id: P1, status: "resolved", resolution: "written_off", resolvedBy: "Asha" });
    expect(resolutions.get(P1)).toMatchObject({ resolution: "written_off", note: "Customer gave 100 back in cash", resolvedByUserId: "admin-1" });
    expect(payments.get(P1)).toEqual(before);
  });

  it("will not resolve twice, and two admins resolving at once leave one decision", async () => {
    await PaymentAdminService.resolveMismatch(P1, { resolution: "matched", note: "ok" }, admin);
    expect((await failure(PaymentAdminService.resolveMismatch(P1, { resolution: "refunded", note: "no" }, admin))).errorCode).toBe(409);
    const results = await Promise.allSettled([
      PaymentAdminService.resolveMismatch(P2, { resolution: "matched", note: "one" }, admin),
      PaymentAdminService.resolveMismatch(P2, { resolution: "refunded", note: "two" }, { ...admin, id: "admin-2" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.errorCode).toBe(409);
    expect(resolutions.size).toBe(2);
  });

  it("validates the decision and 404s on a payment that is not a mismatch", async () => {
    for (const body of [{}, { resolution: "matched" }, { note: "x" }, { resolution: "ignored", note: "x" }, { resolution: "matched", note: "x".repeat(1001) }]) {
      expect((await failure(PaymentAdminService.resolveMismatch(P1, body, admin))).errorCode).toBe(400);
    }
    seed("aaaaaaaa-0000-4000-8000-000000000003", { amountMismatch: false });
    expect((await failure(PaymentAdminService.resolveMismatch("aaaaaaaa-0000-4000-8000-000000000003", { resolution: "matched", note: "x" }, admin))).errorCode).toBe(404);
    expect((await failure(PaymentAdminService.resolveMismatch(P2, { resolution: "matched", note: "x" }, staffA))).errorCode).toBe(404);
    expect(resolutions.size).toBe(0);
  });
});

describe("internal checkout (called by commerce)", () => {
  const order = (overrides: Record<string, unknown> = {}, key?: string) =>
    PaymentService.createInternalCheckout({ orderRef: "LOC-500", amountPaise: 49_950, customerUserId: CUSTOMER, ...overrides }, key);

  it("creates a Razorpay order in paise and returns what Checkout needs, remembering customer and store", async () => {
    const checkout = await order({ storeId: STORE_A });
    expect(checkout).toMatchObject({ amountPaise: 49_950, currency: "INR", keyId: "rzp_test_key" });
    expect(checkout.razorpayOrderId).toMatch(/^order_T/);
    expect(orderCalls[0]).toMatchObject({ amount: 49_950, currency: "INR", receipt: "LOC-500" });
    expect([...payments.values()][0]).toMatchObject({ orderRef: "LOC-500", customerUserId: CUSTOMER, storeId: STORE_A, createdByUserId: null, status: "created" });
  });

  it("applies the same amount rules as the staff route", async () => {
    for (const amountPaise of [0, 99, 12.5, "500", -1, 2_000_000_001, undefined]) {
      expect((await failure(order({ amountPaise }))).errorCode).toBe(400);
    }
    for (const patch of [{ orderRef: "" }, { orderRef: "x".repeat(65) }, { customerUserId: "x" }, { customerUserId: undefined }, { storeId: "x" }]) {
      expect((await failure(order(patch))).errorCode).toBe(400);
    }
    expect(orderCalls).toHaveLength(0);
  });

  it("refuses an order that is already paid with 409, and allows a retry while it is not", async () => {
    await order();
    await order(); // an unpaid attempt does not block another
    for (const p of payments.values()) p.status = "captured";
    const refused = await failure(order());
    expect(refused.errorCode).toBe(409);
    expect(refused.displayMessage).toMatch(/already paid/);
    expect(orderCalls).toHaveLength(2);
  });

  it("returns the original checkout for a repeated Idempotency-Key, creating one Razorpay order", async () => {
    const first = await order({}, "key-1");
    const second = await order({}, "key-1");
    expect(second).toEqual(first);
    expect(orderCalls).toHaveLength(1);
    expect(payments.size).toBe(1);
  });

  it("takes the key from the body when there is no header, the header winning", async () => {
    const viaBody = await order({ idempotencyKey: "body-key" });
    expect(await order({ idempotencyKey: "body-key" })).toEqual(viaBody);
    const viaHeader = await order({ orderRef: "LOC-501", idempotencyKey: "ignored" }, "header-key");
    expect(await order({ orderRef: "LOC-501" }, "header-key")).toEqual(viaHeader);
  });

  it("refuses a key reused for a different order or amount, and scopes keys to the customer", async () => {
    await order({}, "key-1");
    expect((await failure(order({ amountPaise: 60_000 }, "key-1"))).errorCode).toBe(409);
    expect((await failure(order({ orderRef: "LOC-999" }, "key-1"))).errorCode).toBe(409);
    const other = await order({ customerUserId: OTHER_CUSTOMER }, "key-1");
    expect(other.paymentId).not.toBe([...payments.values()][0].id);
    expect((await failure(order({}, "bad key"))).errorCode).toBe(400);
  });

  it("two simultaneous sends of one key return one payment", async () => {
    const [a, b] = await Promise.all([order({}, "key-race"), order({}, "key-race")]);
    expect(a.paymentId).toBe(b.paymentId);
    expect(payments.size).toBe(1);
  });

  it("lets the staff route use the same key rule, tagging the caller's store", async () => {
    const first = await PaymentService.createCheckout({ orderRef: "LOC-600", amount: 100 }, "s-1", { storeId: STORE_A, idempotencyKey: "staff-key" });
    const second = await PaymentService.createCheckout({ orderRef: "LOC-600", amount: 100 }, "s-1", { storeId: STORE_A, idempotencyKey: "staff-key" });
    expect(second).toEqual(first);
    expect([...payments.values()][0]).toMatchObject({ storeId: STORE_A, createdByUserId: "s-1", idempotencyOwner: "s-1" });
  });
});

describe("internal verify and lookup", () => {
  const confirm = async (customer?: string) => {
    const checkout = await PaymentService.createInternalCheckout({ orderRef: "LOC-700", amountPaise: 20_000, customerUserId: CUSTOMER }, undefined);
    gatewayPayments.set("pay_V1", { id: "pay_V1", order_id: checkout.razorpayOrderId, status: "captured", amount: 20_000, method: "upi" });
    const signature = crypto.createHmac("sha256", KEY_SECRET).update(`${checkout.razorpayOrderId}|pay_V1`).digest("hex");
    return PaymentService.confirmCheckout(
      { razorpayOrderId: checkout.razorpayOrderId, razorpayPaymentId: "pay_V1", razorpaySignature: signature },
      customer
    );
  };

  it("confirms the customer's own payment", async () => {
    expect(await confirm(CUSTOMER)).toMatchObject({ orderRef: "LOC-700", status: "captured", amountPaise: 20_000 });
  });

  it("answers 404 when another customer is named, leaving the payment untouched", async () => {
    expect((await failure(confirm(OTHER_CUSTOMER))).errorCode).toBe(404);
    expect([...payments.values()][0].status).toBe("created");
  });

  it("lists the payments of an order, newest first, with what has been refunded", async () => {
    await PaymentService.createInternalCheckout({ orderRef: "LOC-800", amountPaise: 20_000, customerUserId: CUSTOMER }, undefined);
    await PaymentService.createInternalCheckout({ orderRef: "LOC-800", amountPaise: 20_000, customerUserId: CUSTOMER }, undefined);
    const first = [...payments.values()][0];
    first.createdAt = new Date("2020-01-01");
    first.refundedPaise = 500;
    const { payments: list } = await PaymentService.listForOrder("LOC-800");
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ paymentId: first.id, refundedPaise: 500 });
    expect((await PaymentService.listForOrder("LOC-nothing")).payments).toEqual([]);
    expect((await failure(PaymentService.listForOrder(undefined))).errorCode).toBe(400);
    expect((await failure(PaymentService.listForOrder("x".repeat(65)))).errorCode).toBe(400);
  });
});
