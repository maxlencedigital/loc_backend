import { CustomException } from "../../commons/Exception/CustomException.js";

const mockCreateOrder = jest.fn();
const mockLookup = jest.fn();
jest.mock("../Queries/Package.Query.js", () => ({ PackageQuery: require("../Testing/FakeQueries").PackageQuery }));
jest.mock("../Queries/Counter.Query.js", () => ({ CounterQuery: require("../Testing/FakeQueries").CounterQuery }));
jest.mock("../Clients/Finance.Client.js", () => ({ FinanceClient: { createPaymentOrder: (...a: unknown[]) => mockCreateOrder(...a) } }));
jest.mock("../Clients/Gateway.Client.js", () => ({ GatewayClient: { lookupUsers: (...a: unknown[]) => mockLookup(...a) } }));

import { PackageService, effectiveStatus } from "./Package.Service.js";
import { db, reset, newId } from "../Testing/FakeQueries.js";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const DAY = 86_400_000;

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a rejection");
};

const newPackage = async (over: Record<string, unknown> = {}) =>
  PackageService.createPackage({ name: "Wash 10", price: 900, credit: 1000, validityDays: 90, ...over }) as Promise<any>;

beforeEach(() => {
  reset();
  mockCreateOrder.mockReset().mockImplementation(async (input: any) => ({
    paymentId: "pay-1", razorpayOrderId: `order_${input.orderRef}`, amountPaise: input.amountPaise, currency: "INR", keyId: "rzp_test",
  }));
  mockLookup.mockReset().mockImplementation(async (ids: string[]) => ids.map((id) => ({ id, name: `Name ${id.slice(-1)}` })));
});

describe("admin: packages", () => {
  it("creates, reads, updates and lists packages with money in rupees", async () => {
    const created = await newPackage({ description: "Ten washes" });
    const updated: any = await PackageService.updatePackage(created.id, { price: 850.5, isActive: false });
    const read: any = await PackageService.getPackage(created.id);

    expect(created).toMatchObject({ price: 900, credit: 1000, validityDays: 90, isActive: true, description: "Ten washes" });
    expect(updated).toMatchObject({ price: 850.5, isActive: false, credit: 1000 });
    expect(read.price).toBe(850.5);
    expect([...db.packages.values()][0]).toMatchObject({ pricePaise: 85_050, creditPaise: 100_000 });
    expect(((await PackageService.listPackages({ isActive: "false" })) as any).total).toBe(1);
  });

  it.each([
    ["no name", { name: undefined }],
    ["zero price", { price: 0 }],
    ["negative credit", { credit: -1 }],
    ["fractional validity", { validityDays: 1.5 }],
    ["zero validity", { validityDays: 0 }],
    ["unknown field", { pricePaise: 1 }],
  ])("rejects %s with 400", async (_name, over) => {
    expect((await rejection(newPackage(over))).errorCode).toBe(400);
    expect(db.packages.size).toBe(0);
  });

  it("answers 404 for unknown and malformed ids, and refuses unknown PATCH fields", async () => {
    const created = await newPackage();

    expect((await rejection(PackageService.getPackage(newId()))).errorCode).toBe(404);
    expect((await rejection(PackageService.updatePackage("x", {}))).errorCode).toBe(404);
    expect((await rejection(PackageService.updatePackage(created.id, { id: newId() }))).errorCode).toBe(400);
  });
});

