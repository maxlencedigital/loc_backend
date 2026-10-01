import { CustomException } from "../../commons/Exception/CustomException.js";
import type { RequestUser } from "../Middleware/Identity.js";

// The Query modules are replaced by in-memory fakes and the gateway lookup is faked; the
// pricing, care rules, slot rules, idempotency and ownership checks below are the real code.
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

import { state as core } from "../Testing/InMemoryCommerce.js";
import { state } from "../Testing/InMemoryCustomerAccount.js";
import { buildWorld, IWorld, signUp } from "../Testing/CustomerAccountWorld.js";
import { garmentTypeIdOf } from "../Utils/GarmentTypeId.js";
import { CustomerOrderingService, MAX_ORDER_PHOTOS } from "./CustomerOrdering.Service.js";
import { CustomerProfileService } from "./CustomerProfile.Service.js";
import { GarmentProfileService } from "./GarmentProfile.Service.js";

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

const shirt = () => garmentTypeIdOf("men", "Shirt");
const washItem = (kg = 2.5, extra: Record<string, unknown> = {}) => ({ garmentTypeId: shirt(), serviceId: world.washFold.id, weightKg: kg, ...extra });
const cleanItem = (quantity = 1, extra: Record<string, unknown> = {}) => ({ garmentTypeId: shirt(), serviceId: world.dryClean.id, quantity, ...extra });

interface IShopper {
  user: RequestUser;
  addressId: string;
}

const shopper = async (city = "Bengaluru"): Promise<IShopper> => {
  const user = signUp();
  const address = (await CustomerProfileService.createAddress(user, { label: "home", line1: "12 MG Road", city, pincode: "560001" })) as any;
  return { user, addressId: address.id };
};

const slotsOn = async (s: IShopper, date = TOMORROW, extra: Record<string, unknown> = {}) =>
  ((await CustomerOrderingService.listPickupSlots(s.user, { addressId: s.addressId, date, ...extra })) as any).items as {
    id: string;
    from: string;
    to: string;
    available: boolean;
  }[];

const place = async (s: IShopper, over: Record<string, unknown> = {}, key?: string) => {
  const slot = (await slotsOn(s))[0]!;
  return (await CustomerOrderingService.placeMyOrder(
    s.user,
    key,
    { addressId: s.addressId, items: [washItem()], pickupSlotId: slot.id, paymentMethod: "online", ...over }
  )) as any;
};

// ---------------------------------------------------------- care questions
describe("care questions", () => {
  it("asks one yes or no question first, to customers only", async () => {
    const asked = (await CustomerOrderingService.getCareQuestions(signUp())) as any;
    expect(asked.questions).toEqual([expect.objectContaining({ id: "delicate", type: "yes_no" })]);
  });

  it("follows up only on a yes, and offers photo and note for a premium item", async () => {
    const user = signUp();
    const plain = (await CustomerOrderingService.evaluateCareAnswers(user, { answers: [{ questionId: "delicate", answer: "no" }] })) as any;
    expect(plain).toMatchObject({ followUps: [], complete: true, offerPhotoAndNote: false });

    const yes = (await CustomerOrderingService.evaluateCareAnswers(user, { answers: [{ questionId: "delicate", answer: "yes" }] })) as any;
    expect(yes.followUps.map((q: any) => q.id)).toEqual(["delicate_kind"]);
    expect(yes.flags.delicate).toBe(true);

    const suit = { garmentTypeId: garmentTypeIdOf("premium", "Suit"), serviceId: world.dryClean.id, quantity: 1 };
    const premium = (await CustomerOrderingService.evaluateCareAnswers(user, { answers: [{ questionId: "delicate", answer: "no" }], items: [suit] })) as any;
    expect(premium.offerPhotoAndNote).toBe(true);
  });

  it("refuses answers that are not selections", async () => {
    const user = signUp();
    await refused(CustomerOrderingService.evaluateCareAnswers(user, { answers: [{ questionId: "delicate", answer: "very old silk" }] }), 400);
    await refused(CustomerOrderingService.evaluateCareAnswers(user, {}), 400);
    await refused(CustomerOrderingService.evaluateCareAnswers(user, { answers: [], items: [{ fabric: "chainmail" }] }), 400);
  });
});

