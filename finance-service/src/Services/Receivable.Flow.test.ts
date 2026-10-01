// In-memory Receivable query layer. applyPayment is one atomic check-and-decrement like the guarded
// UPDATE; the transaction rolls back its own decrements when it fails, like a database would.
jest.mock("../Queries/Transaction.Query.js", () => ({
  TransactionQuery: {
    run: async (work: any) => {
      const tx = { undo: [] as Array<() => void> };
      try {
        return await work(tx);
      } catch (error) {
        tx.undo.reverse().forEach((undo) => undo());
        throw error;
      }
    },
  },
}));
jest.mock("../Queries/Ledger.Query.js", () => ({ LedgerQuery: { post: async (posting: any) => (globalThis as any).__ledger.push(posting) } }));
jest.mock("../Clients/Growth.Client.js", () => ({ GrowthClient: { dispatch: jest.fn() } }));
jest.mock("../Queries/Receivable.Query.js", () => {
  const rows = new Map<string, any>();
  const contacts = new Map<string, any>();
  const payments: any[] = [];
  const reminders: any[] = [];
  let seq = 0;
  const uuid = (p: string) => `${p}-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const clone = (x: any) => (x ? { ...x } : null);
  const visible = (r: any, scope: string | null) => r && (!scope || r.storeId === scope);
  return {
    __rows: rows,
    __contacts: contacts,
    __payments: payments,
    __reminders: reminders,
    ReceivableQuery: {
      create: async (data: any) => {
        if ([...rows.values()].some((r) => r.invoiceId === data.invoiceId)) return false;
        const { contactPhone, contactEmail, ...rest } = data;
        const row = { id: uuid("a0000000"), balancePaise: data.amountPaise, lastRemindedAt: null, createdAt: new Date(), updatedAt: new Date(), ...rest };
        rows.set(row.id, row);
        contacts.set(row.id, { phone: contactPhone, email: contactEmail });
        return true;
      },
      findById: async (id: string, scope: string | null) => (visible(rows.get(id), scope) ? clone(rows.get(id)) : null),
      findByInvoice: async (invoiceId: string) => clone([...rows.values()].find((r) => r.invoiceId === invoiceId)),
      findContact: async (id: string) => clone(contacts.get(id)),
      search: jest.fn(async () => ({ items: [...rows.values()].map(clone), total: rows.size })),
      aging: jest.fn(async () => [{ label: "Not yet due", amountPaise: 500, count: 1 }, { label: "1-30 days", amountPaise: 1500, count: 2 }]),
      listPayments: async (id: string) => payments.filter((p) => p.receivableId === id),
      applyPayment: async (id: string, amount: number, tx: any) => {
        const row = rows.get(id);
        if (!row || row.balancePaise < amount) return false;
        row.balancePaise -= amount;
        tx.undo.push(() => (row.balancePaise += amount));
        return true;
      },
      findPaymentByKey: async (receivableId: string, key: string) =>
        clone(payments.find((p) => p.receivableId === receivableId && p.idempotencyKey === key)),
      addPayment: async (data: any, tx: any) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (data.idempotencyKey && payments.some((p) => p.receivableId === data.receivableId && p.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        const row = { id: uuid("b0000000"), createdAt: new Date(), ...data };
        payments.push(row);
        tx.undo.push(() => payments.splice(payments.indexOf(row), 1));
        return clone(row);
      },
      listForReminders: jest.fn(async () => []),
      recordReminders: jest.fn(async (attempts: any[]) => {
        for (const a of attempts) {
          reminders.push(a);
          if (a.delivered) rows.get(a.id).lastRemindedAt = new Date();
        }
      }),
    },
  };
});
const ledger: any[] = [];
(globalThis as any).__ledger = ledger;

import { CustomException } from "../../commons/Exception/CustomException.js";
import { Actor } from "../Middleware/StoreScope.js";
import { clock } from "../Utils/Dates.js";
import { ReceivableService } from "./Receivable.Service.js";

const { __rows: rows, __contacts: contacts, __payments: payments, __reminders: reminders, ReceivableQuery } = jest.requireMock("../Queries/Receivable.Query.js");
const { GrowthClient } = jest.requireMock("../Clients/Growth.Client.js");

const STORE_A = "11111111-1111-4111-8111-111111111101";
const STORE_B = "11111111-1111-4111-8111-111111111102";
const CUSTOMER = "22222222-2222-4222-8222-222222222201";
const admin: Actor = { id: "admin-1", role: "admin", name: "Asha", storeId: null, scopeStoreId: null };
const scopedToB: Actor = { ...admin, scopeStoreId: STORE_B };

const failure = async (promise: Promise<unknown>): Promise<CustomException> => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a refusal");
};

let seqInvoice = 0;
const register = (overrides: Record<string, unknown> = {}) =>
  ReceivableService.registerFromCommerce({
    invoiceId: `33333333-3333-4333-8333-${String(++seqInvoice).padStart(12, "0")}`,
    customerId: CUSTOMER,
    storeId: STORE_A,
    orderRef: "LOC-7",
    amountPaise: 100_000,
    dueOn: "2026-09-20",
    contactPhone: "+919800000001",
    contactEmail: "pat@example.com",
    ...overrides,
  });

beforeEach(() => {
  rows.clear();
  contacts.clear();
  payments.length = 0;
  reminders.length = 0;
  ledger.length = 0;
  seqInvoice = 0;
  jest.clearAllMocks();
  clock.now = () => new Date("2026-10-01T06:00:00Z");
  GrowthClient.dispatch.mockResolvedValue({ delivered: true, error: null });
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  clock.now = () => new Date();
});

describe("registering from commerce", () => {
  it("registers an invoice once; the same invoice again is a no-op", async () => {
    const first = await register({ invoiceId: "33333333-3333-4333-8333-000000000099" });
    expect(first.created).toBe(true);
    const again = await register({ invoiceId: "33333333-3333-4333-8333-000000000099" });
    expect(again).toMatchObject({ id: first.id, created: false });
    expect(rows.size).toBe(1);
  });

  it("refuses the same invoice with a different amount, and bad input", async () => {
    await register({ invoiceId: "33333333-3333-4333-8333-000000000099" });
    expect((await failure(register({ invoiceId: "33333333-3333-4333-8333-000000000099", amountPaise: 5 }))).errorCode).toBe(409);
    const bad: Array<Record<string, unknown>> = [
      { amountPaise: 0 },
      { amountPaise: 12.5 },
      { amountPaise: "100" },
      { dueOn: "2026-02-30" },
      { storeId: "x" },
      { contactPhone: "call me" },
      { contactEmail: "not-an-email" },
      { invoiceId: undefined },
    ];
    for (const patch of bad) expect((await failure(register(patch))).errorCode).toBe(400);
  });

  it("never returns the contact details it stored", async () => {
    const registered = await register();
    expect(JSON.stringify(registered)).not.toMatch(/9800000001|pat@example/);
    const view = await ReceivableService.getReceivable(registered.id, admin);
    expect(JSON.stringify(view)).not.toMatch(/9800000001|pat@example/);
  });
});

describe("reading", () => {
  it("derives status and days overdue from the balance and today's IST date", async () => {
    const overdue = await register({ dueOn: "2026-09-20" });
    const open = await register({ dueOn: "2026-10-05" });
    const paid = await register({ dueOn: "2026-09-01", amountPaise: 1000 });
    rows.get(paid.id).balancePaise = 0;
    const page = await ReceivableService.listReceivables({}, admin, { page: 1, limit: 20, offset: 0 });
    const byId = Object.fromEntries(page.items.map((i) => [i.id, i]));
    expect(byId[overdue.id]).toMatchObject({ status: "overdue", daysOverdue: 11, amount: 1000 });
    expect(byId[open.id]).toMatchObject({ status: "open", daysOverdue: 0 });
    expect(byId[paid.id]).toMatchObject({ status: "paid", daysOverdue: 0, amount: 0 });
  });

  it("passes filters and an olderThanDays cut-off to the query, and validates them", async () => {
    await ReceivableService.listReceivables({ status: "overdue", olderThanDays: "30", customerId: CUSTOMER }, admin, { page: 1, limit: 20, offset: 0 });
    expect(ReceivableQuery.search.mock.calls[0][0]).toMatchObject({ status: "overdue", dueOnOrBefore: "2026-09-01", customerId: CUSTOMER, today: "2026-10-01" });
    for (const query of [{ status: "late" }, { olderThanDays: "0" }, { olderThanDays: "x" }, { customerId: "x" }]) {
      expect((await failure(ReceivableService.listReceivables(query, admin, { page: 1, limit: 20, offset: 0 }))).errorCode).toBe(400);
    }
  });

  it("answers 404 for a receivable outside the admin's chosen store, and for a malformed id", async () => {
    const { id } = await register({ storeId: STORE_A });
    expect((await failure(ReceivableService.getReceivable(id, scopedToB))).errorCode).toBe(404);
    expect((await failure(ReceivableService.getReceivable("nope", admin))).errorCode).toBe(404);
    expect((await ReceivableService.getReceivable(id, admin)).id).toBe(id);
  });

  it("totals the aging buckets", async () => {
    const aging = await ReceivableService.getAging({}, admin);
    expect(aging.total).toBe(20);
    expect(aging.buckets[1]).toEqual({ label: "1-30 days", amount: 15, count: 2 });
    await ReceivableService.getAging({ storeId: STORE_B }, admin);
    expect(ReceivableQuery.aging.mock.calls[1]).toEqual(["2026-10-01", STORE_B]);
  });
});

describe("recording a payment", () => {
  const pay = (id: string, body: Record<string, unknown>, key?: string, actor = admin) => ReceivableService.recordPayment(id, body, actor, key);

  it("reduces the balance and moves it to paid when settled, journalling each payment", async () => {
    const { id } = await register({ amountPaise: 100_000 });
    const part = await pay(id, { amount: 400, mode: "cash" });
    expect(part).toMatchObject({ amount: 400, balance: 600, status: "overdue" });
    const rest = await pay(id, { amount: 600, mode: "upi", reference: "UTR123" });
    expect(rest).toMatchObject({ balance: 0, status: "paid" });
    expect(rows.get(id).balancePaise).toBe(0);
    expect(ledger.map((p) => p.lines.map((l: any) => [l.account, l.debitPaise, l.creditPaise]))).toEqual([
      [["cash", 40_000, 0], ["receivables", 0, 40_000]],
      [["bank", 60_000, 0], ["receivables", 0, 60_000]],
    ]);
    expect(ledger[0]).toMatchObject({ sourceType: "receivable_payment", storeId: STORE_A });
  });

  it("refuses more than is owed, and any payment on a settled balance", async () => {
    const { id } = await register({ amountPaise: 100_000 });
    expect((await failure(pay(id, { amount: 1000.01, mode: "cash" }))).errorCode).toBe(409);
    expect(rows.get(id).balancePaise).toBe(100_000);
    await pay(id, { amount: 1000, mode: "cash" });
    const again = await failure(pay(id, { amount: 1, mode: "cash" }));
    expect(again.errorCode).toBe(409);
    expect(again.displayMessage).toMatch(/already paid/);
  });

  it("validates the amount, mode and reference, and 404s on an unknown or other-store receivable", async () => {
    const { id } = await register();
    for (const body of [{ mode: "cash" }, { amount: 5 }, { amount: 0, mode: "cash" }, { amount: 5.555, mode: "cash" }, { amount: 5, mode: "cheque" }, { amount: 5, mode: "cash", reference: "x".repeat(121) }]) {
      expect((await failure(pay(id, body))).errorCode).toBe(400);
    }
    expect((await failure(pay("nope", { amount: 5, mode: "cash" }))).errorCode).toBe(404);
    expect((await failure(pay(id, { amount: 5, mode: "cash" }, undefined, scopedToB))).errorCode).toBe(404);
    expect(rows.get(id).balancePaise).toBe(100_000);
  });

  it("two payments that each fit alone but not together: one is taken, the balance never goes negative", async () => {
    const { id } = await register({ amountPaise: 100_000 });
    const results = await Promise.allSettled([pay(id, { amount: 700, mode: "cash" }), pay(id, { amount: 700, mode: "bank" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.errorCode).toBe(409);
    expect(rows.get(id).balancePaise).toBe(30_000);
    expect(payments).toHaveLength(1);
    expect(ledger).toHaveLength(1);
  });

  it("replays a payment for the same Idempotency-Key without taking the money twice", async () => {
    const { id } = await register({ amountPaise: 100_000 });
    const first = await pay(id, { amount: 300, mode: "cash" }, "key-1");
    const second = await pay(id, { amount: 300, mode: "cash" }, "key-1");
    expect(second.id).toBe(first.id);
    expect(rows.get(id).balancePaise).toBe(70_000);
    expect(payments).toHaveLength(1);
    expect((await failure(pay(id, { amount: 301, mode: "cash" }, "key-1"))).errorCode).toBe(409);
  });

  it("two simultaneous sends of one key take the money once", async () => {
    const { id } = await register({ amountPaise: 100_000 });
    const [a, b] = await Promise.all([pay(id, { amount: 300, mode: "cash" }, "key-race"), pay(id, { amount: 300, mode: "cash" }, "key-race")]);
    expect(a.id).toBe(b.id);
    expect(rows.get(id).balancePaise).toBe(70_000);
    expect(payments).toHaveLength(1);
  });
});

describe("reminding one customer", () => {
  it("sends through growth with the right address for the channel and logs the attempt", async () => {
    const { id } = await register();
    const result = await ReceivableService.sendReminder(id, { channel: "email", message: "Please pay" }, admin);
    expect(result).toEqual({ receivableId: id, channel: "email", delivered: true });
    expect(GrowthClient.dispatch).toHaveBeenCalledWith({
      channel: "email",
      to: "pat@example.com",
      templateId: "receivable_reminder",
      params: { amount: "1000.00", dueOn: "2026-09-20", invoice: "LOC-7", message: "Please pay" },
      customerId: CUSTOMER,
    });
    await ReceivableService.sendReminder(id, { channel: "sms" }, admin);
    expect(GrowthClient.dispatch.mock.calls[1][0].to).toBe("+919800000001");
    expect(reminders).toHaveLength(2);
    expect(rows.get(id).lastRemindedAt).toBeInstanceOf(Date);
  });

  it("reports a failed delivery instead of failing, and does not mark the customer as reminded", async () => {
    const { id } = await register();
    GrowthClient.dispatch.mockResolvedValue({ delivered: false, error: "unavailable" });
    await expect(ReceivableService.sendReminder(id, { channel: "sms" }, admin)).resolves.toMatchObject({ delivered: false });
    expect(reminders[0]).toMatchObject({ delivered: false, error: "unavailable" });
    expect(rows.get(id).lastRemindedAt).toBeNull();
  });

  it("refuses a settled balance, a missing address, a bad channel, and an unknown receivable", async () => {
    const settled = await register({ amountPaise: 1000 });
    rows.get(settled.id).balancePaise = 0;
    expect((await failure(ReceivableService.sendReminder(settled.id, { channel: "sms" }, admin))).errorCode).toBe(409);
    const noPhone = await register({ contactPhone: undefined });
    expect((await failure(ReceivableService.sendReminder(noPhone.id, { channel: "whatsapp" }, admin))).errorCode).toBe(409);
    expect((await failure(ReceivableService.sendReminder(noPhone.id, { channel: "pigeon" }, admin))).errorCode).toBe(400);
    expect((await failure(ReceivableService.sendReminder(noPhone.id, {}, admin))).errorCode).toBe(400);
    expect((await failure(ReceivableService.sendReminder("nope", { channel: "sms" }, admin))).errorCode).toBe(404);
    expect(GrowthClient.dispatch).not.toHaveBeenCalled();
  });
});

describe("the reminder run", () => {
  const due = async (count: number, withPhone = true) => {
    const batch = [];
    for (let i = 0; i < count; i++) {
      const registered = await register(withPhone ? {} : { contactPhone: undefined });
      batch.push({ receivable: rows.get(registered.id), contact: contacts.get(registered.id) });
    }
    return batch;
  };

  it("asks only for overdue balances not reminded in the last 24 hours, at most 50 at a time", async () => {
    await ReceivableService.runReminders({ olderThanDays: 3 }, admin);
    const [dueOnOrBefore, remindedBefore, limit] = ReceivableQuery.listForReminders.mock.calls[0];
    expect(dueOnOrBefore).toBe("2026-09-28");
    expect(clock.now().getTime() - remindedBefore.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(limit).toBe(50);
  });

  it("counts sent, failed and customers without an address, and says when more may be waiting", async () => {
    const withPhone = await due(3);
    const without = await due(1, false);
    ReceivableQuery.listForReminders.mockResolvedValueOnce([...withPhone, ...without]);
    GrowthClient.dispatch.mockResolvedValueOnce({ delivered: true, error: null }).mockResolvedValueOnce({ delivered: false, error: "unavailable" }).mockResolvedValueOnce({ delivered: true, error: null });
    const result = await ReceivableService.runReminders({ channel: "sms" }, admin);
    expect(result).toEqual({ sent: 2, failed: 1, noContact: 1, more: false });
    expect(ReceivableQuery.recordReminders).toHaveBeenCalledTimes(1);
    ReceivableQuery.listForReminders.mockResolvedValueOnce(Array.from({ length: 50 }, () => withPhone[0]));
    expect((await ReceivableService.runReminders({}, admin)).more).toBe(true);
  });

  it("a second run straight after sends nobody again (delivered customers are stamped)", async () => {
    const batch = await due(2);
    const stamped = new Set<string>();
    ReceivableQuery.listForReminders.mockImplementation(async () => batch.filter((b: any) => !stamped.has(b.receivable.id)));
    ReceivableQuery.recordReminders.mockImplementation(async (attempts: any[]) => attempts.forEach((a) => a.delivered && stamped.add(a.id)));
    expect((await ReceivableService.runReminders({}, admin)).sent).toBe(2);
    expect((await ReceivableService.runReminders({}, admin)).sent).toBe(0);
    expect(GrowthClient.dispatch).toHaveBeenCalledTimes(2);
  });

  it("validates its options", async () => {
    expect((await failure(ReceivableService.runReminders({ olderThanDays: -1 }, admin))).errorCode).toBe(400);
    expect((await failure(ReceivableService.runReminders({ channel: "fax" }, admin))).errorCode).toBe(400);
  });
});
