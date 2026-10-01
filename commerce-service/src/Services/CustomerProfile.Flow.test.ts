import { CustomException } from "../../commons/Exception/CustomException.js";
import type { RequestUser } from "../Middleware/Identity.js";

// The Query modules are replaced by in-memory fakes and the gateway lookup is faked; every
// service, validation rule and ownership check below is the real code.
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
import { gateway, state } from "../Testing/InMemoryCustomerAccount.js";
import { asRole, buildWorld, IWorld, signUp } from "../Testing/CustomerAccountWorld.js";
import { CustomerOrderingService } from "./CustomerOrdering.Service.js";
import { CustomerOrdersService } from "./CustomerOrders.Service.js";
import { CustomerProfileService, MAX_ADDRESSES } from "./CustomerProfile.Service.js";
import { GarmentProfileService, MAX_GARMENT_PHOTOS } from "./GarmentProfile.Service.js";
import { garmentTypeIdOf } from "../Utils/GarmentTypeId.js";

let world: IWorld;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  world = buildWorld();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

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

const home = { label: "home", line1: "12 MG Road", city: "Bengaluru", pincode: "560001" };
const addAddress = (user: RequestUser, extra: Record<string, unknown> = {}) =>
  CustomerProfileService.createAddress(user, { ...home, ...extra });

// ------------------------------------------------------------ the account
describe("the customer account", () => {
  it("is created on the first call from the gateway account and the core Customer in the default store", async () => {
    const user = signUp({ name: "Ana Rao", email: "Ana@Example.com", phoneNumber: "+919845012345" });
    const profile = await CustomerProfileService.getProfile(user);

    expect(profile).toMatchObject({ name: "Ana Rao", phone: "+919845012345", email: "ana@example.com", defaultAddressId: null, profileComplete: false });
    const customer = [...core.customers.values()][0];
    expect(customer).toMatchObject({ phone: "+91 98450 12345", storeId: world.storeA.id, type: "retail" });
    expect(state.profiles.size).toBe(1);
  });

  it("asks the gateway only once per account", async () => {
    const user = signUp();
    await CustomerProfileService.getProfile(user);
    await CustomerProfileService.getProfile(user);
    await CustomerProfileService.listAddresses(user, {});
    expect(gateway.calls).toBe(1);
  });

  it("links the customer the store already has for that phone and keeps the name the store recorded", async () => {
    const walkIn = seed.customer({ storeId: world.storeB.id, phone: "+91 98450 12345", name: "A. Rao (walk-in)", email: "" });
    const user = signUp({ name: "Ana Rao", email: "ana@example.com", phoneNumber: "+919845012345" });

    const profile = await CustomerProfileService.getProfile(user);

    expect(core.customers.size).toBe(1);
    expect(state.profiles.get(profile.id).customerId).toBe(walkIn.id);
    expect(profile.name).toBe("A. Rao (walk-in)");
    expect(profile.email).toBe("ana@example.com"); // filled in because the store had none
  });

  it("never duplicates under concurrent first requests", async () => {
    const user = signUp();
    const results = await Promise.all(Array.from({ length: 6 }, () => CustomerProfileService.getProfile(user)));

    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(state.profiles.size).toBe(1);
    expect(core.customers.size).toBe(1);
  });

  it("never duplicates the core customer when two different accounts start at once", async () => {
    const a = signUp({ phoneNumber: "+919845055555" });
    const b = signUp({ phoneNumber: "+919845055555" });
    const settled = await Promise.allSettled([CustomerProfileService.getProfile(a), CustomerProfileService.getProfile(b)]);

    expect(core.customers.size).toBe(1);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const lost = settled.find((s) => s.status === "rejected") as PromiseRejectedResult;
    expect((lost.reason as CustomException).errorCode).toBe(409);
  });

  it.each([
    ["admin", "admin"],
    ["manager", "manager"],
    ["staff", "staff"],
    ["super_admin", "super_admin"],
    ["driver", "driver"],
    ["hr", "hr"],
  ] as const)("is refused to a %s even where the route guard lets them through", async (_name, role) => {
    const user = asRole(role, world.storeA.id);
    await refused(CustomerProfileService.getProfile(user), 403, /Only customers/);
    await refused(CustomerProfileService.listAddresses(user, {}), 403);
    await refused(GarmentProfileService.list(user, {}), 403);
    await refused(CustomerOrdersService.listMyOrders(user, {}), 403);
    await refused(CustomerOrderingService.getCareQuestions(user), 403);
    expect(gateway.calls).toBe(0);
    expect(state.profiles.size).toBe(0);
  });

  it("is refused when the gateway says the account is inactive or not a customer", async () => {
    await refused(CustomerProfileService.getProfile(signUp({ isActive: false })), 403);
    await refused(CustomerProfileService.getProfile(signUp({ role: "staff" })), 403);
    // The identity says customer but the gateway disagrees.
    const liar = signUp({ role: "staff" });
    await refused(CustomerProfileService.getProfile({ ...liar, role: "customer" }), 403);
    expect(state.profiles.size).toBe(0);
  });

  it("explains an account with no usable mobile number", async () => {
    await refused(CustomerProfileService.getProfile(signUp({ phoneNumber: null })), 400, /mobile number/);
    await refused(CustomerProfileService.getProfile(signUp({ phoneNumber: "12345" })), 400, /mobile number/);
    expect(core.customers.size).toBe(0);
  });

  it("answers 403 for an account the gateway does not know, and 503 when the gateway is down", async () => {
    await refused(CustomerProfileService.getProfile({ ...signUp(), id: crypto.randomUUID() }), 403, /could not be found/);
    gateway.failWith = new CustomException("A connected service is unavailable right now. Please try again.", 503);
    await refused(CustomerProfileService.getProfile(signUp()), 503);
    expect(state.profiles.size).toBe(0);
  });

  it("says so when no store is live to hold the customer", async () => {
    core.stores.clear();
    await refused(CustomerProfileService.getProfile(signUp()), 503, /No store/);
  });
});

