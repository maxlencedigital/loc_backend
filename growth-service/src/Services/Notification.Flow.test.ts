import { CustomException } from "../../commons/Exception/CustomException.js";

const mockSmsSend = jest.fn();
const mockSmsText = jest.fn();
const mockEmailSend = jest.fn();
const mockWaSend = jest.fn();
const configured = { sms: true, email: true, whatsapp: true };

jest.mock("../Clients/Sms.Client.js", () => ({
  SmsClient: {
    send: (...a: unknown[]) => mockSmsSend(...a),
    sendText: (...a: unknown[]) => mockSmsText(...a),
    isConfigured: () => configured.sms,
  },
}));
jest.mock("../Clients/Email.Client.js", () => ({
  EmailClient: { send: (...a: unknown[]) => mockEmailSend(...a), isConfigured: () => configured.email },
}));
jest.mock("../Clients/WhatsApp.Client.js", () => ({
  WhatsAppClient: { sendTemplateMessage: (...a: unknown[]) => mockWaSend(...a), isConfigured: () => configured.whatsapp },
}));
jest.mock("../Queries/Notification.Query.js", () => ({ NotificationQuery: require("../Testing/FakeQueries").NotificationQuery }));
jest.mock("../Queries/Counter.Query.js", () => ({ CounterQuery: require("../Testing/FakeQueries").CounterQuery }));

import { NotificationService, safeError } from "./Notification.Service.js";
import { db, reset, newId } from "../Testing/FakeQueries.js";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const PHONE = "+919812345678";
const params = { name: "Asha", orderId: "LOC-1", total: "Rs 100" };
const dispatch = (over: Record<string, unknown> = {}) =>
  NotificationService.dispatch({ channel: "sms", to: PHONE, templateId: "order_confirmed", params, customerId: C1, ...over }) as Promise<any>;

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a rejection");
};

let logSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
beforeEach(() => {
  reset();
  Object.assign(configured, { sms: true, email: true, whatsapp: true });
  mockSmsSend.mockReset().mockResolvedValue("sms-1");
  mockSmsText.mockReset().mockResolvedValue("sms-text-1");
  mockEmailSend.mockReset().mockResolvedValue("email-1");
  mockWaSend.mockReset().mockResolvedValue("wamid-1");
  logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  delete process.env.NOTIFY_MAX_PER_RECIPIENT_PER_HOUR;
});

