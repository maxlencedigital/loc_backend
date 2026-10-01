// An in-memory stand-in for the P01 Query modules (customer profile, addresses, garment
// profiles, photos, pickup slots, app-order details, internal order reads). The core
// stores, customers, catalogue and orders come from InMemoryCommerce, unchanged.
// It keeps what the services rely on: owner filters, unique keys (with Prisma's error
// shape), conditional seat updates and row locks held until the transaction ends. What it
// cannot prove (SQL, real transactions and rollback) the live run covers.
import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { orderQuery, state as core } from "./InMemoryCommerce.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const clone = <T>(value: T): T => structuredClone(value);
const id = () => crypto.randomUUID();
// Strictly increasing, so rows created in the same millisecond still sort in creation order.
let lastTick = 0;
const now = () => new Date((lastTick = Math.max(Date.now(), lastTick + 1)));

const uniqueViolation = (constraint: string) =>
  Object.assign(new Error(`Unique constraint failed on the constraint: \`${constraint}\``), { code: "P2002" });

interface Tx {
  held: Map<string, () => void>;
}

export const state = {
  profiles: new Map<string, any>(),
  addresses: new Map<string, any>(),
  garments: new Map<string, any>(),
  photos: new Map<string, any>(),
  configs: new Map<string, any>(),
  slots: new Map<string, any>(),
  exts: new Map<string, any>(),
  lines: new Map<string, any>(),
  paid: new Map<string, number>(),
  locks: new Map<string, Promise<void>>(),
};

export const reset = () => {
  for (const key of ["profiles", "addresses", "garments", "photos", "configs", "slots", "exts", "lines", "paid", "locks"] as const) {
    state[key].clear();
  }
};

const acquire = async (tx: Tx, key: string) => {
  if (tx.held.has(key)) return;
  const previous = state.locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  state.locks.set(key, previous.then(() => mine));
  await previous;
  tx.held.set(key, release);
};

const inTransaction = async <T>(work: (tx: Tx) => Promise<T>): Promise<T> => {
  const tx: Tx = { held: new Map() };
  try {
    return await work(tx);
  } finally {
    for (const release of tx.held.values()) release();
  }
};

const page = <T>(rows: T[], offset: number, limit: number) => ({ items: rows.slice(offset, offset + limit).map(clone), total: rows.length });
const byNewest = (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);

// ---------------------------------------------------------------- profiles
export const profileQuery = {
  findByUserId: async (userId: string) => {
    await tick();
    const found = [...state.profiles.values()].find((p) => p.userId === userId);
    return found ? clone(found) : null;
  },
  findByCustomerId: async (customerId: string) => {
    const found = [...state.profiles.values()].find((p) => p.customerId === customerId);
    return found ? clone(found) : null;
  },
  create: async (userId: string, customerId: string) => {
    await tick();
    const rows = [...state.profiles.values()];
    if (rows.some((p) => p.userId === userId)) throw uniqueViolation("uq_customer_profile_user");
    if (rows.some((p) => p.customerId === customerId)) throw uniqueViolation("uq_customer_profile_customer");
    const profile = { id: id(), userId, customerId, defaultAddressId: null, createdAt: now(), updatedAt: now() };
    state.profiles.set(profile.id, profile);
    return clone(profile);
  },
  lock: async (profileId: string, tx: Tx) => {
    if (!state.profiles.has(profileId)) return false;
    await acquire(tx, `profile:${profileId}`);
    return true;
  },
  setDefaultAddress: async (profileId: string, addressId: string | null) => {
    state.profiles.get(profileId).defaultAddressId = addressId;
  },
  findCustomerByPhone: async (phone: string) => {
    await tick();
    const found = [...core.customers.values()].find((c) => c.phone === phone);
    return found ? clone(found) : null;
  },
};