describe("customer: available and purchase", () => {
  it("offers only active packages, in pages", async () => {
    await newPackage({ name: "A" });
    await newPackage({ name: "B", isActive: false });

    const available: any = await PackageService.listAvailable({ limit: "10" });

    expect(available.items.map((p: any) => p.name)).toEqual(["A"]);
    expect(available.items[0]).not.toHaveProperty("isActive");
  });

  it("takes the price from the package, never from the client, and records a pending purchase", async () => {
    const pkg = await newPackage();

    const result: any = await PackageService.purchase(C1, pkg.id, { paymentMethod: "online", amount: 1, price: 1 });

    expect(mockCreateOrder).toHaveBeenCalledWith(expect.objectContaining({ amountPaise: 90_000, customerUserId: C1, orderRef: result.orderRef, idempotencyKey: result.orderRef }));
    expect(result).toMatchObject({ amount: 900, currency: "INR", keyId: "rzp_test", razorpayOrderId: `order_${result.orderRef}` });
    expect(result.orderRef).toMatch(/^PKG-/);
    expect([...db.customerPackages.values()][0]).toMatchObject({ customerId: C1, status: "pending", pricePaise: 90_000, creditPaise: 100_000, remainingCreditPaise: 100_000, validityDays: 90 });
    expect(((await PackageService.listOwned(C1, {})) as any).total).toBe(0);
  });

  it("accepts an empty body and rejects an unknown payment method", async () => {
    const pkg = await newPackage();

    expect(await PackageService.purchase(C1, pkg.id, undefined)).toHaveProperty("customerPackageId");
    expect((await rejection(PackageService.purchase(C1, pkg.id, { paymentMethod: "barter" }))).errorCode).toBe(400);
  });

  it("answers 404 for an unknown, inactive or malformed package", async () => {
    const off = await newPackage({ isActive: false });

    expect((await rejection(PackageService.purchase(C1, off.id, {}))).errorCode).toBe(404);
    expect((await rejection(PackageService.purchase(C1, newId(), {}))).errorCode).toBe(404);
    expect((await rejection(PackageService.purchase(C1, "x", {}))).errorCode).toBe(404);
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it("leaves no row behind when finance refuses or is down", async () => {
    const pkg = await newPackage();
    mockCreateOrder.mockRejectedValue(new CustomException("A connected service is unavailable right now.", 503));

    const error = await rejection(PackageService.purchase(C1, pkg.id, {}));

    expect(error.errorCode).toBe(503);
    expect(db.customerPackages.size).toBe(0);
  });

  it("bounds unfinished purchases: the 6th pending one in a day is a 429", async () => {
    const pkg = await newPackage();
    for (let i = 0; i < 5; i++) await PackageService.purchase(C1, pkg.id, {});

    expect((await rejection(PackageService.purchase(C1, pkg.id, {}))).errorCode).toBe(429);
    expect(await PackageService.purchase(C2, pkg.id, {})).toHaveProperty("orderRef");
  });
});

describe("activation (internal) and ownership", () => {
  const buy = async (customerId = C1, over: Record<string, unknown> = {}) => {
    const pkg = await newPackage(over);
    return (await PackageService.purchase(customerId, pkg.id, {})) as any;
  };

  it("activates a paid purchase: credit, expiry from the snapshot validity, and it appears as owned", async () => {
    const bought = await buy();

    const active: any = await PackageService.activate({ orderRef: bought.orderRef });
    const owned: any = await PackageService.listOwned(C1, {});

    expect(active).toMatchObject({ status: "active", replayed: false, remainingCredit: 1000 });
    expect(owned.items[0]).toMatchObject({ name: "Wash 10", remainingCredit: 1000 });
    const days = (new Date(owned.items[0].expiresOn).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
  });

  it("uses the validity the customer bought, not a later edit of the package", async () => {
    const bought = await buy();
    const [row] = [...db.customerPackages.values()];
    await PackageService.updatePackage(row.packageId, { validityDays: 10 });

    await PackageService.activate({ orderRef: bought.orderRef });

    const days = (new Date(((await PackageService.listOwned(C1, {})) as any).items[0].expiresOn).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(89);
  });

  it("is idempotent: a second activation changes nothing", async () => {
    const bought = await buy();
    const first: any = await PackageService.activate({ orderRef: bought.orderRef });

    const again: any = await PackageService.activate({ orderRef: bought.orderRef });

    expect(again).toMatchObject({ replayed: true, status: "active", expiresOn: first.expiresOn });
  });

  it("refuses an order ref that is not a package purchase, and 404s an unknown one", async () => {
    expect((await rejection(PackageService.activate({ orderRef: "ORDER-1" }))).errorCode).toBe(400);
    expect((await rejection(PackageService.activate({ orderRef: "PKG-unknown" }))).errorCode).toBe(404);
    expect((await rejection(PackageService.activate({}))).errorCode).toBe(400);
  });

  it("reads an expired package as expired and filters by effective status", async () => {
    const bought = await buy();
    await PackageService.activate({ orderRef: bought.orderRef });
    const row = [...db.customerPackages.values()][0];
    row.expiresAt = new Date(Date.now() - DAY);

    const expired: any = await PackageService.listCustomerPackages({ status: "expired" });
    const active: any = await PackageService.listCustomerPackages({ status: "active" });

    expect(effectiveStatus(row as any, new Date())).toBe("expired");
    expect(expired.total).toBe(1);
    expect(active.total).toBe(0);
    expect(expired.items[0].status).toBe("expired");
  });

  it("customers see only their own packages; admins can filter by customer", async () => {
    const mine = await buy(C1);
    const theirs = await buy(C2);
    await PackageService.activate({ orderRef: mine.orderRef });
    await PackageService.activate({ orderRef: theirs.orderRef });

    const own: any = await PackageService.listOwned(C1, {});
    const filtered: any = await PackageService.listCustomerPackages({ customerId: C2 });

    expect(own.total).toBe(1);
    expect(own.items[0].id).toBe(mine.customerPackageId);
    expect(filtered.items.map((p: any) => p.customerId)).toEqual([C2]);
    expect((await rejection(PackageService.listCustomerPackages({ status: "bogus" }))).errorCode).toBe(400);
    expect((await rejection(PackageService.listCustomerPackages({ customerId: "x" }))).errorCode).toBe(400);
  });

  it("admin gets one customer package (404 while unpaid) and the package's subscribers with names", async () => {
    const bought = await buy();
    expect((await rejection(PackageService.getCustomerPackage(bought.customerPackageId))).errorCode).toBe(404);
    await PackageService.activate({ orderRef: bought.orderRef });
    const [row] = [...db.customerPackages.values()];

    const one: any = await PackageService.getCustomerPackage(bought.customerPackageId);
    const subscribers: any = await PackageService.listSubscribers(row.packageId, {});

    expect(one).toMatchObject({ customerId: C1, status: "active" });
    expect(subscribers.items[0]).toMatchObject({ customerId: C1, name: "Name 1", remainingCredit: 1000 });
    expect((await rejection(PackageService.listSubscribers(newId(), {}))).errorCode).toBe(404);
  });

  it("lists subscribers without names when the gateway is down", async () => {
    const bought = await buy();
    await PackageService.activate({ orderRef: bought.orderRef });
    mockLookup.mockRejectedValue(new Error("down"));

    const subscribers: any = await PackageService.listSubscribers([...db.customerPackages.values()][0].packageId, {});

    expect(subscribers.items[0].name).toBeNull();
  });
});
