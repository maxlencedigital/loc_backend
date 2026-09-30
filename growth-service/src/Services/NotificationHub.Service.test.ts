import { CustomException } from "../../commons/Exception/CustomException.js";

const mockSmsSend = jest.fn();
const mockSmsConfigured = jest.fn();
const mockEmailSend = jest.fn();
const mockEmailConfigured = jest.fn();
const mockWaSend = jest.fn();
const mockWaConfigured = jest.fn();

jest.mock("../Clients/Sms.Client.js", () => ({
  SmsClient: { send: (...args: unknown[]) => mockSmsSend(...args), isConfigured: () => mockSmsConfigured() },
}));
jest.mock("../Clients/Email.Client.js", () => ({
  EmailClient: { send: (...args: unknown[]) => mockEmailSend(...args), isConfigured: () => mockEmailConfigured() },
}));
jest.mock("../Clients/WhatsApp.Client.js", () => ({
  WhatsAppClient: {
    sendTemplateMessage: (...args: unknown[]) => mockWaSend(...args),
    isConfigured: () => mockWaConfigured(),
  },
}));

import { NotificationHub, DispatchInput } from "./NotificationHub.Service.js";

const params = { name: "Asha", orderId: "LOC-1042", total: "$24.50", pickupTime: "9 AM", eta: "6 PM", amount: "$24.50" };
const base = (channel: DispatchInput["channel"], templateId = "order_confirmed"): DispatchInput => ({
  channel,
  to: "+61412345678",
  templateId,
  params,
});

