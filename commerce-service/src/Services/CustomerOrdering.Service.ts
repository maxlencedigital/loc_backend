import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { ORDER_STATUS_LABEL, isFinalStatus } from "../Models/Order/OrderStatus.js";
import { OrderPriority } from "../Models/Order/Order.Interface.js";
import {
  FABRICS,
  IAddress,
  ICustomerOrderLine,
  IPhotoInput,
  PAYMENT_METHODS,
} from "../Models/CustomerAccount/CustomerAccount.Interface.js";
import { toCustomerStatus } from "../Models/CustomerAccount/CustomerOrderStatus.js";
import { CustomerQuery } from "../Queries/Customer.Query.js";
import { CustomerAddressQuery } from "../Queries/CustomerAddress.Query.js";
import { CustomerOrderQuery } from "../Queries/CustomerOrder.Query.js";
import { CustomerPhotoQuery } from "../Queries/CustomerPhoto.Query.js";
import { CustomerProfileQuery } from "../Queries/CustomerProfile.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { GarmentProfileQuery } from "../Queries/GarmentProfile.Query.js";
import { OrderQuery } from "../Queries/Order.Query.js";
import { PickupSlotQuery } from "../Queries/PickupSlot.Query.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import type { IStore } from "../Models/Store/Store.Interface.js";
import { categoryIdOf } from "../Utils/GarmentTypeId.js";
import { optionalOneOf, optionalText, parseBody } from "../Utils/Input.js";
import { toRupees } from "../Utils/Money.js";
import { parsePhotoNote, parsePhotoUrl } from "../Utils/PhotoInput.js";
import { isUuid } from "../Utils/Uuid.js";
import { evaluateCare, openingQuestions, parseAnswers, toCareInput } from "./CareQuestions.js";
import { assertCustomer, resolveCustomer } from "./CustomerAccount.Service.js";
import { effectivePrices, loadCatalogue, parseBasket } from "./CustomerCatalogue.js";
import { EXPRESS_PROMISE_HOURS, STANDARD_PROMISE_HOURS } from "./Order.Service.js";
import { parseCare } from "./OrderCare.js";
import { priceOrder } from "./OrderPricing.js";
import {
  daySlots,
  expressDecisionFor,
  isOpenForBooking,
  nextSlotAfterRetry,
  slotConfigOf,
} from "./PickupSlot.Service.js";
import { istDateOf, parseDateOnly } from "./PickupSlots.js";

export const MAX_ORDER_PHOTOS = 5;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const ADDRESS_NOT_FOUND = "Address not found.";
const SLOT_TAKEN = "That pickup slot is no longer available. Please choose another.";
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;
const CATEGORY_NAME: Record<string, string> = {
  men: "Men's",
  women: "Women's",
  kids: "Kids'",
  household: "Household",
  premium: "Premium",
};

export const formatAddress = (a: Pick<IAddress, "line1" | "line2" | "landmark" | "city" | "pincode">): string =>
  [a.line1, a.line2, a.landmark, `${a.city} ${a.pincode}`].filter((part) => part.trim() !== "").join(", ");

const ownedAddress = async (customerId: string, id: unknown, field: string): Promise<IAddress> => {
  if (id === undefined || id === null || id === "") throw new CustomException(`${field} is required.`, badRequest);
  const address = isUuid(id) ? await CustomerAddressQuery.findOwned(customerId, id) : null;
  if (!address) throw new CustomException(ADDRESS_NOT_FOUND, notFound);
  return address;
};

// Choosing the store is out of scope (no nearest-store logic yet). An explicit storeId must be
// a live store; otherwise the first live store in the address's city, else the first live store.
export const chooseStore = async (address: IAddress, requested: unknown): Promise<IStore> => {
  const live = await StoreQuery.list(null, "live");
  if (requested !== undefined && requested !== null && requested !== "") {
    const chosen = isUuid(requested) ? live.find((s) => s.id === requested) : undefined;
    if (!chosen) throw new CustomException("That store is not taking orders.", badRequest);
    return chosen;
  }
  const local = live.find((s) => s.city.trim().toLowerCase() === address.city.trim().toLowerCase());
  const store = local ?? live[0];
  if (!store) throw new CustomException("No store is taking orders yet. Please try again later.", conflict);
  return store;
};

