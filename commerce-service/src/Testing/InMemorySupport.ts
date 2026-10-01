// An in-memory stand-in for the P02 Query modules (complaints, tickets, feedback, customer
// payments and saved methods, and the order reads they share), plus fakes for the three
// services the package calls (gateway, finance, logistics). It keeps what the services rely
// on: owner filters, unique keys (with Prisma's error shape), row locks held until the
// transaction ends, and newest-first paging. What it cannot prove (SQL aggregates, real
// transactions and rollback) the live run covers.
import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { state as core } from "./InMemoryCommerce.js";
import { gateway } from "./InMemoryCustomerAccount.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const clone = <T>(value: T): T => structuredClone(value);
const id = () => crypto.randomUUID();
// Strictly increasing, so rows made in the same millisecond still sort in creation order.
let lastTick = 0;
const now = () => new Date((lastTick = Math.max(Date.now(), lastTick + 1)));

const uniqueViolation = (constraint: string) =>
  Object.assign(new Error(`Unique constraint failed on the constraint: \`${constraint}\``), { code: "P2002" });

interface Tx {
  held: Map<string, () => void>;
}

export const state = {
  complaints: new Map<string, any>(),
  events: new Map<string, any[]>(),
  tickets: new Map<string, any>(),
  messages: new Map<string, any[]>(),
  feedback: new Map<string, any>(),
  payments: new Map<string, any>(),
  methods: new Map<string, any>(),
  locks: new Map<string, Promise<void>>(),
};

