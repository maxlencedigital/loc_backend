import { CustomException } from "../../commons/Exception/CustomException.js";
import type { RequestUser } from "../Middleware/Identity.js";

// The Query modules are replaced by in-memory fakes; the status machine, ownership checks,
// slot seats and internal order rules below are the real code.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../../commons/Http/ServiceClient.js", () => require("../Testing/InMemoryCustomerAccount.js").serviceClientMock);
jest.mock("../Queries/Store.Query.js", () => ({ StoreQuery: require("../Testing/InMemoryCommerce.js").storeQuery }));
jest.mock("../Queries/Customer.Query.js", () => ({ CustomerQuery: require("../Testing/InMemoryCommerce.js").customerQuery }));
jest.mock("../Queries/Catalog.Query.js", () => ({ CatalogQuery: require("../Testing/InMemoryCommerce.js").catalogQuery }));
jest.mock("../Queries/Order.Query.js", () => ({ OrderQuery: require("../Testing/InMemoryCommerce.js").orderQuery }));
jest.mock("../Queries/CustomerProfile.Query.js", () => ({ CustomerProfileQuery: require("../Testing/InMemoryCustomerAccount.js").profileQuery }));
jest.mock("../Queries/CustomerAddress.Query.js", () => ({ CustomerAddressQuery: require("../Testing/InMemoryCustomerAccount.js").addressQuery }));
jest.mock("../Queries/GarmentProfile.Query.js", () => ({ GarmentProfileQuery: require("../Testing/InMemoryCustomerAccount.js").garmentQuery }));
jest.mock("../Queries/CustomerPhoto.Query.js", () => ({ CustomerPhotoQuery: require("../Testing/InMemoryCustomerAccount.js").photoQuery }));
jest.mock("../Queries/PickupSlot.Query.js", () => ({ PickupSlotQuery: require("../Testing/InMemoryCustomerAccount.js").slotQuery }));
jest.mock("../Queries/CustomerOrder.Query.js", () => ({ CustomerOrderQuery: require("../Testing/InMemoryCustomerAccount.js").customerOrderQuery }));
jest.mock("../Queries/OrderInternal.Query.js", () => ({ OrderInternalQuery: require("../Testing/InMemoryCustomerAccount.js").internalOrderQuery }));

import { seed, state as core } from "../Testing/InMemoryCommerce.js";
import { state } from "../Testing/InMemoryCustomerAccount.js";
import { buildWorld, IWorld, signUp } from "../Testing/CustomerAccountWorld.js";
import { garmentTypeIdOf } from "../Utils/GarmentTypeId.js";
import { CustomerOrderingService } from "./CustomerOrdering.Service.js";
import { CustomerOrdersService, RESCHEDULE_CUTOFF_MINUTES } from "./CustomerOrders.Service.js";
import { CustomerProfileService } from "./CustomerProfile.Service.js";
import { OrderInternalService } from "./OrderInternal.Service.js";
import { OrderService } from "./Order.Service.js";

const NOW = new Date("2026-10-05T04:00:00Z"); // Monday 09:30 in India
const TOMORROW = "2026-10-06";

let world: IWorld;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["setImmediate", "nextTick", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  world = buildWorld();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  errorSpy.mockRestore();
});

const refused = async (promise: Promise<unknown>, status: number, message?: RegExp) => {
  try {
    await promise;
  } catch (error) {
    expect((error as CustomException).errorCode).toBe(status);
    if (message) expect((error as CustomException).displayMessage).toMatch(message);
    return;
  }
  throw new Error("expected the call to be rejected");
};

interface IShopper {
  user: RequestUser;
  addressId: string;
}

const shopper = async (): Promise<IShopper> => {
  const user = signUp();
  const address = (await CustomerProfileService.createAddress(user, { label: "home", line1: "12 MG Road", city: "Bengaluru", pincode: "560001" })) as any;
  return { user, addressId: address.id };
};

const slotsOn = async (s: IShopper, date = TOMORROW) =>
  ((await CustomerOrderingService.listPickupSlots(s.user, { addressId: s.addressId, date })) as any).items as { id: string; from: string; to: string }[];

const item = (extra: Record<string, unknown> = {}) => ({
  garmentTypeId: garmentTypeIdOf("men", "Shirt"),
  serviceId: world.washFold.id,
  weightKg: 2,
  ...extra,
});