// --------------------------------------------------------------- addresses
export const addressQuery = {
  inTransaction,
  list: async (customerId: string, offset: number, limit: number) =>
    page([...state.addresses.values()].filter((a) => a.customerId === customerId).sort(byNewest), offset, limit),
  findOwned: async (customerId: string, addressId: string) => {
    const found = state.addresses.get(addressId);
    return found && found.customerId === customerId ? clone(found) : null;
  },
  count: async (customerId: string) => [...state.addresses.values()].filter((a) => a.customerId === customerId).length,
  create: async (customerId: string, data: any) => {
    await tick();
    const address = { id: id(), customerId, ...data, createdAt: now(), updatedAt: now() };
    state.addresses.set(address.id, address);
    return clone(address);
  },
  update: async (customerId: string, addressId: string, data: any) => {
    const found = state.addresses.get(addressId);
    if (!found || found.customerId !== customerId) return null;
    Object.assign(found, data, { updatedAt: now() });
    return clone(found);
  },
  remove: async (customerId: string, addressId: string) => {
    const found = state.addresses.get(addressId);
    if (!found || found.customerId !== customerId) return false;
    state.addresses.delete(addressId);
    return true;
  },
  findLatest: async (customerId: string) => {
    const [latest] = [...state.addresses.values()].filter((a) => a.customerId === customerId).sort(byNewest);
    return latest ? clone(latest) : null;
  },
};

// ---------------------------------------------------------- garment profiles
export const garmentQuery = {
  inTransaction,
  list: async (customerId: string, offset: number, limit: number) =>
    page(
      [...state.garments.values()]
        .filter((g) => g.customerId === customerId)
        .sort((a, b) => Number(b.isFavourite) - Number(a.isFavourite) || byNewest(a, b)),
      offset,
      limit
    ),
  findOwned: async (customerId: string, profileId: string) => {
    const found = state.garments.get(profileId);
    return found && found.customerId === customerId ? clone(found) : null;
  },
  count: async (customerId: string) => [...state.garments.values()].filter((g) => g.customerId === customerId).length,
  countOwned: async (customerId: string, ids: string[]) =>
    ids.filter((i) => state.garments.get(i)?.customerId === customerId).length,
  create: async (customerId: string, data: any) => {
    await tick();
    const profile = { id: id(), customerId, ...data, createdAt: now(), updatedAt: now() };
    state.garments.set(profile.id, profile);
    return clone(profile);
  },
  update: async (customerId: string, profileId: string, data: any) => {
    const found = state.garments.get(profileId);
    if (!found || found.customerId !== customerId) return null;
    Object.assign(found, data, { updatedAt: now() });
    return clone(found);
  },
  lock: async (customerId: string, profileId: string, tx: Tx) => {
    const found = state.garments.get(profileId);
    if (!found || found.customerId !== customerId) return false;
    await acquire(tx, `garment:${profileId}`);
    return true;
  },
  remove: async (customerId: string, profileId: string) => {
    const found = state.garments.get(profileId);
    if (!found || found.customerId !== customerId) return false;
    state.garments.delete(profileId);
    for (const [photoId, photo] of state.photos) if (photo.ownerType === "garment_profile" && photo.ownerId === profileId) state.photos.delete(photoId);
    for (const line of state.lines.values()) if (line.garmentProfileId === profileId) line.garmentProfileId = null;
    return true;
  },
  history: async (customerId: string, profileId: string, limit: number) => {
    const lines = [...state.lines.values()].filter((l) => l.customerId === customerId && l.garmentProfileId === profileId).slice(0, limit);
    return lines.flatMap((line) => {
      const order = core.orders.get(line.orderId);
      if (!order || order.status === "cancelled") return [];
      const item = order.items.find((i: any) => i.id === line.orderItemId);
      return [{
        orderId: order.id,
        storeId: order.storeId,
        storeName: core.stores.get(order.storeId)?.name ?? "",
        placedAt: order.placedAt,
        service: item?.serviceName ?? "",
        careNote: line.note || order.care.customerNote || "",
      }];
    });
  },
};

