import { CustomException } from "../../commons/Exception/CustomException.js";
import { SmsClient } from "./Sms.Client.js";

const SMS_ENV = ["TRANSMIT_SMS_API_KEY", "TRANSMIT_SMS_API_SECRET", "TRANSMIT_SMS_FROM_NUMBER", "SMS_SENDER_ID"];
const params = { name: "Asha", orderId: "LOC-1042", total: "$24.50" };

const mockFetch = (response: { status?: number; text: string }) => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: (response.status ?? 200) < 400,
    status: response.status ?? 200,
    text: jest.fn().mockResolvedValue(response.text),
    json: jest.fn().mockRejectedValue(new Error("body already read")),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

const successBody = JSON.stringify({ message_id: 987654, error: { code: "SUCCESS", description: "OK" } });

describe("SmsClient", () => {
  beforeEach(() => {
    for (const key of SMS_ENV) delete process.env[key];
    process.env.TRANSMIT_SMS_API_KEY = "key";
    process.env.TRANSMIT_SMS_API_SECRET = "secret";
    process.env.SMS_SENDER_ID = "LOC";
  });

  it("posts a form body to TransmitSMS with Basic auth and digits-only number", async () => {
    const fetchMock = mockFetch({ text: successBody });

    const id = await SmsClient.send("+61 (412) 345-678", "order_confirmed", params);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.transmitsms.com/send-sms.json");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("key:secret").toString("base64")}`);
    const form = init.body as URLSearchParams;
    expect(form.get("to")).toBe("61412345678");
    expect(form.get("from")).toBe("LOC");
    expect(form.get("message")).toBe(
      "Hi Asha, your LOC order LOC-1042 is confirmed. Total: $24.50. Thank you!"
    );
    expect(id).toBe("987654");
  });

  it("strips a numeric sender to digits but keeps an alphanumeric id as is", async () => {
    process.env.SMS_SENDER_ID = "+61 400 000 000";
    const fetchMock = mockFetch({ text: successBody });
    await SmsClient.send("61412345678", "order_confirmed", params);
    expect((fetchMock.mock.calls[0][1].body as URLSearchParams).get("from")).toBe("61400000000");
  });

  it("falls back to TRANSMIT_SMS_FROM_NUMBER when SMS_SENDER_ID is unset", async () => {
    delete process.env.SMS_SENDER_ID;
    process.env.TRANSMIT_SMS_FROM_NUMBER = "+61499999999";
    const fetchMock = mockFetch({ text: successBody });
    await SmsClient.send("61412345678", "order_confirmed", params);
    expect((fetchMock.mock.calls[0][1].body as URLSearchParams).get("from")).toBe("61499999999");
  });

  it("reports configured only with key, secret and a sender", () => {
    expect(SmsClient.isConfigured()).toBe(true);
    delete process.env.SMS_SENDER_ID;
    expect(SmsClient.isConfigured()).toBe(false);
    process.env.TRANSMIT_SMS_FROM_NUMBER = "61400000000";
    expect(SmsClient.isConfigured()).toBe(true);
    delete process.env.TRANSMIT_SMS_API_SECRET;
    expect(SmsClient.isConfigured()).toBe(false);
  });

  it("throws 400 for an unknown template without calling the provider", async () => {
    const fetchMock = mockFetch({ text: successBody });
    await expect(SmsClient.send("61412345678", "nope", params)).rejects.toMatchObject({ errorCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws 400 for a missing param and never sends a literal {{x}}", async () => {
    const fetchMock = mockFetch({ text: successBody });
    await expect(SmsClient.send("61412345678", "order_confirmed", { name: "Asha" })).rejects.toMatchObject({
      errorCode: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws 400 when the number has no digits", async () => {
    mockFetch({ text: successBody });
    await expect(SmsClient.send("abc", "order_confirmed", params)).rejects.toMatchObject({ errorCode: 400 });
  });

  it("treats a 200 response with an error body as a failure", async () => {
    mockFetch({ text: JSON.stringify({ error: { code: "AUTH_FAILED", description: "Bad credentials" } }) });
    const error = await SmsClient.send("61412345678", "order_confirmed", params).catch((e) => e);
    expect(error).toBeInstanceOf(CustomException);
    expect(error.errorCode).toBe(503);
    expect(error.displayMessage).toContain("Bad credentials");
  });

  it("fails on a non-JSON response body", async () => {
    mockFetch({ status: 502, text: "<html>Bad gateway</html>" });
    const error = await SmsClient.send("61412345678", "order_confirmed", params).catch((e) => e);
    expect(error.errorCode).toBe(503);
    expect(error.displayMessage).toContain("HTTP 502");
  });

  it("fails on a network error", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch;
    const error = await SmsClient.send("61412345678", "order_confirmed", params).catch((e) => e);
    expect(error).toBeInstanceOf(CustomException);
    expect(error.displayMessage).toContain("ECONNRESET");
  });

  it("refuses to send when not configured", async () => {
    delete process.env.TRANSMIT_SMS_API_KEY;
    const fetchMock = mockFetch({ text: successBody });
    await expect(SmsClient.send("61412345678", "order_confirmed", params)).rejects.toMatchObject({ errorCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
