const mockSmsSend = jest.fn();
const mockSmsText = jest.fn();
const mockEmailSend = jest.fn();
const configured = { sms: true, email: true };

jest.mock("../Clients/Sms.Client.js", () => ({
  SmsClient: { send: (...a: unknown[]) => mockSmsSend(...a), sendText: (...a: unknown[]) => mockSmsText(...a), isConfigured: () => configured.sms },
}));
jest.mock("../Clients/Email.Client.js", () => ({
  EmailClient: { send: (...a: unknown[]) => mockEmailSend(...a), isConfigured: () => configured.email },
}));
jest.mock("../Clients/WhatsApp.Client.js", () => ({ WhatsAppClient: { sendTemplateMessage: jest.fn(), isConfigured: () => true } }));

import { NotificationHub } from "./NotificationHub.Service.js";

const params = { name: "Asha", orderId: "LOC-1", total: "Rs 100", amount: "Rs 100" };

beforeEach(() => {
  configured.sms = true;
  configured.email = true;
  mockSmsText.mockReset().mockResolvedValue("t-1");
  mockEmailSend.mockReset().mockResolvedValue("e-1");
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("NotificationHub.preview", () => {
  it("renders what the customer would read on each channel and validates like dispatch", () => {
    expect(NotificationHub.preview({ channel: "sms", to: "1", templateId: "order_confirmed", params })).toEqual({
      title: "Order confirmed",
      body: "Hi Asha, your LOC order LOC-1 is confirmed. Total: Rs 100. Thank you!",
    });
    expect(NotificationHub.preview({ channel: "whatsapp", to: "1", templateId: "payment_received", params }).body).toBe(
      "Hi Asha, we received your payment of Rs 100 for LOC order LOC-1. Thank you!"
    );
    expect(NotificationHub.preview({ channel: "email", to: "a@b.c", templateId: "order_confirmed", params }).title).toContain("LOC-1");
  });

  it("throws 400 for an unknown template, missing params and an unknown channel", () => {
    const bad = (input: object) => () => NotificationHub.preview({ to: "1", params, ...input } as any);

    expect(bad({ channel: "sms", templateId: "nope" })).toThrow(expect.objectContaining({ errorCode: 400 }));
    expect(bad({ channel: "sms", templateId: "order_confirmed", params: {} })).toThrow(expect.objectContaining({ errorCode: 400 }));
    expect(bad({ channel: "pigeon", templateId: "order_confirmed" })).toThrow(expect.objectContaining({ errorCode: 400 }));
  });
});

describe("NotificationHub.dispatchText", () => {
  it("sends free-form sms text as given", async () => {
    const result = await NotificationHub.dispatchText({ channel: "sms", to: "+911", subject: "S", text: "Hello there" });

    expect(result).toEqual({ channel: "sms", delivered: true, providerMessageId: "t-1" });
    expect(mockSmsText).toHaveBeenCalledWith("+911", "Hello there");
  });

  it("wraps email text in escaped paragraphs", async () => {
    await NotificationHub.dispatchText({ channel: "email", to: "a@b.c", subject: "Sale", text: "Hi <b>you</b>\n\nSecond" });

    const sent = mockEmailSend.mock.calls[0][0];
    expect(sent.subject).toBe("Sale");
    expect(sent.bodyHtml).toContain("&lt;b&gt;you&lt;/b&gt;");
    expect(sent.bodyHtml.match(/<p /g)).toHaveLength(2);
  });

  it("reports provider failure and an unconfigured channel as results, not exceptions", async () => {
    mockSmsText.mockRejectedValue(new Error("down"));
    const failed = await NotificationHub.dispatchText({ channel: "sms", to: "+911", subject: "S", text: "x" });
    configured.email = false;
    const off = await NotificationHub.dispatchText({ channel: "email", to: "a@b.c", subject: "S", text: "x" });

    expect(failed).toMatchObject({ delivered: false, error: "down" });
    expect(off).toEqual({ channel: "email", delivered: false, error: "not configured" });
  });

  it("refuses whatsapp, which needs an approved template, and missing fields", async () => {
    await expect(NotificationHub.dispatchText({ channel: "whatsapp", to: "1", subject: "S", text: "x" } as any)).rejects.toMatchObject({ errorCode: 400 });
    await expect(NotificationHub.dispatchText({ channel: "sms", to: "1", subject: "S" } as any)).rejects.toMatchObject({ errorCode: 400 });
  });
});
