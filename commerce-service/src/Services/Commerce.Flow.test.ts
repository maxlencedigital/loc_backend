import { CustomException } from "../../commons/Exception/CustomException.js";
import type { IdentifiedRequest, RequestUser, UserRole } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";

// The four Query modules are replaced by one in-memory database; every service, the
// pricing rules and the status machine below are the real code.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/Store.Query.js", () => ({ StoreQuery: require("../Testing/InMemoryCommerce.js").storeQuery }));
jest.mock("../Queries/Customer.Query.js", () => ({ CustomerQuery: require("../Testing/InMemoryCommerce.js").customerQuery }));
jest.mock("../Queries/Catalog.Query.js", () => ({ CatalogQuery: require("../Testing/InMemoryCommerce.js").catalogQuery }));
jest.mock("../Queries/Order.Query.js", () => ({ OrderQuery: require("../Testing/InMemoryCommerce.js").orderQuery }));

import { seed, reset, state } from "../Testing/InMemoryCommerce.js";
import { CatalogService } from "./Catalog.Service.js";
import { CustomerService, normalizePhone } from "./Customer.Service.js";
import { EXPRESS_PROMISE_HOURS, OrderService, STANDARD_PROMISE_HOURS, checkTransition, toOrderView } from "./Order.Service.js";
import { StoreService } from "./Store.Service.js";

// ------------------------------------------------------------------- world
let storeA: any;
let storeB: any;
let ana: any; // retail customer of store A
let corp: any; // corporate customer of store A
let bob: any; // customer of store B
let washFold: any;
let dryClean: any;
let carpet: any;
let retired: any;
let unpriced: any;
let standard: any;

const actor = (role: UserRole, storeId: string | null = null, name: string | null = null): RequestUser => ({
  id: `${role}-1`,
  role,
  storeId,
  scopeStoreId: null,
  name,
});
const scopeOf = (user: RequestUser, scopeStoreId: string | null = null) =>
  resolveStoreScope({ user: { ...user, scopeStoreId } } as IdentifiedRequest);

let admin: RequestUser;
let managerA: RequestUser;
let staffA: RequestUser;
let managerB: RequestUser;

const rupees = (paise: number) => paise / 100;

beforeEach(() => {
  reset();
  storeA = seed.store({ code: "BLR-IND" });
  storeB = seed.store({ code: "BLR-KOR" });
  ana = seed.customer({ storeId: storeA.id, phone: "+91 98450 12345", name: "Ana Rao", addresses: ["12 MG Road"] });
  corp = seed.customer({ storeId: storeA.id, phone: "+91 98450 22222", name: "Nimbus Hotels", type: "corporate" });
  bob = seed.customer({ storeId: storeB.id, phone: "+91 98450 33333", name: "Bob Iyer" });

  washFold = seed.service({ code: "WASH_FOLD", name: "Wash & Fold", unit: "kg", expressAvailable: true });
  dryClean = seed.service({ code: "DRY_CLEAN", name: "Dry Clean", unit: "piece", expressAvailable: true });
  carpet = seed.service({ code: "CARPET", name: "Carpet Deep Clean", unit: "piece", expressAvailable: false });
  retired = seed.service({ code: "LEATHER", name: "Leather", unit: "piece", active: false });
  unpriced = seed.service({ code: "SHOE_CARE", name: "Shoe Care", unit: "pair" });

  standard = seed.list({ name: "Standard retail" });
  const row = (priceListId: string, service: any, garment: string, category: string, ratePaise: number, expressRatePaise: number) =>
    seed.row({ priceListId, serviceId: service.id, garment, category, ratePaise, expressRatePaise });
  row(standard.id, washFold, "Shirt", "men", 8000, 11600);
  row(standard.id, dryClean, "Shirt", "men", 12000, 17400);
  row(standard.id, dryClean, "Saree", "women", 25000, 36250);
  row(standard.id, carpet, "Rug", "household", 50000, 50000);
  row(standard.id, retired, "Jacket", "premium", 90000, 90000);

  const corporate = seed.list({ name: "Corporate contract", customerType: "corporate" });
  row(corporate.id, washFold, "Shirt", "men", 6800, 9900);

  const storeBList = seed.list({ name: "Koramangala intro", storeId: storeB.id });
  row(storeBList.id, dryClean, "Shirt", "men", 10000, 14500);

  // Cheaper than everything, but inactive: it must never price an order.
  const old = seed.list({ name: "Old rates", active: false });
  row(old.id, washFold, "Shirt", "men", 100, 100);

  admin = actor("admin");
  managerA = actor("manager", storeA.id, "Meera Nair");
  staffA = actor("staff", storeA.id);
  managerB = actor("manager", storeB.id);
});

const item = (service: any, garment: string, category: string, qty: number, extra: Record<string, unknown> = {}) => ({
  serviceId: service.id,
  garment,
  category,
  qty,
  ...extra,
});

const book = (user: RequestUser, body: Record<string, unknown>, scopeStoreId: string | null = null) =>
  OrderService.create(scopeOf(user, scopeStoreId), user, body);

const bookAna = (items: unknown[], extra: Record<string, unknown> = {}) =>
  book(managerA, { customerId: ana.id, items, ...extra });

const rejection = async (promise: Promise<unknown>): Promise<CustomException> => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected the call to be rejected");
};

const refused = async (promise: Promise<unknown>, status: number, message?: RegExp) => {
  const error = await rejection(promise);
  expect(error.errorCode).toBe(status);
  if (message) expect(error.displayMessage).toMatch(message);
};

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

