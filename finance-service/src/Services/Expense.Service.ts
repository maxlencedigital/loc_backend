import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { Page, PageRequest, toPage } from "../../commons/Utils/Pagination.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import { Actor, effectiveStore, scopeOf } from "../Middleware/StoreScope.js";
import {
  ExpenseStatus,
  IExpense,
  IExpenseCategory,
  IExpenseUpdate,
  SpendMode,
} from "../Models/Expense/Expense.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { ExpenseQuery } from "../Queries/Expense.Query.js";
import type { Db } from "../Queries/Db.js";
import { TransactionQuery } from "../Queries/Transaction.Query.js";
import { istToday, optionalDayBounds, parseDay } from "../Utils/Dates.js";
import {
  idempotencyKeyOf,
  oneOf,
  optionalOneOf,
  optionalText,
  optionalUuidField,
  parseBody,
  pathId,
  queryEnum,
  queryUuid,
  text,
  uuidField,
} from "../Utils/Input.js";
import { rupeesToPaise, toRupees } from "../Utils/Money.js";
import { UploadedFile } from "../Utils/Multipart.js";
import { LedgerService } from "./Ledger.Service.js";

const STATUSES: readonly ExpenseStatus[] = ["recorded", "approved", "rejected", "paid"];
const MODES: readonly SpendMode[] = ["cash", "bank", "upi", "card"];

// recorded -> approved | rejected; approved -> paid. Rejected and paid are final.
export const ALLOWED_MOVES: Record<ExpenseStatus, ExpenseStatus[]> = {
  recorded: ["approved", "rejected"],
  approved: ["paid"],
  rejected: [],
  paid: [],
};

const MAX_CATEGORY_DEPTH = 5;

// ------------------------------------------------------------------ categories

const toCategory = (category: IExpenseCategory) => ({
  id: category.id,
  name: category.name,
  parentId: category.parentId,
  createdAt: category.createdAt,
  updatedAt: category.updatedAt,
});

const nameKeyOf = (name: string) => name.toLowerCase();

const requireParent = async (parentId: string | undefined | null, selfId?: string): Promise<string | null> => {
  if (!parentId) return null;
  if (!(await ExpenseQuery.findCategory(parentId))) throw new CustomException("The parent category does not exist.", badRequest);
  if (selfId) {
    if (parentId === selfId) throw new CustomException("A category cannot be its own parent.", badRequest);
    if ((await ExpenseQuery.ancestorsOf(parentId, MAX_CATEGORY_DEPTH)).includes(selfId)) {
      throw new CustomException("A category cannot be moved beneath one of its own children.", badRequest);
    }
  }
  return parentId;
};