export const reset = () => {
  lastTick = 0;
  for (const key of ["complaints", "events", "tickets", "messages", "feedback", "payments", "methods", "locks"] as const) {
    state[key].clear();
  }
  fake.finance.calls.length = 0;
  fake.finance.failWith = null;
  fake.finance.verdicts.clear();
  fake.finance.checkouts.clear();
  fake.finance.counter = 0;
  fake.logistics.jobs.clear();
  fake.logistics.failWith = null;
  fake.logistics.calls = 0;
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

// Also releases the order-row locks taken through the core fake, which shares this Tx shape.
const inTransaction = async <T>(work: (tx: Tx) => Promise<T>): Promise<T> => {
  const tx: Tx = { held: new Map() };
  try {
    return await work(tx);
  } finally {
    for (const release of tx.held.values()) release();
  }
};

const page = (rows: any[], offset: number, limit: number) => ({
  items: rows.slice(offset, offset + limit).map(clone),
  total: rows.length,
});
const newest = (field: string) => (a: any, b: any) => b[field].getTime() - a[field].getTime() || a.id.localeCompare(b.id);

// -------------------------------------------------------------- order reads
const orderRef = (order: any) => ({
  id: order.id,
  ref: order.ref,
  storeId: order.storeId,
  customerId: order.customerId,
  status: order.status,
  paymentStatus: order.paymentStatus,
  amountPaise: order.amountPaise,
});

export const supportOrderQuery = {
  findOrderForCustomer: async (orderId: string, customerId: string) => {
    await tick();
    const order = core.orders.get(orderId);
    return order && order.customerId === customerId ? orderRef(order) : null;
  },
  findOrderInScope: async (orderId: string, scope: string | null) => {
    await tick();
    const order = core.orders.get(orderId);
    return order && (!scope || order.storeId === scope) ? orderRef(order) : null;
  },
  orderHasItem: async (orderId: string, itemId: string) =>
    !!core.orders.get(orderId)?.items.some((item: any) => item.id === itemId),
};

// -------------------------------------------------------------- complaints
const matchesOwner = (c: any, owner: any) =>
  (!owner.storeId || c.storeId === owner.storeId) &&
  (!owner.customerUserId || c.customerUserId === owner.customerUserId) &&
  (!owner.escalatedOnly || c.escalatedAt !== null);

const toEvent = (event: any) => ({ id: id(), createdAt: now(), ...event });

const detail = (c: any) => ({ ...clone(c), events: clone(state.events.get(c.id) ?? []) });

export const complaintQuery = {
  inTransaction,
  create: async (data: any) => {
    await tick();
    const { firstEvent, ...rest } = data;
    const rows = [...state.complaints.values()];
    if (rows.some((c) => c.activeKey === rest.activeKey)) throw uniqueViolation("uq_complaint_active_key");
    if (rest.idempotencyKey !== null && rows.some((c) => c.createdByUserId === rest.createdByUserId && c.idempotencyKey === rest.idempotencyKey)) {
      throw uniqueViolation("uq_complaint_creator_key");
    }
    const complaint = {
      id: id(), status: "open", assigneeId: null, assigneeName: null, assignedAt: null, firstResponseAt: null,
      resolvedAt: null, closedAt: null, escalatedAt: null, escalationReason: null, decision: null, resolution: null,
      refundAmountPaise: null, goodwill: null, photos: [], reopenCount: 0, createdAt: now(), updatedAt: now(), ...rest,
    };
    state.complaints.set(complaint.id, complaint);
    state.events.set(complaint.id, [toEvent(firstEvent)]);
    return detail(complaint);
  },
  findDetail: async (complaintId: string, owner: any) => {
    await tick();
    const c = state.complaints.get(complaintId);
    return c && matchesOwner(c, owner) ? detail(c) : null;
  },
  lock: async (complaintId: string, owner: any, tx: Tx) => {
    const c = state.complaints.get(complaintId);
    if (!c || !matchesOwner(c, owner)) return null;
    await acquire(tx, `complaint:${complaintId}`);
    return clone(state.complaints.get(complaintId));
  },
  apply: async (complaintId: string, patch: any, events: any[]) => {
    await tick();
    if (patch.activeKey && [...state.complaints.values()].some((c) => c.id !== complaintId && c.activeKey === patch.activeKey)) {
      throw uniqueViolation("uq_complaint_active_key");
    }
    Object.assign(state.complaints.get(complaintId), patch, { updatedAt: now() });
    state.events.get(complaintId)!.push(...events.map(toEvent));
  },
  countEvents: async (complaintId: string) => state.events.get(complaintId)?.length ?? 0,
  findByCreatorKey: async (createdByUserId: string, key: string) => {
    const c = [...state.complaints.values()].find((x) => x.createdByUserId === createdByUserId && x.idempotencyKey === key);
    return c ? detail(c) : null;
  },
  findByActiveKey: async (activeKey: string) => {
    const c = [...state.complaints.values()].find((x) => x.activeKey === activeKey);
    return c ? detail(c) : null;
  },
  search: async (filter: any, sortBy: "createdAt" | "escalatedAt") => {
    const rows = [...state.complaints.values()]
      .filter(
        (c) =>
          matchesOwner(c, filter) &&
          (!filter.statuses || filter.statuses.includes(c.status)) &&
          (!filter.type || c.type === filter.type) &&
          (!filter.assigneeId || c.assigneeId === filter.assigneeId) &&
          (!filter.from || c.createdAt >= filter.from) &&
          (!filter.to || c.createdAt <= filter.to)
      )
      .sort(newest(sortBy));
    return page(rows, filter.page.offset, filter.page.limit);
  },
  closeResolved: async (cutoff: Date, limit: number, at: Date) => {
    const due = [...state.complaints.values()]
      .filter((c) => c.status === "resolved" && c.resolvedAt < cutoff)
      .sort((a, b) => a.resolvedAt.getTime() - b.resolvedAt.getTime())
      .slice(0, limit);
    for (const c of due) {
      Object.assign(c, { status: "closed", closedAt: at });
      state.events.get(c.id)!.push(
        toEvent({ kind: "closed", actorRole: "system", actorUserId: null, actorName: "System", message: "auto", internal: false, fromStatus: "resolved", toStatus: "closed" })
      );
    }
    return due.length;
  },
};

// ----------------------------------------------------------------- tickets
const ticketDetail = (t: any) => ({ ...clone(t), messages: clone(state.messages.get(t.id) ?? []) });
const ticketOwned = (t: any, customerUserId: string | null) => !customerUserId || t.customerUserId === customerUserId;

export const ticketQuery = {
  inTransaction,
  create: async (data: any) => {
    await tick();
    const { firstMessage, ...rest } = data;
    if (rest.idempotencyKey !== null && [...state.tickets.values()].some((t) => t.customerUserId === rest.customerUserId && t.idempotencyKey === rest.idempotencyKey)) {
      throw uniqueViolation("uq_ticket_customer_key");
    }
    const ticket = {
      id: id(), status: "open", messageCount: 1, firstResponseAt: null, answeredAt: null, closedAt: null,
      createdAt: now(), updatedAt: now(), ...rest,
    };
    state.tickets.set(ticket.id, ticket);
    state.messages.set(ticket.id, [{ id: id(), createdAt: now(), ...firstMessage }]);
    return ticketDetail(ticket);
  },
  findDetail: async (ticketId: string, customerUserId: string | null) => {
    await tick();
    const t = state.tickets.get(ticketId);
    return t && ticketOwned(t, customerUserId) ? ticketDetail(t) : null;
  },
  findByCustomerKey: async (customerUserId: string, key: string) => {
    const t = [...state.tickets.values()].find((x) => x.customerUserId === customerUserId && x.idempotencyKey === key);
    return t ? ticketDetail(t) : null;
  },
  lock: async (ticketId: string, customerUserId: string | null, tx: Tx) => {
    const t = state.tickets.get(ticketId);
    if (!t || !ticketOwned(t, customerUserId)) return null;
    await acquire(tx, `ticket:${ticketId}`);
    return clone(state.tickets.get(ticketId));
  },
  appendMessage: async (ticketId: string, message: any, patch: any) => {
    await tick();
    const t = state.tickets.get(ticketId);
    Object.assign(t, patch, { messageCount: t.messageCount + 1, updatedAt: now() });
    state.messages.get(ticketId)!.push({ id: id(), createdAt: now(), ...message });
  },
  setStatus: async (ticketId: string, patch: any) => {
    Object.assign(state.tickets.get(ticketId), patch, { updatedAt: now() });
  },
  listForCustomer: async (customerUserId: string, status: string | undefined, p: any) => {
    const rows = [...state.tickets.values()]
      .filter((t) => t.customerUserId === customerUserId && (!status || t.status === status))
      .sort(newest("updatedAt"));
    return page(rows, p.offset, p.limit);
  },
};

// ---------------------------------------------------------------- feedback
const feedbackMatches = (f: any, filter: any) =>
  (!filter.storeId || f.storeId === filter.storeId) &&
  (!filter.riderId || f.riderId === filter.riderId) &&
  (!filter.rating || f.rating === filter.rating) &&
  (!filter.from || f.createdAt >= filter.from) &&
  (!filter.to || f.createdAt <= filter.to);

const avg = (values: number[]) =>
  values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;

export const feedbackQuery = {
  create: async (data: any) => {
    await tick();
    if ([...state.feedback.values()].some((f) => f.orderId === data.orderId && f.customerUserId === data.customerUserId)) {
      throw uniqueViolation("uq_feedback_order_customer");
    }
    const row = { id: id(), createdAt: now(), ...data };
    state.feedback.set(row.id, row);
    return clone(row);
  },
  findByOrderAndCustomer: async (orderId: string, customerUserId: string) => {
    const f = [...state.feedback.values()].find((x) => x.orderId === orderId && x.customerUserId === customerUserId);
    return f ? clone(f) : null;
  },
  search: async (filter: any) => {
    const rows = [...state.feedback.values()].filter((f) => feedbackMatches(f, filter)).sort(newest("createdAt"));
    return page(rows, filter.page.offset, filter.page.limit);
  },
  summarise: async (filter: any, trendFrom: Date | undefined) => {
    const rows = [...state.feedback.values()].filter((f) => feedbackMatches(f, filter));
    const group = (key: (f: any) => string | null, value: (f: any) => number | null, subset = rows) => {
      const map = new Map<string, number[]>();
      for (const f of subset) {
        const k = key(f);
        const v = value(f);
        if (k === null || v === null) continue;
        map.set(k, [...(map.get(k) ?? []), v]);
      }
      return map;
    };
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const f of rows) distribution[f.rating] += 1;
    return {
      overall: { average: avg(rows.map((f) => f.rating)), count: rows.length },
      distribution,
      byStore: [...group((f) => f.storeId, (f) => f.rating)].map(([storeId, v]) => ({ storeId, average: avg(v), count: v.length })),
      byRider: [...group((f) => f.riderId, (f) => f.riderRating)].map(([riderId, v]) => ({ riderId, average: avg(v), count: v.length })),
      trend: [...group((f) => f.ratedOn.toISOString().slice(0, 10), (f) => f.rating, rows.filter((f) => !trendFrom || f.ratedOn >= trendFrom))]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, average: avg(v), count: v.length })),
    };
  },
};