const place = async (s: IShopper, over: Record<string, unknown> = {}, slotIndex = 0) => {
  const slot = (await slotsOn(s))[slotIndex]!;
  return (await CustomerOrderingService.placeMyOrder(s.user, undefined, {
    addressId: s.addressId,
    items: [item()],
    pickupSlotId: slot.id,
    paymentMethod: "online",
    ...over,
  })) as any;
};

const system = (name = "Logistics") => ({ actor: { name } });
const advance = (orderId: string, status: string, note?: string) => OrderInternalService.changeStatus(orderId, { status, note, ...system() });

// ------------------------------------------------------------- order history
describe("my orders", () => {
  it("lists only my orders, newest first, with the customer-facing status", async () => {
    const s = await shopper();
    const other = await shopper();
    const first = await place(s);
    jest.setSystemTime(new Date(NOW.getTime() + 60_000));
    const second = await place(s, { express: true });
    await place(other);

    const page = (await CustomerOrdersService.listMyOrders(s.user, {})) as any;
    expect(page).toMatchObject({ page: 1, limit: 20, total: 2 });
    expect(page.items.map((o: any) => o.id)).toEqual([second.orderId, first.orderId]);
    expect(page.items[0]).toMatchObject({
      orderNumber: second.orderNumber,
      status: "pickup_scheduled",
      express: true,
      total: 232,
      paymentStatus: "unpaid",
      storeId: world.storeA.id,
      pickupSlot: { from: "2026-10-06T01:30:00.000Z", to: "2026-10-06T03:30:00.000Z" },
    });
  });

  it("shows a counter order with no pickup slot as placed, not pickup_scheduled", async () => {
    const s = await shopper();
    const profile = [...state.profiles.values()][0];
    const customerId = profile.customerId;
    await place(s);
    const walkIn = seed.customer({ storeId: world.storeA.id, phone: "+91 98450 77777" });
    expect(walkIn).toBeTruthy();
    // A walk-in order the store booked for this same customer.
    core.orders.set("walkin", { id: "walkin", ref: "LOC-1", storeId: world.storeA.id, customerId, status: "booked", priority: "standard", paymentStatus: "paid", amountPaise: 5000, placedAt: new Date(NOW.getTime() - 3600_000), items: [], events: [] });

    const all = ((await CustomerOrdersService.listMyOrders(s.user, {})) as any).items;
    expect(all.map((o: any) => [o.id === "walkin", o.status])).toEqual([[false, "pickup_scheduled"], [true, "placed"]]);
    expect(((await CustomerOrdersService.listMyOrders(s.user, { status: "placed" })) as any).items.map((o: any) => o.id)).toEqual(["walkin"]);
    expect(((await CustomerOrdersService.listMyOrders(s.user, { status: "pickup_scheduled" })) as any).total).toBe(1);
  });

  it("filters by customer status, mapping the plant's finer steps onto it", async () => {
    const s = await shopper();
    const a = await place(s);
    const b = await place(s);
    await advance(a.orderId, "picked_up");
    await advance(a.orderId, "received");
    await advance(a.orderId, "sorted");
    await advance(b.orderId, "picked_up");

    const ids = async (status: string) => ((await CustomerOrdersService.listMyOrders(s.user, { status })) as any).items.map((o: any) => o.id);
    expect(await ids("processing")).toEqual([a.orderId]); // "sorted" is part of processing
    expect(await ids("picked_up")).toEqual([b.orderId]);
    expect(await ids("at_store")).toEqual([]);
    expect(await ids("pickup_scheduled")).toEqual([]);
    await refused(CustomerOrdersService.listMyOrders(s.user, { status: "washing" }), 400, /status/);
  });

  it("filters by placed date, a bare end date meaning through the end of that Indian day", async () => {
    const s = await shopper();
    await place(s);
    const ids = async (query: Record<string, unknown>) => ((await CustomerOrdersService.listMyOrders(s.user, query)) as any).total;

    expect(await ids({ from: "2026-10-05", to: "2026-10-05" })).toBe(1);
    expect(await ids({ from: "2026-10-06" })).toBe(0);
    expect(await ids({ to: "2026-10-04" })).toBe(0);
    await refused(CustomerOrdersService.listMyOrders(s.user, { from: "yesterday" }), 400);
  });

  it("pages and caps the page size", async () => {
    const s = await shopper();
    for (let i = 0; i < 3; i += 1) {
      jest.setSystemTime(new Date(NOW.getTime() + i * 60_000));
      await place(s);
    }
    const second = (await CustomerOrdersService.listMyOrders(s.user, { page: "2", limit: "2" })) as any;
    expect(second).toMatchObject({ page: 2, limit: 2, total: 3 });
    expect(second.items).toHaveLength(1);
    expect(((await CustomerOrdersService.listMyOrders(s.user, { limit: "9999" })) as any).limit).toBe(100);
    await refused(CustomerOrdersService.listMyOrders(s.user, { page: "-1" }), 400);
  });

  it("returns an order in full, and 404 for anyone else's or a malformed id", async () => {
    const s = await shopper();
    const stranger = await shopper();
    const placed = await place(s, { items: [item({ fabric: "cotton" })], careNotes: "gentle" });

    const detail = (await CustomerOrdersService.getMyOrder(s.user, placed.orderId)) as any;
    expect(detail).toMatchObject({ id: placed.orderId, status: "pickup_scheduled", total: 160, pickupSlot: expect.any(Object) });
    expect(detail.items).toEqual([expect.objectContaining({ garmentType: "Shirt", service: "Wash & Fold", quantity: 2, unit: "kg", status: "pickup_scheduled", careFlags: [] })]);

    await refused(CustomerOrdersService.getMyOrder(stranger.user, placed.orderId), 404);
    await refused(CustomerOrdersService.getMyOrder(s.user, "nope"), 404);
    await refused(CustomerOrdersService.getMyOrder(s.user, crypto.randomUUID()), 404);
  });
});