// ------------------------------------------------------------- the profile
describe("the profile", () => {
  it("is complete only with a name, an email and a default address", async () => {
    const user = signUp();
    expect((await CustomerProfileService.getProfile(user)).profileComplete).toBe(false);
    await addAddress(user);
    expect(await CustomerProfileService.getProfile(user)).toMatchObject({ profileComplete: true });
  });

  it("updates name and email on the core customer, so the staff screens show them too", async () => {
    const user = signUp();
    const updated = await CustomerProfileService.updateProfile(user, { name: "  Ana Rao-Iyer ", email: "NEW@Example.com" });

    expect(updated).toMatchObject({ name: "Ana Rao-Iyer", email: "new@example.com" });
    expect([...core.customers.values()][0]).toMatchObject({ name: "Ana Rao-Iyer", email: "new@example.com" });
  });

  it("changes the default address only to one of the caller's own", async () => {
    const user = signUp();
    const first = await addAddress(user);
    const second = await addAddress(user, { label: "office", line1: "Tech Park" });
    expect((await CustomerProfileService.updateProfile(user, { defaultAddressId: second.id })).defaultAddressId).toBe(second.id);
    expect(first.isDefault).toBe(true);

    const stranger = signUp();
    const theirs = await addAddress(stranger);
    await refused(CustomerProfileService.updateProfile(user, { defaultAddressId: theirs.id }), 404);
    await refused(CustomerProfileService.updateProfile(user, { defaultAddressId: "nope" }), 404);
  });

  it.each([
    ["a blank name", { name: "  " }],
    ["a name over 80 characters", { name: "x".repeat(81) }],
    ["a malformed email", { email: "not-an-email" }],
    ["an email over 120 characters", { email: `${"a".repeat(120)}@example.com` }],
    ["a phone change", { phone: "+919999999999" }],
  ])("rejects %s with 400", async (_name, body) => {
    const user = signUp();
    await refused(CustomerProfileService.updateProfile(user, body), 400);
  });

  it("does not take the id, phone or customer link from the request", async () => {
    const user = signUp({ phoneNumber: "+919845012346" });
    const before = await CustomerProfileService.getProfile(user);
    await CustomerProfileService.updateProfile(user, { id: crypto.randomUUID(), customerId: crypto.randomUUID(), userId: crypto.randomUUID(), orderCount: 99 });
    expect(await CustomerProfileService.getProfile(user)).toEqual(before);
    expect([...core.customers.values()][0].orderCount).toBe(0);
  });
});

