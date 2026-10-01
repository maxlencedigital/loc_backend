import { CustomException } from "../../commons/Exception/CustomException.js";

const mockSmsText = jest.fn();
const mockEmailSend = jest.fn();
const mockLookup = jest.fn();
const mockGetUser = jest.fn();
const configured = { sms: true, email: true };

jest.mock("../Clients/Sms.Client.js", () => ({
  SmsClient: { send: jest.fn(), sendText: (...a: unknown[]) => mockSmsText(...a), isConfigured: () => configured.sms },
}));
jest.mock("../Clients/Email.Client.js", () => ({
  EmailClient: { send: (...a: unknown[]) => mockEmailSend(...a), isConfigured: () => configured.email },
}));
jest.mock("../Clients/WhatsApp.Client.js", () => ({ WhatsAppClient: { sendTemplateMessage: jest.fn(), isConfigured: () => false } }));
jest.mock("../Clients/Gateway.Client.js", () => ({
  GatewayClient: { lookupUsers: (...a: unknown[]) => mockLookup(...a), getUser: (...a: unknown[]) => mockGetUser(...a) },
}));
jest.mock("../Queries/Db.js", () => ({ inTransaction: (work: any) => require("../Testing/FakeQueries").inTransaction(work) }));
jest.mock("../Queries/Campaign.Query.js", () => ({ CampaignQuery: require("../Testing/FakeQueries").CampaignQuery }));
jest.mock("../Queries/Customer.Query.js", () => ({ CustomerQuery: require("../Testing/FakeQueries").CustomerQuery }));
jest.mock("../Queries/Notification.Query.js", () => ({ NotificationQuery: require("../Testing/FakeQueries").NotificationQuery }));
jest.mock("../Queries/Coupon.Query.js", () => ({ CouponQuery: require("../Testing/FakeQueries").CouponQuery }));
jest.mock("../Queries/Counter.Query.js", () => ({ CounterQuery: require("../Testing/FakeQueries").CounterQuery }));

import { CampaignService, renderMessage } from "./Campaign.Service.js";
import { RetentionService } from "./Retention.Service.js";
import { NotificationService } from "./Notification.Service.js";
import { riskScore, daysForScore, parseAudience, toCriteria } from "./Audience.js";
import { db, reset, seed, newId } from "../Testing/FakeQueries.js";

const ADMIN = "99999999-9999-4999-8999-999999999999";
const STORE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

const users = new Map<string, any>();
const phoneOf = (id: string) => `+9198${id.slice(-8)}`;
const addUser = (id: string, over: Record<string, unknown> = {}) => {
  users.set(id, { id, name: `Cust ${id.slice(-2)}`, email: `${id.slice(-8)}@example.com`, phoneNumber: phoneOf(id), role: "customer", storeId: null, isActive: true, ...over });
  return id;
};
const customers = (n: number, over: Record<string, unknown> = {}) =>
  Array.from({ length: n }, (_, i) => addUser(seed.customer(i + 1, over)));

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a rejection");
};

const draft = async (over: Record<string, unknown> = {}) =>
  CampaignService.create(ADMIN, {
    name: "Spring offer", channel: "sms", audience: { segment: "all" }, message: "Hi {{name}}, 10% off this week", ...over,
  }) as Promise<any>;

let logSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
beforeEach(() => {
  reset();
  users.clear();
  Object.assign(configured, { sms: true, email: true });
  process.env.CAMPAIGN_BATCH_SIZE = "2";
  mockSmsText.mockReset().mockResolvedValue("sms-1");
  mockEmailSend.mockReset().mockResolvedValue("email-1");
  mockLookup.mockReset().mockImplementation(async (ids: string[]) => ids.map((id) => users.get(id)).filter(Boolean));
  mockGetUser.mockReset().mockImplementation(async (id: string) => users.get(id) ?? null);
  logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  delete process.env.CAMPAIGN_BATCH_SIZE;
  delete process.env.CAMPAIGN_MAX_RECIPIENTS;
});