// ----------------------------------------------------------------- payments
export const paymentQuery = {
  inTransaction,
  create: async (data: any) => {
    await tick();
    const rows = [...state.payments.values()];
    if (rows.some((p) => p.razorpayOrderId === data.razorpayOrderId)) throw uniqueViolation("uq_customer_payment_razorpay_order");
    if (data.idempotencyKey !== null && rows.some((p) => p.customerUserId === data.customerUserId && p.idempotencyKey === data.idempotencyKey)) {
      throw uniqueViolation("uq_customer_payment_key");
    }
    const payment = { id: id(), status: "created", razorpayPaymentId: null, paidAt: null, createdAt: now(), updatedAt: now(), ...data };
    state.payments.set(payment.id, payment);
    return clone(payment);
  },
  findByKey: async (customerUserId: string, key: string) => {
    const p = [...state.payments.values()].find((x) => x.customerUserId === customerUserId && x.idempotencyKey === key);
    return p ? clone(p) : null;
  },
  findOwn: async (customerUserId: string, orderId: string, razorpayOrderId: string) => {
    await tick();
    const p = [...state.payments.values()].find(
      (x) => x.customerUserId === customerUserId && x.orderId === orderId && x.razorpayOrderId === razorpayOrderId
    );
    return p ? clone(p) : null;
  },
  lock: async (paymentId: string, tx: Tx) => {
    if (!state.payments.has(paymentId)) return null;
    await acquire(tx, `payment:${paymentId}`);
    return clone(state.payments.get(paymentId));
  },
  update: async (paymentId: string, data: any) => {
    await tick();
    Object.assign(state.payments.get(paymentId), data, { updatedAt: now() });
    return clone(state.payments.get(paymentId));
  },
  search: async (filter: any) => {
    const rows = [...state.payments.values()]
      .filter(
        (p) =>
          p.customerUserId === filter.customerUserId &&
          p.status !== "created" &&
          (!filter.from || p.createdAt >= filter.from) &&
          (!filter.to || p.createdAt <= filter.to)
      )
      .sort(newest("createdAt"));
    return page(rows, filter.page.offset, filter.page.limit);
  },
  listMethods: async (customerUserId: string, offset: number, limit: number) => {
    const rows = [...state.methods.values()]
      .filter((m) => m.customerUserId === customerUserId)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || newest("createdAt")(a, b));
    return page(rows, offset, limit);
  },
  countMethods: async (customerUserId: string) => [...state.methods.values()].filter((m) => m.customerUserId === customerUserId).length,
  findMethodByToken: async (customerUserId: string, providerToken: string) => {
    await tick();
    const m = [...state.methods.values()].find((x) => x.customerUserId === customerUserId && x.providerToken === providerToken);
    return m ? clone(m) : null;
  },
  clearDefault: async (customerUserId: string) => {
    for (const m of state.methods.values()) {
      if (m.customerUserId === customerUserId && m.isDefault) Object.assign(m, { isDefault: false, defaultKey: null });
    }
  },
  createMethod: async (data: any) => {
    await tick();
    const rows = [...state.methods.values()];
    if (rows.some((m) => m.customerUserId === data.customerUserId && m.providerToken === data.providerToken)) {
      throw uniqueViolation("uq_saved_method_token");
    }
    const defaultKey = data.isDefault ? data.customerUserId : null;
    if (defaultKey && rows.some((m) => m.defaultKey === defaultKey)) throw uniqueViolation("uq_saved_method_default");
    const method = { id: id(), createdAt: now(), ...data, defaultKey };
    state.methods.set(method.id, method);
    return clone(method);
  },
  deleteMethod: async (customerUserId: string, methodId: string) => {
    const m = state.methods.get(methodId);
    if (!m || m.customerUserId !== customerUserId) return { found: false, wasDefault: false };
    state.methods.delete(methodId);
    return { found: true, wasDefault: m.isDefault };
  },
  promoteNewest: async (customerUserId: string) => {
    const newestMethod = [...state.methods.values()].filter((m) => m.customerUserId === customerUserId).sort(newest("createdAt"))[0];
    if (newestMethod) Object.assign(newestMethod, { isDefault: true, defaultKey: customerUserId });
  },
};

