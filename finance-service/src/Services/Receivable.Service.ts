import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { Page, PageRequest, toPage } from "../../commons/Utils/Pagination.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import { GrowthClient } from "../Clients/Growth.Client.js";
import { Actor, effectiveStore, scopeOf } from "../Middleware/StoreScope.js";
import { SpendMode } from "../Models/Expense/Expense.Interface.js";
import { IReceivable, IReceivableContact, ReceivableStatus } from "../Models/Receivable/Receivable.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { ReceivableQuery } from "../Queries/Receivable.Query.js";
import { TransactionQuery } from "../Queries/Transaction.Query.js";
import { addDays, clock, daysBetween, istToday, parseDay } from "../Utils/Dates.js";
import {
  idempotencyKeyOf,
  oneOf,
  optionalOneOf,
  optionalText,
  parseBody,
  pathId,
  queryEnum,
  queryUuid,
  queryWholeNumber,
  uuidField,
  wholeNumber,
} from "../Utils/Input.js";
import { rupeesToPaise, toRupees, wholePaise } from "../Utils/Money.js";
import { LedgerService } from "./Ledger.Service.js";

const MODES: readonly SpendMode[] = ["cash", "bank", "upi", "card"];
const CHANNELS = ["sms", "email", "whatsapp"] as const;
type Channel = (typeof CHANNELS)[number];
const STATUSES: readonly ReceivableStatus[] = ["open", "overdue", "paid"];
const REMINDER_TEMPLATE = "receivable_reminder";
const REMINDER_BATCH = 50;
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const statusOf = (r: IReceivable, today: string): ReceivableStatus =>
  r.balancePaise === 0 ? "paid" : r.dueOn < today ? "overdue" : "open";

const daysOverdue = (r: IReceivable, today: string): number =>
  r.balancePaise > 0 && r.dueOn < today ? daysBetween(r.dueOn, today) : 0;

const toItem = (r: IReceivable, today: string) => ({
  id: r.id,
  customerId: r.customerId,
  invoiceId: r.invoiceId,
  amount: toRupees(r.balancePaise),
  invoiceAmount: toRupees(r.amountPaise),
  dueOn: r.dueOn,
  status: statusOf(r, today),
  daysOverdue: daysOverdue(r, today),
});

const notFoundReceivable = () => new CustomException("Receivable not found.", notFound);

// ------------------------------------------------------------------ reads