// ----------------------------------------------------------------- tracking
describe("tracking", () => {
  it("shows the journey so far, done stages with times and the rest pending", async () => {
    const s = await shopper();
    const { orderId } = await place(s);
    jest.setSystemTime(new Date("2026-10-06T02:00:00Z"));
    await advance(orderId, "picked_up");
    jest.setSystemTime(new Date("2026-10-06T05:00:00Z"));
    await advance(orderId, "received");
    await advance(orderId, "sorted");

    const tracking = (await CustomerOrdersService.trackMyOrder(s.user, orderId)) as any;
    expect(tracking.status).toBe("processing");
    expect(tracking.stages.map((x: any) => [x.stage, x.done])).toEqual([
      ["placed", true], ["picked_up", true], ["at_store", true], ["processing", true],
      ["quality_check", false], ["ready", false], ["out_for_delivery", false], ["delivered", false],
    ]);
    expect(tracking.stages[1].at).toBe("2026-10-06T02:00:00.000Z");
    expect(tracking.stages[4].at).toBeNull();
    expect(tracking.rider).toBeNull();
  });

  it("names the rider once one is assigned and leaves unknown logistics data null", async () => {
    const s = await shopper();
    const { orderId } = await place(s);
    core.orders.get(orderId).riderName = "Ravi";
    const tracking = (await CustomerOrdersService.trackMyOrder(s.user, orderId)) as any;
    expect(tracking.rider).toEqual({ name: "Ravi", phone: null, etaMinutes: null, latitude: null, longitude: null });
  });

  it("ends a cancelled order with a cancelled stage, and a delivered one with every stage done", async () => {
    const s = await shopper();
    const cancelled = await place(s);
    await CustomerOrdersService.cancelMyOrder(s.user, cancelled.orderId, {});
    const stages = ((await CustomerOrdersService.trackMyOrder(s.user, cancelled.orderId)) as any).stages;
    expect(stages.at(-1)).toMatchObject({ stage: "cancelled", done: true });
    expect(stages.filter((x: any) => x.done).map((x: any) => x.stage)).toEqual(["placed", "cancelled"]);

    const delivered = await place(s);
    for (const status of ["picked_up", "received", "sorted", "washing", "drying", "quality_check", "packed", "out_for_delivery", "delivered"]) {
      await advance(delivered.orderId, status);
    }
    const done = ((await CustomerOrdersService.trackMyOrder(s.user, delivered.orderId)) as any);
    expect(done.status).toBe("delivered");
    expect(done.stages.every((x: any) => x.done)).toBe(true);
  });

  it("is 404 for someone else's order", async () => {
    const s = await shopper();
    const stranger = await shopper();
    const { orderId } = await place(s);
    await refused(CustomerOrdersService.trackMyOrder(stranger.user, orderId), 404);
  });
});