// ------------------------------------------------- the three other services
export const fake = {
  finance: {
    calls: [] as Array<{ path: string; body: any }>,
    failWith: null as Error | null,
    // razorpayPaymentId -> what finance says about it; anything else is "captured".
    verdicts: new Map<string, string>(),
    checkouts: new Map<string, any>(),
    counter: 0,
  },
  logistics: {
    jobs: new Map<string, any[]>(),
    failWith: null as Error | null,
    calls: 0,
  },
};

const financeOrders = (body: any) => {
  if (body.idempotencyKey && fake.finance.checkouts.has(body.idempotencyKey)) {
    return clone(fake.finance.checkouts.get(body.idempotencyKey));
  }
  fake.finance.counter += 1;
  const checkout = {
    paymentId: `fin-${fake.finance.counter}`,
    razorpayOrderId: `order_${fake.finance.counter}`,
    amountPaise: body.amountPaise,
    currency: "INR",
    keyId: "rzp_test_key",
    orderRef: body.orderRef,
  };
  if (body.idempotencyKey) fake.finance.checkouts.set(body.idempotencyKey, checkout);
  fake.finance.checkouts.set(checkout.razorpayOrderId, checkout);
  const { orderRef: _ref, ...payload } = checkout;
  return payload;
};

const financeVerify = (body: any) => {
  const checkout = fake.finance.checkouts.get(body.razorpayOrderId);
  if (!checkout) throw new CustomException("Payment not found.", 404);
  if (body.razorpaySignature !== "sig_ok") throw new CustomException("Payment signature is invalid.", 400);
  return {
    paymentId: checkout.paymentId,
    orderRef: checkout.orderRef,
    status: fake.finance.verdicts.get(body.razorpayPaymentId) ?? "captured",
    amountPaise: checkout.amountPaise,
  };
};