// ------------------------------------------------------------ order pricing
describe("booking an order", () => {
  it("prices every item from the active price list and totals in whole paise", async () => {
    const order = await bookAna([item(washFold, "Shirt", "men", 2.5), item(dryClean, "Saree", "women", 3)]);

    expect(order.items.map((i) => [i.service, i.qty, i.unit, i.rate, i.amount])).toEqual([
      ["Wash & Fold", 2.5, "kg", 80, 200],
      ["Dry Clean", 3, "piece", 250, 750],
    ]);
    expect(order.amount).toBe(950);
    expect(order.pieces).toBe(10 + 3); // 2.5 kg is estimated at 4 pieces per kg, rounded up
    expect(order.weightKg).toBe(2.5);
  });

  it("never lets a client set a price: rate, amount and price in the request are ignored", async () => {
    const order = await bookAna([
      item(washFold, "Shirt", "men", 2, { rate: 1, amount: 1, price: 1, ratePaise: 1 }),
    ], { amount: 1, total: 1 });

    expect(order.items[0]).toMatchObject({ rate: 80, amount: 160 });
    expect(order.amount).toBe(160);
  });

  it("rounds a fractional quantity once, in paise", async () => {
    // 1.1 kg x Rs 33.33 would be 36.663 in floating point; the order is exact integer paise.
    const cheap = seed.list({ name: "Odd rates", storeId: storeA.id });
    seed.row({ priceListId: cheap.id, serviceId: washFold.id, garment: "Shirt", category: "men", ratePaise: 3333, expressRatePaise: 3333 });
    const order = await bookAna([item(washFold, "Shirt", "men", 1.1)]);

    expect(order.items[0]!.amount).toBe(36.66);
    expect(Number.isInteger(Math.round(order.amount * 100))).toBe(true);
  });

  it("prices express orders from the express rate and refuses services without express", async () => {
    const order = await bookAna([item(washFold, "Shirt", "men", 1)], { priority: "express" });
    expect(order.items[0]!.rate).toBe(116);

    await refused(bookAna([item(carpet, "Rug", "household", 1)], { priority: "express" }), 400, /not available as express/);
  });

  it("matches the garment case-insensitively and keeps the list's spelling", async () => {
    const order = await bookAna([item(dryClean, "sAREE", "women", 1)]);
    expect(order.items[0]!.garment).toBe("Saree");
  });

  it("ignores the unit the client sends: the service decides it", async () => {
    const order = await bookAna([item(washFold, "Shirt", "men", 2, { unit: "piece" }), item(dryClean, "Shirt", "men", 1, { unit: "kg" })]);
    expect(order.items.map((i) => i.unit)).toEqual(["kg", "piece"]);
  });

  describe("a coarse booking with no matching garment row", () => {
    beforeEach(() => {
      const broad = seed.list({ name: "Broad rates", storeId: storeA.id });
      const add = (garment: string, category: string, ratePaise: number) =>
        seed.row({ priceListId: broad.id, serviceId: washFold.id, garment, category, ratePaise, expressRatePaise: ratePaise + 3000 });
      add("Trouser", "men", 7500);
      add("Kurta", "men", 9000);
      add("Bedsheet", "household", 6000);
    });

    it("gets the service's cheapest row in the same category, keeping the booking's wording", async () => {
      const order = await bookAna([item(washFold, "Men's garments", "men", 2)]);
      expect(order.items[0]).toMatchObject({ garment: "Men's garments", category: "men", rate: 75, amount: 150 });
    });

    it("prices Wash and fold sent as household from the household row", async () => {
      const order = await bookAna([item(washFold, "Wash & fold", "household", 1)]);
      expect(order.items[0]!.rate).toBe(60);
    });

    it("falls back to the cheapest row of the service when no row shares the category", async () => {
      const order = await bookAna([item(washFold, "Kids garments", "kids", 1)]);
      expect(order.items[0]!.rate).toBe(60);
    });

    it("prefers an exact row over the base row, and uses the express column for express", async () => {
      const exact = await bookAna([item(washFold, "Kurta", "men", 1)]);
      expect(exact.items[0]!.rate).toBe(90);
      const express = await bookAna([item(washFold, "Men's garments", "men", 1)], { priority: "express" });
      expect(express.items[0]!.rate).toBe(105);
    });

    it("still refuses a service that no applicable list prices", async () => {
      await refused(bookAna([item(unpriced, "Anything", "men", 1)]), 400, /no price/);
    });
  });

  it("uses the most specific active list: store list, then customer type, then general", async () => {
    const forCorporate = await book(managerA, { customerId: corp.id, items: [item(washFold, "Shirt", "men", 1)] });
    expect(forCorporate.items[0]!.rate).toBe(68);

    const forStoreB = await book(managerB, { customerId: bob.id, items: [item(dryClean, "Shirt", "men", 1)] });
    expect(forStoreB.items[0]!.rate).toBe(100);
  });

  it("falls back to the general list when the specific one has no row for the item", async () => {
    const order = await book(managerB, { customerId: bob.id, items: [item(dryClean, "Saree", "women", 1)] });
    expect(order.items[0]!.rate).toBe(250);
  });

  it("does not use a list narrowed to another store, or an inactive list", async () => {
    const order = await bookAna([item(dryClean, "Shirt", "men", 1)]);
    expect(order.items[0]!.rate).toBe(120); // not store B's 100
    const wash = await bookAna([item(washFold, "Shirt", "men", 1)]);
    expect(wash.items[0]!.rate).toBe(80); // not the inactive list's 1
  });

  it.each([
    ["an unknown service", () => ({ serviceId: "8d1c3a2e-0000-4000-8000-000000000000", garment: "Shirt", category: "men", qty: 1 }), /unknown service/],
    ["a service id that is not a uuid", () => ({ serviceId: "x", garment: "Shirt", category: "men", qty: 1 }), /not a valid service/],
    ["a service with no price on any active list", () => item(unpriced, "Sneakers", "men", 1), /no price/],
    ["an unknown category", () => item(washFold, "Shirt", "aliens", 1), /category/],
    ["an inactive service", () => item(retired, "Jacket", "premium", 1), /not currently offered/],
    ["a fractional piece quantity", () => item(dryClean, "Shirt", "men", 1.5), /whole number/],
    ["zero quantity", () => item(washFold, "Shirt", "men", 0), /greater than zero/],
    ["negative quantity", () => item(washFold, "Shirt", "men", -2), /greater than zero/],
    ["NaN quantity", () => item(washFold, "Shirt", "men", Number.NaN), /greater than zero/],
    ["infinite quantity", () => item(washFold, "Shirt", "men", Number.POSITIVE_INFINITY), /greater than zero/],
    ["a string quantity", () => item(washFold, "Shirt", "men", "2" as unknown as number), /greater than zero/],
    ["an absurd quantity", () => item(washFold, "Shirt", "men", 1_000_000), /too large/],
    ["more than three decimals", () => item(washFold, "Shirt", "men", 1.0005), /three decimals/],
    ["a missing garment", () => ({ serviceId: washFold.id, category: "men", qty: 1 }), /garment/],
  ])("rejects %s with 400", async (_name, make, message) => {
    await refused(bookAna([make()]), 400, message);
    expect(state.orders.size).toBe(0);
  });

  it.each([
    ["no items", []],
    ["items that are not a list", "shirt"],
    ["more than fifty items", Array.from({ length: 51 }, () => ({}))],
  ])("rejects %s", async (_name, items) => {
    await refused(bookAna(items as unknown[]), 400);
  });

  it("refuses a total beyond the column limit", async () => {
    const lavish = seed.list({ name: "Lavish", storeId: storeA.id });
    seed.row({ priceListId: lavish.id, serviceId: washFold.id, garment: "Shirt", category: "men", ratePaise: 9_000_000, expressRatePaise: 9_000_000 });
    const lines = Array.from({ length: 30 }, () => item(washFold, "Shirt", "men", 500));
    await refused(bookAna(lines), 400, /too large/);
  });

  it("does not create a half-booked order when one item is bad", async () => {
    await refused(bookAna([item(washFold, "Shirt", "men", 1), item(unpriced, "Sneakers", "men", 1)]), 400);
    expect(state.orders.size).toBe(0);
    expect(state.customers.get(ana.id).orderCount).toBe(0);
  });

  it("defaults the promise by priority and honours a valid override", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-30T10:00:00Z"), doNotFake: ["setImmediate", "nextTick", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      const standardOrder = await bookAna([item(washFold, "Shirt", "men", 1)]);
      const expressOrder = await bookAna([item(washFold, "Shirt", "men", 1)], { priority: "express" });
      const hours = (o: { placedAt: string; promisedAt: string }) =>
        (new Date(o.promisedAt).getTime() - new Date(o.placedAt).getTime()) / 3_600_000;
      expect(hours(standardOrder)).toBe(STANDARD_PROMISE_HOURS);
      expect(hours(expressOrder)).toBe(EXPRESS_PROMISE_HOURS);

      const custom = await bookAna([item(washFold, "Shirt", "men", 1)], { promisedAt: "2026-10-02T18:00:00Z" });
      expect(custom.promisedAt).toBe("2026-10-02T18:00:00.000Z");

      await refused(bookAna([item(washFold, "Shirt", "men", 1)], { promisedAt: "2026-09-29T10:00:00Z" }), 400, /future/);
      await refused(bookAna([item(washFold, "Shirt", "men", 1)], { promisedAt: "2027-09-30T10:00:00Z" }), 400, /within 60 days/);
      await refused(bookAna([item(washFold, "Shirt", "men", 1)], { promisedAt: "tomorrow" }), 400, /ISO/);
    } finally {
      jest.useRealTimers();
    }
  });

  it("records who booked it as the first timeline event, and the customer's totals", async () => {
    const order = await bookAna([item(washFold, "Shirt", "men", 2)]);

    expect(order.status).toBe("booked");
    expect(order.timeline).toEqual([{ at: order.placedAt, status: "booked", by: "Meera Nair" }]);
    expect(order.address).toBe("12 MG Road");
    expect(order.customerName).toBe("Ana Rao");
    const stored = state.customers.get(ana.id);
    expect([stored.orderCount, stored.lifetimeValuePaise]).toEqual([1, 16000]);
  });

  it("names the actor by role when the gateway forwards no name", async () => {
    const order = await book(staffA, { customerId: ana.id, items: [item(washFold, "Shirt", "men", 1)] });
    expect(order.timeline[0]!.by).toBe("Employee");
  });

  it("fills a neutral care profile when none is given and validates one that is", async () => {
    const plain = await bookAna([item(washFold, "Shirt", "men", 1)]);
    expect(plain.care).toMatchObject({ riskClass: "low", flags: [], photoCount: 0, recommendedWash: "Warm cotton 40°C" });

    const silk = await bookAna([item(washFold, "Shirt", "men", 1)], { care: { fabric: "Silk", riskClass: "high", flags: ["Dry clean only"] } });
    expect(silk.care).toMatchObject({ fabric: "Silk", riskClass: "high", recommendedWash: "Wool cycle 20°C", recommendedDry: "Flat dry" });

    await refused(bookAna([item(washFold, "Shirt", "men", 1)], { care: { riskClass: "extreme" } }), 400, /riskClass/);
  });

  it("accepts the dashboard's short form: coarse garment, partial care, paid at booking", async () => {
    const order = await bookAna([{ serviceId: washFold.id, garment: "Men's garments", category: "men", qty: 3, unit: "kg" }], {
      priority: "standard",
      channel: "walk_in",
      paymentStatus: "paid",
      care: { flags: ["Cold wash only"], customerNote: "Light starch" },
    });

    expect(order).toMatchObject({ paymentStatus: "paid", amount: 240 });
    expect(order.care).toMatchObject({ flags: ["Cold wash only"], customerNote: "Light starch", riskClass: "low", fabric: "Not specified" });
  });

  it("requires a chosen store for an admin, and a live one", async () => {
    await refused(book(admin, { customerId: ana.id, items: [item(washFold, "Shirt", "men", 1)] }), 400, /Choose a store/);
    await refused(
      book(admin, { customerId: ana.id, items: [item(washFold, "Shirt", "men", 1)] }, "99999999-9999-4999-8999-999999999999"),
      400,
      /Choose a store/
    );
    const order = await book(admin, { customerId: ana.id, items: [item(washFold, "Shirt", "men", 1)] }, storeA.id);
    expect(order.storeId).toBe(storeA.id);

    state.stores.get(storeA.id).status = "closed";
    await refused(bookAna([item(washFold, "Shirt", "men", 1)]), 400, /not taking orders/);
  });

  it("gives 20 simultaneous bookings 20 distinct, consecutive references", async () => {
    const orders = await Promise.all(
      Array.from({ length: 20 }, () => bookAna([item(washFold, "Shirt", "men", 1)]))
    );
    const numbers = orders.map((o) => Number(o.ref.replace("LOC-", ""))).sort((a, b) => a - b);

    expect(new Set(numbers).size).toBe(20);
    expect(numbers[0]).toBe(24800);
    expect(numbers[19]).toBe(24819);
    expect(orders.every((o) => /^LOC-\d+$/.test(o.ref))).toBe(true);
  });
});

