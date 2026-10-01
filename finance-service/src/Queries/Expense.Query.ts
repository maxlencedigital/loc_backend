import type { Prisma } from "@prisma/client";
import { PageRequest } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { dayToDate } from "../Utils/Dates.js";
import {
  ExpenseStatus,
  IExpense,
  IExpenseCategory,
  IExpenseCreate,
  IExpenseEvent,
  IExpenseEventCreate,
  IExpenseFilter,
  IExpenseReceipt,
  IExpenseUpdate,
} from "../Models/Expense/Expense.Interface.js";
import { Db, toDay } from "./Db.js";

const EXPENSE_COLUMNS = {
  id: true,
  date: true,
  categoryId: true,
  amountPaise: true,
  storeId: true,
  vendorId: true,
  description: true,
  paymentMode: true,
  status: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ExpenseRow = Prisma.ExpenseGetPayload<{ select: typeof EXPENSE_COLUMNS }>;
const toExpense = (row: ExpenseRow): IExpense => ({ ...row, date: toDay(row.date) });

const CATEGORY_COLUMNS = { id: true, name: true, parentId: true, createdAt: true, updatedAt: true } as const;

// ------------------------------------------------------------------ categories

const listCategories = async (page: PageRequest): Promise<{ items: IExpenseCategory[]; total: number }> => {
  try {
    const [items, total] = await Promise.all([
      prisma.expenseCategory.findMany({
        select: CATEGORY_COLUMNS,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      prisma.expenseCategory.count(),
    ]);
    return { items, total };
  } catch (error) {
    throw error;
  }
};

const findCategory = async (id: string, db: Db = prisma): Promise<IExpenseCategory | null> => {
  try {
    return await db.expenseCategory.findUnique({ where: { id }, select: CATEGORY_COLUMNS });
  } catch (error) {
    throw error;
  }
};

const findCategoryByKey = async (nameKey: string, db: Db = prisma): Promise<IExpenseCategory | null> => {
  try {
    return await db.expenseCategory.findUnique({ where: { nameKey }, select: CATEGORY_COLUMNS });
  } catch (error) {
    throw error;
  }
};

const createCategory = async (
  data: { name: string; nameKey: string; parentId: string | null },
  db: Db = prisma
): Promise<IExpenseCategory> => {
  try {
    return await db.expenseCategory.create({ data, select: CATEGORY_COLUMNS });
  } catch (error) {
    throw error;
  }
};

const updateCategory = async (
  id: string,
  data: { name?: string; nameKey?: string; parentId?: string | null },
  db: Db = prisma
): Promise<IExpenseCategory> => {
  try {
    return await db.expenseCategory.update({ where: { id }, data, select: CATEGORY_COLUMNS });
  } catch (error) {
    throw error;
  }
};

/** The chain of parents above a category, up to maxDepth, so re-parenting cannot make a loop. */
const ancestorsOf = async (id: string, maxDepth: number, db: Db = prisma): Promise<string[]> => {
  try {
    const chain: string[] = [];
    let current: string | null = id;
    for (let depth = 0; current && depth < maxDepth; depth++) {
      const row: { parentId: string | null } | null = await db.expenseCategory.findUnique({
        where: { id: current },
        select: { parentId: true },
      });
      current = row?.parentId ?? null;
      if (current) chain.push(current);
    }
    return chain;
  } catch (error) {
    throw error;
  }
};

const countCategoryUse = async (id: string, db: Db = prisma): Promise<{ children: number; expenses: number }> => {
  try {
    const [children, expenses] = await Promise.all([
      db.expenseCategory.count({ where: { parentId: id } }),
      db.expense.count({ where: { categoryId: id } }),
    ]);
    return { children, expenses };
  } catch (error) {
    throw error;
  }
};

const deleteCategory = async (id: string, db: Db = prisma): Promise<void> => {
  try {
    await db.expenseCategory.delete({ where: { id } });
  } catch (error) {
    throw error;
  }
};

// ------------------------------------------------------------------ expenses

const create = async (data: IExpenseCreate, db: Db = prisma): Promise<IExpense> => {
  try {
    return toExpense(await db.expense.create({ data: { ...data, date: dayToDate(data.date) }, select: EXPENSE_COLUMNS }));
  } catch (error) {
    throw error;
  }
};

const findByKey = async (createdByUserId: string, idempotencyKey: string, db: Db = prisma): Promise<IExpense | null> => {
  try {
    const row = await db.expense.findUnique({
      where: { createdByUserId_idempotencyKey: { createdByUserId, idempotencyKey } },
      select: EXPENSE_COLUMNS,
    });
    return row ? toExpense(row) : null;
  } catch (error) {
    throw error;
  }
};

/** `storeScope` null means every store; a store id hides everything outside it. */
const findById = async (id: string, storeScope: string | null, db: Db = prisma): Promise<IExpense | null> => {
  try {
    const row = await db.expense.findFirst({
      where: { id, deletedAt: null, ...(storeScope ? { storeId: storeScope } : {}) },
      select: EXPENSE_COLUMNS,
    });
    return row ? toExpense(row) : null;
  } catch (error) {
    throw error;
  }
};

// A no-op UPDATE takes the row lock, so two approvals or edits of one expense run one after the other.
const lockById = async (id: string, storeScope: string | null, db: Db): Promise<IExpense | null> => {
  try {
    await db.expense.updateMany({
      where: { id, deletedAt: null, ...(storeScope ? { storeId: storeScope } : {}) },
      data: { updatedAt: new Date() },
    });
    return await findById(id, storeScope, db);
  } catch (error) {
    throw error;
  }
};

const whereOf = (filter: IExpenseFilter): Prisma.ExpenseWhereInput => ({
  deletedAt: null,
  ...(filter.storeId ? { storeId: filter.storeId } : {}),
  ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
  ...(filter.status ? { status: filter.status } : {}),
  ...(filter.from || filter.to
    ? {
        date: {
          ...(filter.from ? { gte: dayToDate(filter.from) } : {}),
          ...(filter.to ? { lte: dayToDate(filter.to) } : {}),
        },
      }
    : {}),
});

const search = async (filter: IExpenseFilter, page: PageRequest): Promise<{ items: IExpense[]; total: number }> => {
  try {
    const where = whereOf(filter);
    const [rows, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        select: EXPENSE_COLUMNS,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: page.offset,
        take: page.limit,
      }),
      prisma.expense.count({ where }),
    ]);
    return { items: rows.map(toExpense), total };
  } catch (error) {
    throw error;
  }
};