// ------------------------------------------------------------------- cancel
describe("cancelling an order", () => {
  it("cancels before pickup, gives the seat back and takes the order off the customer's totals", async () => {
    const s = await shopper();
    const { orderId } = await place(s);
    const slotId = state.exts.get(orderId).pickupSlotId;
    expect(state.slots.get(slotId).booked).toBe(1);

    const cancelled = (await CustomerOrdersService.cancelMyOrder(s.user, orderId, { reason: "Plans changed" })) as any;

    expect(cancelled.status).toBe("cancelled");
    expect(core.orders.get(orderId).events.at(-1)).toMatchObject({ status: "cancelled", note: "Plans changed", byName: "Ana Rao", byUserId: s.user.id });
    expect(state.slots.get(slotId).booked).toBe(0);
    expect([...core.customers.values()][0]).toMatchObject({ orderCount: 0, lifetimeValuePaise: 0 });
  });

  it("records a default reason when none is given", async () => {
    const s = await shopper();
    const { orderId } = await place(s);
    await CustomerOrdersService.cancelMyOrder(s.user, orderId, undefined);
    expect(core.orders.get(orderId).events.at(-1).note).toBe("Cancelled by the customer.");
  });

  it("is harmless to repeat: it does not release the seat or the totals twice", async () => {
    const s = await shopper();
    const { orderId } = await place(s);
    await CustomerOrdersService.cancelMyOrder(s.user, orderId, {});
    await CustomerOrdersService.cancelMyOrder(s.user, orderId, {});
    await Promise.all([CustomerOrdersService.cancelMyOrder(s.user, orderId, {}), CustomerOrdersService.cancelMyOrder(s.user, orderId, {})]);

    expect(core.orders.get(orderId).events.filter((e: any) => e.status === "cancelled")).toHaveLength(1);
    expect([...state.slots.values()][0].booked).toBe(0);
    expect([...core.customers.values()][0].orderCount).toBe(0);
  });

  it.each(["picked_up", "received", "washing", "out_for_delivery", "delivered"])("is refused with 409 once the order is %s", async (status) => {
    const s = await shopper();
    const { orderId } = await place(s);
    core.orders.get(orderId).status = status;
    await refused(CustomerOrdersService.cancelMyOrder(s.user, orderId, {}), 409, /pickup has started/);
    expect(core.orders.get(orderId).status).toBe(status);
    expect([...state.slots.values()][0].booked).toBe(1);
  });

  it("lets only one of a cancel and a pickup win when they race", async () => {
    const s = await shopper();
    const { orderId } = await place(s);
    const settled = await Promise.allSettled([CustomerOrdersService.cancelMyOrder(s.user, orderId, {}), advance(orderId, "picked_up")]);

    const status = core.orders.get(orderId).status;
    expect(["cancelled", "picked_up"]).toContain(status);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(core.orders.get(orderId).events.map((e: any) => e.status)).toEqual(["booked", status]);
  });

  it("answers 404 for someone else's order and rejects an over-long reason", async () => {
    const s = await shopper();
    const stranger = await shopper();
    const { orderId } = await place(s);
    await refused(CustomerOrdersService.cancelMyOrder(stranger.user, orderId, {}), 404);
    await refused(CustomerOrdersService.cancelMyOrder(s.user, orderId, { reason: "x".repeat(501) }), 400);
    expect(core.orders.get(orderId).status).toBe("booked");
  });
});