// --------------------------------------------------------------- addresses
describe("addresses", () => {
  it("saves, reads, changes and deletes an address", async () => {
    const user = signUp();
    const created = await addAddress(user, { line2: "Flat 4B", landmark: "Near the metro", latitude: 12.97, longitude: 77.59 });
    expect(created).toMatchObject({ label: "home", line1: "12 MG Road", line2: "Flat 4B", landmark: "Near the metro", city: "Bengaluru", pincode: "560001", latitude: 12.97, longitude: 77.59, isDefault: true });

    expect(await CustomerProfileService.getAddress(user, created.id)).toEqual(created);
    const changed = await CustomerProfileService.updateAddress(user, created.id, { line1: "14 MG Road", label: "office" });
    expect(changed).toMatchObject({ line1: "14 MG Road", label: "office", line2: "Flat 4B", pincode: "560001" });

    expect(await CustomerProfileService.deleteAddress(user, created.id)).toBeNull();
    await refused(CustomerProfileService.getAddress(user, created.id), 404);
  });

  it("makes the first address the default and hands the role on when the default is deleted", async () => {
    const user = signUp();
    const first = await addAddress(user);
    const second = await addAddress(user, { line1: "Second" });
    const third = await addAddress(user, { line1: "Third" });
    expect([first.isDefault, second.isDefault, third.isDefault]).toEqual([true, false, false]);

    await CustomerProfileService.deleteAddress(user, first.id);
    expect((await CustomerProfileService.getProfile(user)).defaultAddressId).toBe(third.id); // newest left

    await CustomerProfileService.deleteAddress(user, third.id);
    await CustomerProfileService.deleteAddress(user, second.id);
    expect((await CustomerProfileService.getProfile(user)).defaultAddressId).toBeNull();
  });

  it("pages the list, newest first, and caps the page size", async () => {
    const user = signUp();
    for (let i = 1; i <= 5; i += 1) await addAddress(user, { line1: `Address ${i}` });

    const first = (await CustomerProfileService.listAddresses(user, { page: "1", limit: "2" })) as any;
    expect(first).toMatchObject({ page: 1, limit: 2, total: 5 });
    expect(first.items.map((a: any) => a.line1)).toEqual(["Address 5", "Address 4"]);
    const last = (await CustomerProfileService.listAddresses(user, { page: "3", limit: "2" })) as any;
    expect(last.items.map((a: any) => a.line1)).toEqual(["Address 1"]);
    expect(((await CustomerProfileService.listAddresses(user, { limit: "5000" })) as any).limit).toBe(100);
    expect(((await CustomerProfileService.listAddresses(user, {})) as any).limit).toBe(20);
    await refused(CustomerProfileService.listAddresses(user, { page: "0" }), 400);
    await refused(CustomerProfileService.listAddresses(user, { limit: "abc" }), 400);
  });

  it("stops at the cap even when many are added at once", async () => {
    const user = signUp();
    const settled = await Promise.allSettled(Array.from({ length: MAX_ADDRESSES + 5 }, (_, i) => addAddress(user, { line1: `Address ${i}` })));

    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(MAX_ADDRESSES);
    expect(((await CustomerProfileService.listAddresses(user, {})) as any).total).toBe(MAX_ADDRESSES);
    const refusal = settled.find((s) => s.status === "rejected") as PromiseRejectedResult;
    expect((refusal.reason as CustomException).errorCode).toBe(409);
  });

  it.each([
    ["no line1", { line1: undefined }],
    ["no city", { city: undefined }],
    ["no pincode", { pincode: undefined }],
    ["no label", { label: undefined }],
    ["an unknown label", { label: "castle" }],
    ["a pincode of the wrong length", { pincode: "5600" }],
    ["a pincode starting with 0", { pincode: "060001" }],
    ["a pincode with letters", { pincode: "56A001" }],
    ["a line1 over 120 characters", { line1: "x".repeat(121) }],
    ["a latitude out of range", { latitude: 91, longitude: 77 }],
    ["a longitude out of range", { latitude: 12, longitude: 181 }],
    ["a latitude without a longitude", { latitude: 12 }],
    ["a coordinate that is not a number", { latitude: "12", longitude: "77" }],
  ])("rejects an address with %s", async (_name, extra) => {
    const user = signUp();
    await refused(CustomerProfileService.createAddress(user, { ...home, ...extra }), 400);
    expect(state.addresses.size).toBe(0);
  });

  it("changes only the whitelisted fields and revalidates what it is given", async () => {
    const user = signUp();
    const created = await addAddress(user, { latitude: 12, longitude: 77 });
    const other = signUp();
    await CustomerProfileService.getProfile(other);

    await CustomerProfileService.updateAddress(user, created.id, { id: crypto.randomUUID(), customerId: [...state.profiles.values()][1].customerId, createdAt: "2000-01-01" });
    const stored = state.addresses.get(created.id);
    expect(stored.id).toBe(created.id);
    expect(stored.customerId).toBe([...state.profiles.values()][0].customerId);
    expect(stored.createdAt.getFullYear()).toBeGreaterThan(2000);

    await refused(CustomerProfileService.updateAddress(user, created.id, { pincode: "1" }), 400);
    await refused(CustomerProfileService.updateAddress(user, created.id, { latitude: null }), 400); // longitude would be left alone
    expect(await CustomerProfileService.updateAddress(user, created.id, { latitude: null, longitude: null })).toMatchObject({ latitude: null, longitude: null });
  });

  it("is invisible to everyone else: another customer gets 404 to read, change or delete it", async () => {
    const owner = signUp();
    const intruder = signUp();
    const mine = await addAddress(owner);
    await addAddress(intruder, { line1: "Intruder's own" });

    await refused(CustomerProfileService.getAddress(intruder, mine.id), 404);
    await refused(CustomerProfileService.updateAddress(intruder, mine.id, { line1: "hijacked" }), 404);
    await refused(CustomerProfileService.deleteAddress(intruder, mine.id), 404);
    await refused(CustomerProfileService.getAddress(intruder, "not-a-uuid"), 404);
    const theirs = (await CustomerProfileService.listAddresses(intruder, {})) as any;
    expect(theirs.items.map((a: any) => a.line1)).toEqual(["Intruder's own"]);
    expect(state.addresses.get(mine.id).line1).toBe("12 MG Road");
  });
});

