import { CustomException } from "../../commons/Exception/CustomException.js";

const mockSendMail = jest.fn();
jest.mock("nodemailer", () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail })) },
}));

import { OtpSender } from "./OtpSender.Service.js";

const EMAIL_ENV = [
  "EMAIL_API_PROVIDER",
  "EMAIL_API_KEY",
  "EMAIL_FROM",
  "EMAIL_HOST",
  "EMAIL_USER",
  "EMAIL_PASS",
];

const mockFetch = (response: { ok: boolean; status?: number; text?: string }) => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    text: async () => response.text ?? "",
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

describe("OtpSender.sendEmail", () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    for (const key of EMAIL_ENV) delete process.env[key];
    mockSendMail.mockReset();
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("logs the code and sends nothing when no provider is configured", async () => {
    const fetchMock = mockFetch({ ok: true });

    await OtpSender.sendEmail("a@example.com", "123456");

    expect(OtpSender.emailConfigured()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("code=123456"));
  });

  it("sends through Brevo with its api-key header and body shape", async () => {
    process.env.EMAIL_API_PROVIDER = "brevo";
    process.env.EMAIL_API_KEY = "brevo-key";
    process.env.EMAIL_FROM = "noreply@loc.test";
    const fetchMock = mockFetch({ ok: true });

    await OtpSender.sendEmail("a@example.com", "654321");

    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.headers["api-key"]).toBe("brevo-key");
    expect(body.sender.email).toBe("noreply@loc.test");
    expect(body.to).toEqual([{ email: "a@example.com" }]);
    expect(body.textContent).toContain("654321");
    expect(body.htmlContent).toContain("654321");
  });

  it("sends through Resend with a bearer token and body shape", async () => {
    process.env.EMAIL_API_PROVIDER = "resend";
    process.env.EMAIL_API_KEY = "re_key";
    process.env.EMAIL_FROM = "noreply@loc.test";
    const fetchMock = mockFetch({ ok: true });

    await OtpSender.sendEmail("a@example.com", "111222");

    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_key");
    expect(body.to).toEqual(["a@example.com"]);
    expect(body.from).toContain("noreply@loc.test");
    expect(body.text).toContain("111222");
  });

  it("prefers the HTTPS API over SMTP when both are configured", async () => {
    process.env.EMAIL_API_PROVIDER = "brevo";
    process.env.EMAIL_API_KEY = "brevo-key";
    process.env.EMAIL_FROM = "noreply@loc.test";
    process.env.EMAIL_HOST = "smtp.example.com";
    process.env.EMAIL_USER = "u";
    process.env.EMAIL_PASS = "p";
    const fetchMock = mockFetch({ ok: true });

    await OtpSender.sendEmail("a@example.com", "123456");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("falls back to SMTP when only SMTP is configured", async () => {
    process.env.EMAIL_HOST = "smtp.example.com";
    process.env.EMAIL_USER = "sender@example.com";
    process.env.EMAIL_PASS = "p";
    mockSendMail.mockResolvedValue({});
    const fetchMock = mockFetch({ ok: true });

    await OtpSender.sendEmail("a@example.com", "123456");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@example.com", from: "sender@example.com" })
    );
  });

  it("ignores an unknown provider name and an API key without a sender", async () => {
    process.env.EMAIL_API_PROVIDER = "mailgun";
    process.env.EMAIL_API_KEY = "k";
    process.env.EMAIL_FROM = "noreply@loc.test";
    expect(OtpSender.emailConfigured()).toBe(false);

    process.env.EMAIL_API_PROVIDER = "brevo";
    delete process.env.EMAIL_FROM;
    expect(OtpSender.emailConfigured()).toBe(false);
  });

  it("reports a provider rejection as a 503 instead of a silent success", async () => {
    process.env.EMAIL_API_PROVIDER = "brevo";
    process.env.EMAIL_API_KEY = "bad-key";
    process.env.EMAIL_FROM = "noreply@loc.test";
    mockFetch({ ok: false, status: 401, text: '{"message":"Key not found"}' });

    await expect(OtpSender.sendEmail("a@example.com", "123456")).rejects.toBeInstanceOf(CustomException);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("delivery failed"),
      expect.stringContaining("HTTP 401")
    );
  });

  it("reports a network failure as a CustomException", async () => {
    process.env.EMAIL_API_PROVIDER = "resend";
    process.env.EMAIL_API_KEY = "k";
    process.env.EMAIL_FROM = "noreply@loc.test";
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch;

    await expect(OtpSender.sendEmail("a@example.com", "123456")).rejects.toBeInstanceOf(CustomException);
  });
});
