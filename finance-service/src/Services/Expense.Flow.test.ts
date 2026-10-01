jest.mock("../Queries/Transaction.Query.js", () => ({ TransactionQuery: { run: async (work: any) => work({}) } }));
jest.mock("../Queries/Ledger.Query.js", () => ({ LedgerQuery: { post: async (posting: any) => (globalThis as any).__ledger.push(posting) } }));
jest.mock("../Queries/Expense.Query.js", () => {
  const categories = new Map<string, any>();
  const expenses = new Map<string, any>();
  const events: any[] = [];
  const receipts: any[] = [];
  let seq = 0;
  const uuid = (prefix: string) => `${prefix}-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const clone = (x: any) => (x ? { ...x } : null);
  const visible = (e: any, scope: string | null) => e && !e.deletedAt && (!scope || e.storeId === scope);
  return {
    __categories: categories,
    __expenses: expenses,
    __events: events,
    __receipts: receipts,
    ExpenseQuery: {
      listCategories: async () => ({ items: [...categories.values()].map(clone), total: categories.size }),
      findCategory: async (id: string) => clone(categories.get(id)),
      findCategoryByKey: async (key: string) => clone([...categories.values()].find((c) => c.nameKey === key)),
      createCategory: async (data: any) => {
        const row = { id: uuid("c0000000"), createdAt: new Date(), updatedAt: new Date(), ...data };
        categories.set(row.id, row);
        return clone(row);
      },
      updateCategory: async (id: string, data: any) => {
        Object.assign(categories.get(id), data);
        return clone(categories.get(id));
      },
      ancestorsOf: async (id: string) => {
        const chain: string[] = [];
        let current = categories.get(id)?.parentId;
        while (current) {
          chain.push(current);
          current = categories.get(current)?.parentId;
        }
        return chain;
      },
      countCategoryUse: async (id: string) => ({
        children: [...categories.values()].filter((c) => c.parentId === id).length,
        expenses: [...expenses.values()].filter((e) => e.categoryId === id).length,
      }),
      deleteCategory: async (id: string) => void categories.delete(id),
      create: async (data: any) => {
        const row = { id: uuid("e0000000"), status: "recorded", deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        expenses.set(row.id, row);
        return clone(row);
      },
      findByKey: async (creator: string, key: string) =>
        clone([...expenses.values()].find((e) => e.createdByUserId === creator && e.idempotencyKey === key)),
      findById: async (id: string, scope: string | null) => {
        const row = expenses.get(id);
        return visible(row, scope) ? clone(row) : null;
      },
      lockById: async (id: string, scope: string | null) => {
        const row = expenses.get(id);
        return visible(row, scope) ? clone(row) : null;
      },
      search: jest.fn(async (filter: any) => {
        const items = [...expenses.values()].filter(
          (e) => visible(e, null) && (!filter.storeId || e.storeId === filter.storeId) && (!filter.status || e.status === filter.status)
        );
        return { items: items.map(clone), total: items.length };
      }),
      update: async (id: string, data: any) => {
        Object.assign(expenses.get(id), data);
        return clone(expenses.get(id));
      },
      transition: async (id: string, from: string, to: string) => {
        const row = expenses.get(id);
        if (!row || row.status !== from || row.deletedAt) return false;
        row.status = to;
        return true;
      },
      softDelete: async (id: string) => {
        const row = expenses.get(id);
        if (!row || !["recorded", "rejected"].includes(row.status) || row.deletedAt) return false;
        row.deletedAt = new Date();
        return true;
      },
      addEvent: async (event: any) => void events.push({ ...event, createdAt: new Date(), id: uuid("v0000000") }),
      listEvents: async (expenseId: string) => events.filter((e) => e.expenseId === expenseId),
      listReceipts: async (expenseId: string) => receipts.filter((r) => r.expenseId === expenseId),
      addReceipt: async (data: any) => {
        if (receipts.some((r) => r.expenseId === data.expenseId && r.sha256 === data.sha256)) return false;
        receipts.push({ id: uuid("r0000000"), createdAt: new Date(), ...data });
        return true;
      },
      findReceiptByHash: async (expenseId: string, sha256: string) => clone(receipts.find((r) => r.expenseId === expenseId && r.sha256 === sha256)),
      countReceipts: async (expenseId: string) => receipts.filter((r) => r.expenseId === expenseId).length,
    },
  };
});
const ledger: any[] = [];
(globalThis as any).__ledger = ledger;

import { CustomException } from "../../commons/Exception/CustomException.js";
import { Actor } from "../Middleware/StoreScope.js";
import { ExpenseService } from "./Expense.Service.js";

const { __categories: categories, __expenses: expenses, __events: events, __receipts: receipts, ExpenseQuery } = jest.requireMock("../Queries/Expense.Query.js");

const STORE_A = "11111111-1111-4111-8111-111111111101";
const STORE_B = "11111111-1111-4111-8111-111111111102";
const admin: Actor = { id: "admin-1", role: "admin", name: "Asha", storeId: null, scopeStoreId: null };
const approver: Actor = { id: "admin-2", role: "admin", name: "Ben", storeId: null, scopeStoreId: null };
const managerA: Actor = { id: "m-1", role: "manager", name: "Meera", storeId: STORE_A, scopeStoreId: null };

const failure = async (promise: Promise<unknown>): Promise<CustomException> => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a refusal");
};

let rent: { id: string };
const newExpense = (overrides: Record<string, unknown> = {}, key?: string, actor = admin) =>
  ExpenseService.createExpense({ date: "2026-09-30", categoryId: rent.id, amount: 1200.5, storeId: STORE_A, ...overrides }, actor, key);

beforeEach(async () => {
  categories.clear();
  expenses.clear();
  events.length = 0;
  receipts.length = 0;
  ledger.length = 0;
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  rent = await ExpenseService.createCategory({ name: "Rent" });
});
afterEach(() => jest.restoreAllMocks());

describe("categories", () => {
  it("creates, reads and lists categories, names unique ignoring case", async () => {
    expect(rent).toMatchObject({ name: "Rent", parentId: null });
    expect((await failure(ExpenseService.createCategory({ name: "  RENT " }))).errorCode).toBe(409);
    const child = await ExpenseService.createCategory({ name: "Shop rent", parentId: (rent as any).id });
    expect(child.parentId).toBe((rent as any).id);
    expect((await ExpenseService.listCategories({ page: 1, limit: 20, offset: 0 })).total).toBe(2);
    expect((await ExpenseService.getCategory((rent as any).id)).name).toBe("Rent");
  });

  it("validates names and parents", async () => {
    expect((await failure(ExpenseService.createCategory({}))).errorCode).toBe(400);
    expect((await failure(ExpenseService.createCategory({ name: "x".repeat(81) }))).errorCode).toBe(400);
    expect((await failure(ExpenseService.createCategory({ name: "A", parentId: "nope" }))).errorCode).toBe(400);
    expect((await failure(ExpenseService.createCategory({ name: "A", parentId: "dddddddd-0000-4000-8000-000000000001" }))).errorCode).toBe(400);
  });

  it("refuses to make a category its own parent or move it beneath its own child", async () => {
    const child = await ExpenseService.createCategory({ name: "Child", parentId: (rent as any).id });
    expect((await failure(ExpenseService.updateCategory((rent as any).id, { parentId: (rent as any).id }))).errorCode).toBe(400);
    expect((await failure(ExpenseService.updateCategory((rent as any).id, { parentId: child.id }))).errorCode).toBe(400);
    expect((await ExpenseService.updateCategory(child.id, { name: "Renamed" })).name).toBe("Renamed");
    expect((await failure(ExpenseService.updateCategory(child.id, {}))).errorCode).toBe(400);
    expect((await failure(ExpenseService.updateCategory(child.id, { name: "rent" }))).errorCode).toBe(409);
  });

  it("deletes only a category nothing uses, and answers 404 for an unknown one", async () => {
    await newExpense();
    expect((await failure(ExpenseService.deleteCategory((rent as any).id))).errorCode).toBe(409);
    const spare = await ExpenseService.createCategory({ name: "Spare" });
    await expect(ExpenseService.deleteCategory(spare.id)).resolves.toMatchObject({ deleted: true });
    expect((await failure(ExpenseService.deleteCategory(spare.id))).errorCode).toBe(404);
    expect((await failure(ExpenseService.getCategory("nope"))).errorCode).toBe(404);
  });
});

describe("creating an expense", () => {
  it("records it in paise as 'recorded' with a first history entry naming who did it", async () => {
    const expense = await newExpense();
    expect(expense).toMatchObject({ status: "recorded", amount: 1200.5, storeId: STORE_A });
    expect([...expenses.values()][0].amountPaise).toBe(120_050);
    expect(events).toEqual([expect.objectContaining({ action: "created", toStatus: "recorded", actorUserId: "admin-1", actorName: "Asha" })]);
  });

  it("is always created as recorded: a status other than recorded is refused", async () => {
    expect((await failure(newExpense({ status: "approved" }))).errorCode).toBe(400);
    await expect(newExpense({ status: "recorded" })).resolves.toBeDefined();
  });

  it("validates every field", async () => {
    const bad: Array<Record<string, unknown>> = [
      { date: undefined },
      { date: "2026-02-30" },
      { date: "2099-01-01" },
      { categoryId: "nope" },
      { categoryId: "dddddddd-0000-4000-8000-000000000001" },
      { amount: 0 },
      { amount: -3 },
      { amount: 10.123 },
      { amount: 99_999_999_999 },
      { storeId: "x" },
      { paymentMode: "cheque" },
      { description: "x".repeat(501) },
    ];
    for (const patch of bad) expect((await failure(newExpense(patch))).errorCode).toBe(400);
    expect(expenses.size).toBe(0);
  });

  it("replays the original for the same Idempotency-Key, and refuses the key for a different expense", async () => {
    const first = await newExpense({}, "k1");
    const again = await newExpense({}, "k1");
    expect(again.id).toBe(first.id);
    expect(expenses.size).toBe(1);
    expect(events.filter((e) => e.action === "created")).toHaveLength(1);
    expect((await failure(newExpense({ amount: 5 }, "k1"))).errorCode).toBe(409);
    // The key belongs to the person who sent it.
    expect((await newExpense({}, "k1", approver)).id).not.toBe(first.id);
  });
});

describe("approval flow", () => {
  it("records recorded -> approved -> paid, each step in the append-only history with its actor", async () => {
    const { id } = await newExpense({ paymentMode: "cash" });
    await ExpenseService.approveExpense(id, { note: "Looks right" }, approver);
    await ExpenseService.updateExpense(id, { status: "paid" }, approver);
    const view = await ExpenseService.getExpense(id, admin);
    expect(view.status).toBe("paid");
    expect(view.history.map((h: any) => [h.action, h.from, h.to, h.by])).toEqual([
      ["created", null, "recorded", "Asha"],
      ["approved", "recorded", "approved", "Ben"],
      ["paid", "approved", "paid", "Ben"],
    ]);
    expect(view.history[1].note).toBe("Looks right");
  });

  it("approving twice is a no-op, not a second history entry", async () => {
    const { id } = await newExpense();
    await ExpenseService.approveExpense(id, {}, approver);
    await ExpenseService.approveExpense(id, {}, approver);
    expect(events.filter((e) => e.action === "approved")).toHaveLength(1);
  });

  it("can reject, and a rejected expense is final", async () => {
    const { id } = await newExpense();
    await ExpenseService.updateExpense(id, { status: "rejected", note: "No invoice" }, approver);
    expect(expenses.get(id).status).toBe("rejected");
    expect((await failure(ExpenseService.approveExpense(id, {}, approver))).errorCode).toBe(409);
    expect((await failure(ExpenseService.updateExpense(id, { status: "recorded" }, approver))).errorCode).toBe(409);
    expect((await failure(ExpenseService.updateExpense(id, { amount: 5 }, approver))).errorCode).toBe(409);
  });

  it("refuses every transition the machine does not allow", async () => {
    const { id } = await newExpense({ paymentMode: "bank" });
    expect((await failure(ExpenseService.updateExpense(id, { status: "paid" }, admin))).errorCode).toBe(409); // not yet approved
    await ExpenseService.approveExpense(id, {}, admin);
    expect((await failure(ExpenseService.updateExpense(id, { status: "recorded" }, admin))).errorCode).toBe(409);
    expect((await failure(ExpenseService.updateExpense(id, { status: "rejected" }, admin))).errorCode).toBe(409);
    await ExpenseService.updateExpense(id, { status: "paid" }, admin);
    for (const status of ["recorded", "approved", "rejected"]) {
      expect((await failure(ExpenseService.updateExpense(id, { status }, admin))).errorCode).toBe(409);
    }
    expect(expenses.get(id).status).toBe("paid");
  });

  it("needs a payment mode before it can be paid, and the mode can still be set while approved", async () => {
    const { id } = await newExpense({ paymentMode: undefined });
    await ExpenseService.approveExpense(id, {}, admin);
    expect((await failure(ExpenseService.updateExpense(id, { status: "paid" }, admin))).errorCode).toBe(409);
    await ExpenseService.updateExpense(id, { paymentMode: "upi", status: "paid" }, admin);
    expect(expenses.get(id)).toMatchObject({ status: "paid", paymentMode: "upi" });
  });

  it("journals a paid expense once: debit the category, credit cash or bank by mode", async () => {
    const cash = await newExpense({ paymentMode: "cash" });
    const card = await newExpense({ paymentMode: "card", amount: 50 });
    for (const e of [cash, card]) {
      await ExpenseService.approveExpense(e.id, {}, admin);
      await ExpenseService.updateExpense(e.id, { status: "paid" }, admin);
    }
    expect(ledger).toHaveLength(2);
    expect(ledger[0]).toMatchObject({ sourceType: "expense_paid", sourceId: cash.id, storeId: STORE_A });
    expect(ledger[0].lines).toEqual([
      { account: "expense:rent", debitPaise: 120_050, creditPaise: 0 },
      { account: "cash", debitPaise: 0, creditPaise: 120_050 },
    ]);
    expect(ledger[1].lines[1]).toMatchObject({ account: "bank", creditPaise: 5000 });
  });

  it("freezes the approved numbers: amount, date and category cannot change after approval", async () => {
    const { id } = await newExpense();
    await ExpenseService.updateExpense(id, { amount: 99 }, admin);
    expect(expenses.get(id).amountPaise).toBe(9900);
    await ExpenseService.approveExpense(id, {}, admin);
    for (const patch of [{ amount: 1 }, { date: "2026-09-01" }, { description: "changed" }]) {
      expect((await failure(ExpenseService.updateExpense(id, patch, admin))).errorCode).toBe(409);
    }
    expect(expenses.get(id).amountPaise).toBe(9900);
  });

  it("records an edit in the history, listing the fields that changed", async () => {
    const { id } = await newExpense();
    await ExpenseService.updateExpense(id, { amount: 10, description: "x" }, admin);
    expect(events.at(-1)).toMatchObject({ action: "edited", note: "Changed: amount, description" });
  });

  it("whitelists what a PATCH may change: unknown fields (status of others, ids, createdBy) are ignored", async () => {
    const { id } = await newExpense();
    await ExpenseService.updateExpense(id, { amount: 10, createdByUserId: "attacker", id: "x", deletedAt: "2020-01-01" }, admin);
    expect(expenses.get(id)).toMatchObject({ createdByUserId: "admin-1", deletedAt: null, amountPaise: 1000 });
    expect((await failure(ExpenseService.updateExpense(id, { createdByUserId: "attacker" }, admin))).errorCode).toBe(400);
  });

  it("an approve and a reject racing: exactly one wins and the history agrees with the status", async () => {
    const { id } = await newExpense();
    const results = await Promise.allSettled([
      ExpenseService.approveExpense(id, {}, approver),
      ExpenseService.updateExpense(id, { status: "rejected" }, admin),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const last = events.filter((e) => e.expenseId === id).at(-1);
    expect(last.toStatus).toBe(expenses.get(id).status);
  });
});

describe("deleting", () => {
  it("soft-deletes a recorded expense, which then reads as not found", async () => {
    const { id } = await newExpense();
    await expect(ExpenseService.deleteExpense(id, admin)).resolves.toMatchObject({ deleted: true });
    expect(expenses.get(id).deletedAt).toBeInstanceOf(Date);
    expect((await failure(ExpenseService.getExpense(id, admin))).errorCode).toBe(404);
    expect((await failure(ExpenseService.deleteExpense(id, admin))).errorCode).toBe(404);
  });

  it("refuses to delete an approved or paid expense: the history must stay", async () => {
    const { id } = await newExpense();
    await ExpenseService.approveExpense(id, {}, admin);
    expect((await failure(ExpenseService.deleteExpense(id, admin))).errorCode).toBe(409);
    expect(expenses.get(id).deletedAt).toBeNull();
  });
});

describe("store scope", () => {
  it("lets a manager read only their own store's expenses; another store's is 404, not 403", async () => {
    const mine = await newExpense({ storeId: STORE_A });
    const theirs = await newExpense({ storeId: STORE_B });
    const company = await newExpense({ storeId: undefined });
    expect((await ExpenseService.getExpense(mine.id, managerA)).id).toBe(mine.id);
    expect((await failure(ExpenseService.getExpense(theirs.id, managerA))).errorCode).toBe(404);
    expect((await failure(ExpenseService.getExpense(company.id, managerA))).errorCode).toBe(404);
    expect((await ExpenseService.getExpense(theirs.id, admin)).id).toBe(theirs.id);
  });

  it("forces a manager's list to their store, even when they ask for another", async () => {
    await ExpenseService.listExpenses({}, managerA, { page: 1, limit: 20, offset: 0 });
    expect(ExpenseQuery.search.mock.calls[0][0].storeId).toBe(STORE_A);
    expect((await failure(ExpenseService.listExpenses({ storeId: STORE_B }, managerA, { page: 1, limit: 20, offset: 0 }))).errorCode).toBe(404);
    await ExpenseService.listExpenses({ storeId: STORE_B, status: "approved" }, admin, { page: 1, limit: 20, offset: 0 });
    expect(ExpenseQuery.search.mock.calls[1][0]).toMatchObject({ storeId: STORE_B, status: "approved" });
  });

  it("refuses a store-bound role with no store", async () => {
    const homeless: Actor = { ...managerA, storeId: null };
    expect((await failure(ExpenseService.listExpenses({}, homeless, { page: 1, limit: 20, offset: 0 }))).errorCode).toBe(403);
  });

  it("validates list filters", async () => {
    for (const query of [{ status: "bogus" }, { categoryId: "x" }, { from: "2026-13-01" }, { from: "2026-02-01", to: "2026-01-01" }, { storeId: ["a", "b"] }]) {
      expect((await failure(ExpenseService.listExpenses(query, admin, { page: 1, limit: 20, offset: 0 }))).errorCode).toBe(400);
    }
  });
});

describe("receipts", () => {
  const pdf = (body = "%PDF-1.4 receipt") => ({ field: "file", fileName: "r.pdf", contentType: "application/pdf", content: Buffer.from(body) });

  it("attaches a receipt as a reference with its fingerprint", async () => {
    const { id } = await newExpense();
    const receipt = await ExpenseService.attachReceipt(id, pdf(), admin);
    expect(receipt).toMatchObject({ expenseId: id, fileName: "r.pdf", contentType: "application/pdf", sizeBytes: 16 });
    expect(receipt.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await ExpenseService.getExpense(id, admin)).receipts).toHaveLength(1);
  });

  it("treats the same file attached twice as one receipt", async () => {
    const { id } = await newExpense();
    const first = await ExpenseService.attachReceipt(id, pdf(), admin);
    const second = await ExpenseService.attachReceipt(id, pdf(), admin);
    expect(second.id).toBe(first.id);
    expect(receipts).toHaveLength(1);
  });

  it("checks the real file type, size, count and the expense", async () => {
    const { id } = await newExpense();
    const spoofed = { ...pdf("<html>not a pdf</html>"), contentType: "application/pdf" };
    expect((await failure(ExpenseService.attachReceipt(id, spoofed, admin))).errorCode).toBe(400);
    expect((await failure(ExpenseService.attachReceipt(id, { ...pdf(), contentType: "text/html" }, admin))).errorCode).toBe(400);
    expect((await failure(ExpenseService.attachReceipt(id, undefined, admin))).errorCode).toBe(400);
    expect((await failure(ExpenseService.attachReceipt(id, pdf(""), admin))).errorCode).toBe(400);
    expect((await failure(ExpenseService.attachReceipt(id, { ...pdf(), content: Buffer.alloc(2 * 1024 * 1024 + 1, 1) }, admin))).errorCode).toBe(413);
    expect((await failure(ExpenseService.attachReceipt("dddddddd-0000-4000-8000-000000000001", pdf(), admin))).errorCode).toBe(404);
    for (let i = 0; i < 5; i++) await ExpenseService.attachReceipt(id, pdf(`%PDF-1.4 number ${i}`), admin);
    expect((await failure(ExpenseService.attachReceipt(id, pdf("%PDF-1.4 one too many"), admin))).errorCode).toBe(409);
  });

  it("accepts PNG and JPEG by their signatures", async () => {
    const { id } = await newExpense();
    const png = { field: "file", fileName: "a.png", contentType: "image/png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]) };
    const jpg = { field: "file", fileName: "a.jpg", contentType: "image/jpeg", content: Buffer.from([0xff, 0xd8, 0xff, 1]) };
    await expect(ExpenseService.attachReceipt(id, png, admin)).resolves.toBeDefined();
    await expect(ExpenseService.attachReceipt(id, jpg, admin)).resolves.toBeDefined();
  });
});