describe("dispatch (internal)", () => {
  it("delivers and records every dispatch with a readable title and body", async () => {
    const result = await dispatch();

    expect(result).toEqual({ delivered: true, providerMessageId: "sms-1" });
    expect(mockSmsSend).toHaveBeenCalledWith(PHONE, "order_confirmed", params);
    expect([...db.notifications.values()][0]).toMatchObject({
      customerId: C1, channel: "sms", status: "sent", title: "Order confirmed", templateId: "order_confirmed",
    });
    expect([...db.notifications.values()][0].body).toContain("LOC-1");
  });

  it("answers a provider failure as delivered:false with a safe error, never as an exception", async () => {
    mockSmsSend.mockRejectedValue(new Error("TransmitSMS rejected key sk_live_SECRET for 919812345678"));

    const result = await dispatch();

    expect(result).toEqual({ delivered: false, error: "delivery failed" });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect([...db.notifications.values()][0]).toMatchObject({ status: "failed", error: "delivery failed" });
  });

  it("answers an unconfigured channel as delivered:false and still records it", async () => {
    configured.sms = false;

    const result = await dispatch();

    expect(result).toEqual({ delivered: false, error: "not configured" });
    expect(db.notifications.size).toBe(1);
    expect(mockSmsSend).not.toHaveBeenCalled();
  });

  it("still answers when the hub itself rejects (no 5xx for a provider problem)", async () => {
    configured.whatsapp = true;
    mockWaSend.mockImplementation(() => {
      throw new TypeError("boom");
    });

    const result = await dispatch({ channel: "whatsapp" });

    expect(result).toMatchObject({ delivered: false });
  });

  it.each([
    ["unknown channel", { channel: "pigeon" }],
    ["missing recipient", { to: undefined }],
    ["unknown template", { templateId: "nope" }],
    ["missing template param", { params: { name: "Asha" } }],
    ["non-text param", { params: { ...params, total: 5 } }],
    ["array params", { params: [] }],
    ["bad customer id", { customerId: "x" }],
    ["reserved template", { templateId: "custom" }],
    ["whatsapp without a template", { channel: "whatsapp", templateId: "payment_failed" }],
  ])("rejects %s with 400 and records nothing", async (_name, over) => {
    expect((await rejection(dispatch(over))).errorCode).toBe(400);
    expect(db.notifications.size).toBe(0);
  });

  it("dedupes by idempotencyKey: a replay returns the first result and sends once", async () => {
    const first = await dispatch({ idempotencyKey: "order-1-confirmed" });

    const again = await dispatch({ idempotencyKey: "order-1-confirmed" });

    expect(again).toEqual(first);
    expect(mockSmsSend).toHaveBeenCalledTimes(1);
    expect(db.notifications.size).toBe(1);
  });

  it("dedupes a concurrent double submission of one key", async () => {
    const [a, b] = await Promise.all([dispatch({ idempotencyKey: "k" }), dispatch({ idempotencyKey: "k" })]);

    expect(mockSmsSend).toHaveBeenCalledTimes(1);
    expect(db.notifications.size).toBe(1);
    expect([a, b].every((r) => r.delivered || r.error === "in progress")).toBe(true);
  });

  it("does not contact a customer who switched that channel off, but keeps the record", async () => {
    await NotificationService.setPreferences(C1, { channels: { sms: false } });

    const result = await dispatch();
    const other = await dispatch({ customerId: C2 });

    expect(result).toEqual({ delivered: false, error: "opted out" });
    expect(mockSmsSend).toHaveBeenCalledTimes(1);
    expect(other.delivered).toBe(true);
    expect(db.notifications.size).toBe(2);
  });

  it("bounds messages per recipient per hour, and never stores the number in a counter key", async () => {
    process.env.NOTIFY_MAX_PER_RECIPIENT_PER_HOUR = "3";
    for (let i = 0; i < 3; i++) await dispatch();

    const blocked = await dispatch();

    expect(blocked).toEqual({ delivered: false, error: "rate limited" });
    expect(mockSmsSend).toHaveBeenCalledTimes(3);
    expect(db.notifications.size).toBe(3);
    expect([...db.counters.keys()].every((k) => !k.includes("9812345678"))).toBe(true);
  });

  it("works for email and whatsapp templates too", async () => {
    const email = await dispatch({ channel: "email", to: "asha@example.com" });
    const wa = await dispatch({ channel: "whatsapp" });

    expect(email.delivered).toBe(true);
    expect(wa.delivered).toBe(true);
    expect(mockEmailSend).toHaveBeenCalledWith(expect.objectContaining({ to: "asha@example.com" }));
    expect([...db.notifications.values()].find((n) => n.channel === "whatsapp")?.body).toContain("Asha");
  });

  it("works without a customer id (no inbox entry, no preference check)", async () => {
    const result = await dispatch({ customerId: undefined });

    expect(result.delivered).toBe(true);
    expect(((await NotificationService.listMine(C1, {})) as any).total).toBe(0);
  });
});