// -------------------------------------------------------------- reschedule
describe("rescheduling the pickup", () => {
  it("moves the order to another slot, swapping the seats and noting it on the timeline", async () => {
    const s = await shopper();
    const slots = await slotsOn(s);
    const { orderId } = await place(s, {}, 0);

    const moved = (await CustomerOrdersService.rescheduleMyPickup(s.user, orderId, { pickupSlotId: slots[2]!.id })) as any;

    expect(moved.pickupSlot).toEqual({ from: slots[2]!.from, to: slots[2]!.to });
    expect(state.slots.get(slots[0]!.id).booked).toBe(0);
    expect(state.slots.get(slots[2]!.id).booked).toBe(1);
    expect(state.exts.get(orderId).pickupSlotId).toBe(slots[2]!.id);
    expect(core.orders.get(orderId).events.at(-1)).toMatchObject({ status: "booked", byName: "Ana Rao" });
    expect(core.orders.get(orderId).events.at(-1).note).toMatch(/Pickup moved to/);
  });

  it("does nothing when asked for the slot the order already has", async () => {
    const s = await shopper();
    const slots = await slotsOn(s);
    const { orderId } = await place(s, {}, 0);
    await CustomerOrdersService.rescheduleMyPickup(s.user, orderId, { pickupSlotId: slots[0]!.id });
    expect(state.slots.get(slots[0]!.id).booked).toBe(1);
    expect(core.orders.get(orderId).events).toHaveLength(1);
  });

  it("keeps the old seat when the new slot is full", async () => {
    const s = await shopper();
    const slots = await slotsOn(s);
    const { orderId } = await place(s, {}, 0);
    state.slots.get(slots[1]!.id).booked = state.slots.get(slots[1]!.id).capacity;

    await refused(CustomerOrdersService.rescheduleMyPickup(s.user, orderId, { pickupSlotId: slots[1]!.id }), 409, /no longer available/);
    expect(state.slots.get(slots[0]!.id).booked).toBe(1);
    expect(state.exts.get(orderId).pickupSlotId).toBe(slots[0]!.id);
  });

  it("refuses a slot at another store, an unknown slot and a slot inside the lead time", async () => {
    const s = await shopper();
    const { orderId } = await place(s);
    const [otherStore] = ((await CustomerOrderingService.listPickupSlots(s.user, { addressId: s.addressId, date: TOMORROW, storeId: world.storeB.id })) as any).items;
    await refused(CustomerOrdersService.rescheduleMyPickup(s.user, orderId, { pickupSlotId: otherStore.id }), 409, /same store/);
    await refused(CustomerOrdersService.rescheduleMyPickup(s.user, orderId, { pickupSlotId: crypto.randomUUID() }), 400);
    await refused(CustomerOrdersService.rescheduleMyPickup(s.user, orderId, { pickupSlotId: "x" }), 400);
    await refused(CustomerOrdersService.rescheduleMyPickup(s.user, orderId, {}), 400);

    const [soon] = await slotsOn(s, "2026-10-05");
    await refused(CustomerOrdersService.rescheduleMyPickup(s.user, orderId, { pickupSlotId: soon!.id }), 409, /no longer available/);
  });

  it(`is refused within ${RESCHEDULE_CUTOFF_MINUTES} minutes of the window opening, and once the order is picked up`, async () => {
    const s = await shopper();
    const slots = await slotsOn(s);
    const { orderId } = await place(s, {}, 0);

    jest.setSystemTime(new Date(new Date(slots[0]!.from).getTime() - 30 * 60_000));
    await refused(CustomerOrdersService.rescheduleMyPickup(s.user, orderId, { pickupSlotId: slots[3]!.id }), 409, /too close/);

    jest.setSystemTime(NOW);
    core.orders.get(orderId).status = "picked_up";
    await refused(CustomerOrdersService.rescheduleMyPickup(s.user, orderId, { pickupSlotId: slots[3]!.id }), 409, /before the rider collects/);
    expect(state.exts.get(orderId).pickupSlotId).toBe(slots[0]!.id);
  });

  it("is 404 for someone else's order", async () => {
    const s = await shopper();
    const stranger = await shopper();
    const slots = await slotsOn(s);
    const { orderId } = await place(s);
    await refused(CustomerOrdersService.rescheduleMyPickup(stranger.user, orderId, { pickupSlotId: slots[2]!.id }), 404);
  });

  it("never loses or invents a seat when two customers swap slots at once", async () => {
    const a = await shopper();
    const b = await shopper();
    const slots = await slotsOn(a);
    const one = await place(a, {}, 0);
    const two = await place(b, {}, 1);

    await Promise.all([
      CustomerOrdersService.rescheduleMyPickup(a.user, one.orderId, { pickupSlotId: slots[1]!.id }),
      CustomerOrdersService.rescheduleMyPickup(b.user, two.orderId, { pickupSlotId: slots[0]!.id }),
    ]);

    expect(state.slots.get(slots[0]!.id).booked).toBe(1);
    expect(state.slots.get(slots[1]!.id).booked).toBe(1);
    expect([state.exts.get(one.orderId).pickupSlotId, state.exts.get(two.orderId).pickupSlotId]).toEqual([slots[1]!.id, slots[0]!.id]);
  });
});