const listCategories = async (page: PageRequest): Promise<Page<ReturnType<typeof toCategory>>> => {
  try {
    const { items, total } = await ExpenseQuery.listCategories(page);
    return toPage(items.map(toCategory), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getCategory = async (rawId: string) => {
  try {
    const category = await ExpenseQuery.findCategory(pathId(rawId, "Expense category"));
    if (!category) throw new CustomException("Expense category not found.", notFound);
    return toCategory(category);
  } catch (error) {
    throw toCustomException(error);
  }
};

const nameTaken = () => new CustomException("An expense category with this name already exists.", conflict);

const createCategory = async (input: unknown) => {
  try {
    const body = parseBody(input);
    requireFields(body, ["name"]);
    const name = text(body.name, "name", 80);
    const parentId = await requireParent(optionalUuidField(body.parentId, "parentId"));
    if (await ExpenseQuery.findCategoryByKey(nameKeyOf(name))) throw nameTaken();
    try {
      return toCategory(await ExpenseQuery.createCategory({ name, nameKey: nameKeyOf(name), parentId }));
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const updateCategory = async (rawId: string, input: unknown) => {
  try {
    const id = pathId(rawId, "Expense category");
    const body = parseBody(input);
    const current = await ExpenseQuery.findCategory(id);
    if (!current) throw new CustomException("Expense category not found.", notFound);

    const data: { name?: string; nameKey?: string; parentId?: string | null } = {};
    if (body.name !== undefined) {
      data.name = text(body.name, "name", 80);
      data.nameKey = nameKeyOf(data.name);
      const clash = await ExpenseQuery.findCategoryByKey(data.nameKey);
      if (clash && clash.id !== id) throw nameTaken();
    }
    if (body.parentId !== undefined) {
      data.parentId = await requireParent(body.parentId === null ? null : uuidField(body.parentId, "parentId"), id);
    }
    if (Object.keys(data).length === 0) throw new CustomException("Nothing to update.", badRequest);
    try {
      return toCategory(await ExpenseQuery.updateCategory(id, data));
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const deleteCategory = async (rawId: string) => {
  try {
    const id = pathId(rawId, "Expense category");
    if (!(await ExpenseQuery.findCategory(id))) throw new CustomException("Expense category not found.", notFound);
    const use = await ExpenseQuery.countCategoryUse(id);
    if (use.children > 0 || use.expenses > 0) {
      throw new CustomException("This category is in use by expenses or sub-categories and cannot be deleted.", conflict);
    }
    await ExpenseQuery.deleteCategory(id);
    return { id, deleted: true };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------ expenses

const toExpense = (expense: IExpense) => ({
  id: expense.id,
  date: expense.date,
  categoryId: expense.categoryId,
  amount: toRupees(expense.amountPaise),
  storeId: expense.storeId,
  vendorId: expense.vendorId,
  description: expense.description,
  paymentMode: expense.paymentMode,
  status: expense.status,
  createdAt: expense.createdAt,
  updatedAt: expense.updatedAt,
});

const notFoundExpense = () => new CustomException("Expense not found.", notFound);

const validDate = (value: unknown): string => {
  const day = parseDay(value, "date");
  if (day > istToday()) throw new CustomException("date cannot be in the future.", badRequest);
  return day;
};

const requireCategory = async (categoryId: string): Promise<IExpenseCategory> => {
  const category = await ExpenseQuery.findCategory(categoryId);
  if (!category) throw new CustomException("The expense category does not exist.", badRequest);
  return category;
};

const createExpense = async (input: unknown, actor: Actor, rawKey: unknown) => {
  try {
    const body = parseBody(input);
    requireFields(body, ["date", "categoryId", "amount"]);
    // A new expense is always "recorded"; approval is its own step with its own history.
    if (body.status !== undefined && body.status !== "recorded") {
      throw new CustomException("A new expense starts as recorded. Use approve to accept it.", badRequest);
    }
    const data = {
      date: validDate(body.date),
      categoryId: uuidField(body.categoryId, "categoryId"),
      amountPaise: rupeesToPaise(body.amount, "amount"),
      storeId: optionalUuidField(body.storeId, "storeId") ?? null,
      vendorId: optionalUuidField(body.vendorId, "vendorId") ?? null,
      description: optionalText(body.description, "description", 500) ?? null,
      paymentMode: optionalOneOf(body.paymentMode, MODES, "paymentMode") ?? null,
    };
    const key = idempotencyKeyOf(rawKey) ?? null;

    if (key) {
      const earlier = await ExpenseQuery.findByKey(actor.id, key);
      if (earlier) return replayOf(earlier, data);
    }
    await requireCategory(data.categoryId);
    try {
      const expense = await TransactionQuery.run(async (tx) => {
        const created = await ExpenseQuery.create({ ...data, createdByUserId: actor.id, idempotencyKey: key }, tx);
        await ExpenseQuery.addEvent(
          { expenseId: created.id, action: "created", fromStatus: null, toStatus: "recorded", actorUserId: actor.id, actorName: actor.name, note: null },
          tx
        );
        return created;
      });
      return toExpense(expense);
    } catch (error) {
      // Two requests with one key raced: the unique (creator, key) let one in.
      if (key && isUniqueViolation(error)) {
        const earlier = await ExpenseQuery.findByKey(actor.id, key);
        if (earlier) return replayOf(earlier, data);
      }
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const replayOf = (earlier: IExpense, data: { date: string; categoryId: string; amountPaise: number; storeId: string | null }) => {
  if (
    earlier.date !== data.date ||
    earlier.categoryId !== data.categoryId ||
    earlier.amountPaise !== data.amountPaise ||
    earlier.storeId !== data.storeId
  ) {
    throw new CustomException("This Idempotency-Key was already used for a different expense.", conflict);
  }
  return toExpense(earlier);
};

const listExpenses = async (
  query: Record<string, unknown>,
  actor: Actor,
  page: PageRequest
): Promise<Page<ReturnType<typeof toExpense>>> => {
  try {
    const storeId = effectiveStore(actor, queryUuid(query.storeId, "storeId")) ?? undefined;
    const { from, to } = optionalDayBounds(query);
    const { items, total } = await ExpenseQuery.search(
      {
        storeId,
        categoryId: queryUuid(query.categoryId, "categoryId"),
        status: queryEnum(query.status, STATUSES, "status"),
        from,
        to,
      },
      page
    );
    return toPage(items.map(toExpense), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getExpense = async (rawId: string, actor: Actor) => {
  try {
    const id = pathId(rawId, "Expense");
    const expense = await ExpenseQuery.findById(id, scopeOf(actor));
    if (!expense) throw notFoundExpense();
    const [events, receipts] = await Promise.all([ExpenseQuery.listEvents(id, 200), ExpenseQuery.listReceipts(id)]);
    return {
      ...toExpense(expense),
      history: events.map((event) => ({
        action: event.action,
        from: event.fromStatus,
        to: event.toStatus,
        by: event.actorName ?? event.actorUserId,
        note: event.note,
        at: event.createdAt,
      })),
      receipts: receipts.map((receipt) => ({
        id: receipt.id,
        fileName: receipt.fileName,
        contentType: receipt.contentType,
        sizeBytes: receipt.sizeBytes,
        sha256: receipt.sha256,
        uploadedAt: receipt.createdAt,
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};


// Moves an expense one step along the machine. Runs inside the caller's transaction and under
// the row lock; the status change itself is a guarded statement, so a concurrent move loses.
const moveStatus = async (tx: Db, expense: IExpense, to: ExpenseStatus, actor: Actor, note: string | null) => {
  if (!ALLOWED_MOVES[expense.status].includes(to)) {
    throw new CustomException(`An expense that is ${expense.status} cannot become ${to}.`, conflict);
  }
  if (to === "paid" && !expense.paymentMode) {
    throw new CustomException("Set a paymentMode before marking an expense paid.", conflict);
  }
  if (!(await ExpenseQuery.transition(expense.id, expense.status, to, tx))) {
    throw new CustomException("This expense was changed by someone else. Reload and try again.", conflict);
  }
  await ExpenseQuery.addEvent(
    { expenseId: expense.id, action: to, fromStatus: expense.status, toStatus: to, actorUserId: actor.id, actorName: actor.name, note },
    tx
  );
  if (to === "paid") {
    const category = await ExpenseQuery.findCategory(expense.categoryId, tx);
    await LedgerService.postExpensePaid(expense, category?.name ?? "uncategorised", tx);
  }
  return { ...expense, status: to };
};

const updateExpense = async (rawId: string, input: unknown, actor: Actor) => {
  try {
    const id = pathId(rawId, "Expense");
    const body = parseBody(input);

    // Only these fields can change; req.body is never spread into the write.
    const edits: IExpenseUpdate = {};
    if (body.date !== undefined) edits.date = validDate(body.date);
    if (body.categoryId !== undefined) edits.categoryId = uuidField(body.categoryId, "categoryId");
    if (body.amount !== undefined) edits.amountPaise = rupeesToPaise(body.amount, "amount");
    if (body.storeId !== undefined) edits.storeId = body.storeId === null ? null : uuidField(body.storeId, "storeId");
    if (body.vendorId !== undefined) edits.vendorId = body.vendorId === null ? null : uuidField(body.vendorId, "vendorId");
    if (body.description !== undefined) {
      edits.description = body.description === null ? null : text(body.description, "description", 500);
    }
    if (body.paymentMode !== undefined) {
      edits.paymentMode = body.paymentMode === null ? null : oneOf(body.paymentMode, MODES, "paymentMode");
    }
    const status = optionalOneOf(body.status, STATUSES, "status");
    const note = optionalText(body.note, "note", 500) ?? null;
    if (Object.keys(edits).length === 0 && !status) throw new CustomException("Nothing to update.", badRequest);
    if (edits.categoryId) await requireCategory(edits.categoryId);

    const updated = await TransactionQuery.run(async (tx) => {
      let current = await ExpenseQuery.lockById(id, null, tx);
      if (!current) throw notFoundExpense();

      if (Object.keys(edits).length > 0) {
        // Money fields are frozen once an expense leaves "recorded": the approval was of those numbers,
        // except that the payment mode may still be set while it waits to be paid.
        const onlyMode = Object.keys(edits).every((k) => k === "paymentMode");
        if (current.status !== "recorded" && !(current.status === "approved" && onlyMode)) {
          throw new CustomException(`An expense that is ${current.status} can no longer be edited.`, conflict);
        }
        current = await ExpenseQuery.update(id, edits, tx);
        await ExpenseQuery.addEvent(
          {
            expenseId: id,
            action: "edited",
            fromStatus: current.status,
            toStatus: current.status,
            actorUserId: actor.id,
            actorName: actor.name,
            note: `Changed: ${Object.keys(edits).map((k) => (k === "amountPaise" ? "amount" : k)).join(", ")}`,
          },
          tx
        );
      }
      if (status && status !== current.status) current = (await moveStatus(tx, current, status, actor, note)) as IExpense;
      return current;
    });
    return toExpense(updated);
  } catch (error) {
    throw toCustomException(error);
  }
};

const approveExpense = async (rawId: string, input: unknown, actor: Actor) => {
  try {
    const id = pathId(rawId, "Expense");
    const note = optionalText(parseBody(input).note, "note", 500) ?? null;
    const updated = await TransactionQuery.run(async (tx) => {
      const current = await ExpenseQuery.lockById(id, null, tx);
      if (!current) throw notFoundExpense();
      // Approving twice is a no-op, not an error: the first approval already stands.
      if (current.status === "approved") return current;
      return (await moveStatus(tx, current, "approved", actor, note)) as IExpense;
    });
    return toExpense(updated);
  } catch (error) {
    throw toCustomException(error);
  }
};

const deleteExpense = async (rawId: string, actor: Actor) => {
  try {
    const id = pathId(rawId, "Expense");
    await TransactionQuery.run(async (tx) => {
      const current = await ExpenseQuery.lockById(id, null, tx);
      if (!current) throw notFoundExpense();
      if (!(await ExpenseQuery.softDelete(id, tx))) {
        throw new CustomException(`An expense that is ${current.status} cannot be deleted.`, conflict);
      }
      await ExpenseQuery.addEvent(
        { expenseId: id, action: "deleted", fromStatus: current.status, toStatus: current.status, actorUserId: actor.id, actorName: actor.name, note: null },
        tx
      );
    });
    return { id, deleted: true };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------ receipts

const RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/png"];
export const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
const MAX_RECEIPTS_PER_EXPENSE = 5;

// PDF, JPEG and PNG are told apart by their first bytes, not by the type the client claims.
const looksLike = (type: string, content: Buffer): boolean =>
  (type === "application/pdf" && content.subarray(0, 5).toString("latin1") === "%PDF-") ||
  (type === "image/jpeg" && content[0] === 0xff && content[1] === 0xd8) ||
  (type === "image/png" && content.subarray(1, 4).toString("latin1") === "PNG");

const attachReceipt = async (rawId: string, file: UploadedFile | undefined, actor: Actor) => {
  try {
    const id = pathId(rawId, "Expense");
    if (!file) throw new CustomException("file is required.", badRequest);
    if (file.content.length === 0) throw new CustomException("The file is empty.", badRequest);
    if (file.content.length > MAX_RECEIPT_BYTES) throw new CustomException("The file is too large (2 MB at most).", 413);
    if (!RECEIPT_TYPES.includes(file.contentType) || !looksLike(file.contentType, file.content)) {
      throw new CustomException("A receipt must be a PDF, JPEG or PNG file.", badRequest);
    }
    const expense = await ExpenseQuery.findById(id, null);
    if (!expense) throw notFoundExpense();

    const sha256 = crypto.createHash("sha256").update(file.content).digest("hex");
    const meta = (r: { id: string; fileName: string; contentType: string; sizeBytes: number; sha256: string; createdAt: Date }) => ({
      id: r.id,
      expenseId: id,
      fileName: r.fileName,
      contentType: r.contentType,
      sizeBytes: r.sizeBytes,
      sha256: r.sha256,
      uploadedAt: r.createdAt,
    });
    // The same file attached twice is one receipt.
    const existing = await ExpenseQuery.findReceiptByHash(id, sha256);
    if (existing) return meta(existing);
    if ((await ExpenseQuery.countReceipts(id)) >= MAX_RECEIPTS_PER_EXPENSE) {
      throw new CustomException(`An expense can have at most ${MAX_RECEIPTS_PER_EXPENSE} receipts.`, conflict);
    }
    await ExpenseQuery.addReceipt({
      expenseId: id,
      fileName: file.fileName,
      contentType: file.contentType,
      sizeBytes: file.content.length,
      sha256,
      content: file.content,
      uploadedByUserId: actor.id,
    });
    const stored = await ExpenseQuery.findReceiptByHash(id, sha256);
    return meta(stored as NonNullable<typeof stored>);
  } catch (error) {
    throw toCustomException(error);
  }
};

export const ExpenseService = {
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  listExpenses,
  getExpense,
  createExpense,
  updateExpense,
  approveExpense,
  deleteExpense,
  attachReceipt,
};