// ----------------------------------------------------------- status machine
describe("order status machine", () => {
  const FLOW = ["booked", "picked_up", "received", "sorted", "washing", "drying", "quality_check", "packed", "out_for_delivery", "delivered"];

  const newOrder = async () => bookAna([item(washFold, "Shirt", "men", 1)]);
  const move = (order: { id: string }, status: string, note?: string, user = managerA) =>
    OrderService.changeStatus(order.id, scopeOf(user), user, { status, note });
  const advanceTo = async (order: { id: string }, status: string) => {
    for (const step of FLOW.slice(1, FLOW.indexOf(status) + 1)) await move(order, step);
  };

  it("moves one step forward and appends one event per change, by the acting user", async () => {
    const order = await newOrder();
    const moved = await move(order, "picked_up", "Collected from the door");

    expect(moved.status).toBe("picked_up");
    expect(moved.timeline).toHaveLength(2);
    expect(moved.timeline[1]).toMatchObject({ status: "picked_up", by: "Meera Nair", note: "Collected from the door" });
  });

  it("walks the whole journey, one event each", async () => {
    const order = await newOrder();
    await advanceTo(order, "delivered");
    const done = await OrderService.getById(order.id, scopeOf(managerA));

    expect(done.status).toBe("delivered");
    expect(done.timeline.map((e) => e.status)).toEqual(FLOW);
  });

  it.each([
    ["skipping a step", "booked", "received"],
    ["skipping to the end", "booked", "delivered"],
    ["repeating the current status", "booked", "booked"],
  ])("refuses %s", async (_name, from, to) => {
    const order = await newOrder();
    await advanceTo(order, from);
    await refused(move(order, to), 400, /one step forward/);
    expect((await OrderService.getById(order.id, scopeOf(managerA))).timeline).toHaveLength(FLOW.indexOf(from) + 1);
  });

  it("allows one step back only with a note, and records it", async () => {
    const order = await newOrder();
    await advanceTo(order, "drying");

    await refused(move(order, "washing"), 400, /note is required/);
    await refused(move(order, "washing", "   "), 400, /note is required/);
    const back = await move(order, "washing", "Stain came back, rewashing");

    expect(back.status).toBe("washing");
    expect(back.timeline.at(-1)).toMatchObject({ status: "washing", note: "Stain came back, rewashing" });
    await refused(move(order, "received", "two steps"), 400, /one step/);
  });

  it("cannot go back from booked", async () => {
    const order = await newOrder();
    await refused(move(order, "booked", "again"), 400);
  });

  it("treats delivered as final, in both directions", async () => {
    const order = await newOrder();
    await advanceTo(order, "delivered");
    await refused(move(order, "out_for_delivery", "oops"), 400, /delivered order cannot change/);
    await refused(move(order, "delivered"), 400, /cannot change/);
  });

  it("rejects an unknown status, and cancelling through the status route", async () => {
    const order = await newOrder();
    await refused(move(order, "teleported"), 400, /status must be one of/);
    await refused(move(order, "cancelled", "no"), 400, /cancel action/);
  });

  it("two simultaneous identical advances produce exactly one event", async () => {
    const order = await newOrder();
    const results = await Promise.allSettled([move(order, "picked_up"), move(order, "picked_up")]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((failure.reason as CustomException).errorCode).toBe(400);
    const stored = state.orders.get(order.id);
    expect(stored.events.filter((e: any) => e.status === "picked_up")).toHaveLength(1);
    expect(stored.status).toBe("picked_up");
  });

  it("ten simultaneous identical advances still produce one event", async () => {
    const order = await newOrder();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => move(order, "picked_up")));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(state.orders.get(order.id).events).toHaveLength(2);
  });

  it("checkTransition is the whole rule: only i+1, or i-1 with a note, never from a final state", () => {
    FLOW.slice(0, -1).forEach((from, i) => {
      FLOW.forEach((to, j) => {
        const allowed = j === i + 1 || (j === i - 1 && i > 0);
        const run = () => checkTransition(from as any, to as any, j === i - 1 ? "note" : null);
        if (allowed) expect(run).not.toThrow();
        else expect(run).toThrow(CustomException);
      });
      expect(() => checkTransition(from as any, "cancelled", "n")).toThrow(CustomException);
    });
    expect(() => checkTransition("cancelled", "booked", "n")).toThrow(/cannot change/);
  });

  describe("cancelling", () => {
    it.each(FLOW.slice(0, 8))("is allowed from %s and closes the order", async (from) => {
      const order = await newOrder();
      await advanceTo(order, from);
      const cancelled = await OrderService.cancel(order.id, scopeOf(managerA), managerA, { reason: "Customer asked" });

      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.timeline.at(-1)).toMatchObject({ status: "cancelled", note: "Customer asked", by: "Meera Nair" });
      await refused(move(order, "picked_up"), 400, /cancelled order cannot change/);
    });

    it.each(["out_for_delivery", "delivered"])("is refused once %s", async (from) => {
      const order = await newOrder();
      await advanceTo(order, from);
      await refused(OrderService.cancel(order.id, scopeOf(managerA), managerA, { reason: "Too late" }), 400, /cannot be cancelled/);
    });

    it("needs a reason, and cannot be repeated", async () => {
      const order = await newOrder();
      await refused(OrderService.cancel(order.id, scopeOf(managerA), managerA, {}), 400, /reason is required/);
      await OrderService.cancel(order.id, scopeOf(managerA), managerA, { reason: "Changed mind" });
      await refused(OrderService.cancel(order.id, scopeOf(managerA), managerA, { reason: "Again" }), 400, /cancelled order cannot be cancelled/);
      expect(state.orders.get(order.id).events.filter((e: any) => e.status === "cancelled")).toHaveLength(1);
    });

    it("takes the order back out of the customer's totals", async () => {
      const order = await newOrder();
      await OrderService.cancel(order.id, scopeOf(managerA), managerA, { reason: "Changed mind" });
      const stored = state.customers.get(ana.id);
      expect([stored.orderCount, stored.lifetimeValuePaise]).toEqual([0, 0]);
    });

    it("lets two simultaneous cancels through only once", async () => {
      const order = await newOrder();
      const results = await Promise.allSettled([
        OrderService.cancel(order.id, scopeOf(managerA), managerA, { reason: "a" }),
        OrderService.cancel(order.id, scopeOf(managerA), managerA, { reason: "b" }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(state.customers.get(ana.id).orderCount).toBe(0);
    });
  });
});

// -------------------------------------------------------------- slack, views
describe("slackMinutes", () => {
  it("is the minutes from now to the promise, computed when read", async () => {
    const order = await bookAna([item(washFold, "Shirt", "men", 1)], { priority: "express" });
    const promised = new Date(order.promisedAt).getTime();
    const stored = state.orders.get(order.id);

    const now = new Date(promised - 90 * 60_000);
    expect(toOrderView(stored, now).slackMinutes).toBe(90);
    expect(toOrderView(stored, new Date(promised + 45 * 60_000)).slackMinutes).toBe(-45);
    expect(toOrderView(stored, new Date(promised)).slackMinutes).toBe(0);
  });

  it("is never stored", async () => {
    const order = await bookAna([item(washFold, "Shirt", "men", 1)]);
    expect(Object.keys(state.orders.get(order.id))).not.toContain("slackMinutes");
    const fresh = await OrderService.getById(order.id, scopeOf(managerA));
    expect(fresh.slackMinutes).toBeGreaterThan(0);
  });
});

// ----------------------------------------------------- store isolation (404)
describe("store isolation", () => {
  let orderA: any;
  let orderB: any;

  beforeEach(async () => {
    orderA = await bookAna([item(washFold, "Shirt", "men", 1)]);
    orderB = await book(managerB, { customerId: bob.id, items: [item(washFold, "Shirt", "men", 1)] });
  });

  it.each([
    ["manager", () => managerA],
    ["staff", () => staffA],
  ])("hides the other store's order from a %s with 404 on every route", async (_role, who) => {
    const user = who();
    const scope = scopeOf(user);
    await refused(OrderService.getById(orderB.id, scope), 404, /Order not found/);
    await refused(OrderService.changeStatus(orderB.id, scope, user, { status: "picked_up" }), 404);
    await refused(OrderService.cancel(orderB.id, scope, user, { reason: "sabotage" }), 404);
    expect(state.orders.get(orderB.id).status).toBe("booked");
    expect(state.orders.get(orderB.id).events).toHaveLength(1);
  });

  it("lists, filters and counts only the caller's store", async () => {
    const mine = await OrderService.list(scopeOf(managerA), {});
    expect(mine.map((o) => o.id)).toEqual([orderA.id]);
    expect(await OrderService.list(scopeOf(managerA), { customerId: bob.id })).toEqual([]);
    expect(await OrderService.pipeline(scopeOf(managerA))).toEqual([{ status: "booked", label: "Booked", count: 1 }]);
  });

  it("ignores a forged scope header for a manager", async () => {
    const forged = scopeOf(managerA, storeB.id);
    expect(forged).toBe(storeA.id);
    expect((await OrderService.list(forged, {})).map((o) => o.id)).toEqual([orderA.id]);
  });

  it("hides the other store's customer and store, for read and write", async () => {
    const scope = scopeOf(managerA);
    await refused(CustomerService.getById(bob.id, scope), 404, /Customer not found/);
    await refused(CustomerService.update(bob.id, scope, { name: "Hijacked" }), 404);
    expect(state.customers.get(bob.id).name).toBe("Bob Iyer");
    await refused(StoreService.getById(storeB.id, scope), 404, /Store not found/);
    expect((await StoreService.list(scope, {})).map((s) => s.code)).toEqual(["BLR-IND"]);
    expect((await CustomerService.list(scope, {})).map((c) => c.id).sort()).toEqual([ana.id, corp.id].sort());
  });

  it("cannot book for another store's customer", async () => {
    await refused(book(managerA, { customerId: bob.id, items: [item(washFold, "Shirt", "men", 1)] }), 404, /Customer not found/);
  });

  it("gives an admin every store, or just the scoped one", async () => {
    expect(await OrderService.list(scopeOf(admin), {})).toHaveLength(2);
    expect((await OrderService.list(scopeOf(admin, storeB.id), {})).map((o) => o.id)).toEqual([orderB.id]);
    expect((await OrderService.getById(orderB.id, scopeOf(admin))).id).toBe(orderB.id);
    await refused(OrderService.getById(orderA.id, scopeOf(admin, storeB.id)), 404);
    expect((await StoreService.list(scopeOf(admin), {})).map((s) => s.code)).toEqual(["BLR-IND", "BLR-KOR"]);
    expect((await StoreService.list(scopeOf(admin, storeA.id), {})).map((s) => s.code)).toEqual(["BLR-IND"]);
  });

  it("treats a malformed id as not found rather than an error", async () => {
    await refused(OrderService.getById("not-a-uuid", scopeOf(admin)), 404);
    await refused(CustomerService.getById("1", scopeOf(admin)), 404);
    await refused(StoreService.getById("compare", scopeOf(admin)), 404);
  });
});

// ------------------------------------------------ stores and customers: 409
describe("stores", () => {
  const body = { code: "hyd-gac", name: "Gachibowli Plant", city: "Hyderabad", address: "Financial District", type: "franchise", openingHours: "07:00 – 21:00", capacityKgPerDay: 400 };

  it("creates a store with an upper-cased code and live status by default", async () => {
    const store = await StoreService.create(body);
    expect(store).toMatchObject({ code: "HYD-GAC", status: "live", type: "franchise", capacityKgPerDay: 400 });
    expect(Object.keys(store)).not.toContain("managerName");
  });

  it("answers 409 for a duplicate code, however it is cased", async () => {
    await StoreService.create(body);
    await refused(StoreService.create({ ...body, code: "HYD-GAC", name: "Other" }), 409, /already exists/);
    await refused(StoreService.create({ ...body, code: "hyd-gac" }), 409);
    expect([...state.stores.values()].filter((s) => s.code === "HYD-GAC")).toHaveLength(1);
  });

  it.each([
    ["a missing field", { ...body, city: undefined }, /city is required/],
    ["a bad code", { ...body, code: "no spaces!" }, /code must be/],
    ["an unknown type", { ...body, type: "kiosk" }, /type must be one of/],
    ["a negative capacity", { ...body, capacityKgPerDay: -5 }, /capacityKgPerDay/],
    ["a fractional capacity", { ...body, capacityKgPerDay: 1.5 }, /capacityKgPerDay/],
  ])("rejects %s", async (_name, payload, message) => {
    await refused(StoreService.create(payload), 400, message);
  });

  it("updates fields but never the code, and deactivate closes it", async () => {
    const store = await StoreService.create(body);
    const updated = await StoreService.update(store.id, { name: "Gachibowli Hub", capacityKgPerDay: 500 });
    expect(updated).toMatchObject({ name: "Gachibowli Hub", capacityKgPerDay: 500, code: "HYD-GAC" });
    await refused(StoreService.update(store.id, { code: "NEW" }), 400, /cannot be changed/);

    expect((await StoreService.deactivate(store.id)).status).toBe("closed");
    expect((await StoreService.list(null, { status: "closed" })).map((s) => s.code)).toEqual(["HYD-GAC"]);
    await refused(StoreService.deactivate("99999999-9999-4999-8999-999999999999"), 404);
  });
});

describe("customers", () => {
  it("creates in the caller's store and ignores a body storeId from a store-bound role", async () => {
    const customer = await CustomerService.create(scopeOf(managerA), { name: "Dev Patel", phone: "98450 55555", storeId: storeB.id });
    expect(customer).toMatchObject({ storeId: storeA.id, phone: "+91 98450 55555", type: "retail", orders: 0, lifetimeValue: 0 });
  });

  it("makes an admin pick a store, by scope or by body", async () => {
    await refused(CustomerService.create(scopeOf(admin), { name: "Dev Patel", phone: "98450 55555" }), 400, /Choose a store/);
    await refused(CustomerService.create(scopeOf(admin), { name: "Dev Patel", phone: "98450 55555", storeId: "nope" }), 400, /Choose a store/);
    expect((await CustomerService.create(scopeOf(admin), { name: "Dev Patel", phone: "98450 55555", storeId: storeB.id })).storeId).toBe(storeB.id);
    expect((await CustomerService.create(scopeOf(admin, storeA.id), { name: "Eva Nair", phone: "98450 66666" })).storeId).toBe(storeA.id);
  });

  it("answers 409 for a duplicate phone, whatever its formatting", async () => {
    for (const phone of ["+91 98450 12345", "98450 12345", "9845012345", "+919845012345", "098450 12345", "(+91) 98450-12345"]) {
      await refused(CustomerService.create(scopeOf(managerB), { name: "Copy", phone }), 409, /already exists/);
    }
    expect([...state.customers.values()].filter((c) => c.phone === "+91 98450 12345")).toHaveLength(1);
  });

  it("answers 409 when an update would take another customer's phone, but allows keeping your own", async () => {
    await refused(CustomerService.update(ana.id, scopeOf(managerA), { phone: "+91 98450 22222" }), 409);
    expect((await CustomerService.update(ana.id, scopeOf(managerA), { phone: "98450 12345", name: "Ana R." })).name).toBe("Ana R.");
  });

  it.each([
    ["a short phone", { name: "X", phone: "12345" }, /phone/],
    ["a landline-looking number", { name: "X", phone: "5845012345" }, /phone/],
    ["a missing name", { phone: "98450 77777" }, /name is required/],
    ["a bad email", { name: "X", phone: "98450 77777", email: "nope" }, /email/],
    ["an unknown type", { name: "X", phone: "98450 77777", type: "vip" }, /type must be one of/],
  ])("rejects %s", async (_name, payload, message) => {
    await refused(CustomerService.create(scopeOf(managerA), payload), 400, message);
  });

  it("normalises phone numbers to one form", () => {
    expect(normalizePhone("98450 12345")).toBe("+91 98450 12345");
    expect(normalizePhone("+91-98450-12345")).toBe("+91 98450 12345");
    expect(() => normalizePhone(undefined)).toThrow(CustomException);
  });

  it("filters by q and segment, newest first", async () => {
    const scope = scopeOf(managerA);
    expect((await CustomerService.list(scope, { q: "nimbus" })).map((c) => c.id)).toEqual([corp.id]);
    expect((await CustomerService.list(scope, { q: "12345" })).map((c) => c.id)).toEqual([ana.id]);
    expect((await CustomerService.list(scope, { segment: "corporate" })).map((c) => c.id)).toEqual([corp.id]);
    await refused(CustomerService.list(scope, { segment: "gold" }), 400, /segment/);
    await refused(CustomerService.list(scope, { q: ["a", "b"] }), 400, /single value/);
  });

  it("shapes a customer the way the dashboard type expects", async () => {
    state.customers.get(ana.id).lifetimeValuePaise = 123456;
    const view = await CustomerService.getById(ana.id, scopeOf(managerA));
    expect(view.lifetimeValue).toBe(1234.56);
    expect(view.lastOrderAt).toBe(view.joinedAt); // never ordered: the join date stands in
    expect(Object.keys(view).sort()).toEqual(
      ["addresses", "churnRisk", "email", "id", "joinedAt", "lastOrderAt", "lifetimeValue", "loyaltyPoints", "name", "orders", "phone", "rating", "storeId", "tags", "type", "walletBalance"]
    );
  });
});

// -------------------------------------------------------- price lists (admin)
describe("price lists", () => {
  it("lists with computed row counts and shapes rows in rupees", async () => {
    const lists = await CatalogService.listPriceLists();
    expect(lists.find((l) => l.name === "Standard retail")).toMatchObject({ rows: 5, active: true });
    const rows = await CatalogService.listRows(standard.id);
    expect(rows.find((r) => r.garment === "Saree")).toMatchObject({ serviceName: "Dry Clean", unit: "piece", rate: 250, expressRate: 362.5, priceListId: standard.id });
    await refused(CatalogService.listRows("9d1c3a2e-0000-4000-8000-000000000000"), 404);
  });

  it("creates lists, refusing a duplicate name with 409", async () => {
    const created = await CatalogService.createList({ name: "Festive", appliesTo: "Diwali", customerType: "retail" });
    expect(created).toMatchObject({ name: "Festive", active: true, rows: 0 });
    await refused(CatalogService.createList({ name: "Festive" }), 409, /already exists/);
    await refused(CatalogService.createList({ name: "X", storeId: "nope" }), 400, /storeId/);
    await refused(CatalogService.createList({ name: "X", active: "yes" }), 400, /active/);
  });

  it("renames and activates, refusing a name another list holds", async () => {
    const renamed = await CatalogService.updateList(standard.id, { name: "Retail 2026", active: false });
    expect(renamed).toMatchObject({ name: "Retail 2026", active: false });
    await refused(CatalogService.updateList(standard.id, { name: "Corporate contract" }), 409);
    await refused(CatalogService.updateList("9d1c3a2e-0000-4000-8000-000000000000", { name: "Z" }), 404);

  });

  it("stops pricing from a list the moment it is deactivated", async () => {
    await CatalogService.updateList(standard.id, { active: false });
    await refused(bookAna([item(dryClean, "Saree", "women", 1)]), 400, /no price/);
  });

  it("duplicates with every row, inactive, with a fresh name each time", async () => {
    const first = await CatalogService.duplicateList(standard.id);
    const second = await CatalogService.duplicateList(standard.id);

    expect(first).toMatchObject({ name: "Standard retail (copy)", active: false, rows: 5 });
    expect(second.name).toBe("Standard retail (copy 2)");
    expect(await CatalogService.listRows(first.id)).toHaveLength(5);
    // The copy is inactive, so live pricing is untouched.
    expect((await bookAna([item(washFold, "Shirt", "men", 1)])).items[0]!.rate).toBe(80);
    await refused(CatalogService.duplicateList("nope"), 404);
  });

  it("changes a rate, takes effect on new orders only, and stamps the list", async () => {
    const before = await bookAna([item(washFold, "Shirt", "men", 1)]);
    const row = (await CatalogService.listRows(standard.id)).find((r) => r.garment === "Shirt" && r.serviceName === "Wash & Fold")!;
    const stamp = state.lists.get(standard.id).updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));

    const updated = await CatalogService.updateRow(standard.id, row.id, { rate: 90.5, expressRate: 130 });
    expect(updated).toMatchObject({ rate: 90.5, expressRate: 130 });
    expect(state.lists.get(standard.id).updatedAt.getTime()).toBeGreaterThan(stamp.getTime());

    const after = await bookAna([item(washFold, "Shirt", "men", 1)]);
    expect(after.items[0]!.rate).toBe(90.5);
    expect((await OrderService.getById(before.id, scopeOf(managerA))).items[0]!.rate).toBe(80);
  });

  it.each([
    ["zero", { rate: 0 }],
    ["negative", { rate: -5 }],
    ["NaN", { rate: Number.NaN }],
    ["a string", { rate: "90" }],
    ["three decimals", { rate: 90.123 }],
    ["absurd", { rate: 99_999_999 }],
    ["an express rate below the rate", { rate: 100, expressRate: 50 }],
    ["a rate above the kept express rate", { rate: 500 }],
  ])("refuses %s as a rate", async (_name, payload) => {
    const row = (await CatalogService.listRows(standard.id))[0]!;
    await refused(CatalogService.updateRow(standard.id, row.id, payload), 400);
  });

  it("does not find a row through the wrong list", async () => {
    const other = seed.list({ name: "Other" });
    const row = (await CatalogService.listRows(standard.id))[0]!;
    await refused(CatalogService.updateRow(other.id, row.id, { rate: 10 }), 404, /row not found/);
    await refused(CatalogService.updateRow(standard.id, "nope", { rate: 10 }), 404);
  });

  it("lists services in the dashboard shape", async () => {
    const services = await CatalogService.listServices();
    expect(services.find((s) => s.name === "Wash & Fold")).toEqual({
      id: washFold.id,
      name: "Wash & Fold",
      department: "laundry",
      unit: "kg",
      turnaroundHours: 48,
      expressAvailable: true,
      active: true,
    });
  });
});