describe("customer inbox", () => {
  it("lists only my notifications, newest first, in pages", async () => {
    await dispatch({ templateId: "order_confirmed" });
    await dispatch({ templateId: "payment_received", params: { name: "Asha", orderId: "LOC-1", amount: "Rs 100" } });
    await dispatch({ customerId: C2 });

    const mine: any = await NotificationService.listMine(C1, { limit: "1" });
    const all: any = await NotificationService.listMine(C1, {});

    expect(mine).toMatchObject({ limit: 1, total: 2 });
    expect(mine.items[0]).toMatchObject({ title: "Payment received", channel: "sms", read: false });
    expect(all.items).toHaveLength(2);
    expect(JSON.stringify(all)).not.toContain(PHONE);
  });

  it("marks read, filters unread, and repeating the call is harmless", async () => {
    await dispatch();
    await dispatch();
    const [first] = ((await NotificationService.listMine(C1, {})) as any).items;

    await NotificationService.markRead(C1, first.id);
    const again = await NotificationService.markRead(C1, first.id);
    const unread: any = await NotificationService.listMine(C1, { unread: "true" });

    expect(again).toEqual({ id: first.id, read: true });
    expect(unread.total).toBe(1);
    expect(unread.items[0].id).not.toBe(first.id);
    expect((await rejection(NotificationService.listMine(C1, { unread: "maybe" }))).errorCode).toBe(400);
  });

  it("answers 404 for someone else's notification, an unknown one and a malformed id", async () => {
    await dispatch({ customerId: C2 });
    const [theirs] = [...db.notifications.values()];

    expect((await rejection(NotificationService.markRead(C1, theirs.id))).errorCode).toBe(404);
    expect((await rejection(NotificationService.markRead(C1, newId()))).errorCode).toBe(404);
    expect((await rejection(NotificationService.markRead(C1, "nope"))).errorCode).toBe(404);
    expect(theirs.readAt).toBeNull();
  });
});

describe("preferences", () => {
  it("defaults to sms, email and whatsapp on, push off", async () => {
    expect(await NotificationService.getPreferences(C1)).toEqual({
      channels: { sms: true, email: true, whatsapp: true, push: false },
      language: "en",
      quietHours: null,
    });
  });

  it("merges channel changes, stores language and quiet hours, and can clear them", async () => {
    await NotificationService.setPreferences(C1, { channels: { whatsapp: false }, language: "hi", quietHours: { from: "22:00", to: "07:30" } });
    const after: any = await NotificationService.getPreferences(C1);
    const cleared: any = await NotificationService.setPreferences(C1, { channels: {}, quietHours: null });

    expect(after).toEqual({ channels: { sms: true, email: true, whatsapp: false, push: false }, language: "hi", quietHours: { from: "22:00", to: "07:30" } });
    expect(cleared.quietHours).toBeNull();
    expect(cleared.channels.whatsapp).toBe(false);
  });

  it.each([
    ["no channels", {}],
    ["unknown channel", { channels: { fax: true } }],
    ["non-boolean", { channels: { sms: "yes" } }],
    ["bad language", { channels: {}, language: "english" }],
    ["bad time", { channels: {}, quietHours: { from: "25:00", to: "07:00" } }],
    ["half a quiet window", { channels: {}, quietHours: { from: "22:00" } }],
    ["unknown field", { channels: {}, role: "admin" }],
  ])("rejects %s with 400", async (_name, body) => {
    expect((await rejection(NotificationService.setPreferences(C1, body))).errorCode).toBe(400);
  });

  it("keeps each customer's preferences separate", async () => {
    await NotificationService.setPreferences(C1, { channels: { email: false } });

    expect(((await NotificationService.getPreferences(C2)) as any).channels.email).toBe(true);
  });
});

describe("templates", () => {
  const body = { name: "Welcome", channel: "sms", body: "Hi {{name}}, welcome to LOC" };

  it("creates with variables taken from the body, reads, updates and lists", async () => {
    const created: any = await NotificationService.createTemplate(body);
    await NotificationService.updateTemplate(created.id, { body: "Hello {{name}}, your code is {{code}}", variables: ["name", "code"] });
    const read: any = await NotificationService.getTemplate(created.id);
    const list: any = await NotificationService.listTemplates({});

    expect(created).toMatchObject({ variables: ["name"], language: "en", isActive: true });
    expect(read.variables).toEqual(["name", "code"]);
    expect(list.total).toBe(1);
  });

  it("refuses a body that uses a variable it does not declare, duplicate names and bad input", async () => {
    await NotificationService.createTemplate(body);

    expect((await rejection(NotificationService.createTemplate({ ...body, name: "Other", body: "{{x}}", variables: ["y"] }))).errorCode).toBe(400);
    expect((await rejection(NotificationService.createTemplate(body))).errorCode).toBe(409);
    expect((await rejection(NotificationService.createTemplate({ name: "x", channel: "pigeon", body: "b" }))).errorCode).toBe(400);
    expect((await rejection(NotificationService.createTemplate({ ...body, name: "Y", extra: 1 }))).errorCode).toBe(400);
  });

  it("deletes an unused template, 404s a missing one, and refuses one a campaign uses", async () => {
    const used: any = await NotificationService.createTemplate(body);
    const free: any = await NotificationService.createTemplate({ ...body, name: "Free" });
    db.campaigns.set(newId(), { id: newId(), templateId: used.id });

    expect(await NotificationService.deleteTemplate(free.id)).toEqual({ deleted: true });
    expect((await rejection(NotificationService.deleteTemplate(free.id))).errorCode).toBe(404);
    expect((await rejection(NotificationService.deleteTemplate(used.id))).errorCode).toBe(409);
  });
});

