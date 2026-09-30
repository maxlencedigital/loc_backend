// An in-memory stand-in for the four Query modules, for tests that exercise the real
// services end to end. It keeps the semantics the services rely on: store scoping, unique
// keys (with Prisma's error shape), newest-first search, and row locks held until the
// transaction ends. What it cannot prove (SQL, real transactions) the live run covers.
import crypto from "crypto";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const clone = <T>(value: T): T => structuredClone(value);

const uniqueViolation = (constraint: string) =>
  Object.assign(new Error(`Unique constraint failed on the constraint: \`${constraint}\``), { code: "P2002" });

interface Tx {
  held: Map<string, () => void>;
}

export const state = {
  stores: new Map<string, any>(),
  customers: new Map<string, any>(),
  services: new Map<string, any>(),
  lists: new Map<string, any>(),
  rows: new Map<string, any>(),
  orders: new Map<string, any>(),
  counter: { value: 24799 },
  locks: new Map<string, Promise<void>>(),
};

export const reset = () => {
  for (const key of ["stores", "customers", "services", "lists", "rows", "orders"] as const) state[key].clear();
  state.counter.value = 24799;
  state.locks.clear();
};

// FIFO row lock: waiters queue behind the holder and proceed when its transaction ends.
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

const now = () => new Date();
const id = () => crypto.randomUUID();

// ------------------------------------------------------------------ stores
export const storeQuery = {
  create: async (data: any) => {
    if ([...state.stores.values()].some((s) => s.code === data.code)) throw uniqueViolation("commerce_stores_code_key");
    const store = { id: id(), createdAt: now(), updatedAt: now(), ...data };
    state.stores.set(store.id, store);
    return clone(store);
  },
  list: async (scope: string | null, status?: string) =>
    [...state.stores.values()]
      .filter((s) => (!scope || s.id === scope) && (!status || s.status === status))
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(clone),
  findById: async (storeId: string, scope: string | null) => {
    const store = state.stores.get(storeId);
    return store && (!scope || store.id === scope) ? clone(store) : null;
  },
  update: async (storeId: string, data: any) => {
    const store = { ...state.stores.get(storeId), ...data, updatedAt: now() };
    state.stores.set(storeId, store);
    return clone(store);
  },
};

// --------------------------------------------------------------- customers
export const customerQuery = {
  create: async (data: any) => {
    if ([...state.customers.values()].some((c) => c.phone === data.phone)) {
      throw uniqueViolation("commerce_customers_phone_key");
    }
    const customer = {
      id: id(),
      orderCount: 0,
      lifetimeValuePaise: 0,
      lastOrderAt: null,
      churnRisk: 0,
      rating: null,
      walletBalancePaise: 0,
      loyaltyPoints: 0,
      createdAt: now(),
      updatedAt: now(),
      ...data,
    };
    state.customers.set(customer.id, customer);
    return clone(customer);
  },
  search: async (filter: any) => {
    const q = filter.q?.trim().toLowerCase();
    return [...state.customers.values()]
      .filter(
        (c) =>
          (!filter.storeId || c.storeId === filter.storeId) &&
          (!filter.type || c.type === filter.type) &&
          (!q || [c.name, c.phone, c.email].some((field: string) => field.toLowerCase().includes(q)))
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, filter.limit)
      .map(clone);
  },
  findById: async (customerId: string, scope: string | null) => {
    const customer = state.customers.get(customerId);
    return customer && (!scope || customer.storeId === scope) ? clone(customer) : null;
  },
  update: async (customerId: string, data: any) => {
    if (data.phone && [...state.customers.values()].some((c) => c.phone === data.phone && c.id !== customerId)) {
      throw uniqueViolation("commerce_customers_phone_key");
    }
    const customer = { ...state.customers.get(customerId), ...data };
    state.customers.set(customerId, customer);
    return clone(customer);
  },
  recordOrder: async (customerId: string, amountPaise: number, at: Date) => {
    const customer = state.customers.get(customerId);
    customer.orderCount += 1;
    customer.lifetimeValuePaise += amountPaise;
    customer.lastOrderAt = at;
  },
  reverseOrder: async (customerId: string, amountPaise: number) => {
    const customer = state.customers.get(customerId);
    customer.orderCount -= 1;
    customer.lifetimeValuePaise -= amountPaise;
  },
};