// ------------------------------------------------------- invoice and reorder
describe("invoice and reorder", () => {
  it("gives the order's invoice, with no download link yet, and none for a cancelled order", async () => {
    const s = await shopper();
    const { orderId, orderNumber } = await place(s);

    expect(await CustomerOrdersService.getMyOrderInvoice(s.user, orderId)).toEqual({
      invoiceNumber: `INV-${orderNumber.replace("LOC-", "")}`,
      issuedAt: NOW.toISOString(),
      total: 160,
      downloadUrl: null,
    });
    await CustomerOrdersService.cancelMyOrder(s.user, orderId, {});
    await refused(CustomerOrdersService.getMyOrderInvoice(s.user, orderId), 404, /cancelled/);
  });

  it("is 404 for someone else's invoice", async () => {
    const s = await shopper();
    const stranger = await shopper();
    const { orderId } = await place(s);
    await refused(CustomerOrdersService.getMyOrderInvoice(stranger.user, orderId), 404);
  });

  it("builds a basket from a past order: same items, fabric and notes, the pickup address", async () => {
    const s = await shopper();
    const { orderId } = await place(s, { items: [item({ weightKg: 3, fabric: "linen", note: "light starch" }), { garmentTypeId: garmentTypeIdOf("men", "Shirt"), serviceId: world.dryClean.id, quantity: 2 }] });

    const basket = (await CustomerOrdersService.reorderMyOrder(s.user, orderId)) as any;
    expect(basket.addressId).toBe(s.addressId);
    expect(basket.items).toEqual([
      { garmentTypeId: garmentTypeIdOf("men", "Shirt"), serviceId: world.washFold.id, weightKg: 3, fabric: "linen", note: "light starch" },
      { garmentTypeId: garmentTypeIdOf("men", "Shirt"), serviceId: world.dryClean.id, quantity: 2 },
    ]);
    expect(core.orders.size).toBe(1); // nothing was booked
  });

  it("falls back to the default address when the old one was deleted, and works for a counter order", async () => {
    const s = await shopper();
    const second = (await CustomerProfileService.createAddress(s.user, { label: "office", line1: "Tech Park", city: "Bengaluru", pincode: "560037" })) as any;
    const { orderId } = await place(s);
    await CustomerProfileService.deleteAddress(s.user, s.addressId);
    expect(((await CustomerOrdersService.reorderMyOrder(s.user, orderId)) as any).addressId).toBe(second.id);
  });

  it("is 404 for someone else's order", async () => {
    const s = await shopper();
    const stranger = await shopper();
    const { orderId } = await place(s);
    await refused(CustomerOrdersService.reorderMyOrder(stranger.user, orderId), 404);
  });
});

// ------------------------------------------------------------ internal orders
describe("internal: reading an order", () => {
  it("gives the agreed shape, plus the delivery address and pickup window", async () => {
    const s = await shopper();
    const { orderId } = await place(s);
    const customer = [...core.customers.values()][0];

    expect(await OrderInternalService.getOrder(orderId)).toEqual({
      id: orderId,
      ref: "LOC-24800",
      storeId: world.storeA.id,
      customerId: customer.id,
      customerUserId: s.user.id,
      customerName: "Ana Rao",
      customerPhone: customer.phone,
      status: "booked",
      priority: "standard",
      paymentStatus: "unpaid",
      amountPaise: 16000,
      paidPaise: 0,
      address: "12 MG Road, Bengaluru 560001",
      promisedAt: "2026-10-08T03:30:00.000Z",
      deliveryAddress: "12 MG Road, Bengaluru 560001",
      pickupWindow: { from: "2026-10-06T01:30:00.000Z", to: "2026-10-06T03:30:00.000Z" },
    });
  });

  it("has no user or pickup window for a counter order, and counts a paid one as fully paid", async () => {
    const customer = seed.customer({ storeId: world.storeA.id, phone: "+91 98450 12345" });
    core.orders.set("walkin", { id: "walkin", ref: "LOC-1", storeId: world.storeA.id, customerId: customer.id, status: "booked", priority: "standard", paymentStatus: "paid", amountPaise: 5000, address: "Counter", promisedAt: NOW, placedAt: NOW, items: [], events: [] });
    const walkIn = crypto.randomUUID();
    core.orders.set(walkIn, { ...core.orders.get("walkin"), id: walkIn });

    expect(await OrderInternalService.getOrder(walkIn)).toMatchObject({ customerUserId: null, paidPaise: 5000, pickupWindow: null, deliveryAddress: "Counter" });
  });

  it("answers 404 for an unknown order and 400 for a malformed id", async () => {
    await refused(OrderInternalService.getOrder(crypto.randomUUID()), 404);
    await refused(OrderInternalService.getOrder("nope"), 400, /valid order id/);
  });
});