// ---------------------------------------------------------------- catalogue
describe("the catalogue for an address", () => {
  it("lists garment types, services and server prices for the store serving the address", async () => {
    const s = await shopper();
    const catalog = (await CustomerOrderingService.getMyCatalog(s.user, { addressId: s.addressId })) as any;

    expect(catalog.store).toEqual({ id: world.storeA.id, name: "Indiranagar Plant" });
    const men = catalog.categories.find((c: any) => c.name === "Men's");
    expect(men.garmentTypes).toEqual([{ id: shirt(), name: "Shirt", unit: "piece" }]);
    expect(catalog.services.map((x: any) => x.name)).toEqual(["Carpet Clean", "Dry Clean", "Wash & Fold"]);
    expect(catalog.prices).toContainEqual({ serviceId: world.washFold.id, garmentTypeId: shirt(), price: 80, expressPrice: 116 });
  });

  it("chooses the store in the address's city, an explicit store when asked, and refuses one that is not live", async () => {
    const hyderabad = await shopper("Hyderabad");
    expect(((await CustomerOrderingService.getMyCatalog(hyderabad.user, { addressId: hyderabad.addressId })) as any).store.id).toBe(world.storeB.id);

    const s = await shopper();
    expect(((await CustomerOrderingService.getMyCatalog(s.user, { addressId: s.addressId, storeId: world.storeB.id })) as any).store.id).toBe(world.storeB.id);
    core.stores.get(world.storeB.id).status = "closed";
    await refused(CustomerOrderingService.getMyCatalog(s.user, { addressId: s.addressId, storeId: world.storeB.id }), 400, /not taking orders/);
    // A city with no live store falls back to the first live one.
    expect(((await CustomerOrderingService.getMyCatalog(hyderabad.user, { addressId: hyderabad.addressId })) as any).store.id).toBe(world.storeA.id);
  });

  it("does not list a service that is switched off", async () => {
    const s = await shopper();
    core.services.get(world.carpet.id).active = false;
    const catalog = (await CustomerOrderingService.getMyCatalog(s.user, { addressId: s.addressId })) as any;
    expect(catalog.services.map((x: any) => x.name)).not.toContain("Carpet Clean");
    expect(catalog.prices.some((p: any) => p.serviceId === world.carpet.id)).toBe(false);
  });

  it("answers 404 for an address that is not the caller's, and 400 when none is given", async () => {
    const owner = await shopper();
    const stranger = await shopper();
    await refused(CustomerOrderingService.getMyCatalog(stranger.user, { addressId: owner.addressId }), 404);
    await refused(CustomerOrderingService.getMyCatalog(stranger.user, {}), 400);
  });
});

// -------------------------------------------------------------- pickup slots
describe("pickup slots", () => {
  it("lists the store's opening hours as back-to-back windows with free seats", async () => {
    const s = await shopper();
    const slots = await slotsOn(s);

    expect(slots).toHaveLength(7); // 07:00 to 21:00 in two-hour windows
    expect(slots[0]).toMatchObject({ from: "2026-10-06T01:30:00.000Z", to: "2026-10-06T03:30:00.000Z", available: true });
    expect(slots.every((x) => x.available)).toBe(true);
    expect(new Set(slots.map((x) => x.id)).size).toBe(7);
  });

  it("gives the same slot ids on every listing, even when customers list at once", async () => {
    const a = await shopper();
    const b = await shopper();
    const [first, second] = await Promise.all([slotsOn(a), slotsOn(b)]);
    expect(first.map((x) => x.id)).toEqual(second.map((x) => x.id));
    expect(state.slots.size).toBe(7);
  });

  it("closes a window that starts inside the lead time", async () => {
    const s = await shopper();
    const today = await slotsOn(s, "2026-10-05");
    // Now is 09:30 and the lead is two hours: windows from 13:00 on are open, the 11:00 one is not.
    expect(today.map((x) => x.available)).toEqual([false, false, false, true, true, true, true]);
  });

  it("uses a store's own slot rules when it has them", async () => {
    const s = await shopper();
    state.configs.set(world.storeA.id, { slotMinutes: 60, capacityPerSlot: 1, leadMinutes: 0, horizonDays: 2 });
    expect(await slotsOn(s)).toHaveLength(14);
    expect(state.slots.values().next().value.capacity).toBe(1);
    await refused(CustomerOrderingService.listPickupSlots(s.user, { addressId: s.addressId, date: "2026-10-08" }), 400, /2 days ahead/);
  });

  it("has no slots for a store whose opening hours cannot be read", async () => {
    const s = await shopper();
    core.stores.get(world.storeA.id).openingHours = "when we feel like it";
    expect(await slotsOn(s)).toEqual([]);
  });

  it("pages the day's windows", async () => {
    const s = await shopper();
    const page = (await CustomerOrderingService.listPickupSlots(s.user, { addressId: s.addressId, date: TOMORROW, limit: "3", page: "3" })) as any;
    expect(page).toMatchObject({ page: 3, limit: 3, total: 7 });
    expect(page.items).toHaveLength(1);
  });

  it("marks every window unavailable for express while the plant is full", async () => {
    const s = await shopper();
    expect((await slotsOn(s, TOMORROW, { express: "true" })).every((x) => x.available)).toBe(true);
    fillPlant(world.storeA.id);
    expect((await slotsOn(s, TOMORROW, { express: "true" })).some((x) => x.available)).toBe(false);
    expect((await slotsOn(s, TOMORROW)).every((x) => x.available)).toBe(true);
  });

  it.each([
    ["no date", { date: undefined }],
    ["a malformed date", { date: "06/10/2026" }],
    ["yesterday", { date: "2026-10-04" }],
    ["a date past the horizon", { date: "2026-10-13" }],
    ["express that is not true or false", { express: "maybe" }],
    ["no address", { addressId: undefined }],
  ])("rejects %s with 400", async (_name, extra) => {
    const s = await shopper();
    await refused(CustomerOrderingService.listPickupSlots(s.user, { addressId: s.addressId, date: TOMORROW, ...extra }), 400);
  });

  it("answers 404 for someone else's address", async () => {
    const owner = await shopper();
    const stranger = await shopper();
    await refused(CustomerOrderingService.listPickupSlots(stranger.user, { addressId: owner.addressId, date: TOMORROW }), 404);
  });
});

