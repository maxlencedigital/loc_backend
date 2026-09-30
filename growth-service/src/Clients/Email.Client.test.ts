import { CustomException } from "../../commons/Exception/CustomException.js";
import { EmailClient } from "./Email.Client.js";

const EMAIL_ENV = ["EMAIL_API_PROVIDER", "EMAIL_API_KEY", "EMAIL_FROM"];
const message = {
  to: "a@example.com",
  subject: "Hello there",
  title: "Order confirmed",
  bodyHtml: "<p>Hi <strong>Asha</strong></p>",
  preheader: "Preview text",
};

const mockFetch = (response: { ok: boolean; status?: number; text?: string }) => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    text: async () => response.text ?? "",
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

describe("EmailClient", () => {
  beforeEach(() => {
    for (const key of EMAIL_ENV) delete process.env[key];
    process.env.EMAIL_API_KEY = "api-key";
    process.env.EMAIL_FROM = "noreply@loc.test";
  });

  it("sends through Brevo with its api-key header and body shape", async () => {
    process.env.EMAIL_API_PROVIDER = "brevo";
    const fetchMock = mockFetch({ ok: true, text: '{"messageId":"<brevo-1@x>"}' });

    const id = await EmailClient.send(message);

    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.method).toBe("POST");
    expect(init.headers["api-key"]).toBe("api-key");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.signal).toBeDefined();
    expect(body.sender).toEqual({ email: "noreply@loc.test", name: "LOC" });
    expect(body.to).toEqual([{ email: "a@example.com" }]);
    expect(body.subject).toBe("Hello there");
    expect(body.htmlContent).toContain("<strong>Asha</strong>");
    expect(body.htmlContent).toContain("Order confirmed");
    expect(body.textContent).toContain("Hi Asha");
    expect(body.textContent).not.toContain("<");
    expect(id).toBe("<brevo-1@x>");
  });

  it("sends through Resend with a bearer token and body shape", async () => {
    process.env.EMAIL_API_PROVIDER = "resend";
    const fetchMock = mockFetch({ ok: true, text: '{"id":"re_123"}' });

    const id = await EmailClient.send(message);

    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer api-key");
    expect(body.from).toBe("LOC <noreply@loc.test>");
    expect(body.to).toEqual(["a@example.com"]);
    expect(body.html).toContain("<strong>Asha</strong>");
    expect(body.text).toContain("Hi Asha");
    expect(id).toBe("re_123");
  });

  it("escapes the title but keeps trusted bodyHtml markup", async () => {
    process.env.EMAIL_API_PROVIDER = "brevo";
    const fetchMock = mockFetch({ ok: true, text: "{}" });

    await EmailClient.send({ ...message, title: "<script>alert(1)</script>", preheader: "<img src=x>" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.htmlContent).not.toContain("<script>");
    expect(body.htmlContent).not.toContain("<img");
    expect(body.htmlContent).toContain("&lt;script&gt;");
    expect(body.textContent).toContain("<script>alert(1)</script>");
  });

  it("succeeds with no id when the provider body is empty or unreadable", async () => {
    process.env.EMAIL_API_PROVIDER = "brevo";
    mockFetch({ ok: true, text: "" });
    await expect(EmailClient.send(message)).resolves.toBeUndefined();
  });

  it("throws with the status and only the first 300 chars on non-2xx", async () => {
    process.env.EMAIL_API_PROVIDER = "brevo";
    mockFetch({ ok: false, status: 401, text: "x".repeat(500) });

    const error = await EmailClient.send(message).catch((e) => e);

    expect(error).toBeInstanceOf(CustomException);
    expect(error.errorCode).toBe(503);
    expect(error.displayMessage).toContain("HTTP 401");
    expect(error.displayMessage).toContain("x".repeat(300));
    expect(error.displayMessage).not.toContain("x".repeat(301));
  });

  it("wraps a network failure as a CustomException", async () => {
    process.env.EMAIL_API_PROVIDER = "resend";
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch;
    const error = await EmailClient.send(message).catch((e) => e);
    expect(error).toBeInstanceOf(CustomException);
    expect(error.displayMessage).toContain("ECONNRESET");
  });

  it("throws 400 when a required field is missing", async () => {
    process.env.EMAIL_API_PROVIDER = "brevo";
    const fetchMock = mockFetch({ ok: true });
    await expect(EmailClient.send({ ...message, subject: "" })).rejects.toMatchObject({ errorCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is configured only for a known provider with key and sender", async () => {
    expect(EmailClient.isConfigured()).toBe(false);
    process.env.EMAIL_API_PROVIDER = "mailgun";
    expect(EmailClient.isConfigured()).toBe(false);
    process.env.EMAIL_API_PROVIDER = "resend";
    expect(EmailClient.isConfigured()).toBe(true);
    delete process.env.EMAIL_FROM;
    expect(EmailClient.isConfigured()).toBe(false);
  });

  it("refuses to send when not configured", async () => {
    const fetchMock = mockFetch({ ok: true });
    await expect(EmailClient.send(message)).rejects.toMatchObject({ errorCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
