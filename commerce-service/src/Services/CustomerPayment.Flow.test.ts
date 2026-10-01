import { CustomException } from "../../commons/Exception/CustomException.js";

// Queries are in-memory fakes and finance, logistics and the gateway are faked services; the
// payment rules, the account package's paid-total logic and its customer link are real code.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../../commons/Http/ServiceClient.js", () => require("../Testing/InMemorySupport.js").serviceClientMock);
jest.mock("../Queries/Store.Query.js", () => ({ StoreQuery: require("../Testing/InMemoryCommerce.js").storeQuery }));
jest.mock("../Queries/Customer.Query.js", () => ({ CustomerQuery: require("../Testing/InMemoryCommerce.js").customerQuery }));
jest.mock("../Queries/Catalog.Query.js", () => ({ CatalogQuery: require("../Testing/InMemoryCommerce.js").catalogQuery }));
jest.mock("../Queries/Order.Query.js", () => ({ OrderQuery: require("../Testing/InMemoryCommerce.js").orderQuery }));
jest.mock("../Queries/CustomerProfile.Query.js", () => ({ CustomerProfileQuery: require("../Testing/InMemoryCustomerAccount.js").profileQuery }));
jest.mock("../Queries/OrderInternal.Query.js", () => ({ OrderInternalQuery: require("../Testing/InMemoryCustomerAccount.js").internalOrderQuery }));
jest.mock("../Queries/CustomerOrder.Query.js", () => ({ CustomerOrderQuery: require("../Testing/InMemoryCustomerAccount.js").customerOrderQuery }));
jest.mock("../Queries/CustomerPayment.Query.js", () => ({ CustomerPaymentQuery: require("../Testing/InMemorySupport.js").paymentQuery }));
jest.mock("../Queries/SupportOrder.Query.js", () => ({ SupportOrderQuery: require("../Testing/InMemorySupport.js").supportOrderQuery }));

import { state as core } from "../Testing/InMemoryCommerce.js";
import { state as account } from "../Testing/InMemoryCustomerAccount.js";
import { fake, state } from "../Testing/InMemorySupport.js";
import { IShopper, addOrder, buildSupportWorld, refused, shopper } from "../Testing/SupportWorld.js";
import { CustomerPaymentService } from "./CustomerPayment.Service.js";
import { MAX_SAVED_METHODS, PaymentMethodService } from "./PaymentMethod.Service.js";
import { OrderInternalService } from "./OrderInternal.Service.js";

const NOW = new Date("2026-10-05T04:00:00Z");
const SIG = "sig_ok";
let world: any;
let ana: IShopper;
let bob: IShopper;
let order: any;
let errorSpy: jest.SpyInstance;

const initiate = (who = ana, orderId = order.id, body: unknown = {}, key?: string) =>
  CustomerPaymentService.initiate(who.user, orderId, body, key) as Promise<any>;
const verify = (checkout: any, who = ana, orderId = order.id, extra: Record<string, unknown> = {}) =>
  CustomerPaymentService.verify(who.user, orderId, {
    razorpayOrderId: checkout.razorpayOrderId,
    razorpayPaymentId: `pay_${checkout.razorpayOrderId}`,
    razorpaySignature: SIG,
    ...extra,
  }) as Promise<any>;
const paidTotal = (orderId = order.id) => account.paid.get(orderId);

beforeEach(async () => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["setImmediate", "nextTick", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  world = buildSupportWorld();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  ana = await shopper();
  bob = await shopper();
  order = addOrder(ana.customerId, world.storeA.id, { status: "received", amountPaise: 25050 });
});
afterEach(() => {
  jest.useRealTimers();
  errorSpy.mockRestore();
});