// ------------------------------------------------------------------ photos
export const photoQuery = {
  count: async (ownerType: string, ownerId: string) =>
    [...state.photos.values()].filter((p) => p.ownerType === ownerType && p.ownerId === ownerId).length,
  listByOwners: async (ownerType: string, ownerIds: string[]) =>
    [...state.photos.values()].filter((p) => p.ownerType === ownerType && ownerIds.includes(p.ownerId)).map(clone),
  createMany: async (customerId: string, ownerType: string, ownerId: string, photos: any[]) =>
    photos.map((photo) => {
      const row = { id: id(), customerId, ownerType, ownerId, ...photo, createdAt: now() };
      state.photos.set(row.id, row);
      return clone(row);
    }),
};

// ------------------------------------------------------------- pickup slots
export const slotQuery = {
  inTransaction,
  findConfig: async (storeId: string) => {
    const config = state.configs.get(storeId);
    return config ? clone(config) : null;
  },
  ensureWindows: async (storeId: string, windows: { startsAt: Date; endsAt: Date }[], capacity: number) => {
    await tick();
    for (const w of windows) {
      const exists = [...state.slots.values()].some((s) => s.storeId === storeId && s.startsAt.getTime() === w.startsAt.getTime());
      if (exists) continue;
      const slot = { id: id(), storeId, startsAt: w.startsAt, endsAt: w.endsAt, capacity, booked: 0 };
      state.slots.set(slot.id, slot);
    }
  },
  listBetween: async (storeId: string, from: Date, to: Date) =>
    [...state.slots.values()]
      .filter((s) => s.storeId === storeId && s.startsAt >= from && s.startsAt < to)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map(clone),
  findById: async (slotId: string) => {
    const found = state.slots.get(slotId);
    return found ? clone(found) : null;
  },
  // Like the real conditional UPDATE: the capacity test and the increment are one step.
  reserve: async (slotId: string, tx: Tx) => {
    await acquire(tx, `slot:${slotId}`);
    const slot = state.slots.get(slotId);
    if (!slot || slot.booked >= slot.capacity) return false;
    slot.booked += 1;
    return true;
  },
  release: async (slotId: string, tx: Tx) => {
    await acquire(tx, `slot:${slotId}`);
    const slot = state.slots.get(slotId);
    if (slot && slot.booked > 0) slot.booked -= 1;
  },
};

// --------------------------------------------------------- app-order details
export const customerOrderQuery = {
  inTransaction,
  findByIdempotencyKey: async (customerId: string, key: string) => {
    const found = [...state.exts.values()].find((e) => e.customerId === customerId && e.idempotencyKey === key);
    return found ? clone(found) : null;
  },
  findExtByOrderIds: async (orderIds: string[]) => orderIds.map((o) => state.exts.get(o)).filter(Boolean).map(clone),
  createExt: async (data: any) => {
    await tick();
    const duplicate = data.idempotencyKey !== null && [...state.exts.values()].some((e) => e.customerId === data.customerId && e.idempotencyKey === data.idempotencyKey);
    if (duplicate) throw uniqueViolation("uq_customer_order_idempotency");
    const ext = { id: id(), ...data };
    state.exts.set(ext.orderId, ext);
    return clone(ext);
  },
  createLines: async (lines: any[]) => {
    for (const line of lines) state.lines.set(line.orderItemId, { id: id(), createdAt: now(), ...line });
  },
  findLinesByOrder: async (orderId: string) => [...state.lines.values()].filter((l) => l.orderId === orderId).map(clone),
  ownsOrder: async (customerId: string, orderId: string) => core.orders.get(orderId)?.customerId === customerId,
  // The order's own row lock (shared with the existing status code), taken only for the owner.
  lockOwned: async (customerId: string, orderId: string, tx: Tx) => {
    if (core.orders.get(orderId)?.customerId !== customerId) return false;
    return (await orderQuery.lockById(orderId, null, tx as any)) !== null;
  },
  listOwned: async (customerId: string, filter: any) => {
    const rows = [...core.orders.values()]
      .filter(
        (o) =>
          o.customerId === customerId &&
          (!filter.statuses || filter.statuses.includes(o.status)) &&
          (filter.hasPickupSlot === undefined || o.status !== "booked" || state.exts.has(o.id) === filter.hasPickupSlot) &&
          (!filter.from || o.placedAt >= filter.from) &&
          (!filter.to || o.placedAt <= filter.to)
      )
      .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime() || a.id.localeCompare(b.id));
    const slice = rows.slice(filter.offset, filter.offset + filter.limit);
    return { rows: slice.map(clone), total: rows.length };
  },
  updatePickup: async (orderId: string, pickup: any) => {
    Object.assign(state.exts.get(orderId), pickup);
  },
  sumOpenWeightGrams: async (storeId: string, statuses: string[]) =>
    [...core.orders.values()].filter((o) => o.storeId === storeId && statuses.includes(o.status)).reduce((sum, o) => sum + o.weightGrams, 0),
};