const update = async (id: string, data: IExpenseUpdate, db: Db = prisma): Promise<IExpense> => {
  try {
    const { date, ...rest } = data;
    return toExpense(
      await db.expense.update({
        where: { id },
        data: { ...rest, ...(date ? { date: dayToDate(date) } : {}) },
        select: EXPENSE_COLUMNS,
      })
    );
  } catch (error) {
    throw error;
  }
};

/** One guarded statement: moves the status only while it still is `from`. False: someone got there first. */
const transition = async (id: string, from: ExpenseStatus, to: ExpenseStatus, db: Db = prisma): Promise<boolean> => {
  try {
    const { count } = await db.expense.updateMany({ where: { id, status: from, deletedAt: null }, data: { status: to } });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const softDelete = async (id: string, db: Db = prisma): Promise<boolean> => {
  try {
    const { count } = await db.expense.updateMany({
      where: { id, status: { in: ["recorded", "rejected"] }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

// ------------------------------------------------------------------ events and receipts

const addEvent = async (data: IExpenseEventCreate, db: Db = prisma): Promise<void> => {
  try {
    await db.expenseEvent.create({ data });
  } catch (error) {
    throw error;
  }
};

const listEvents = async (expenseId: string, limit: number): Promise<IExpenseEvent[]> => {
  try {
    return await prisma.expenseEvent.findMany({
      where: { expenseId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
    });
  } catch (error) {
    throw error;
  }
};

const RECEIPT_META = {
  id: true,
  expenseId: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  sha256: true,
  createdAt: true,
} as const;

const listReceipts = async (expenseId: string, db: Db = prisma): Promise<IExpenseReceipt[]> => {
  try {
    return await db.expenseReceipt.findMany({
      where: { expenseId },
      select: RECEIPT_META,
      orderBy: { createdAt: "asc" },
      take: 50,
    });
  } catch (error) {
    throw error;
  }
};

/** Stores the file. The unique (expense, sha256) makes re-uploading the same file a no-op (false). */
const addReceipt = async (
  data: {
    expenseId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    content: Buffer;
    uploadedByUserId: string;
  },
  db: Db = prisma
): Promise<boolean> => {
  try {
    const { count } = await db.expenseReceipt.createMany({
      data: [{ ...data, content: new Uint8Array(data.content) }],
      skipDuplicates: true,
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const findReceiptByHash = async (expenseId: string, sha256: string, db: Db = prisma): Promise<IExpenseReceipt | null> => {
  try {
    return await db.expenseReceipt.findUnique({ where: { expenseId_sha256: { expenseId, sha256 } }, select: RECEIPT_META });
  } catch (error) {
    throw error;
  }
};

const countReceipts = async (expenseId: string, db: Db = prisma): Promise<number> => {
  try {
    return await db.expenseReceipt.count({ where: { expenseId } });
  } catch (error) {
    throw error;
  }
};

// ------------------------------------------------------------------ aggregates

// Approved and paid expenses are real spend; recorded ones are not yet accepted and rejected never are.
const COUNTED: ExpenseStatus[] = ["approved", "paid"];

const spendByStore = async (
  from: string,
  to: string,
  storeId?: string
): Promise<Array<{ storeId: string | null; amountPaise: number }>> => {
  try {
    const groups = await prisma.expense.groupBy({
      by: ["storeId"],
      where: {
        deletedAt: null,
        status: { in: COUNTED },
        date: { gte: dayToDate(from), lte: dayToDate(to) },
        ...(storeId ? { storeId } : {}),
      },
      _sum: { amountPaise: true },
    });
    return groups.map((g) => ({ storeId: g.storeId, amountPaise: Number(g._sum.amountPaise ?? 0) }));
  } catch (error) {
    throw error;
  }
};

const spendByDay = async (
  from: string,
  to: string,
  options: { storeId?: string; categoryKey?: string } = {}
): Promise<Array<{ date: string; amountPaise: number }>> => {
  try {
    const groups = await prisma.expense.groupBy({
      by: ["date"],
      where: {
        deletedAt: null,
        status: { in: COUNTED },
        date: { gte: dayToDate(from), lte: dayToDate(to) },
        ...(options.storeId ? { storeId: options.storeId } : {}),
        ...(options.categoryKey ? { category: { nameKey: options.categoryKey } } : {}),
      },
      _sum: { amountPaise: true },
      orderBy: { date: "asc" },
    });
    return groups.map((g) => ({ date: toDay(g.date), amountPaise: Number(g._sum.amountPaise ?? 0) }));
  } catch (error) {
    throw error;
  }
};

export const ExpenseQuery = {
  listCategories,
  findCategory,
  findCategoryByKey,
  createCategory,
  updateCategory,
  ancestorsOf,
  countCategoryUse,
  deleteCategory,
  create,
  findByKey,
  findById,
  lockById,
  search,
  update,
  transition,
  softDelete,
  addEvent,
  listEvents,
  listReceipts,
  addReceipt,
  findReceiptByHash,
  countReceipts,
  spendByStore,
  spendByDay,
};