// ------------------------------------------------------- order list filters
describe("listing orders", () => {
  const T0 = new Date("2026-09-20T09:00:00Z").getTime();

  // Orders placed on consecutive days, with a spread of status, priority and payment.
  const build = async () => {
    const make = async (dayOffset: number, extra: Record<string, unknown>, who = managerA, customer = ana) => {
      jest.useFakeTimers({ now: T0 + dayOffset * 86_400_000, doNotFake: ["setImmediate", "nextTick", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      try {
        return await book(who, { customerId: customer.id, items: [item(washFold, "Shirt", "men", 1)], ...extra });
      } finally {
        jest.useRealTimers();
      }
    };
    return {
      first: await make(0, { paymentStatus: "paid" }),
      second: await make(1, { priority: "express", paymentStatus: "part_paid" }),
      third: await make(2, { channel: "phone" }, managerA, corp),
      fourth: await make(3, {}, managerB, bob),
    };
  };

  let orders: Awaited<ReturnType<typeof build>>;
  beforeEach(async () => {
    orders = await build();
    await OrderService.changeStatus(orders.first.id, scopeOf(managerA), managerA, { status: "picked_up" });
    await OrderService.changeStatus(orders.first.id, scopeOf(managerA), managerA, { status: "received" });
    await OrderService.cancel(orders.third.id, scopeOf(managerA), managerA, { reason: "Duplicate booking" });
  });

  const ids = async (user: RequestUser, query: Record<string, unknown>, scopeStoreId: string | null = null) =>
    (await OrderService.list(scopeOf(user, scopeStoreId), query)).map((o) => o.id);

  it("returns newest first", async () => {
    expect(await ids(admin, {})).toEqual([orders.fourth.id, orders.third.id, orders.second.id, orders.first.id]);
  });

  it("filters by status, including the active shorthand", async () => {
    expect(await ids(managerA, { status: "received" })).toEqual([orders.first.id]);
    expect(await ids(managerA, { status: "cancelled" })).toEqual([orders.third.id]);
    expect(await ids(managerA, { status: "active" })).toEqual([orders.second.id, orders.first.id]);
    await refused(OrderService.list(scopeOf(managerA), { status: "lost" }), 400, /status must be one of/);
  });

  it("filters by priority, payment status and customer", async () => {
    expect(await ids(managerA, { priority: "express" })).toEqual([orders.second.id]);
    expect(await ids(managerA, { paymentStatus: "paid" })).toEqual([orders.first.id]);
    expect(await ids(managerA, { paymentStatus: "unpaid" })).toEqual([orders.third.id]);
    expect(await ids(managerA, { customerId: corp.id })).toEqual([orders.third.id]);
    await refused(OrderService.list(scopeOf(managerA), { priority: "urgent" }), 400, /priority/);
    await refused(OrderService.list(scopeOf(managerA), { paymentStatus: "owes" }), 400, /paymentStatus/);
    await refused(OrderService.list(scopeOf(managerA), { customerId: "nope" }), 400, /customerId/);
  });

  it("searches ref, customer name and phone", async () => {
    expect(await ids(managerA, { q: orders.second.ref.toLowerCase() })).toEqual([orders.second.id]);
    expect(await ids(managerA, { q: "nimbus" })).toEqual([orders.third.id]);
    expect(await ids(managerA, { q: "22222" })).toEqual([orders.third.id]);
    expect(await ids(managerA, { q: "zzz" })).toEqual([]);
  });

  it("filters by placed date, with a bare `to` date covering that whole day", async () => {
    expect(await ids(admin, { from: "2026-09-22" })).toEqual([orders.fourth.id, orders.third.id]);
    expect(await ids(admin, { to: "2026-09-21" })).toEqual([orders.second.id, orders.first.id]);
    expect(await ids(admin, { from: "2026-09-21", to: "2026-09-22" })).toEqual([orders.third.id, orders.second.id]);
    expect(await ids(admin, { from: "2026-09-21T10:00:00Z", to: "2026-09-21T23:00:00Z" })).toEqual([]);
    await refused(OrderService.list(scopeOf(admin), { from: "yesterday" }), 400, /from/);
  });

  it("combines filters with the store scope", async () => {
    expect(await ids(admin, { status: "booked" })).toEqual([orders.fourth.id, orders.second.id]);
    expect(await ids(admin, { status: "booked" }, storeA.id)).toEqual([orders.second.id]);
  });

  it("limits to 500 by default, never above 1000, and rejects nonsense", async () => {
    const spy = jest.spyOn(require("../Testing/InMemoryCommerce.js").orderQuery, "search");
    await OrderService.list(scopeOf(admin), {});
    await OrderService.list(scopeOf(admin), { limit: "50000" });
    await OrderService.list(scopeOf(admin), { limit: "2" });
    expect(spy.mock.calls.map(([filter]: any) => filter.limit)).toEqual([500, 1000, 2]);
    expect(await ids(admin, { limit: "2" })).toHaveLength(2);
    for (const limit of ["0", "-1", "abc", "1.5"]) await refused(OrderService.list(scopeOf(admin), { limit }), 400, /limit/);
    spy.mockRestore();
  });

  it("returns the full dashboard Order shape", async () => {
    const [newest] = await OrderService.list(scopeOf(admin), {});
    expect(Object.keys(newest!).sort()).toEqual(
      ["address", "amount", "care", "channel", "customerId", "customerName", "customerPhone", "id", "items", "paymentStatus", "pieces", "placedAt", "priority", "promisedAt", "ref", "riderName", "slackMinutes", "status", "storeId", "timeline", "weightKg"]
    );
    expect(Object.keys(newest!.items[0]!).sort()).toEqual(["amount", "category", "garment", "id", "qty", "rate", "service", "unit"]);
  });
});

// ------------------------------------------------------------------ pipeline
describe("order pipeline", () => {
  it("counts active orders per status in plant order, leaving out empty and final statuses", async () => {
    const make = () => bookAna([item(washFold, "Shirt", "men", 1)]);
    const step = (o: { id: string }, status: string) => OrderService.changeStatus(o.id, scopeOf(managerA), managerA, { status });

    const a = await make();
    const b = await make();
    await make();
    await step(a, "picked_up");
    await step(b, "picked_up");
    await step(b, "received");
    const delivered = await make();
    for (const s of ["picked_up", "received", "sorted", "washing", "drying", "quality_check", "packed", "out_for_delivery", "delivered"]) await step(delivered, s);
    const cancelled = await make();
    await OrderService.cancel(cancelled.id, scopeOf(managerA), managerA, { reason: "x" });
    await book(managerB, { customerId: bob.id, items: [item(washFold, "Shirt", "men", 1)] });

    expect(await OrderService.pipeline(scopeOf(managerA))).toEqual([
      { status: "booked", label: "Booked", count: 1 },
      { status: "picked_up", label: "Picked up", count: 1 },
      { status: "received", label: "Received", count: 1 },
    ]);
    expect((await OrderService.pipeline(scopeOf(admin))).find((r) => r.status === "booked")!.count).toBe(2);
    expect(await OrderService.pipeline(scopeOf(managerB))).toEqual([{ status: "booked", label: "Booked", count: 1 }]);
  });

  it("is empty when there are no active orders", async () => {
    expect(await OrderService.pipeline(scopeOf(admin))).toEqual([]);
  });
});