// Open orders weighing 90 kg in a 100 kg store: past the 80 kg express line.
const fillPlant = (storeId: string, grams = 90_000) => {
  const customer = [...core.customers.values()][0] ?? { id: crypto.randomUUID() };
  core.orders.set("filler", { id: "filler", storeId, customerId: customer.id, status: "washing", weightGrams: grams, amountPaise: 0, placedAt: NOW, items: [], events: [] });
};

// ---------------------------------------------------------------- express
describe("express availability", () => {
  it("is available on a quiet day, with staff and rider cover reported as not assessed", async () => {
    const s = await shopper();
    const answer = (await CustomerOrderingService.checkExpressAvailability(s.user, { addressId: s.addressId, items: [washItem(10)] })) as any;
    expect(answer).toEqual({ available: true, constraints: { machine: true, staff: null, rider: null }, reasons: [] });
  });

  it("turns off when the basket would take the plant past 80% and offers a slot at least a day away", async () => {
    const s = await shopper();
    core.orders.set("filler", { id: "filler", storeId: world.storeA.id, customerId: crypto.randomUUID(), status: "booked", weightGrams: 75_000, amountPaise: 0, placedAt: NOW, items: [], events: [] });

    expect(((await CustomerOrderingService.checkExpressAvailability(s.user, { addressId: s.addressId, items: [washItem(5)] })) as any).available).toBe(true);
    const full = (await CustomerOrderingService.checkExpressAvailability(s.user, { addressId: s.addressId, items: [washItem(5.1)] })) as any;
    expect(full.available).toBe(false);
    expect(full.constraints.machine).toBe(false);
    expect(full.reasons[0]).toMatch(/full for today/);
    // Now is Mon 09:30 IST; the first window at least 24 hours on is Tue 11:00 IST.
    expect(full.nextAvailableSlot).toEqual({ from: "2026-10-06T05:30:00.000Z", to: "2026-10-06T07:30:00.000Z" });
  });

  it("ignores finished orders and counts only what the plant still has to do", async () => {
    const s = await shopper();
    fillPlant(world.storeA.id);
    core.orders.get("filler").status = "packed";
    expect(((await CustomerOrderingService.checkExpressAvailability(s.user, { addressId: s.addressId })) as any).available).toBe(true);
  });

  it("checks a given pickup slot's store, and refuses an unknown slot or someone else's address", async () => {
    const s = await shopper();
    fillPlant(world.storeB.id);
    const [slot] = await slotsOn(s, TOMORROW, { storeId: world.storeB.id });
    const viaSlot = (await CustomerOrderingService.checkExpressAvailability(s.user, { addressId: s.addressId, pickupSlotId: slot!.id })) as any;
    expect(viaSlot.available).toBe(false);

    await refused(CustomerOrderingService.checkExpressAvailability(s.user, { addressId: s.addressId, pickupSlotId: crypto.randomUUID() }), 400);
    const stranger = await shopper();
    await refused(CustomerOrderingService.checkExpressAvailability(stranger.user, { addressId: s.addressId }), 404);
    await refused(CustomerOrderingService.checkExpressAvailability(s.user, {}), 400);
  });
});

