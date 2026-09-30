import { CustomException } from "../../commons/Exception/CustomException.js";
import { WhatsAppClient } from "./WhatsApp.Client.js";

const WA_ENV = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_API_VERSION"];

const mockFetch = (response: { status?: number; text: string }) => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: (response.status ?? 200) < 400,
    status: response.status ?? 200,
    text: async () => response.text,
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

const okBody = JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: "wamid.ABC" }] });

describe("WhatsAppClient.sendTemplateMessage", () => {
  beforeEach(() => {
    for (const key of WA_ENV) delete process.env[key];
    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
  });

  it("posts the template payload to the Graph API and returns the message id", async () => {
    const fetchMock = mockFetch({ text: okBody });

    const id = await WhatsAppClient.sendTemplateMessage("+61 412 345 678", "order_confirmed", "en", ["Asha", "LOC-1", "$9"]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v21.0/1234567890/messages");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer token");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: "whatsapp",
      to: "61412345678",
      type: "template",
      template: {
        name: "order_confirmed",
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Asha" },
              { type: "text", text: "LOC-1" },
              { type: "text", text: "$9" },
            ],
          },
        ],
      },
    });
    expect(id).toBe("wamid.ABC");
  });

  it("sends no components for a template without body params", async () => {
    const fetchMock = mockFetch({ text: okBody });
    await WhatsAppClient.sendTemplateMessage("61412345678", "hello_world", "en_US", []);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).template.components).toEqual([]);
  });

  it("honours WHATSAPP_API_VERSION", async () => {
    process.env.WHATSAPP_API_VERSION = "v23.0";
    const fetchMock = mockFetch({ text: okBody });
    await WhatsAppClient.sendTemplateMessage("61412345678", "order_confirmed", "en", ["a"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.facebook.com/v23.0/1234567890/messages");
  });

  it("includes Meta's error message and code on a non-2xx response", async () => {
    mockFetch({
      status: 400,
      text: JSON.stringify({ error: { message: "(#132001) Template name does not exist", code: 132001 } }),
    });

    const error = await WhatsAppClient.sendTemplateMessage("61412345678", "nope", "en", []).catch((e) => e);

    expect(error).toBeInstanceOf(CustomException);
    expect(error.errorCode).toBe(503);
    expect(error.displayMessage).toContain("HTTP 400");
    expect(error.displayMessage).toContain("Template name does not exist");
    expect(error.displayMessage).toContain("132001");
  });

  it("falls back to the raw body when a non-2xx response is not JSON", async () => {
    mockFetch({ status: 502, text: "Bad gateway" });
    const error = await WhatsAppClient.sendTemplateMessage("61412345678", "order_confirmed", "en", []).catch((e) => e);
    expect(error.displayMessage).toContain("Bad gateway");
  });

  it("fails when a 2xx response carries no message id", async () => {
    mockFetch({ text: "{}" });
    await expect(
      WhatsAppClient.sendTemplateMessage("61412345678", "order_confirmed", "en", [])
    ).rejects.toMatchObject({ errorCode: 503 });
  });

  it("wraps a network failure as a CustomException", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch;
    const error = await WhatsAppClient.sendTemplateMessage("61412345678", "order_confirmed", "en", []).catch((e) => e);
    expect(error).toBeInstanceOf(CustomException);
    expect(error.displayMessage).toContain("ECONNRESET");
  });

  it("throws 400 for a missing template name or an undialable number", async () => {
    const fetchMock = mockFetch({ text: okBody });
    await expect(WhatsAppClient.sendTemplateMessage("61412345678", "", "en", [])).rejects.toMatchObject({ errorCode: 400 });
    await expect(WhatsAppClient.sendTemplateMessage("abc", "order_confirmed", "en", [])).rejects.toMatchObject({
      errorCode: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is configured only with both token and phone number id, and refuses to send otherwise", async () => {
    expect(WhatsAppClient.isConfigured()).toBe(true);
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    expect(WhatsAppClient.isConfigured()).toBe(false);
    const fetchMock = mockFetch({ text: okBody });
    await expect(
      WhatsAppClient.sendTemplateMessage("61412345678", "order_confirmed", "en", [])
    ).rejects.toMatchObject({ errorCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