describe("starting a payment", () => {
  it("charges what the order in the database says is owed and answers in rupees", async () => {
    const checkout = await initiate(ana, order.id, { method: "upi" });
    expect(checkout).toMatchObject({ razorpayOrderId: "order_1", amount: 250.5, amountPaise: 25050, currency: "INR", keyId: "rzp_test_key" });
    expect(fake.finance.calls).toEqual([
      { path: "/internal/payments/orders", body: { orderRef: order.ref, amountPaise: 25050, customerUserId: ana.user.id } },
    ]);
    expect(state.payments.get(checkout.paymentId)).toMatchObject({ status: "created", method: "upi", orderId: order.id, customerUserId: ana.user.id });
  });

  it("ignores any amount the client sends", async () => {
    const checkout = await initiate(ana, order.id, { amount: 1, amountPaise: 1, method: "card" });
    expect(checkout.amountPaise).toBe(25050);
    expect(fake.finance.calls[0]!.body.amountPaise).toBe(25050);
  });

  it("asks only for what is still owed after an earlier payment", async () => {
    account.paid.set(order.id, 10000);
    order.paymentStatus = "part_paid";
    expect((await initiate()).amountPaise).toBe(15050);
  });

  it("treats an order marked paid with no recorded total as fully paid", async () => {
    order.paymentStatus = "paid";
    await refused(initiate(), 409, /already paid/);
  });

  it("refuses a fully paid order, a cancelled order and a bad method; nothing is sent to finance", async () => {
    account.paid.set(order.id, 25050);
    await refused(initiate(), 409, /already paid/);
    account.paid.clear();
    order.status = "cancelled";
    await refused(initiate(), 409, /cancelled/);
    order.status = "received";
    await refused(initiate(ana, order.id, { method: "bitcoin" }), 400, /method/);
    expect(fake.finance.calls).toHaveLength(0);
    expect(state.payments.size).toBe(0);
  });

  it("answers 404 for another customer's order, an unknown one and a malformed id", async () => {
    await refused(initiate(bob), 404, /Order not found/);
    await refused(initiate(ana, "11111111-1111-4111-8111-111111111111"), 404);
    await refused(initiate(ana, "nope"), 404);
    expect(fake.finance.calls).toHaveLength(0);
  });

  it("is refused for anyone who is not a customer", async () => {
    const staff = { ...ana.user, role: "staff" as const };
    await refused(CustomerPaymentService.initiate(staff, order.id, {}, undefined), 403);
  });

  it("leaves nothing behind and says so when the payment service is down", async () => {
    fake.finance.failWith = new CustomException("A connected service is unavailable right now. Please try again.", 503);
    await refused(initiate(), 503);
    expect(state.payments.size).toBe(0);
  });

  it("refuses a checkout whose amount is not the amount asked for", async () => {
    const original = fake.finance.counter;
    fake.finance.checkouts.set(`${ana.user.id}:${order.id}:forced`, { paymentId: "fin-x", razorpayOrderId: "order_x", amountPaise: 1, currency: "INR", keyId: "k", orderRef: order.ref });
    await refused(initiate(ana, order.id, {}, "forced"), 503);
    expect(fake.finance.counter).toBe(original);
    expect(state.payments.size).toBe(0);
  });

  it("returns the same checkout for a repeated Idempotency-Key without calling finance again", async () => {
    const first = await initiate(ana, order.id, {}, "pay-1");
    const again = await initiate(ana, order.id, {}, "pay-1");
    expect(again).toEqual(first);
    expect(fake.finance.calls).toHaveLength(1);
    expect(state.payments.size).toBe(1);
  });

  it("refuses to reuse a key for another order", async () => {
    await initiate(ana, order.id, {}, "pay-1");
    const second = addOrder(ana.customerId, world.storeA.id, { status: "received" });
    await refused(initiate(ana, second.id, {}, "pay-1"), 409, /Idempotency-Key/);
  });

  it("keeps one attempt when the same request races five times", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => initiate(ana, order.id, {}, "race")));
    expect(new Set(results.map((r) => r.razorpayOrderId)).size).toBe(1);
    expect(state.payments.size).toBe(1);
  });

  it("refuses a malformed Idempotency-Key", async () => {
    await refused(initiate(ana, order.id, {}, "bad key"), 400);
  });
});