// ----------------------------------------------------------------- catalog
const rowView = (row: any) => {
  const service = state.services.get(row.serviceId);
  return { ...clone(row), serviceName: service.name, unit: service.unit };
};
const listView = (list: any) => ({
  ...clone(list),
  rowCount: [...state.rows.values()].filter((r) => r.priceListId === list.id).length,
});

export const catalogQuery = {
  inTransaction,
  listServices: async () => [...state.services.values()].sort((a, b) => a.code.localeCompare(b.code)).map(clone),
  findServicesByIds: async (ids: string[]) => ids.map((i) => state.services.get(i)).filter(Boolean).map(clone),
  listLists: async () => [...state.lists.values()].sort((a, b) => a.name.localeCompare(b.name)).map(listView),
  findListById: async (listId: string) => (state.lists.has(listId) ? listView(state.lists.get(listId)) : null),
  createList: async (data: any) => {
    if ([...state.lists.values()].some((l) => l.name === data.name)) throw uniqueViolation("commerce_price_lists_name_key");
    const list = { id: id(), createdAt: now(), updatedAt: now(), ...data };
    state.lists.set(list.id, list);
    return listView(list);
  },
  updateList: async (listId: string, data: any) => {
    if (data.name && [...state.lists.values()].some((l) => l.name === data.name && l.id !== listId)) {
      throw uniqueViolation("commerce_price_lists_name_key");
    }
    state.lists.set(listId, { ...state.lists.get(listId), ...data, updatedAt: now() });
  },
  listNamesStartingWith: async (prefix: string) =>
    [...state.lists.values()].map((l) => l.name).filter((name: string) => name.startsWith(prefix)),
  listRows: async (listId: string) => [...state.rows.values()].filter((r) => r.priceListId === listId).map(rowView),
  findRow: async (listId: string, rowId: string) => {
    const row = state.rows.get(rowId);
    return row && row.priceListId === listId ? rowView(row) : null;
  },
  copyRows: async (fromId: string, toId: string) => {
    for (const row of [...state.rows.values()].filter((r) => r.priceListId === fromId)) {
      const copy = { ...row, id: id(), priceListId: toId };
      state.rows.set(copy.id, copy);
    }
  },
  updateRowRates: async (listId: string, rowId: string, data: any) => {
    const row = state.rows.get(rowId);
    if (!row || row.priceListId !== listId) return false;
    Object.assign(row, data);
    state.lists.get(listId).updatedAt = now();
    return true;
  },
  findActiveForPricing: async (serviceIds: string[]) =>
    [...state.lists.values()]
      .filter((l) => l.active)
      .map((l) => ({
        id: l.id,
        name: l.name,
        storeId: l.storeId,
        customerType: l.customerType,
        rows: [...state.rows.values()].filter((r) => r.priceListId === l.id && serviceIds.includes(r.serviceId)).map(clone),
      })),
};

// ------------------------------------------------------------------ orders
const withCustomer = (order: any) => {
  const customer = state.customers.get(order.customerId);
  return clone({ ...order, customerName: customer.name, customerPhone: customer.phone });
};