describe("campaign: create and edit", () => {
  it("creates a draft with a bounded audience and the run cap recorded", async () => {
    const campaign = await draft({ audience: { segment: "repeat", storeIds: [STORE_A], minOrders: 3 } });

    expect(campaign).toMatchObject({ status: "draft", channel: "sms", audience: { segment: "repeat", storeIds: [STORE_A], minOrders: 3 } });
    expect([...db.campaigns.values()][0]).toMatchObject({ createdBy: ADMIN, maxRecipients: 1000 });
  });

  it.each([
    ["no name", { name: undefined }],
    ["unknown segment", { audience: { segment: "everyone-ever" } }],
    ["audience as a string", { audience: "all" }],
    ["unknown audience key", { audience: { segment: "all", sql: "1=1" } }],
    ["too many stores", { audience: { segment: "all", storeIds: Array.from({ length: 51 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`) } }],
    ["huge minOrders", { audience: { segment: "all", minOrders: 5000 } }],
    ["unknown channel", { channel: "pigeon" }],
    ["no content", { message: undefined }],
    ["both template and message", { templateId: newId() }],
    ["scheduled in the past", { scheduledAt: new Date(Date.now() - DAY).toISOString() }],
    ["a status other than draft", { status: "sent" }],
    ["message too long", { message: "x".repeat(1001) }],
  ])("rejects %s with 400", async (_name, over) => {
    expect((await rejection(draft(over))).errorCode).toBe(400);
    expect(db.campaigns.size).toBe(0);
  });

  it("uses a template of the same channel and rejects one of another channel", async () => {
    const sms: any = await NotificationService.createTemplate({ name: "Sms one", channel: "sms", body: "Hi {{name}}" });
    const mail: any = await NotificationService.createTemplate({ name: "Mail one", channel: "email", body: "Hi {{name}}" });

    const ok = await draft({ message: undefined, templateId: sms.id });
    const wrong = await rejection(draft({ message: undefined, templateId: mail.id }));

    expect(ok.templateId).toBe(sms.id);
    expect(wrong.errorCode).toBe(400);
  });

  it("edits a draft, and refuses a status in the body or an edit once sending", async () => {
    const campaign = await draft();
    const edited: any = await CampaignService.update(campaign.id, { name: "Renamed", audience: { segment: "new" } });
    expect(edited).toMatchObject({ name: "Renamed", audience: { segment: "new" } });
    expect((await rejection(CampaignService.update(campaign.id, { status: "sent" }))).errorCode).toBe(400);

    customers(1);
    await CampaignService.send(campaign.id);
    expect((await rejection(CampaignService.update(campaign.id, { name: "Too late" }))).errorCode).toBe(409);
  });

  it("lists with filters and pages, and answers 404 for unknown or malformed ids", async () => {
    await draft();
    const other = await draft({ channel: "email" });
    await CampaignService.cancel(other.id);

    const all: any = await CampaignService.list({ limit: "1" });
    const cancelled: any = await CampaignService.list({ status: "cancelled" });
    const email: any = await CampaignService.list({ channel: "email" });

    expect(all).toMatchObject({ limit: 1, total: 2 });
    expect(cancelled.total).toBe(1);
    expect(email.items[0].channel).toBe("email");
    expect((await rejection(CampaignService.list({ status: "bogus" }))).errorCode).toBe(400);
    expect((await rejection(CampaignService.get(newId()))).errorCode).toBe(404);
    expect((await rejection(CampaignService.get("x"))).errorCode).toBe(404);
  });
});

describe("campaign: state machine", () => {
  it("draft -> scheduled (also reschedulable) -> cancelled; terminal states refuse everything", async () => {
    const campaign = await draft();
    const when = new Date(Date.now() + DAY).toISOString();

    expect(((await CampaignService.schedule(campaign.id, { scheduledAt: when })) as any).status).toBe("scheduled");
    expect(((await CampaignService.schedule(campaign.id, { scheduledAt: new Date(Date.now() + 2 * DAY).toISOString() })) as any).status).toBe("scheduled");
    expect(((await CampaignService.cancel(campaign.id)) as any).status).toBe("cancelled");

    expect((await rejection(CampaignService.cancel(campaign.id))).errorCode).toBe(409);
    expect((await rejection(CampaignService.schedule(campaign.id, { scheduledAt: when }))).errorCode).toBe(409);
    expect((await rejection(CampaignService.send(campaign.id))).errorCode).toBe(409);
    expect((await rejection(CampaignService.update(campaign.id, { name: "x" }))).errorCode).toBe(409);
  });

  it("refuses a past or missing schedule time, and content that cannot be sent", async () => {
    const campaign = await draft();
    expect((await rejection(CampaignService.schedule(campaign.id, { scheduledAt: new Date(Date.now() - DAY).toISOString() }))).errorCode).toBe(400);
    expect((await rejection(CampaignService.schedule(campaign.id, {}))).errorCode).toBe(400);

    const bad = await draft({ message: "Your code is {{code}}" });
    const wa = await draft({ channel: "whatsapp" });
    for (const c of [bad, wa]) {
      expect((await rejection(CampaignService.schedule(c.id, { scheduledAt: new Date(Date.now() + DAY).toISOString() }))).errorCode).toBe(400);
      expect((await rejection(CampaignService.send(c.id))).errorCode).toBe(400);
    }
    expect(db.campaigns.get(bad.id)?.status).toBe("draft");
  });

  it("a finished campaign cannot be sent or cancelled again", async () => {
    const campaign = await draft();
    customers(1);
    const done: any = await CampaignService.send(campaign.id);

    expect(done).toMatchObject({ status: "sent", done: true });
    expect((await rejection(CampaignService.send(campaign.id))).errorCode).toBe(409);
    expect((await rejection(CampaignService.cancel(campaign.id))).errorCode).toBe(409);
  });
});

describe("campaign: audience", () => {
  it("previews the count and a small sample with names, filtered by segment and store", async () => {
    seed.customer(1, { lastStoreId: STORE_A });
    seed.customer(2, { lastStoreId: STORE_B });
    seed.customer(3, { lastStoreId: STORE_A, orderCount: 1 });
    [1, 2, 3].forEach((n) => addUser(`00000000-0000-4000-9000-${String(n).padStart(12, "0")}`));

    const all: any = await CampaignService.previewAudience({ audience: { segment: "all" } });
    const storeA: any = await CampaignService.previewAudience({ audience: { segment: "repeat", storeIds: [STORE_A] } });

    expect(all.count).toBe(3);
    expect(all.sample[0]).toMatchObject({ name: expect.stringContaining("Cust") });
    expect(storeA.count).toBe(1);
    expect((await rejection(CampaignService.previewAudience({}))).errorCode).toBe(400);
  });

  it("keeps the sample to 10 and still answers when the gateway is down", async () => {
    customers(12);
    mockLookup.mockRejectedValue(new Error("gateway down"));

    const preview: any = await CampaignService.previewAudience({ audience: { segment: "all" } });

    expect(preview.count).toBe(12);
    expect(preview.sample).toHaveLength(10);
    expect(preview.sample[0].name).toBeNull();
  });

  it("segments resolve to bounded criteria", () => {
    const now = new Date();
    const at = (a: object) => toCriteria(parseAudience(a), now);

    expect(at({ segment: "repeat" }).minOrders).toBe(2);
    expect(at({ segment: "repeat", minOrders: 5 }).minOrders).toBe(5);
    expect(at({ segment: "inactive", inactiveDays: 30 }).lastOrderBefore?.getTime()).toBe(now.getTime() - 30 * DAY);
    expect(at({ segment: "all", inactiveDays: 90 }).lastOrderBefore).toBeDefined();
    expect(at({ segment: "at_risk" }).lastOrderAfter).toBeDefined();
    expect(at({}).minOrders).toBeUndefined();
  });
});

describe("campaign: sending in batches", () => {
  const sentTo = () => mockSmsText.mock.calls.map((c) => c[0] as string);

  it("processes one bounded batch per call, finishes on the call that exhausts the audience, and messages everyone once", async () => {
    const ids = customers(5);
    const campaign = await draft();

    const first: any = await CampaignService.send(campaign.id);
    const second: any = await CampaignService.send(campaign.id);
    const third: any = await CampaignService.send(campaign.id);

    expect([first, second, third].map((r) => [r.status, r.processed, r.done])).toEqual([["sending", 2, false], ["sending", 2, false], ["sent", 1, true]]);
    expect(sentTo().sort()).toEqual(ids.map(phoneOf).sort());
    expect(new Set(sentTo()).size).toBe(5);
    expect(((await CampaignService.stats(campaign.id)) as any)).toMatchObject({ sent: 5, delivered: 5, failed: 0, skipped: 0, pending: 0, opened: 0, clicked: 0 });
    expect((await rejection(CampaignService.send(campaign.id))).errorCode).toBe(409);
  });

  it("fills in the recipient's first name and logs each message under the campaign", async () => {
    const [id] = customers(1);
    users.get(id).name = "Asha Rao";
    const campaign = await draft();

    await CampaignService.send(campaign.id);

    expect(mockSmsText).toHaveBeenCalledWith(phoneOf(id), "Hi Asha, 10% off this week");
    const logged = [...db.notifications.values()];
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ campaignId: campaign.id, customerId: id, status: "sent", title: "Spring offer" });
    expect(renderMessage("Hi {{name}} {{name}} {{other}}", "{{name}}")).toBe("Hi {{name}} {{name}} ");
  });

  it("honours opt-outs, missing contacts and inactive customers, and counts them as skipped", async () => {
    const [a, b, c, d] = customers(4);
    await NotificationService.setPreferences(b, { channels: { sms: false } });
    users.get(c).phoneNumber = null;
    users.get(d).isActive = false;
    const campaign = await draft();

    const result: any = await CampaignService.send(campaign.id);
    const rest: any = await CampaignService.send(campaign.id);

    expect(sentTo()).toEqual([phoneOf(a)]);
    expect(result.skipped + rest.skipped).toBe(3);
    const stats: any = await CampaignService.stats(campaign.id);
    expect(stats).toMatchObject({ delivered: 1, skipped: 3 });
    expect([...db.recipients.values()].filter((r) => r.status === "skipped").map((r) => r.error).sort()).toEqual(
      ["customer not found or inactive", "no contact address", "opted out"]
    );
  });

  it("counts provider failures as failed without leaking provider text", async () => {
    customers(2);
    mockSmsText.mockRejectedValueOnce(new Error("secret provider detail")).mockResolvedValue("ok");
    const campaign = await draft();

    const result: any = await CampaignService.send(campaign.id);

    expect(result).toMatchObject({ processed: 2, delivered: 1, failed: 1 });
    const failed = [...db.recipients.values()].find((r) => r.status === "failed") as any;
    expect(failed.error).toBe("delivery failed");
    expect(JSON.stringify([...db.notifications.values()])).not.toContain("secret provider detail");
  });

  it("an unconfigured channel fails every recipient instead of throwing", async () => {
    customers(2);
    configured.sms = false;
    const campaign = await draft();

    const result: any = await CampaignService.send(campaign.id);

    expect(result).toMatchObject({ delivered: 0, failed: 2 });
    expect(mockSmsText).not.toHaveBeenCalled();
  });

  it("sends email campaigns through the email provider", async () => {
    customers(1);
    const campaign = await draft({ channel: "email" });

    await CampaignService.send(campaign.id);

    expect(mockEmailSend).toHaveBeenCalledWith(expect.objectContaining({ subject: "Spring offer" }));
  });

  it("caps recipients per campaign: CAMPAIGN_MAX_RECIPIENTS stops the run", async () => {
    process.env.CAMPAIGN_MAX_RECIPIENTS = "3";
    customers(5);
    const campaign = await draft();

    const one: any = await CampaignService.send(campaign.id);
    const two: any = await CampaignService.send(campaign.id);

    expect(one.done).toBe(false);
    expect(two).toMatchObject({ status: "sent", done: true, claimed: 3, maxRecipients: 3 });
    expect(mockSmsText).toHaveBeenCalledTimes(3);
  });

  it("targets only the audience: store and segment filters apply to what is sent", async () => {
    const inA = addUser(seed.customer(1, { lastStoreId: STORE_A }));
    addUser(seed.customer(2, { lastStoreId: STORE_B }));
    const campaign = await draft({ audience: { segment: "all", storeIds: [STORE_A] } });

    await CampaignService.send(campaign.id);

    expect(sentTo()).toEqual([phoneOf(inA)]);
  });

  it("cancelling mid-run stops the rest", async () => {
    customers(5);
    const campaign = await draft();
    await CampaignService.send(campaign.id);

    await CampaignService.cancel(campaign.id);

    expect((await rejection(CampaignService.send(campaign.id))).errorCode).toBe(409);
    expect(mockSmsText).toHaveBeenCalledTimes(2);
  });

  it("race: two send calls at once cannot both run a batch (the lease)", async () => {
    customers(4);
    const campaign = await draft();

    const results = await Promise.allSettled([CampaignService.send(campaign.id), CampaignService.send(campaign.id)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as CustomException).errorCode).toBe(409);
    expect(mockSmsText).toHaveBeenCalledTimes(2);
    expect(new Set(sentTo()).size).toBe(2);
  });

  it("restart safety: a failure after claiming leaves recipients pending, and the retry sends each exactly once", async () => {
    customers(3);
    const campaign = await draft();
    mockLookup.mockRejectedValueOnce(new Error("gateway down"));

    const failed = await rejection(CampaignService.send(campaign.id));
    const claimedAfterFailure = db.campaigns.get(campaign.id)?.claimedCount;
    const resumed: any = await CampaignService.send(campaign.id);

    expect(failed.errorCode).toBe(500);
    expect(db.recipients.size).toBe(2);
    expect(claimedAfterFailure).toBe(2);
    expect(resumed.processed).toBe(2);
    expect(db.campaigns.get(campaign.id)?.claimedCount).toBe(2);
    await CampaignService.send(campaign.id);
    expect(new Set(sentTo()).size).toBe(3);
    expect(mockSmsText).toHaveBeenCalledTimes(3);
    expect(db.campaigns.get(campaign.id)?.leaseUntil).toBeNull();
  });

  it("restart safety: recipients left 'sending' by a dead run are failed, never re-sent", async () => {
    customers(2);
    const campaign = await draft();
    await CampaignService.send(campaign.id);
    mockSmsText.mockClear();
    const [row] = [...db.recipients.values()];
    row.status = "sending";

    await CampaignService.send(campaign.id);

    expect(row.status).toBe("failed");
    expect(row.error).toContain("not retried");
    expect(mockSmsText).not.toHaveBeenCalled();
  });

  it("a recipient row exists once per customer: claiming the same customer twice never duplicates", async () => {
    const [id] = customers(1);
    const campaign = await draft();
    const { CampaignQuery } = require("../Testing/FakeQueries");

    await CampaignQuery.claimBatch(campaign.id, [id], id);
    await CampaignQuery.claimBatch(campaign.id, [id], id);

    expect(db.recipients.size).toBe(1);
  });

  it("answers 404 for stats and send of an unknown campaign", async () => {
    expect((await rejection(CampaignService.stats(newId()))).errorCode).toBe(404);
    expect((await rejection(CampaignService.send(newId()))).errorCode).toBe(404);
  });
});

describe("retention", () => {
  it("scores silence linearly between 14 and 90 days", () => {
    expect(riskScore(10)).toBe(0);
    expect(riskScore(14)).toBe(0);
    expect(riskScore(52)).toBe(50);
    expect(riskScore(90)).toBe(100);
    expect(riskScore(500)).toBe(100);
    expect(daysForScore(50)).toBe(52);
  });

  it("lists at-risk customers longest-silent first, with score and reasons, bounded by limit", async () => {
    for (const [n, days, orders] of [[1, 5, 3], [2, 60, 1], [3, 120, 6], [4, 400, 2], [5, 80, 2]] as const) {
      addUser(seed.customer(n, { lastOrderAt: ago(days), orderCount: orders }));
    }

    const result: any = await RetentionService.listAtRisk({});
    const one: any = await RetentionService.listAtRisk({ limit: "1" });

    expect(result.customers.map((c: any) => c.score)).toEqual([100, riskScore(80), riskScore(60)]);
    expect(result.customers.map((c: any) => c.customerId.slice(-2))).toEqual(["03", "05", "02"]);
    expect(result.customers[0].reasons.join(" ")).toContain("regular customer");
    expect(result.customers[2].reasons.join(" ")).toContain("only once");
    expect(result.customers[0].name).toContain("Cust");
    expect(one.customers).toHaveLength(1);
    expect((await rejection(RetentionService.listAtRisk({ limit: "5000" }))).errorCode).toBe(400);
    expect((await rejection(RetentionService.listAtRisk({ minScore: "500" }))).errorCode).toBe(400);
  });

  it("filters by store and minimum score, and still answers without names when the gateway is down", async () => {
    addUser(seed.customer(1, { lastOrderAt: ago(60), lastStoreId: STORE_A }));
    addUser(seed.customer(2, { lastOrderAt: ago(60), lastStoreId: STORE_B }));
    mockLookup.mockRejectedValue(new Error("down"));

    const store: any = await RetentionService.listAtRisk({ storeId: STORE_A });
    const strict: any = await RetentionService.listAtRisk({ minScore: "90" });

    expect(store.customers).toHaveLength(1);
    expect(store.customers[0].name).toBeNull();
    expect(strict.customers).toHaveLength(0);
  });

  it("summarises at-risk count, repeat rate and win-back rate", async () => {
    seed.customer(1, { lastOrderAt: ago(5), orderCount: 3 });
    seed.customer(2, { lastOrderAt: ago(70), orderCount: 1 });
    seed.customer(3, { lastOrderAt: ago(10), orderCount: 1 });
    seed.customer(4, { lastOrderAt: ago(80), orderCount: 2 });
    db.winBacks.push({ customerId: db.stats.get("00000000-0000-4000-9000-000000000004")?.customerId, createdAt: ago(20) });
    (db.stats.get("00000000-0000-4000-9000-000000000004") as any).lastOrderAt = ago(10);
    db.winBacks.push({ customerId: "00000000-0000-4000-9000-000000000002", createdAt: ago(20) });

    const summary: any = await RetentionService.getSummary({});

    expect(summary).toEqual({ atRisk: 1, repeatRatePct: 50, winBackRatePct: 50 });
  });

  it("explains one customer with an order history, 404 for one with none", async () => {
    const id = seed.customer(1);
    db.orders.set("a", { orderRef: "a", customerId: id, amountPaise: 12_300, completedAt: ago(10) });
    db.orders.set("b", { orderRef: "b", customerId: id, amountPaise: 4_500, completedAt: ago(40) });

    const detail: any = await RetentionService.getCustomer(id);

    expect(detail.orderHistory.map((o: any) => o.total)).toEqual([123, 45]);
    expect(detail.score).toBe(0);
    expect((await rejection(RetentionService.getCustomer(newId()))).errorCode).toBe(404);
  });
});

describe("win-back", () => {
  const winBack = (id: string, over: Record<string, unknown> = {}) =>
    RetentionService.sendWinBack(id, { channel: "sms", ...over }) as Promise<any>;

  it("sends one personal message with the coupon code and records it", async () => {
    const id = addUser(seed.customer(1, { lastOrderAt: ago(70) }));
    const coupon: any = await require("./Coupon.Service.js").CouponService.create({
      code: "COMEBACK", title: "Back", type: "flat", value: 50, validFrom: "2020-01-01", validUntil: "2099-12-31",
    });

    const result = await winBack(id, { offerCouponId: coupon.id });

    expect(result).toMatchObject({ delivered: true, channel: "sms" });
    expect(mockSmsText).toHaveBeenCalledWith(phoneOf(id), expect.stringContaining("COMEBACK"));
    expect(db.winBacks).toHaveLength(1);
    expect(([...db.notifications.values()][0] as any).customerId).toBe(id);
  });

  it("contacts a customer at most once a week", async () => {
    const id = addUser(seed.customer(1));
    await winBack(id);

    expect((await rejection(winBack(id))).errorCode).toBe(429);
    expect(mockSmsText).toHaveBeenCalledTimes(1);
  });

  it("will not message an opted-out customer, or one without an address, or on whatsapp", async () => {
    const out = addUser(seed.customer(1));
    const noPhone = addUser(seed.customer(2), { phoneNumber: null });
    await NotificationService.setPreferences(out, { channels: { sms: false } });

    expect((await rejection(winBack(out))).errorCode).toBe(409);
    expect((await rejection(winBack(noPhone))).errorCode).toBe(409);
    expect((await rejection(winBack(out, { channel: "whatsapp" }))).errorCode).toBe(400);
    expect(mockSmsText).not.toHaveBeenCalled();
    expect(db.winBacks).toHaveLength(0);
  });

  it("404s a customer with no history or an inactive account, and rejects bad coupons and input", async () => {
    const id = addUser(seed.customer(1));
    const inactive = addUser(seed.customer(2), { isActive: false });

    expect((await rejection(winBack(newId()))).errorCode).toBe(404);
    expect((await rejection(winBack(inactive))).errorCode).toBe(404);
    expect((await rejection(winBack(id, { offerCouponId: newId() }))).errorCode).toBe(404);
    expect((await rejection(winBack(id, { message: "" }))).errorCode).toBe(400);
    expect((await rejection(winBack(id, { channel: undefined }))).errorCode).toBe(400);
    expect((await rejection(winBack(id, { extra: 1 }))).errorCode).toBe(400);
  });

  it("reports delivered:false (not an error) when the provider fails", async () => {
    const id = addUser(seed.customer(1));
    mockSmsText.mockRejectedValue(new Error("down"));

    const result = await winBack(id);

    expect(result).toMatchObject({ delivered: false });
  });
});