describe("confirming a payment", () => {
  it("adds a captured payment to the order once and marks it paid", async () => {
    const checkout = await initiate();
    const view = await verify(checkout);
    expect(view).toEqual({ paymentStatus: "paid", payment: { id: checkout.paymentId, status: "captured" }, amountPaid: 250.5, amountDue: 0 });
    expect(paidTotal()).toBe(25050);
    expect(core.orders.get(order.id).paymentStatus).toBe("paid");
    expect(state.payments.get(checkout.paymentId)).toMatchObject({ status: "captured", paidAt: expect.any(Date), financePaymentId: "fin-1" });
  });

  it("adds to what was already paid and reaches paid exactly at the order amount", async () => {
    account.paid.set(order.id, 10000);
    order.paymentStatus = "part_paid";
    const view = await verify(await initiate());
    expect(view.paymentStatus).toBe("paid");
    expect(paidTotal()).toBe(25050);
  });

  it("never records more than the order amount if something else paid in the meantime", async () => {
    const checkout = await initiate();
    await OrderInternalService.updatePaymentStatus(order.id, { paymentStatus: "part_paid", paidPaise: 10000 });
    await verify(checkout);
    expect(paidTotal()).toBe(25050);
  });

  it("uses the contract's name for a part payment", async () => {
    const checkout = await initiate();
    account.paid.set(order.id, 5000);
    order.paymentStatus = "part_paid";
    const small = { ...state.payments.get(checkout.paymentId) };
    state.payments.get(checkout.paymentId).amountPaise = 5000;
    fake.finance.checkouts.get(checkout.razorpayOrderId).amountPaise = 5000;
    const view = await verify(checkout);
    expect(small.amountPaise).toBe(25050);
    expect(view.paymentStatus).toBe("partially_paid");
    expect(view).toMatchObject({ amountPaid: 100, amountDue: 150.5 });
  });

  it("counts a repeated confirmation once", async () => {
    const checkout = await initiate();
    await verify(checkout);
    const callsAfterFirst = fake.finance.calls.length;
    const again = await verify(checkout);
    expect(again.paymentStatus).toBe("paid");
    expect(paidTotal()).toBe(25050);
    expect(fake.finance.calls).toHaveLength(callsAfterFirst);
  });

  it("counts five simultaneous confirmations once", async () => {
    const checkout = await initiate();
    const views = await Promise.all([1, 2, 3, 4, 5].map(() => verify(checkout)));
    expect(views.every((v) => v.paymentStatus === "paid")).toBe(true);
    expect(paidTotal()).toBe(25050);
  });

  it("adds the amount exactly once however many confirmations race (a part payment, so a cap cannot hide a double count)", async () => {
    const checkout = await initiate();
    state.payments.get(checkout.paymentId).amountPaise = 5000;
    fake.finance.checkouts.get(checkout.razorpayOrderId).amountPaise = 5000;
    await Promise.all([1, 2, 3, 4, 5].map(() => verify(checkout)));
    expect(paidTotal()).toBe(5000);
    expect(core.orders.get(order.id).paymentStatus).toBe("part_paid");
  });

  it("refuses a bad signature and changes nothing", async () => {
    const checkout = await initiate();
    await refused(verify(checkout, ana, order.id, { razorpaySignature: "forged" }), 400, /signature/);
    expect(paidTotal()).toBeUndefined();
    expect(state.payments.get(checkout.paymentId).status).toBe("created");
  });

  it.each([["razorpayOrderId"], ["razorpayPaymentId"], ["razorpaySignature"]])("requires %s", async (field) => {
    const checkout = await initiate();
    await refused(verify(checkout, ana, order.id, { [field]: "" }), 400, new RegExp(field));
  });

  it("will not confirm another customer's checkout, a checkout for a different order, or an unknown one", async () => {
    const checkout = await initiate();
    const bobsOrder = addOrder(bob.customerId, world.storeA.id, { status: "received" });
    await refused(verify(checkout, bob, bobsOrder.id), 404, /Payment not found/);
    await refused(verify(checkout, bob, order.id), 404, /Order not found/);
    const other = addOrder(ana.customerId, world.storeA.id, { status: "received" });
    await refused(verify(checkout, ana, other.id), 404, /Payment not found/);
    await refused(verify({ razorpayOrderId: "order_999" }), 404);
    expect(paidTotal()).toBeUndefined();
  });

  it("records an authorised payment without paying the order, and a later capture completes it", async () => {
    const checkout = await initiate();
    fake.finance.verdicts.set(`pay_${checkout.razorpayOrderId}`, "authorized");
    const view = await verify(checkout);
    expect(view).toMatchObject({ paymentStatus: "unpaid", payment: { status: "authorized" } });
    expect(paidTotal()).toBeUndefined();
    fake.finance.verdicts.clear();
    expect((await verify(checkout)).paymentStatus).toBe("paid");
  });

  it("records a failure, and a capture after it still counts", async () => {
    const checkout = await initiate();
    fake.finance.verdicts.set(`pay_${checkout.razorpayOrderId}`, "failed");
    expect((await verify(checkout)).payment.status).toBe("failed");
    expect(core.orders.get(order.id).paymentStatus).toBe("unpaid");
    fake.finance.verdicts.clear();
    expect((await verify(checkout)).paymentStatus).toBe("paid");
  });

  it("does not let a late failure undo a capture", async () => {
    const checkout = await initiate();
    await verify(checkout);
    fake.finance.verdicts.set(`pay_${checkout.razorpayOrderId}`, "failed");
    const view = await verify(checkout);
    expect(view.payment.status).toBe("captured");
    expect(paidTotal()).toBe(25050);
  });

  it("leaves everything as it was, and says so, when finance is down", async () => {
    const checkout = await initiate();
    fake.finance.failWith = new CustomException("A connected service is unavailable right now. Please try again.", 503);
    await refused(verify(checkout), 503);
    expect(state.payments.get(checkout.paymentId).status).toBe("created");
    expect(paidTotal()).toBeUndefined();
    fake.finance.failWith = null;
    expect((await verify(checkout)).paymentStatus).toBe("paid");
  });

  it("refuses a confirmation whose order or amount does not match the checkout", async () => {
    const checkout = await initiate();
    fake.finance.checkouts.get(checkout.razorpayOrderId).amountPaise = 100;
    await refused(verify(checkout), 409, /does not match/);
    expect(paidTotal()).toBeUndefined();
  });
});