// ------------------------------------------------------- internal order reads
const internalView = (order: any) => {
  const customer = core.customers.get(order.customerId);
  return {
    id: order.id,
    ref: order.ref,
    storeId: order.storeId,
    customerId: order.customerId,
    status: order.status,
    priority: order.priority,
    paymentStatus: order.paymentStatus,
    amountPaise: order.amountPaise,
    address: order.address,
    promisedAt: order.promisedAt,
    customerName: customer.name,
    customerPhone: customer.phone,
  };
};

export const internalOrderQuery = {
  inTransaction,
  findOrder: async (orderId: string) => {
    const order = core.orders.get(orderId);
    return order ? internalView(order) : null;
  },
  findPaidPaise: async (orderId: string) => state.paid.get(orderId) ?? null,
  upsertPaidPaise: async (orderId: string, paidPaise: number) => {
    state.paid.set(orderId, paidPaise);
  },
  setPaymentStatus: async (orderId: string, paymentStatus: string) => {
    core.orders.get(orderId).paymentStatus = paymentStatus;
  },
  summarise: async (filter: { from: Date; to: Date; storeId: string | null }) => {
    const inRange = [...core.orders.values()].filter(
      (o) => o.placedAt >= filter.from && o.placedAt < filter.to && (!filter.storeId || o.storeId === filter.storeId)
    );
    const live = inRange.filter((o) => o.status !== "cancelled");
    const group = <K extends string>(rows: any[], key: (o: any) => K) => {
      const map = new Map<K, { orders: number; revenuePaise: number }>();
      for (const o of rows) {
        const entry = map.get(key(o)) ?? { orders: 0, revenuePaise: 0 };
        entry.orders += 1;
        entry.revenuePaise += o.amountPaise;
        map.set(key(o), entry);
      }
      return map;
    };
    const istDay = (o: any) => new Date(o.placedAt.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    return {
      byStatus: [...group(inRange, (o) => o.status)].map(([status, v]) => ({ status, orders: v.orders })),
      byStore: [...group(live, (o) => o.storeId)].map(([storeId, v]) => ({ storeId, ...v })),
      byDay: [...group(live, istDay)].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    };
  },
};

// ------------------------------------------------------------- gateway fake
export const gateway = {
  users: new Map<string, any>(),
  calls: 0,
  failWith: null as Error | null,
};

export const resetGateway = () => {
  gateway.users.clear();
  gateway.calls = 0;
  gateway.failWith = null;
};

// Stands in for commons/Http/ServiceClient: only the gateway's user lookup is answered.
export const serviceClientMock = {
  ServiceClient: {
    get: async (target: string, path: string) => {
      gateway.calls += 1;
      if (gateway.failWith) throw gateway.failWith;
      const userId = decodeURIComponent(path.split("/").pop() as string);
      const user = target === "gateway" ? gateway.users.get(userId) : undefined;
      if (!user) {
        throw new CustomException("User not found.", 404);
      }
      return clone(user);
    },
  },
};