describe("NotificationHub.dispatch", () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    mockSmsSend.mockReset().mockResolvedValue("sms-1");
    mockEmailSend.mockReset().mockResolvedValue("email-1");
    mockWaSend.mockReset().mockResolvedValue("wamid.1");
    mockSmsConfigured.mockReset().mockReturnValue(true);
    mockEmailConfigured.mockReset().mockReturnValue(true);
    mockWaConfigured.mockReset().mockReturnValue(true);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe("routing", () => {
    it("routes sms to SmsClient only", async () => {
      const result = await NotificationHub.dispatch(base("sms"));

      expect(mockSmsSend).toHaveBeenCalledWith("+61412345678", "order_confirmed", params);
      expect(mockEmailSend).not.toHaveBeenCalled();
      expect(mockWaSend).not.toHaveBeenCalled();
      expect(result).toEqual({ channel: "sms", delivered: true, providerMessageId: "sms-1" });
    });

    it("routes email to EmailClient with the rendered, escaped template", async () => {
      const result = await NotificationHub.dispatch({
        ...base("email", "payment_received"),
        to: "a@example.com",
        params: { ...params, name: "<script>alert(1)</script>" },
      });

      expect(mockSmsSend).not.toHaveBeenCalled();
      expect(mockWaSend).not.toHaveBeenCalled();
      const message = mockEmailSend.mock.calls[0][0];
      expect(message.to).toBe("a@example.com");
      expect(message.subject).toContain("LOC-1042");
      expect(message.title).toBe("Payment received");
      expect(message.bodyHtml).toContain("&lt;script&gt;");
      expect(message.bodyHtml).not.toContain("<script>");
      expect(result).toEqual({ channel: "email", delivered: true, providerMessageId: "email-1" });
    });

    it("routes whatsapp to WhatsAppClient with the template name, language and ordered params", async () => {
      const result = await NotificationHub.dispatch(base("whatsapp", "payment_received"));

      expect(mockSmsSend).not.toHaveBeenCalled();
      expect(mockEmailSend).not.toHaveBeenCalled();
      // payment_received is {{1}}=name {{2}}=amount {{3}}=orderId
      expect(mockWaSend).toHaveBeenCalledWith("+61412345678", "payment_received", "en", ["Asha", "$24.50", "LOC-1042"]);
      expect(result).toEqual({ channel: "whatsapp", delivered: true, providerMessageId: "wamid.1" });
    });

    it("omits providerMessageId when the provider returns none", async () => {
      mockSmsSend.mockResolvedValue(undefined);
      expect(await NotificationHub.dispatch(base("sms"))).toEqual({ channel: "sms", delivered: true });
    });
  });

  describe("provider failure", () => {
    it.each([
      ["sms", mockSmsSend],
      ["email", mockEmailSend],
      ["whatsapp", mockWaSend],
    ] as const)("returns delivered:false instead of throwing on a %s failure", async (channel, send) => {
      send.mockRejectedValue(new CustomException("provider down", 503));

      const result = await NotificationHub.dispatch(base(channel));

      expect(result).toEqual({ channel, delivered: false, error: "provider down" });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`[Notification][${channel}]`), "provider down");
    });

    it("handles a non-CustomException rejection and logs only to=, not the message body", async () => {
      mockSmsSend.mockRejectedValue(new Error("boom"));

      const result = await NotificationHub.dispatch(base("sms"));

      expect(result).toEqual({ channel: "sms", delivered: false, error: "boom" });
      expect(errorSpy.mock.calls[0][0]).toContain("to=+61412345678");
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("Asha");
    });
  });

  describe("caller bugs throw 400", () => {
    it("rejects an unknown channel", async () => {
      await expect(
        NotificationHub.dispatch({ ...base("sms"), channel: "pigeon" as unknown as "sms" })
      ).rejects.toMatchObject({ errorCode: 400 });
    });

    it("rejects a missing to, channel or templateId", async () => {
      await expect(NotificationHub.dispatch({ ...base("sms"), to: "" })).rejects.toMatchObject({ errorCode: 400 });
      await expect(NotificationHub.dispatch({ ...base("sms"), templateId: "" })).rejects.toMatchObject({ errorCode: 400 });
      await expect(
        NotificationHub.dispatch({ ...base("sms"), channel: undefined as unknown as "sms" })
      ).rejects.toMatchObject({ errorCode: 400 });
    });

    it.each(["sms", "email", "whatsapp"] as const)("rejects an unknown templateId on %s", async (channel) => {
      await expect(NotificationHub.dispatch(base(channel, "nope"))).rejects.toMatchObject({ errorCode: 400 });
    });

    it.each(["sms", "email", "whatsapp"] as const)("rejects missing params on %s without calling the provider", async (channel) => {
      await expect(
        NotificationHub.dispatch({ ...base(channel), params: { name: "Asha" } })
      ).rejects.toMatchObject({ errorCode: 400 });
      expect(mockSmsSend).not.toHaveBeenCalled();
      expect(mockEmailSend).not.toHaveBeenCalled();
      expect(mockWaSend).not.toHaveBeenCalled();
    });

    it("rejects params that are not an object", async () => {
      await expect(
        NotificationHub.dispatch({ ...base("sms"), params: [] as unknown as Record<string, string> })
      ).rejects.toMatchObject({ errorCode: 400 });
    });

    it("rejects a templateId that has no WhatsApp template (payment_failed)", async () => {
      await expect(NotificationHub.dispatch(base("whatsapp", "payment_failed"))).rejects.toMatchObject({ errorCode: 400 });
      expect(mockWaSend).not.toHaveBeenCalled();
    });
  });

  describe("unconfigured provider", () => {
    it("returns delivered:false 'not configured', sends nothing and prints the message in development", async () => {
      process.env.NODE_ENV = "development";
      mockSmsConfigured.mockReturnValue(false);

      const result = await NotificationHub.dispatch(base("sms"));

      expect(result).toEqual({ channel: "sms", delivered: false, error: "not configured" });
      expect(mockSmsSend).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("to=+61412345678"));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Hi Asha, your LOC order LOC-1042 is confirmed"));
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("prints a readable preview for email and whatsapp too", async () => {
      process.env.NODE_ENV = "test";
      mockEmailConfigured.mockReturnValue(false);
      mockWaConfigured.mockReturnValue(false);

      const email = await NotificationHub.dispatch({ ...base("email"), to: "a@example.com" });
      const whatsapp = await NotificationHub.dispatch(base("whatsapp"));

      expect(email.error).toBe("not configured");
      expect(whatsapp.error).toBe("not configured");
      expect(mockEmailSend).not.toHaveBeenCalled();
      expect(mockWaSend).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Your LOC order LOC-1042 is confirmed"));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('["Asha","LOC-1042","$24.50"]'));
    });

    it("does not log the rendered message in production but logs a loud error", async () => {
      process.env.NODE_ENV = "production";
      mockWaConfigured.mockReturnValue(false);

      const result = await NotificationHub.dispatch(base("whatsapp"));

      expect(result).toEqual({ channel: "whatsapp", delivered: false, error: "not configured" });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("NODE_ENV=production"));
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("still throws 400 for a bad templateId even when unconfigured", async () => {
      mockSmsConfigured.mockReturnValue(false);
      await expect(NotificationHub.dispatch(base("sms", "nope"))).rejects.toMatchObject({ errorCode: 400 });
    });
  });

  describe("isConfigured", () => {
    it("delegates to each channel's client", () => {
      mockSmsConfigured.mockReturnValue(true);
      mockEmailConfigured.mockReturnValue(false);
      mockWaConfigured.mockReturnValue(true);

      expect(NotificationHub.isConfigured("sms")).toBe(true);
      expect(NotificationHub.isConfigured("email")).toBe(false);
      expect(NotificationHub.isConfigured("whatsapp")).toBe(true);
    });
  });
});