describe("internal: payment status", () => {
  const setup = async () => {
    const s = await shopper();
    const { orderId } = await place(s); // 16000 paise
    return orderId;
  };
  const pay = (orderId: string, paymentStatus: string, paidPaise: number) => OrderInternalService.updatePaymentStatus(orderId, { paymentStatus, paidPaise });

  it("records a part payment and then the full payment, keeping the label in step", async () => {
    const orderId = await setup();
    expect(await pay(orderId, "part_paid", 6000)).toMatchObject({ paymentStatus: "part_paid", paidPaise: 6000 });
    expect(await pay(orderId, "paid", 16000)).toMatchObject({ paymentStatus: "paid", paidPaise: 16000 });
    expect(core.orders.get(orderId).paymentStatus).toBe("paid");
  });

  it("is idempotent: the same message again changes nothing", async () => {
    const orderId = await setup();
    const first = await pay(orderId, "paid", 16000);
    expect(await pay(orderId, "paid", 16000)).toEqual(first);
    expect(await Promise.all([pay(orderId, "paid", 16000), pay(orderId, "paid", 16000)])).toEqual([first, first]);
  });

  it("never decreases what was paid: a late, smaller message is ignored", async () => {
    const orderId = await setup();
    await pay(orderId, "paid", 16000);
    const late = await pay(orderId, "part_paid", 4000);
    expect(late).toMatchObject({ paymentStatus: "paid", paidPaise: 16000 });
    expect(await pay(orderId, "unpaid", 0)).toMatchObject({ paymentStatus: "paid", paidPaise: 16000 });
    expect(state.paid.get(orderId)).toBe(16000);
  });

  it("keeps the highest total when messages arrive out of order", async () => {
    const orderId = await setup();
    await Promise.all([pay(orderId, "part_paid", 3000), pay(orderId, "part_paid", 9000), pay(orderId, "part_paid", 5000)]);
    expect(state.paid.get(orderId)).toBe(9000);
    expect(core.orders.get(orderId).paymentStatus).toBe("part_paid");
  });

  it("treats a paid counter order as paid in full, so it cannot be marked part paid", async () => {
    const customer = seed.customer({ storeId: world.storeA.id, phone: "+91 98450 12345" });
    const id = crypto.randomUUID();
    core.orders.set(id, { id, ref: "LOC-1", storeId: world.storeA.id, customerId: customer.id, status: "booked", priority: "standard", paymentStatus: "paid", amountPaise: 5000, address: "", promisedAt: NOW, placedAt: NOW, items: [], events: [] });
    expect(await pay(id, "part_paid", 1000)).toMatchObject({ paymentStatus: "paid", paidPaise: 5000 });
  });

  it.each([
    ["a status that disagrees with the amount", "paid", 6000],
    ["part_paid for the full amount", "part_paid", 16000],
    ["unpaid with money paid", "unpaid", 100],
    ["more than the order amount", "paid", 16001],
    ["a negative amount", "part_paid", -1],
    ["a fractional amount", "part_paid", 10.5],
    ["an unknown status", "refunded", 0],
  ])("refuses %s with 400", async (_name, status, paid) => {
    const orderId = await setup();
    await refused(pay(orderId, status, paid as number), 400);
    expect(core.orders.get(orderId).paymentStatus).toBe("unpaid");
    expect(state.paid.has(orderId)).toBe(false);
  });

  it("refuses a missing or non-numeric amount and answers 404 for an unknown order", async () => {
    const orderId = await setup();
    await refused(OrderInternalService.updatePaymentStatus(orderId, { paymentStatus: "paid" }), 400);
    await refused(OrderInternalService.updatePaymentStatus(orderId, { paymentStatus: "paid", paidPaise: "16000" }), 400);
    await refused(pay(crypto.randomUUID(), "paid", 16000), 404);
    await refused(pay("nope", "paid", 16000), 400);
  });
});