// ------------------------------------------------------------- price quote
describe("the price quote", () => {
  it("prices every line from the price list and totals in rupees", async () => {
    const s = await shopper();
    const quote = (await CustomerOrderingService.getPriceQuote(s.user, { addressId: s.addressId, items: [washItem(2.5), cleanItem(3)] })) as any;

    expect(quote.lines).toEqual([
      { garmentTypeId: shirt(), serviceId: world.washFold.id, quantity: 2.5, amount: 200 },
      { garmentTypeId: shirt(), serviceId: world.dryClean.id, quantity: 3, amount: 360 },
    ]);
    expect(quote).toMatchObject({ subtotal: 560, discount: 0, expressSurcharge: 0, tax: 0, total: 560 });
  });

  it("shows the express surcharge separately and never reads a price from the request", async () => {
    const s = await shopper();
    const quote = (await CustomerOrderingService.getPriceQuote(s.user, {
      addressId: s.addressId,
      express: true,
      items: [washItem(2, { price: 1, amount: 1, rate: 1 })],
      total: 1,
    })) as any;
    expect(quote).toMatchObject({ subtotal: 160, expressSurcharge: 72, total: 232 });
    expect(quote.lines[0].amount).toBe(232);
  });

  it.each([
    ["a coupon code", () => ({ couponCode: "SAVE10" }), /Coupon codes are not available/],
    ["a package", () => ({ customerPackageId: crypto.randomUUID() }), /Packages are not available/],
    ["express that is not a boolean", () => ({ express: "yes" }), /express/],
    ["no items", () => ({ items: [] }), /at least one item/],
    ["items that are not a list", () => ({ items: "shirt" }), /at least one item/],
    ["a garment type we do not sell", () => ({ items: [washItem(1, { garmentTypeId: garmentTypeIdOf("men", "Spacesuit") })] }), /garmentTypeId/],
    ["an unknown service", () => ({ items: [washItem(1, { serviceId: crypto.randomUUID() })] }), /unknown service/],
    ["a by-weight service with no weight", () => ({ items: [{ garmentTypeId: shirt(), serviceId: world.washFold.id, quantity: 2 }] }), /weightKg is required/],
    ["a per-piece service with no quantity", () => ({ items: [{ garmentTypeId: shirt(), serviceId: world.dryClean.id, weightKg: 2 }] }), /quantity is required/],
    ["a fractional piece quantity", () => ({ items: [cleanItem(1.5)] }), /whole number/],
    ["zero weight", () => ({ items: [washItem(0)] }), /greater than zero/],
    ["an unknown fabric", () => ({ items: [washItem(1, { fabric: "chainmail" })] }), /fabric/],
    ["express for a service without express", () => ({ express: true, items: [{ garmentTypeId: garmentTypeIdOf("household", "Rug"), serviceId: world.carpet.id, quantity: 1 }] }), /not available as express/],
    ["more than fifty items", () => ({ items: Array.from({ length: 51 }, () => washItem(1)) }), /at most 50/],
  ])("refuses %s with 400", async (_name, extra, message) => {
    const s = await shopper();
    await refused(CustomerOrderingService.getPriceQuote(s.user, { addressId: s.addressId, items: [washItem()], ...extra() }), 400, message);
  });
});