const rejectUnsupported = (body: Record<string, unknown>) => {
  const given = (v: unknown) => v !== undefined && v !== null && v !== "";
  if (given(body.couponCode)) throw new CustomException("Coupon codes are not available yet.", badRequest);
  if (given(body.customerPackageId)) throw new CustomException("Packages are not available yet.", badRequest);
};

const parseExpress = (value: unknown): OrderPriority => {
  if (value === undefined || value === null || value === false) return "standard";
  if (value === true) return "express";
  throw new CustomException("express must be true or false.", badRequest);
};

const getCareQuestions = async (user: RequestUser) => {
  try {
    assertCustomer(user);
    return { questions: openingQuestions() };
  } catch (error) {
    throw toCustomException(error);
  }
};

const MAX_EVALUATE_ITEMS = 50;

const evaluateCareAnswers = async (user: RequestUser, input: unknown) => {
  try {
    assertCustomer(user);
    const body = parseBody(input);
    const answers = parseAnswers(body.answers);
    const raw = body.items === undefined ? [] : body.items;
    if (!Array.isArray(raw) || raw.length > MAX_EVALUATE_ITEMS) {
      throw new CustomException(`items must be a list of at most ${MAX_EVALUATE_ITEMS} entries.`, badRequest);
    }
    const items = raw.map((entry) => parseBody(entry));
    const fabrics = items.map((item) => optionalOneOf(item.fabric, FABRICS, "fabric") ?? "unknown");
    // The catalogue is read only when an item names a garment type, to spot premium ones.
    const needsTypes = items.some((item) => item.garmentTypeId !== undefined);
    const types = needsTypes ? (await loadCatalogue(null)).types : new Map();
    const hasPremium = items.some((item) => isUuid(item.garmentTypeId) && types.get(item.garmentTypeId)?.category === "premium");
    const { riskClass: _risk, labels: _labels, ...visible } = evaluateCare(answers, fabrics, hasPremium);
    return visible;
  } catch (error) {
    throw toCustomException(error);
  }
};