describe("admin log and retry", () => {
  it("filters the log, masks recipients and never exposes the raw number or provider text", async () => {
    await dispatch();
    mockSmsSend.mockRejectedValue(new Error("provider said no"));
    await dispatch({ customerId: C2 });
    const failed: any = await NotificationService.listLog({ status: "failed" });
    const byCustomer: any = await NotificationService.listLog({ customerId: C1 });
    const everything: any = await NotificationService.listLog({ channel: "sms", limit: "1" });

    expect(failed.total).toBe(1);
    expect(byCustomer.items.map((i: any) => i.customerId)).toEqual([C1]);
    expect(everything).toMatchObject({ limit: 1, total: 2 });
    expect(JSON.stringify([failed, byCustomer, everything])).not.toContain("9812345678");
    expect(JSON.stringify(failed)).not.toContain("provider said no");
    expect(failed.items[0].recipient).toMatch(/\*\*\*\*5678$/);
  });

  it("reads one entry, 404 for unknown", async () => {
    await dispatch();
    const [entry] = [...db.notifications.values()];

    expect(((await NotificationService.getLogEntry(entry.id)) as any).body).toContain("LOC-1");
    expect((await rejection(NotificationService.getLogEntry(newId()))).errorCode).toBe(404);
  });

  it("retries a failed notification once and records the new outcome", async () => {
    mockSmsSend.mockRejectedValueOnce(new Error("down"));
    await dispatch();
    const [entry] = [...db.notifications.values()];

    const retried: any = await NotificationService.retry(entry.id);

    expect(retried).toMatchObject({ status: "sent", attempts: 2 });
    expect(mockSmsSend).toHaveBeenCalledTimes(2);
  });

  it("refuses to retry a delivered notification, or more than 3 attempts", async () => {
    await dispatch();
    const [ok] = [...db.notifications.values()];
    expect((await rejection(NotificationService.retry(ok.id))).errorCode).toBe(409);

    mockSmsSend.mockRejectedValue(new Error("down"));
    await dispatch({ customerId: C2 });
    const failed = [...db.notifications.values()].find((n) => n.customerId === C2) as any;
    await NotificationService.retry(failed.id);
    await NotificationService.retry(failed.id);
    expect((await rejection(NotificationService.retry(failed.id))).errorCode).toBe(409);
    expect(failed.attempts).toBe(3);
  });

  it("race: two admins retrying together send once", async () => {
    mockSmsSend.mockRejectedValueOnce(new Error("down"));
    await dispatch();
    const [entry] = [...db.notifications.values()];

    const results = await Promise.allSettled([NotificationService.retry(entry.id), NotificationService.retry(entry.id)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(mockSmsSend).toHaveBeenCalledTimes(2);
  });

  it("answers 404 for retrying an unknown notification", async () => {
    expect((await rejection(NotificationService.retry(newId()))).errorCode).toBe(404);
    expect((await rejection(NotificationService.retry("x"))).errorCode).toBe(404);
  });
});

describe("safeError", () => {
  it("keeps only a short category", () => {
    expect(safeError("not configured")).toBe("not configured");
    expect(safeError("Email delivery failed: brevo rejected the email (HTTP 401): key=abc")).toBe("delivery failed");
    expect(safeError(undefined)).toBeNull();
  });
});