describe("payment history", () => {
  it("lists only the customer's own results, newest first, never an abandoned checkout", async () => {
    const done = await initiate();
    await verify(done);
    const other = addOrder(ana.customerId, world.storeA.id, { status: "received" });
    jest.setSystemTime(new Date(NOW.getTime() + 60_000));
    await initiate(ana, other.id);
    const bobOrder = addOrder(bob.customerId, world.storeA.id, { status: "received" });
    await verify(await initiate(bob, bobOrder.id), bob, bobOrder.id);
    const mine = (await CustomerPaymentService.listMine(ana.user, {})) as any;
    expect(mine.total).toBe(1);
    expect(mine.items[0]).toMatchObject({ id: done.paymentId, orderId: order.id, orderRef: order.ref, amount: 250.5, status: "captured", paidAt: expect.any(String) });
  });

  it("pages, bounds the page size and filters by date", async () => {
    for (let i = 0; i < 3; i++) {
      const o = addOrder(ana.customerId, world.storeA.id, { status: "received" });
      jest.setSystemTime(new Date(NOW.getTime() + i * 86_400_000));
      await verify(await initiate(ana, o.id), ana, o.id);
    }
    const page2 = (await CustomerPaymentService.listMine(ana.user, { page: "2", limit: "2" })) as any;
    expect(page2).toMatchObject({ page: 2, limit: 2, total: 3 });
    expect(page2.items).toHaveLength(1);
    expect(((await CustomerPaymentService.listMine(ana.user, { limit: "9999" })) as any).limit).toBe(100);
    expect(((await CustomerPaymentService.listMine(ana.user, { from: "2026-10-06" })) as any).total).toBe(2);
    await refused(CustomerPaymentService.listMine(ana.user, { from: "soon" }), 400);
    await refused(CustomerPaymentService.listMine(ana.user, { page: "-1" }), 400);
  });
});