// -------------------------------------------------------- garment profiles
describe("garment profiles", () => {
  const suit = { name: "My navy suit", fabric: "wool", colour: "navy", brand: "Raymond", washInstructions: ["Dry clean only"], avoid: ["No tumble dry"], notes: "Loose button on the left cuff" };

  it("saves, reads, changes and deletes a profile", async () => {
    const user = signUp();
    const created = (await GarmentProfileService.create(user, suit)) as any;
    expect(created).toMatchObject({ ...suit, garmentTypeId: null, isFavourite: false, photos: [] });

    expect(await GarmentProfileService.get(user, created.id)).toEqual(created);
    const changed = (await GarmentProfileService.update(user, created.id, { isFavourite: true, notes: "" })) as any;
    expect(changed).toMatchObject({ isFavourite: true, notes: "", name: "My navy suit", fabric: "wool" });

    expect(await GarmentProfileService.remove(user, created.id)).toBeNull();
    await refused(GarmentProfileService.get(user, created.id), 404);
  });

  it("defaults the optional fields", async () => {
    const created = (await GarmentProfileService.create(signUp(), { name: "Gym kit" })) as any;
    expect(created).toMatchObject({ fabric: "unknown", colour: "", brand: "", washInstructions: [], avoid: [], notes: "", isFavourite: false });
  });

  it("lists favourites first, then newest, with paging", async () => {
    const user = signUp();
    await GarmentProfileService.create(user, { name: "Old" });
    await GarmentProfileService.create(user, { name: "Favourite", isFavourite: true });
    await GarmentProfileService.create(user, { name: "New" });

    const page = (await GarmentProfileService.list(user, { limit: "2" })) as any;
    expect(page.items.map((p: any) => p.name)).toEqual(["Favourite", "New"]);
    expect(page.total).toBe(3);
    expect(((await GarmentProfileService.list(user, { page: "2", limit: "2" })) as any).items.map((p: any) => p.name)).toEqual(["Old"]);
  });

  it("accepts a garment type we handle and refuses one we do not", async () => {
    const user = signUp();
    const shirt = garmentTypeIdOf("men", "shirt");
    expect(garmentTypeIdOf("men", "Shirt")).toBe(shirt); // case does not matter
    expect(((await GarmentProfileService.create(user, { name: "Shirt", garmentTypeId: shirt })) as any).garmentTypeId).toBe(shirt);
    await refused(GarmentProfileService.create(user, { name: "Alien", garmentTypeId: garmentTypeIdOf("men", "Spacesuit") }), 400, /not a garment we handle/);
    await refused(GarmentProfileService.create(user, { name: "Bad", garmentTypeId: "x" }), 400);
  });

  it.each([
    ["no name", { name: undefined }],
    ["a blank name", { name: " " }],
    ["a name over 80 characters", { name: "x".repeat(81) }],
    ["an unknown fabric", { fabric: "chainmail" }],
    ["more than ten wash instructions", { washInstructions: Array.from({ length: 11 }, () => "x") }],
    ["a wash instruction that is not text", { washInstructions: [5] }],
    ["avoid that is not a list", { avoid: "tumble" }],
    ["notes over 300 characters", { notes: "x".repeat(301) }],
    ["isFavourite as text", { isFavourite: "yes" }],
  ])("rejects a profile with %s", async (_name, extra) => {
    await refused(GarmentProfileService.create(signUp(), { name: "ok", ...extra }), 400);
    expect(state.garments.size).toBe(0);
  });

  it("changes only the whitelisted fields", async () => {
    const user = signUp();
    const created = (await GarmentProfileService.create(user, { name: "Shirt" })) as any;
    const stranger = signUp();
    await CustomerProfileService.getProfile(stranger);
    await GarmentProfileService.update(user, created.id, { customerId: [...state.profiles.values()][1].customerId, id: crypto.randomUUID() });
    expect(state.garments.get(created.id).customerId).toBe([...state.profiles.values()][0].customerId);
  });

  it("is invisible to everyone else, including its history and photo", async () => {
    const owner = signUp();
    const intruder = signUp();
    const mine = (await GarmentProfileService.create(owner, suit)) as any;

    await refused(GarmentProfileService.get(intruder, mine.id), 404);
    await refused(GarmentProfileService.update(intruder, mine.id, { name: "hijacked" }), 404);
    await refused(GarmentProfileService.remove(intruder, mine.id), 404);
    await refused(GarmentProfileService.history(intruder, mine.id), 404);
    await refused(GarmentProfileService.addPhoto(intruder, mine.id, { url: "https://img.example.com/a.jpg" }), 404);
    await refused(GarmentProfileService.get(intruder, "not-a-uuid"), 404);
    expect(((await GarmentProfileService.list(intruder, {})) as any).total).toBe(0);
    expect(state.garments.get(mine.id).name).toBe("My navy suit");
  });

  describe("photos", () => {
    const photo = (n: number) => ({ url: `https://img.example.com/suit-${n}.jpg`, note: "left cuff" });

    it("keeps a reference to an https image and shows it on the profile", async () => {
      const user = signUp();
      const profile = (await GarmentProfileService.create(user, suit)) as any;
      const added = (await GarmentProfileService.addPhoto(user, profile.id, photo(1))) as any;

      expect(added).toMatchObject({ url: "https://img.example.com/suit-1.jpg", note: "left cuff" });
      expect(((await GarmentProfileService.get(user, profile.id)) as any).photos.map((p: any) => p.id)).toEqual([added.id]);
      expect(((await GarmentProfileService.list(user, {})) as any).items[0].photos).toHaveLength(1);
    });

    it.each([
      ["plain http", "http://img.example.com/a.jpg"],
      ["a script link", "javascript:alert(1)"],
      ["a data link", "data:image/png;base64,AAAA"],
      ["localhost", "https://localhost/a.jpg"],
      ["an IPv4 address", "https://10.0.0.5/a.jpg"],
      ["an IPv6 address", "https://[::1]/a.jpg"],
      ["a host with no dot", "https://intranet/a.jpg"],
      ["a link with credentials", "https://user:pass@img.example.com/a.jpg"],
      ["text that is not a link", "my photo"],
      ["a link over 500 characters", `https://img.example.com/${"a".repeat(500)}`],
    ])("refuses %s", async (_name, url) => {
      const user = signUp();
      const profile = (await GarmentProfileService.create(user, suit)) as any;
      await refused(GarmentProfileService.addPhoto(user, profile.id, { url }), 400);
      expect(state.photos.size).toBe(0);
    });

    it("allows at most five, even when uploaded at once", async () => {
      const user = signUp();
      const profile = (await GarmentProfileService.create(user, suit)) as any;
      const settled = await Promise.allSettled(Array.from({ length: MAX_GARMENT_PHOTOS + 3 }, (_, i) => GarmentProfileService.addPhoto(user, profile.id, photo(i))));

      expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(MAX_GARMENT_PHOTOS);
      expect(state.photos.size).toBe(MAX_GARMENT_PHOTOS);
      expect(((settled.find((s) => s.status === "rejected") as PromiseRejectedResult).reason as CustomException).errorCode).toBe(409);
    });

    it("goes away with the profile", async () => {
      const user = signUp();
      const profile = (await GarmentProfileService.create(user, suit)) as any;
      await GarmentProfileService.addPhoto(user, profile.id, photo(1));
      await GarmentProfileService.remove(user, profile.id);
      expect(state.photos.size).toBe(0);
    });
  });
});