// ---------------------------------------------------------------- placing
describe("placing an order", () => {
  it("books the order at server prices, reserves the slot and records the app details", async () => {
    const s = await shopper();
    const slot = (await slotsOn(s))[0]!;
    const result = await place(s, { items: [washItem(2.5, { fabric: "cotton", note: "no starch" }), cleanItem(3)], price: 1, total: 1 });

    expect(result).toMatchObject({ orderNumber: "LOC-24800", status: "pickup_scheduled", amountDue: 560, paymentRequired: true });
    const order = core.orders.get(result.orderId);
    expect(order).toMatchObject({ channel: "app", paymentStatus: "unpaid", amountPaise: 56000, storeId: world.storeA.id, priority: "standard", address: "12 MG Road, Bengaluru 560001" });
    expect(order.events).toEqual([expect.objectContaining({ status: "booked", byName: "Ana Rao" })]);
    // Standard service is promised 48 hours after the pickup window closes.
    expect(order.promisedAt.toISOString()).toBe("2026-10-08T03:30:00.000Z");

    expect(state.slots.get(slot.id).booked).toBe(1);
    expect(state.exts.get(result.orderId)).toMatchObject({ pickupSlotId: slot.id, pickupFrom: new Date(slot.from), paymentMethod: "online", pickupAddress: "12 MG Road, Bengaluru 560001" });
    expect([...state.lines.values()].map((l) => [l.fabric, l.note])).toEqual([["cotton", "no starch"], ["unknown", ""]]);
    expect([...core.customers.values()][0]).toMatchObject({ orderCount: 1, lifetimeValuePaise: 56000 });
  });

  it("asks for no online payment when the customer pays on delivery", async () => {
    const s = await shopper();
    expect(await place(s, { paymentMethod: "cash_on_delivery" })).toMatchObject({ paymentRequired: false, amountDue: 200 });
  });

  it("delivers to a second address when one is chosen, and to the pickup address otherwise", async () => {
    const s = await shopper();
    const office = (await CustomerProfileService.createAddress(s.user, { label: "office", line1: "Tech Park", city: "Bengaluru", pincode: "560037" })) as any;
    const same = await place(s);
    const other = await place(s, { deliveryAddressId: office.id });
    expect(state.exts.get(same.orderId).deliveryAddress).toBe("12 MG Road, Bengaluru 560001");
    expect(state.exts.get(other.orderId)).toMatchObject({ deliveryAddress: "Tech Park, Bengaluru 560037", pickupAddress: "12 MG Road, Bengaluru 560001" });
  });

  it("derives the care profile from the answers, fabrics and note", async () => {
    const s = await shopper();
    const result = await place(s, {
      items: [washItem(1, { fabric: "silk" })],
      careAnswers: [{ questionId: "delicate", answer: "yes" }, { questionId: "delicate_kind", answer: "Silk or fine fabric" }, { questionId: "wash_preference", answer: "Cold wash" }],
      careNotes: "Please be gentle",
    });
    expect(core.orders.get(result.orderId).care).toMatchObject({
      fabric: "silk",
      riskClass: "high",
      flags: ["Delicate", "Cold wash only"],
      customerNote: "Please be gentle",
      recommendedWash: "Cold wash 20°C",
    });
  });

  it("promises express in 24 hours and prices it at the express rate", async () => {
    const s = await shopper();
    const result = await place(s, { express: true });
    const order = core.orders.get(result.orderId);
    expect(order).toMatchObject({ priority: "express", amountPaise: 29000 });
    expect(order.promisedAt.toISOString()).toBe("2026-10-07T03:30:00.000Z");
  });

  it("refuses express with 409 when the plant has filled up since the customer looked", async () => {
    const s = await shopper();
    fillPlant(world.storeA.id);
    await refused(place(s, { express: true }), 409, /Express is no longer available/);
    expect(core.orders.size).toBe(1); // only the filler
  });

  it.each([
    ["a coupon code", { couponCode: "SAVE10" }, 400],
    ["a package", { customerPackageId: crypto.randomUUID() }, 400],
    ["the package payment method", { paymentMethod: "package" }, 400],
    ["an unknown payment method", { paymentMethod: "barter" }, 400],
    ["no payment method", { paymentMethod: undefined }, 400],
    ["no items", { items: [] }, 400],
    ["express as text", { express: "yes" }, 400],
    ["a slot id that is not a uuid", { pickupSlotId: "soon" }, 400],
    ["a slot that does not exist", { pickupSlotId: crypto.randomUUID() }, 400],
    ["free-text care answers", { careAnswers: [{ questionId: "delicate", answer: "yes please" }] }, 400],
    ["care notes over 300 characters", { careNotes: "x".repeat(301) }, 400],
  ])("refuses %s", async (_name, extra, status) => {
    const s = await shopper();
    await refused(place(s, extra), status);
    expect(core.orders.size).toBe(0);
    expect([...state.slots.values()].every((x) => x.booked === 0)).toBe(true);
  });

  it("refuses an address that is not the caller's with 404", async () => {
    const owner = await shopper();
    const stranger = await shopper();
    await refused(place(stranger, { addressId: owner.addressId }), 404);
    await refused(place(stranger, { deliveryAddressId: owner.addressId }), 404);
    expect(core.orders.size).toBe(0);
  });

  it("refuses a garment profile that is not the caller's with 404", async () => {
    const owner = await shopper();
    const stranger = await shopper();
    const theirs = (await GarmentProfileService.create(owner.user, { name: "Theirs" })) as any;
    await refused(place(stranger, { items: [washItem(1, { garmentProfileId: theirs.id })] }), 404, /Garment profile/);
    expect(core.orders.size).toBe(0);
  });

  it("refuses a slot inside the lead time, a store that closed and an inactive service", async () => {
    const s = await shopper();
    const tooSoon = (await slotsOn(s, "2026-10-05"))[0]!;
    await refused(place(s, { pickupSlotId: tooSoon.id }), 409, /no longer available/);

    const [slot] = await slotsOn(s);
    core.stores.get(world.storeA.id).status = "closed";
    await refused(place(s, { pickupSlotId: slot!.id }), 409, /not taking orders/);
    core.stores.get(world.storeA.id).status = "live";
    core.services.get(world.washFold.id).active = false;
    await refused(place(s, { pickupSlotId: slot!.id }), 400, /not currently offered/);
    expect(core.orders.size).toBe(0);
  });

  it("books at the slot's store, not the address's", async () => {
    const s = await shopper("Hyderabad");
    const [slot] = await slotsOn(s, TOMORROW, { storeId: world.storeA.id });
    const result = await place(s, { pickupSlotId: slot!.id });
    expect(core.orders.get(result.orderId).storeId).toBe(world.storeA.id);
  });

  describe("the last seat in a slot", () => {
    it("goes to one customer only, however many ask at once", async () => {
      state.configs.set(world.storeA.id, { slotMinutes: 120, capacityPerSlot: 2, leadMinutes: 0, horizonDays: 7 });
      const shoppers = await Promise.all(Array.from({ length: 6 }, () => shopper()));
      const slot = (await slotsOn(shoppers[0]!))[0]!;

      const settled = await Promise.allSettled(
        shoppers.map((s) => CustomerOrderingService.placeMyOrder(s.user, undefined, { addressId: s.addressId, items: [washItem()], pickupSlotId: slot.id, paymentMethod: "online" }))
      );

      expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(2);
      const losers = settled.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(losers.every((l) => (l.reason as CustomException).errorCode === 409)).toBe(true);
      expect(state.slots.get(slot.id).booked).toBe(2);
      expect(core.orders.size).toBe(2);
    });

    it("is refused with 409 once the slot is full", async () => {
      state.configs.set(world.storeA.id, { slotMinutes: 120, capacityPerSlot: 1, leadMinutes: 0, horizonDays: 7 });
      const a = await shopper();
      const b = await shopper();
      const [slot] = await slotsOn(a);
      await place(a, { pickupSlotId: slot!.id });
      await refused(place(b, { pickupSlotId: slot!.id }), 409, /no longer available/);
      expect((await slotsOn(b))[0]!.available).toBe(false);
    });
  });

  describe("idempotency", () => {
    it("returns the original order when the same key is sent again", async () => {
      const s = await shopper();
      const first = await place(s, {}, "retry-key-0001");
      const again = await place(s, {}, "retry-key-0001");

      expect(again).toEqual(first);
      expect(core.orders.size).toBe(1);
      expect([...state.slots.values()].reduce((sum, x) => sum + x.booked, 0)).toBe(1);
      expect([...core.customers.values()][0].orderCount).toBe(1);
    });

    it("books once when the same key arrives several times at once", async () => {
      const s = await shopper();
      const slot = (await slotsOn(s))[0]!;
      const body = { addressId: s.addressId, items: [washItem()], pickupSlotId: slot.id, paymentMethod: "online" };
      const results = (await Promise.all(Array.from({ length: 5 }, () => CustomerOrderingService.placeMyOrder(s.user, "double-tap-0001", body)))) as any[];

      expect(new Set(results.map((r) => r.orderId)).size).toBe(1);
      expect(core.orders.size).toBe(1);
      expect(state.slots.get(slot.id).booked).toBe(1);
    });

    it("scopes a key to its customer and treats no key as a new order each time", async () => {
      const a = await shopper();
      const b = await shopper();
      const one = await place(a, {}, "shared-key-0001");
      const two = await place(b, {}, "shared-key-0001");
      expect(one.orderId).not.toBe(two.orderId);

      await place(a);
      await place(a);
      expect(core.orders.size).toBe(4);
    });

    it.each(["short", "has spaces in it!", "x".repeat(101)])("refuses the key %p with 400", async (key) => {
      const s = await shopper();
      await refused(place(s, {}, key), 400, /Idempotency-Key/);
    });
  });

  it("links a garment profile to the order, so its history shows the visit", async () => {
    const s = await shopper();
    const profile = (await GarmentProfileService.create(s.user, { name: "My shirt" })) as any;
    const result = await place(s, { items: [washItem(1, { garmentProfileId: profile.id, note: "collar stain" })] });

    const history = (await GarmentProfileService.history(s.user, profile.id)) as any;
    expect(history.visits).toEqual([
      { orderId: result.orderId, storeId: world.storeA.id, storeName: "Indiranagar Plant", date: "2026-10-05", service: "Wash & Fold", careNotes: "collar stain" },
    ]);
    core.orders.get(result.orderId).status = "cancelled";
    expect(((await GarmentProfileService.history(s.user, profile.id)) as any).visits).toEqual([]);
  });
});