const getMyCatalog = async (user: RequestUser, query: Record<string, unknown>) => {
  try {
    const { customer } = await resolveCustomer(user);
    const address = await ownedAddress(customer.id, query.addressId, "addressId");
    const store = await chooseStore(address, query.storeId);
    const catalogue = await loadCatalogue({ storeId: store.id, customerType: customer.type });

    const byCategory = new Map<string, { id: string; name: string; garmentTypes: { id: string; name: string; unit: string }[] }>();
    for (const type of catalogue.types.values()) {
      const entry = byCategory.get(type.category) ?? {
        id: categoryIdOf(type.category),
        name: CATEGORY_NAME[type.category] ?? type.category,
        garmentTypes: [],
      };
      entry.garmentTypes.push({ id: type.id, name: type.name, unit: type.unit });
      byCategory.set(type.category, entry);
    }
    const priced = effectivePrices(catalogue.lists);
    const offered = new Set(priced.map((p) => p.serviceId));
    return {
      store: { id: store.id, name: store.name },
      categories: [...byCategory.values()].map((c) => ({
        ...c,
        garmentTypes: c.garmentTypes.sort((a, b) => a.name.localeCompare(b.name)),
      })),
      services: [...catalogue.services.values()]
        .filter((s) => s.active && offered.has(s.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({
          id: s.id,
          name: s.name,
          unit: s.unit,
          turnaroundHours: s.turnaroundHours,
          expressAvailable: s.expressAvailable,
        })),
      prices: priced
        .filter((p) => catalogue.services.get(p.serviceId)?.active)
        .map((p) => ({
          serviceId: p.serviceId,
          garmentTypeId: p.garmentTypeId,
          price: toRupees(p.row.ratePaise),
          expressPrice: toRupees(p.row.expressRatePaise),
        })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const listPickupSlots = async (user: RequestUser, query: Record<string, unknown>) => {
  try {
    const { customer } = await resolveCustomer(user);
    const address = await ownedAddress(customer.id, query.addressId, "addressId");
    const date = parseDateOnly(query.date, "date");
    const express = query.express === undefined ? false : query.express === "true" ? true : query.express === "false" ? false : null;
    if (express === null) throw new CustomException("express must be true or false.", badRequest);
    const store = await chooseStore(address, query.storeId);
    const config = await slotConfigOf(store.id);
    const now = new Date();
    const today = Date.parse(`${istDateOf(now)}T00:00:00.000Z`);
    const days = (Date.parse(`${date}T00:00:00.000Z`) - today) / MS_PER_DAY;
    if (days < 0 || days > config.horizonDays) {
      throw new CustomException(`date must be from today to ${config.horizonDays} days ahead.`, badRequest);
    }
    const expressOk = express ? (await expressDecisionFor(store, 0)).available : true;
    const slots = await daySlots(store, config, date);
    const page = parsePage(query);
    const items = slots.slice(page.offset, page.offset + page.limit).map((slot) => ({
      id: slot.id,
      from: slot.startsAt.toISOString(),
      to: slot.endsAt.toISOString(),
      available: expressOk && isOpenForBooking(slot, config, now),
    }));
    return { ...toPage(items, slots.length, page), storeId: store.id };
  } catch (error) {
    throw toCustomException(error);
  }
};

const checkExpressAvailability = async (user: RequestUser, input: unknown) => {
  try {
    const { customer } = await resolveCustomer(user);
    const body = parseBody(input);
    const address = await ownedAddress(customer.id, body.addressId, "addressId");
    let store = await chooseStore(address, body.storeId);
    if (body.pickupSlotId !== undefined && body.pickupSlotId !== null) {
      const slot = isUuid(body.pickupSlotId) ? await PickupSlotQuery.findById(body.pickupSlotId) : null;
      const slotStore = slot ? await StoreQuery.findById(slot.storeId, null) : null;
      if (!slot || !slotStore) throw new CustomException("Choose a valid pickup slot.", badRequest);
      store = slotStore;
    }
    const catalogue = body.items === undefined ? null : await loadCatalogue({ storeId: store.id, customerType: customer.type });
    const basketGrams = catalogue
      ? parseBasket(body.items, catalogue).reduce((sum, i) => sum + (catalogue.services.get(i.line.serviceId)?.unit === "kg" ? i.line.quantityMilli : 0), 0)
      : 0;
    const decision = await expressDecisionFor(store, basketGrams);
    const config = await slotConfigOf(store.id);
    return {
      available: decision.available,
      constraints: decision.constraints,
      reasons: decision.reasons,
      ...(decision.available ? {} : { nextAvailableSlot: await nextSlotAfterRetry(store, config, new Date()) }),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const priceBasket = async (customerType: "retail" | "corporate", store: IStore, body: Record<string, unknown>, priority: OrderPriority) => {
  const catalogue = await loadCatalogue({ storeId: store.id, customerType });
  const basket = parseBasket(body.items, catalogue);
  const lines = basket.map((b) => b.line);
  const priced = priceOrder(lines, catalogue.services, catalogue.lists, priority);
  return { catalogue, basket, priced };
};

const getPriceQuote = async (user: RequestUser, input: unknown) => {
  try {
    const { customer } = await resolveCustomer(user);
    const body = parseBody(input);
    rejectUnsupported(body);
    const priority = parseExpress(body.express);
    const address = await ownedAddress(customer.id, body.addressId, "addressId");
    const store = await chooseStore(address, body.storeId);
    const { basket, priced, catalogue } = await priceBasket(customer.type, store, body, priority);
    const standard = priority === "express" ? priceOrder(basket.map((b) => b.line), catalogue.services, catalogue.lists, "standard") : priced;
    return {
      lines: priced.items.map((item, index) => ({
        garmentTypeId: (basket[index] as { garmentTypeId: string }).garmentTypeId,
        serviceId: item.serviceId,
        quantity: item.quantityMilli / 1000,
        amount: toRupees(item.amountPaise),
      })),
      subtotal: toRupees(standard.amountPaise),
      discount: 0,
      expressSurcharge: toRupees(priced.amountPaise - standard.amountPaise),
      // GST is not modelled on orders yet, so the quote carries none.
      tax: 0,
      total: toRupees(priced.amountPaise),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const parseKey = (value: string | undefined): string | null => {
  if (value === undefined || value === "") return null;
  if (!KEY_PATTERN.test(value)) {
    throw new CustomException("Idempotency-Key must be 8 to 100 letters, digits or . _ : -", badRequest);
  }
  return value;
};

const placedResult = (order: { id: string; ref: string; status: Parameters<typeof toCustomerStatus>[0]; amountPaise: number }, method: string) => ({
  orderId: order.id,
  orderNumber: order.ref,
  status: toCustomerStatus(order.status, true),
  amountDue: toRupees(order.amountPaise),
  paymentRequired: method === "online",
});

// The original answer again: the order the key already created, rebuilt from the stored rows.
const replayOf = async (customerId: string, key: string) => {
  const ext = await CustomerOrderQuery.findByIdempotencyKey(customerId, key);
  if (!ext) return null;
  const order = await OrderQuery.findById(ext.orderId, null);
  return order ? placedResult(order, ext.paymentMethod) : null;
};

const placeMyOrder = async (user: RequestUser, idempotencyKey: string | undefined, input: unknown) => {
  try {
    const { profile, customer } = await resolveCustomer(user);
    const key = parseKey(idempotencyKey);
    if (key) {
      const replay = await replayOf(customer.id, key);
      if (replay) return replay;
    }
    const body = parseBody(input);
    rejectUnsupported(body);
    const paymentMethod = optionalOneOf(body.paymentMethod, PAYMENT_METHODS, "paymentMethod");
    if (!paymentMethod) throw new CustomException("paymentMethod is required.", badRequest);
    if (paymentMethod === "package") throw new CustomException("Packages are not available yet.", badRequest);
    const priority = parseExpress(body.express);
    const pickup = await ownedAddress(customer.id, body.addressId, "addressId");
    const delivery = body.deliveryAddressId === undefined ? pickup : await ownedAddress(customer.id, body.deliveryAddressId, "deliveryAddressId");
    if (!isUuid(body.pickupSlotId)) throw new CustomException("Choose a valid pickup slot.", badRequest);
    const slot = await PickupSlotQuery.findById(body.pickupSlotId);
    const store = slot ? await StoreQuery.findById(slot.storeId, null) : null;
    if (!slot || !store) throw new CustomException("Choose a valid pickup slot.", badRequest);
    if (store.status !== "live") throw new CustomException("This store is not taking orders.", conflict);

    const { basket, priced, catalogue } = await priceBasket(customer.type, store, body, priority);
    const profileIds = [...new Set(basket.flatMap((b) => (b.garmentProfileId ? [b.garmentProfileId] : [])))];
    if ((await GarmentProfileQuery.countOwned(customer.id, profileIds)) !== profileIds.length) {
      throw new CustomException("Garment profile not found.", notFound);
    }

    const fabrics = basket.map((b) => b.fabric);
    const types = catalogue.types;
    const evaluation = evaluateCare(
      parseAnswers(body.careAnswers === undefined ? [] : body.careAnswers),
      fabrics,
      basket.some((b) => types.get(b.garmentTypeId)?.category === "premium")
    );
    const care = parseCare(toCareInput(evaluation, fabrics, optionalText(body.careNotes, "careNotes", 300) ?? null));

    const now = new Date();
    const config = await slotConfigOf(store.id);
    if (!isOpenForBooking(slot, config, now)) throw new CustomException(SLOT_TAKEN, conflict);
    if (priority === "express" && !(await expressDecisionFor(store, priced.weightGrams)).available) {
      throw new CustomException("Express is no longer available. Please choose standard service.", conflict);
    }
    const promisedAt = new Date(slot.endsAt.getTime() + (priority === "express" ? EXPRESS_PROMISE_HOURS : STANDARD_PROMISE_HOURS) * MS_PER_HOUR);

    try {
      return await OrderQuery.inTransaction(async (tx) => {
        // One customer's orders queue here, so a double tap and a retry cannot both book.
        await CustomerProfileQuery.lock(profile.id, tx);
        if (key) {
          const again = await CustomerOrderQuery.findByIdempotencyKey(customer.id, key, tx);
          const original = again ? await OrderQuery.findById(again.orderId, null, tx) : null;
          if (again && original) return placedResult(original, again.paymentMethod);
        }
        if (!(await PickupSlotQuery.reserve(slot.id, tx))) throw new CustomException(SLOT_TAKEN, conflict);
        const ref = `LOC-${await OrderQuery.nextOrderNumber(tx)}`;
        const order = await OrderQuery.create(
          ref,
          {
            storeId: store.id,
            customerId: customer.id,
            priority,
            paymentStatus: "unpaid",
            channel: "app",
            pieces: priced.pieces,
            weightGrams: priced.weightGrams,
            amountPaise: priced.amountPaise,
            promisedAt,
            care,
            address: formatAddress(pickup),
            createdByUserId: user.id,
            items: priced.items,
            firstEvent: { byName: customer.name, byUserId: user.id },
          },
          tx
        );
        await CustomerQuery.recordOrder(customer.id, priced.amountPaise, order.placedAt, tx);
        await CustomerOrderQuery.createExt(
          {
            orderId: order.id,
            customerId: customer.id,
            idempotencyKey: key,
            pickupSlotId: slot.id,
            pickupFrom: slot.startsAt,
            pickupTo: slot.endsAt,
            pickupAddressId: pickup.id,
            pickupAddress: formatAddress(pickup),
            deliveryAddressId: delivery.id,
            deliveryAddress: formatAddress(delivery),
            paymentMethod,
          },
          tx
        );
        const lines: ICustomerOrderLine[] = order.items.map((item, index) => {
          const entry = basket[index] as (typeof basket)[number];
          return {
            orderId: order.id,
            orderItemId: item.id,
            customerId: customer.id,
            garmentTypeId: entry.garmentTypeId,
            garmentProfileId: entry.garmentProfileId,
            fabric: entry.fabric,
            note: entry.note,
          };
        });
        await CustomerOrderQuery.createLines(lines, tx);
        return placedResult(order, paymentMethod);
      });
    } catch (error) {
      // Backed by a unique index: if two identical requests still collide, the loser answers
      // with the winner's order.
      if (key && isUniqueViolation(error, "idempotency")) {
        const replay = await replayOf(customer.id, key);
        if (replay) return replay;
      }
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const parsePhotos = (body: Record<string, unknown>): (IPhotoInput & { itemId: string | null })[] => {
  const raw = body.photos;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ORDER_PHOTOS) {
    throw new CustomException(`photos must list 1 to ${MAX_ORDER_PHOTOS} photos.`, badRequest);
  }
  return raw.map((entry, index) => {
    const photo = parseBody(entry);
    if (photo.itemId !== undefined && photo.itemId !== null && !isUuid(photo.itemId)) {
      throw new CustomException(`Photo ${index + 1}: itemId is not valid.`, badRequest);
    }
    return {
      itemId: (photo.itemId as string | null | undefined) ?? null,
      url: parsePhotoUrl(photo.url, `Photo ${index + 1}: url`),
      note: parsePhotoNote(photo.note, `Photo ${index + 1}: note`),
    };
  });
};

const uploadMyOrderPhotos = async (user: RequestUser, orderId: string, input: unknown) => {
  try {
    const { customer } = await resolveCustomer(user);
    const photos = parsePhotos(parseBody(input));
    if (!isUuid(orderId)) throw new CustomException("Order not found.", notFound);
    return await OrderQuery.inTransaction(async (tx) => {
      if (!(await CustomerOrderQuery.lockOwned(customer.id, orderId, tx))) throw new CustomException("Order not found.", notFound);
      const order = await OrderQuery.findById(orderId, null, tx);
      if (!order) throw new CustomException("Order not found.", notFound);
      if (isFinalStatus(order.status)) {
        throw new CustomException(`A ${ORDER_STATUS_LABEL[order.status].toLowerCase()} order cannot take new photos.`, conflict);
      }
      const itemIds = new Set(order.items.map((i) => i.id));
      if (photos.some((p) => p.itemId !== null && !itemIds.has(p.itemId))) {
        throw new CustomException("itemId is not an item of this order.", badRequest);
      }
      const existing = await CustomerPhotoQuery.count("order", orderId, tx);
      if (existing + photos.length > MAX_ORDER_PHOTOS) {
        throw new CustomException(`An order can have at most ${MAX_ORDER_PHOTOS} photos.`, conflict);
      }
      const created = await CustomerPhotoQuery.createMany(customer.id, "order", orderId, photos, tx);
      return {
        photos: created.map((p) => ({
          id: p.id,
          url: p.url,
          note: p.note,
          itemId: p.itemId,
          createdAt: p.createdAt.toISOString(),
        })),
        total: existing + created.length,
      };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

export const CustomerOrderingService = {
  getCareQuestions,
  evaluateCareAnswers,
  getMyCatalog,
  listPickupSlots,
  checkExpressAvailability,
  getPriceQuote,
  placeMyOrder,
  uploadMyOrderPhotos,
};