const listReceivables = async (
  query: Record<string, unknown>,
  actor: Actor,
  page: PageRequest
): Promise<Page<ReturnType<typeof toItem>>> => {
  try {
    const today = istToday(clock.now());
    const olderThan = queryWholeNumber(query.olderThanDays, "olderThanDays", 1, 3650);
    const { items, total } = await ReceivableQuery.search(
      {
        customerId: queryUuid(query.customerId, "customerId"),
        storeId: effectiveStore(actor, queryUuid(query.storeId, "storeId")),
        status: queryEnum(query.status, STATUSES, "status"),
        dueOnOrBefore: olderThan === undefined ? undefined : addDays(today, -olderThan),
        today,
      },
      page
    );
    return toPage(
      items.map((r) => toItem(r, today)),
      total,
      page
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

const getReceivable = async (rawId: string, actor: Actor) => {
  try {
    const today = istToday(clock.now());
    const receivable = await ReceivableQuery.findById(pathId(rawId, "Receivable"), scopeOf(actor));
    if (!receivable) throw notFoundReceivable();
    const payments = await ReceivableQuery.listPayments(receivable.id, 100);
    return {
      ...toItem(receivable, today),
      orderRef: receivable.orderRef,
      storeId: receivable.storeId,
      lastRemindedAt: receivable.lastRemindedAt,
      payments: payments.map((p) => ({
        id: p.id,
        amount: toRupees(p.amountPaise),
        mode: p.mode,
        reference: p.reference,
        recordedAt: p.createdAt,
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const getAging = async (query: Record<string, unknown>, actor: Actor) => {
  try {
    const storeId = effectiveStore(actor, queryUuid(query.storeId, "storeId"));
    const buckets = await ReceivableQuery.aging(istToday(clock.now()), storeId);
    return {
      buckets: buckets.map((b) => ({ label: b.label, amount: toRupees(b.amountPaise), count: b.count })),
      total: toRupees(buckets.reduce((sum, b) => sum + b.amountPaise, 0)),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------ payments

const recordPayment = async (rawId: string, input: unknown, actor: Actor, rawKey: unknown) => {
  try {
    const id = pathId(rawId, "Receivable");
    const body = parseBody(input);
    requireFields(body, ["amount", "mode"]);
    const amountPaise = rupeesToPaise(body.amount, "amount");
    const mode = oneOf(body.mode, MODES, "mode");
    const reference = optionalText(body.reference, "reference", 120) ?? null;
    const key = idempotencyKeyOf(rawKey) ?? null;
    const scope = scopeOf(actor);

    const respond = (payment: { id: string; amountPaise: number; mode: string; reference: string | null }, balancePaise: number, today: string, dueOn: string) => ({
      id: payment.id,
      receivableId: id,
      amount: toRupees(payment.amountPaise),
      mode: payment.mode,
      reference: payment.reference,
      balance: toRupees(balancePaise),
      status: balancePaise === 0 ? "paid" : dueOn < today ? "overdue" : "open",
    });

    const attempt = async () =>
      TransactionQuery.run(async (tx) => {
        const receivable = await ReceivableQuery.findById(id, scope, tx);
        if (!receivable) throw notFoundReceivable();
        const today = istToday(clock.now());

        if (key) {
          const earlier = await ReceivableQuery.findPaymentByKey(id, key, tx);
          if (earlier) {
            if (earlier.amountPaise !== amountPaise || earlier.mode !== mode) {
              throw new CustomException("This Idempotency-Key was already used for a different payment.", conflict);
            }
            return respond(earlier, receivable.balancePaise, today, receivable.dueOn);
          }
        }
        // One guarded UPDATE: it applies only while the balance still covers the amount, so two
        // payments racing past the same balance cannot both be taken. A rollback below undoes it.
        if (!(await ReceivableQuery.applyPayment(id, amountPaise, tx))) {
          throw new CustomException(
            receivable.balancePaise === 0 ? "This balance is already paid." : "The payment is more than the outstanding balance.",
            conflict
          );
        }
        const payment = await ReceivableQuery.addPayment(
          { receivableId: id, storeId: receivable.storeId, amountPaise, mode, reference, idempotencyKey: key, recordedByUserId: actor.id },
          tx
        );
        await LedgerService.postReceivablePayment({ ...payment, storeId: receivable.storeId }, receivable.invoiceId, tx);
        return respond(payment, receivable.balancePaise - amountPaise, today, receivable.dueOn);
      });

    try {
      return await attempt();
    } catch (error) {
      // Two requests with one key raced: the unique (receivable, key) rolled one back. Replay it.
      if (key && isUniqueViolation(error)) return await attempt();
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------ reminders

const contactFor = (channel: Channel, contact: IReceivableContact): string | null =>
  channel === "email" ? contact.email : contact.phone;

const reminderParams = (r: IReceivable, message?: string): Record<string, string | number> => ({
  amount: toRupees(r.balancePaise).toFixed(2),
  dueOn: r.dueOn,
  invoice: r.orderRef ?? r.invoiceId,
  ...(message ? { message } : {}),
});

const sendReminder = async (rawId: string, input: unknown, actor: Actor) => {
  try {
    const id = pathId(rawId, "Receivable");
    const body = parseBody(input);
    requireFields(body, ["channel"]);
    const channel = oneOf(body.channel, CHANNELS, "channel");
    const message = optionalText(body.message, "message", 300);
    const receivable = await ReceivableQuery.findById(id, scopeOf(actor));
    if (!receivable) throw notFoundReceivable();
    if (receivable.balancePaise === 0) throw new CustomException("This balance is already paid.", conflict);

    const contact = await ReceivableQuery.findContact(id);
    const to = contact ? contactFor(channel, contact) : null;
    if (!to) throw new CustomException(`There is no ${channel === "email" ? "email address" : "phone number"} on file for this customer.`, conflict);

    const result = await GrowthClient.dispatch({
      channel,
      to,
      templateId: REMINDER_TEMPLATE,
      params: reminderParams(receivable, message),
      customerId: receivable.customerId,
    });
    await ReceivableQuery.recordReminders([{ id, channel, delivered: result.delivered, error: result.error }], actor.id);
    return { receivableId: id, channel, delivered: result.delivered };
  } catch (error) {
    throw toCustomException(error);
  }
};

/**
 * Reminds the next batch of overdue customers. Anyone reminded in the last 24 hours is skipped,
 * so running it twice in a day does not message people twice. At most 50 go per run.
 */
const runReminders = async (input: unknown, actor: Actor) => {
  try {
    const body = parseBody(input);
    const olderThan = body.olderThanDays === undefined ? 1 : wholeNumber(body.olderThanDays, "olderThanDays", 1, 3650);
    const channel = optionalOneOf(body.channel, CHANNELS, "channel") ?? "sms";
    const today = istToday(clock.now());

    const due = await ReceivableQuery.listForReminders(
      addDays(today, -olderThan),
      new Date(clock.now().getTime() - REMINDER_COOLDOWN_MS),
      REMINDER_BATCH
    );
    const attempts: Array<{ id: string; channel: string; delivered: boolean; error: string | null }> = [];
    let noContact = 0;
    for (const { receivable, contact } of due) {
      const to = contactFor(channel, contact);
      if (!to) {
        noContact += 1;
        continue;
      }
      const result = await GrowthClient.dispatch({
        channel,
        to,
        templateId: REMINDER_TEMPLATE,
        params: reminderParams(receivable),
        customerId: receivable.customerId,
      });
      attempts.push({ id: receivable.id, channel, delivered: result.delivered, error: result.error });
    }
    await ReceivableQuery.recordReminders(attempts, actor.id);
    return {
      sent: attempts.filter((a) => a.delivered).length,
      failed: attempts.filter((a) => !a.delivered).length,
      noContact,
      // Full batch: more may be waiting, so run it again.
      more: due.length === REMINDER_BATCH,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------ from commerce

/** Commerce reports an invoice raised on credit. Idempotent on invoiceId. */
const registerFromCommerce = async (input: unknown) => {
  try {
    const body = parseBody(input);
    requireFields(body, ["invoiceId", "customerId", "storeId", "amountPaise", "dueOn"]);
    const data = {
      invoiceId: uuidField(body.invoiceId, "invoiceId"),
      customerId: uuidField(body.customerId, "customerId"),
      storeId: uuidField(body.storeId, "storeId"),
      orderRef: optionalText(body.orderRef, "orderRef", 64) ?? null,
      amountPaise: wholePaise(body.amountPaise, "amountPaise"),
      dueOn: parseDay(body.dueOn, "dueOn"),
      contactPhone: optionalText(body.contactPhone, "contactPhone", 20) ?? null,
      contactEmail: optionalText(body.contactEmail, "contactEmail", 254) ?? null,
    };
    if (data.contactPhone && !/^\+?[0-9]{7,15}$/.test(data.contactPhone)) {
      throw new CustomException("contactPhone must be 7 to 15 digits.", badRequest);
    }
    if (data.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contactEmail)) {
      throw new CustomException("contactEmail is not a valid address.", badRequest);
    }
    const created = await ReceivableQuery.create(data);
    const stored = await ReceivableQuery.findByInvoice(data.invoiceId);
    if (!stored) throw new CustomException("Receivable could not be saved.", 500);
    if (!created && stored.amountPaise !== data.amountPaise) {
      throw new CustomException("This invoice is already registered with a different amount.", conflict);
    }
    return { id: stored.id, invoiceId: stored.invoiceId, created };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const ReceivableService = {
  listReceivables,
  getReceivable,
  getAging,
  recordPayment,
  sendReminder,
  runReminders,
  registerFromCommerce,
};