// ------------------------------------------------------------ order photos
describe("order photos", () => {
  const photo = (n: number, extra: Record<string, unknown> = {}) => ({ url: `https://img.example.com/stain-${n}.jpg`, note: "stain", ...extra });

  it("keeps https references, optionally tied to an item of the order", async () => {
    const s = await shopper();
    const { orderId } = await place(s);
    const itemId = core.orders.get(orderId).items[0].id;

    const added = (await CustomerOrderingService.uploadMyOrderPhotos(s.user, orderId, { photos: [photo(1, { itemId }), photo(2)] })) as any;
    expect(added.total).toBe(2);
    expect(added.photos).toEqual([expect.objectContaining({ url: "https://img.example.com/stain-1.jpg", itemId }), expect.objectContaining({ itemId: null })]);
  });

  it.each([
    ["no photos", { photos: [] }],
    ["photos that are not a list", { photos: "x" }],
    ["more than five in one call", { photos: Array.from({ length: 6 }, (_, i) => photo(i)) }],
    ["an http link", { photos: [{ url: "http://img.example.com/a.jpg" }] }],
    ["a link to localhost", { photos: [{ url: "https://localhost/a.jpg" }] }],
    ["an item that is not an item of the order", { photos: [photo(1, { itemId: crypto.randomUUID() })] }],
    ["an itemId that is not a uuid", { photos: [photo(1, { itemId: "x" })] }],
    ["a note over 200 characters", { photos: [photo(1, { note: "x".repeat(201) })] }],
  ])("refuses %s with 400", async (_name, body) => {
    const s = await shopper();
    const { orderId } = await place(s);
    await refused(CustomerOrderingService.uploadMyOrderPhotos(s.user, orderId, body), 400);
    expect(state.photos.size).toBe(0);
  });

  it("allows at most five per order, even when uploaded at once", async () => {
    const s = await shopper();
    const { orderId } = await place(s);
    const settled = await Promise.allSettled(Array.from({ length: MAX_ORDER_PHOTOS + 2 }, (_, i) => CustomerOrderingService.uploadMyOrderPhotos(s.user, orderId, { photos: [photo(i)] })));

    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(MAX_ORDER_PHOTOS);
    expect(state.photos.size).toBe(MAX_ORDER_PHOTOS);
    expect(((settled.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as CustomException).errorCode).toBe(409);
  });

  it("is refused for a delivered or cancelled order, and answered 404 for someone else's", async () => {
    const s = await shopper();
    const stranger = await shopper();
    const { orderId } = await place(s);

    await refused(CustomerOrderingService.uploadMyOrderPhotos(stranger.user, orderId, { photos: [photo(1)] }), 404);
    await refused(CustomerOrderingService.uploadMyOrderPhotos(s.user, "not-a-uuid", { photos: [photo(1)] }), 404);
    core.orders.get(orderId).status = "delivered";
    await refused(CustomerOrderingService.uploadMyOrderPhotos(s.user, orderId, { photos: [photo(1)] }), 409, /delivered/);
    expect(state.photos.size).toBe(0);
  });
});