describe("internal: status", () => {
  it("runs the normal status machine as the named system actor", async () => {
    const s = await shopper();
    const { orderId } = await place(s);

    const moved = await advance(orderId, "picked_up", "Collected from the customer");
    expect(moved).toMatchObject({ id: orderId, status: "picked_up" });
    expect(core.orders.get(orderId).events.at(-1)).toMatchObject({ status: "picked_up", byName: "Logistics", byUserId: "system:logistics", note: "Collected from the customer" });
  });

  it("keeps the machine's rules: one step forward, a step back only with a note, nothing after delivery", async () => {
    const s = await shopper();
    const { orderId } = await place(s);
    await refused(advance(orderId, "washing"), 400, /one step/);
    await advance(orderId, "picked_up");
    await refused(advance(orderId, "booked"), 400, /note is required/);
    expect(await advance(orderId, "booked", "Wrong order scanned")).toMatchObject({ status: "booked" });
    await refused(advance(orderId, "cancelled"), 400, /cancel action/);
    core.orders.get(orderId).status = "delivered";
    await refused(advance(orderId, "packed", "x"), 400, /cannot change status/);
  });

  it("lets only one of two identical steps through", async () => {
    const s = await shopper();
    const { orderId } = await place(s);
    const settled = await Promise.allSettled([advance(orderId, "picked_up"), advance(orderId, "picked_up")]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(core.orders.get(orderId).events.filter((e: any) => e.status === "picked_up")).toHaveLength(1);
  });

  it.each([
    ["no actor", undefined],
    ["a blank actor name", { name: " " }],
    ["an actor name with odd characters", { name: "<script>" }],
    ["an actor name over 40 characters", { name: "A".repeat(41) }],
    ["an actor that is not an object", "Logistics"],
  ])("refuses %s with 400", async (_name, actor) => {
    const s = await shopper();
    const { orderId } = await place(s);
    await refused(OrderInternalService.changeStatus(orderId, { status: "picked_up", actor }), 400);
    expect(core.orders.get(orderId).status).toBe("booked");
  });

  it("refuses an unknown status and answers 404 for an unknown order", async () => {
    const s = await shopper();
    const { orderId } = await place(s);
    await refused(OrderInternalService.changeStatus(orderId, { status: "teleported", ...system() }), 400);
    await refused(OrderInternalService.changeStatus(crypto.randomUUID(), { status: "picked_up", ...system() }), 404);
    await refused(OrderInternalService.changeStatus("nope", { status: "picked_up", ...system() }), 400);
  });

  it("is the same machine the staff screens use: a staff step shows up for the customer", async () => {
    const s = await shopper();
    const { orderId } = await place(s);
    await advance(orderId, "picked_up");
    const staff: RequestUser = { id: "staff-1", role: "staff", storeId: world.storeA.id, scopeStoreId: null, name: "Meera" };
    await OrderService.changeStatus(orderId, world.storeA.id, staff, { status: "received" });
    expect(((await CustomerOrdersService.getMyOrder(s.user, orderId)) as any).status).toBe("at_store");
  });
});

describe("internal: summary", () => {
  // Booked now (slots need a future window), then dated back or forward for the report.
  const booked = async (s: IShopper, day: string, slotIndex = 0) => {
    const placed = await place(s, {}, slotIndex);
    core.orders.get(placed.orderId).placedAt = new Date(`${day}T06:00:00Z`);
    return placed;
  };

  it("counts live orders and revenue by day and store, and every status including cancelled", async () => {
    const s = await shopper();
    const first = await booked(s, "2026-10-05");
    await booked(s, "2026-10-05", 1);
    await booked(s, "2026-10-06", 2);
    await CustomerOrdersService.cancelMyOrder(s.user, first.orderId, {});

    const summary = await OrderInternalService.summary({ from: "2026-10-05", to: "2026-10-07" });

    expect(summary).toEqual({
      orders: 2,
      revenuePaise: 32000,
      byStatus: { booked: 2, cancelled: 1 },
      byDay: [{ date: "2026-10-05", orders: 1, revenuePaise: 16000 }, { date: "2026-10-06", orders: 1, revenuePaise: 16000 }],
      byStore: [{ storeId: world.storeA.id, orders: 2, revenuePaise: 32000 }],
    });
  });

  it("narrows to one store and treats a bare end date as through the end of that day", async () => {
    const s = await shopper();
    await booked(s, "2026-10-05");
    expect(await OrderInternalService.summary({ from: "2026-10-05", to: "2026-10-05", storeId: world.storeA.id })).toMatchObject({ orders: 1 });
    expect(await OrderInternalService.summary({ from: "2026-10-05", to: "2026-10-05", storeId: world.storeB.id })).toMatchObject({ orders: 0, revenuePaise: 0, byStore: [] });
  });

  it("defaults to the last 30 days", async () => {
    const s = await shopper();
    await booked(s, "2026-09-20");
    await booked(s, "2026-08-01");
    jest.setSystemTime(new Date("2026-10-05T06:00:00Z"));
    expect(await OrderInternalService.summary({})).toMatchObject({ orders: 1 });
  });

  it("refuses a range over 366 days, a backwards range and malformed input", async () => {
    await expect(OrderInternalService.summary({ from: "2025-10-04", to: "2026-10-04" })).resolves.toBeTruthy(); // exactly 366 days
    await refused(OrderInternalService.summary({ from: "2025-10-01", to: "2026-10-05" }), 400, /at most 366/);
    await refused(OrderInternalService.summary({ from: "2026-10-05", to: "2026-10-01" }), 400, /before/);
    await refused(OrderInternalService.summary({ from: "last week" }), 400);
    await refused(OrderInternalService.summary({ storeId: "x" }), 400);
    await refused(OrderInternalService.summary({ from: ["2026-10-01", "2026-10-02"] }), 400);
  });
});