export const orderQuery = {
  inTransaction,
  // Like the real UPDATE ... RETURNING, the counter row stays locked until the booking ends.
  nextOrderNumber: async (tx: Tx) => {
    await acquire(tx, "counter");
    const current = state.counter.value;
    await tick();
    state.counter.value = current + 1;
    return state.counter.value;
  },
  create: async (ref: string, data: any) => {
    const { items, firstEvent, ...rest } = data;
    const order = {
      id: id(),
      ref,
      status: "booked",
      placedAt: now(),
      riderName: null,
      ...rest,
      items: items.map((item: any) => ({ id: id(), ...item })),
      events: [{ id: id(), status: "booked", note: null, at: now(), ...firstEvent }],
    };
    state.orders.set(order.id, order);
    return withCustomer(order);
  },
  // Yields before answering, so a caller that reads without locking sees a stale row.
  findById: async (orderId: string, scope: string | null) => {
    const order = state.orders.get(orderId);
    const visible = order && (!scope || order.storeId === scope) ? withCustomer(order) : null;
    await tick();
    return visible;
  },
  lockById: async (orderId: string, scope: string | null, tx: Tx) => {
    const order = state.orders.get(orderId);
    if (!order || (scope && order.storeId !== scope)) return null;
    await acquire(tx, `order:${orderId}`);
    return withCustomer(state.orders.get(orderId));
  },
  applyStatus: async (orderId: string, change: any) => {
    const order = state.orders.get(orderId);
    order.status = change.status;
    order.events.push({ id: id(), at: now(), ...change });
    return withCustomer(order);
  },
  search: async (filter: any) => {
    const q = filter.q?.trim().toLowerCase();
    return [...state.orders.values()]
      .map(withCustomer)
      .filter(
        (o) =>
          (!filter.storeId || o.storeId === filter.storeId) &&
          (!filter.statuses || filter.statuses.includes(o.status)) &&
          (!filter.priority || o.priority === filter.priority) &&
          (!filter.paymentStatus || o.paymentStatus === filter.paymentStatus) &&
          (!filter.customerId || o.customerId === filter.customerId) &&
          (!filter.from || o.placedAt >= filter.from) &&
          (!filter.to || o.placedAt <= filter.to) &&
          (!q || [o.ref, o.customerName, o.customerPhone].some((field: string) => field.toLowerCase().includes(q)))
      )
      .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())
      .slice(0, filter.limit);
  },
  countByStatus: async (scope: string | null, statuses: string[]) => {
    const counts: Record<string, number> = {};
    for (const order of state.orders.values()) {
      if ((!scope || order.storeId === scope) && statuses.includes(order.status)) {
        counts[order.status] = (counts[order.status] ?? 0) + 1;
      }
    }
    return counts;
  },
};

// ------------------------------------------------------------- test seeding
export const seed = {
  store: (data: Partial<any> & { code: string }) => {
    const store = { id: id(), name: data.code, city: "Bengaluru", address: "1 Road", status: "live", type: "processing", openingHours: "07:00", capacityKgPerDay: 100, createdAt: now(), updatedAt: now(), ...data };
    state.stores.set(store.id, store);
    return store;
  },
  customer: (data: Partial<any> & { storeId: string; phone: string }) => {
    const customer = { id: id(), name: "Test Customer", email: "", type: "retail", orderCount: 0, lifetimeValuePaise: 0, lastOrderAt: null, churnRisk: 0, rating: null, addresses: [], walletBalancePaise: 0, loyaltyPoints: 0, tags: [], createdAt: now(), updatedAt: now(), ...data };
    state.customers.set(customer.id, customer);
    return customer;
  },
  service: (data: Partial<any> & { code: string }) => {
    const service = { id: id(), name: data.code, department: "laundry", unit: "kg", turnaroundHours: 48, expressAvailable: true, active: true, ...data };
    state.services.set(service.id, service);
    return service;
  },
  list: (data: Partial<any> & { name: string }) => {
    const list = { id: id(), appliesTo: "", active: true, storeId: null, customerType: null, createdAt: now(), updatedAt: now(), ...data };
    state.lists.set(list.id, list);
    return list;
  },
  row: (data: { priceListId: string; serviceId: string; garment: string; category: string; ratePaise: number; expressRatePaise: number }) => {
    const row = { id: id(), ...data };
    state.rows.set(row.id, row);
    return row;
  },
};