describe("saved payment methods", () => {
  const add = (who = ana, body: Record<string, unknown> = {}) =>
    PaymentMethodService.add(who.user, { gatewayToken: "token_AbCd1234", type: "card", brand: "Visa", last4: "4242", ...body });

  it("stores the token and masked display text, and never returns the token", async () => {
    const outcome = await add();
    expect(outcome.created).toBe(true);
    expect(outcome.data).toEqual({ id: expect.any(String), type: "card", label: "Visa ending 4242", brand: "Visa", last4: "4242", isDefault: true });
    expect(JSON.stringify(outcome.data)).not.toContain("token_AbCd1234");
    expect([...state.methods.values()][0].providerToken).toBe("token_AbCd1234");
    expect(JSON.stringify(await PaymentMethodService.listMine(ana.user, {}))).not.toContain("token_AbCd1234");
  });

  it("builds a label for a UPI method and accepts a custom masked label", async () => {
    expect((await add(ana, { gatewayToken: "token_upi_0001", type: "upi", brand: undefined, last4: undefined })).data.label).toBe("UPI");
    expect((await add(ana, { gatewayToken: "token_upi_0002", label: "j***@okbank" })).data.label).toBe("j***@okbank");
  });

  it.each([
    ["a card number as the token", { gatewayToken: "4242 4242 4242 4242" }],
    ["a card number without spaces as the token", { gatewayToken: "4242424242424242" }],
    ["a card number in the label", { label: "4242 4242 4242 4242" }],
    ["a phone-like number in the label", { label: "9845012345" }],
    ["a token with odd characters", { gatewayToken: "tok en;drop" }],
    ["a token that is too short", { gatewayToken: "abc" }],
    ["no token", { gatewayToken: "" }],
    ["a last4 of five digits", { last4: "42424" }],
    ["a last4 with letters", { last4: "42x4" }],
    ["an unknown type", { type: "cheque" }],
    ["a brand with digits", { brand: "Visa4242" }],
    ["isDefault that is not a boolean", { isDefault: "yes" }],
  ])("refuses %s", async (_name, body) => {
    await refused(add(ana, body), 400);
    expect(state.methods.size).toBe(0);
  });

  it("makes the first method the default, moves the default on request, and lists it first", async () => {
    const first = (await add(ana, { gatewayToken: "token_first_001" })).data;
    const second = (await add(ana, { gatewayToken: "token_second_02", last4: "1111" })).data;
    expect([first.isDefault, second.isDefault]).toEqual([true, false]);
    const third = (await add(ana, { gatewayToken: "token_third_003", last4: "2222", isDefault: true })).data;
    expect(third.isDefault).toBe(true);
    const list = (await PaymentMethodService.listMine(ana.user, {})) as any;
    expect(list.items[0].id).toBe(third.id);
    expect(list.items.filter((m: any) => m.isDefault)).toHaveLength(1);
  });

  it("returns the saved method when the same token is sent again", async () => {
    const first = await add();
    const again = await add();
    expect(again.created).toBe(false);
    expect(again.data.id).toBe(first.data.id);
    expect(state.methods.size).toBe(1);
  });

  it("saves one method when the same token arrives five times at once", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => add()));
    expect(new Set(results.map((r) => r.data.id)).size).toBe(1);
    expect(state.methods.size).toBe(1);
  });

  it("keeps each customer's methods separate, even for the same token", async () => {
    await add(ana);
    await add(bob);
    expect(((await PaymentMethodService.listMine(ana.user, {})) as any).total).toBe(1);
    expect(state.methods.size).toBe(2);
  });

  it("keeps at most ten", async () => {
    for (let i = 0; i < MAX_SAVED_METHODS; i++) await add(ana, { gatewayToken: `token_number_${i}00`, last4: String(1000 + i) });
    await refused(add(ana, { gatewayToken: "token_one_more_1" }), 409, /at most/);
  });

  it("removes the customer's own method and hands the default to the newest remaining one", async () => {
    const first = (await add(ana, { gatewayToken: "token_first_001" })).data;
    jest.setSystemTime(new Date(NOW.getTime() + 1000));
    const second = (await add(ana, { gatewayToken: "token_second_02", last4: "1111" })).data;
    jest.setSystemTime(new Date(NOW.getTime() + 2000));
    const third = (await add(ana, { gatewayToken: "token_third_003", last4: "2222" })).data;
    await PaymentMethodService.remove(ana.user, first.id);
    const list = (await PaymentMethodService.listMine(ana.user, {})) as any;
    expect(list.total).toBe(2);
    expect(list.items.find((m: any) => m.isDefault).id).toBe(third.id);
    expect(second.isDefault).toBe(false);
  });

  it("answers 404 for another customer's method, an unknown one and a malformed id", async () => {
    const bobs = (await add(bob)).data;
    await refused(PaymentMethodService.remove(ana.user, bobs.id), 404);
    await refused(PaymentMethodService.remove(ana.user, "11111111-1111-4111-8111-111111111111"), 404);
    await refused(PaymentMethodService.remove(ana.user, "nope"), 404);
    expect(state.methods.size).toBe(1);
  });

  it("pages the list and bounds the page size", async () => {
    for (let i = 0; i < 3; i++) await add(ana, { gatewayToken: `token_number_${i}00`, last4: String(1000 + i) });
    expect(((await PaymentMethodService.listMine(ana.user, { limit: "2", page: "2" })) as any).items).toHaveLength(1);
    expect(((await PaymentMethodService.listMine(ana.user, { limit: "500" })) as any).limit).toBe(100);
    await refused(PaymentMethodService.listMine(ana.user, { page: "x" }), 400);
  });

  it("is refused for anyone who is not a customer", async () => {
    await refused(PaymentMethodService.listMine({ ...ana.user, role: "driver" }, {}), 403);
  });
});