// Stands in for commons/Http/ServiceClient: the gateway (single user and bulk lookup),
// finance and logistics. The gateway answers come from the account package's fake.
export const serviceClientMock = {
  ServiceClient: {
    get: async (target: string, path: string, options: any = {}) => {
      if (target === "gateway") {
        gateway.calls += 1;
        if (gateway.failWith) throw gateway.failWith;
        const user = gateway.users.get(decodeURIComponent(path.split("/").pop() as string));
        if (!user) throw new CustomException("User not found.", 404);
        return clone(user);
      }
      if (target === "logistics" && path === "/internal/jobs") {
        fake.logistics.calls += 1;
        if (fake.logistics.failWith) throw fake.logistics.failWith;
        return { jobs: clone(fake.logistics.jobs.get(options.query.orderId) ?? []) };
      }
      throw new Error(`unexpected GET ${target}${path}`);
    },
    post: async (target: string, path: string, options: any = {}) => {
      if (target === "gateway" && path === "/internal/users/lookup") {
        if (gateway.failWith) throw gateway.failWith;
        return { users: (options.body.ids as string[]).map((uid) => gateway.users.get(uid)).filter(Boolean).map(clone) };
      }
      if (target === "finance") {
        fake.finance.calls.push({ path, body: clone(options.body) });
        if (fake.finance.failWith) throw fake.finance.failWith;
        await tick();
        if (path === "/internal/payments/orders") return financeOrders(options.body);
        if (path === "/internal/payments/verify") return financeVerify(options.body);
      }
      throw new Error(`unexpected POST ${target}${path}`);
    },
  },
};
