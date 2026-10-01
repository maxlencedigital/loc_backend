import nodemailer, { Transporter } from "nodemailer";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { serviceUnavailable } from "../../commons/Utils/StatusCode.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";

// Where OTPs go: TransmitSMS, and email by an HTTPS API (Brevo or Resend) or SMTP.
// All optional — unset credentials log the code, which is never returned in an
// API response. The HTTPS API wins when configured: Render's free tier blocks the
// SMTP ports (25, 465, 587), so SMTP can only ever work locally.

const TRANSMIT_SMS_ENDPOINT = "https://api.transmitsms.com/send-sms.json";

const smsConfigured = () =>
  Boolean(
    process.env.TRANSMIT_SMS_API_KEY &&
      process.env.TRANSMIT_SMS_API_SECRET &&
      process.env.TRANSMIT_SMS_FROM_NUMBER
  );

const smtpConfigured = () =>
  Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);

type EmailApiProvider = "brevo" | "resend";
const emailApiProvider = (): EmailApiProvider | null => {
  const provider = process.env.EMAIL_API_PROVIDER;
  return provider === "brevo" || provider === "resend" ? provider : null;
};
const emailApiConfigured = () =>
  Boolean(emailApiProvider() && process.env.EMAIL_API_KEY && process.env.EMAIL_FROM);

const emailConfigured = () => emailApiConfigured() || smtpConfigured();

/** TransmitSMS expects digits only — no leading '+'. */
const digitsOnly = (value: string) => (value || "").replace(/[^\d]/g, "");

const logToConsole = (channel: "sms" | "email", to: string, code: string) => {
  console.log(`[OTP][${channel}] to=${to} code=${code}`);
  if (process.env.NODE_ENV === "production") {
    // Loud: in production this means codes reach nobody and every dependent
    // flow is silently broken for real users.
    console.error(
      `[OTP] No ${channel} provider configured while NODE_ENV=production — ` +
        `the code was NOT delivered.`
    );
  }
};

const sendSms = async (to: string, code: string): Promise<void> => {
  try {
    if (!smsConfigured()) {
      logToConsole("sms", to, code);
      return;
    }

    const body = new URLSearchParams({
      to: digitsOnly(to),
      message: `${code} is your LOC verification code. It expires in 5 minutes. Do not share it with anyone.`,
      from: digitsOnly(process.env.TRANSMIT_SMS_FROM_NUMBER as string),
    });

    const auth = Buffer.from(
      `${process.env.TRANSMIT_SMS_API_KEY}:${process.env.TRANSMIT_SMS_API_SECRET}`
    ).toString("base64");

    try {
      const response = await fetch(TRANSMIT_SMS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${auth}`,
        },
        body,
      });

      // Read the body ONCE. A response body is a stream: calling .text() and then
      // .json() on the same response throws, which would fail every send.
      const raw = await response.text();
      let data: { error?: { code?: string; description?: string } };
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`non-JSON provider response (HTTP ${response.status}): ${raw.slice(0, 200)}`);
      }

      // TransmitSMS answers 200 even for rejected sends; the verdict is in the
      // body, so checking response.ok alone would treat failures as successes.
      if (data?.error?.code !== "SUCCESS") {
        throw new Error(data?.error?.description || data?.error?.code || "unknown provider error");
      }
    } catch (error) {
      console.error(`[OTP][sms] delivery failed for ${to}:`, (error as Error).message);
      throw new CustomException(
        "Could not send the verification code right now. Please try again.",
        serviceUnavailable
      );
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

// Built once and reused: a transporter per message reopens an SMTP connection
// every time, which is slow and gets throttled by most providers.
let transporter: Transporter | null = null;
const getTransporter = (): Transporter => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE,
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT),
      secure: Number(process.env.EMAIL_PORT) === 465,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
  }
  return transporter;
};

const EMAIL_API_TIMEOUT_MS = 10_000;

interface EmailMessage {
  subject: string;
  text: string;
  html: string;
}

const otpEmail = (code: string): EmailMessage => ({
  subject: "Your LOC verification code",
  text:
    `${code} is your LOC verification code. It expires in 5 minutes.\n\n` +
    `If you did not request this, you can ignore this email.`,
  html:
    `<p style="font-size:16px">Your LOC verification code is:</p>` +
    `<p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>` +
    `<p style="color:#666">It expires in 5 minutes. If you did not request this, ignore this email.</p>`,
});

// Sends over HTTPS, which Render's free tier allows. Throws on any non-2xx so the
// caller reports a real delivery failure instead of a silent success.
const sendEmailByApi = async (to: string, message: EmailMessage): Promise<void> => {
  const provider = emailApiProvider() as EmailApiProvider;
  const apiKey = process.env.EMAIL_API_KEY as string;
  const from = process.env.EMAIL_FROM as string;

  const request: { url: string; headers: Record<string, string>; body: unknown } =
    provider === "brevo"
      ? {
          url: "https://api.brevo.com/v3/smtp/email",
          headers: { "api-key": apiKey },
          body: {
            sender: { email: from, name: "LOC" },
            to: [{ email: to }],
            subject: message.subject,
            htmlContent: message.html,
            textContent: message.text,
          },
        }
      : {
          url: "https://api.resend.com/emails",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: { from: `LOC <${from}>`, to: [to], subject: message.subject, html: message.html, text: message.text },
        };

  const response = await fetch(request.url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...request.headers },
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(EMAIL_API_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`${provider} rejected the email (HTTP ${response.status}): ${detail}`);
  }
};

// Hands one message to whichever email path is configured; any failure is the same 503.
const deliverEmail = async (to: string, message: EmailMessage): Promise<void> => {
  try {
    if (emailApiConfigured()) {
      await sendEmailByApi(to, message);
      return;
    }
    await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  } catch (error) {
    console.error(`[OTP][email] delivery failed for ${to}:`, (error as Error).message);
    throw new CustomException(
      "Could not send the verification code right now. Please try again.",
      serviceUnavailable
    );
  }
};

const sendEmail = async (to: string, code: string): Promise<void> => {
  try {
    if (!emailConfigured()) {
      logToConsole("email", to, code);
      return;
    }
    await deliverEmail(to, otpEmail(code));
  } catch (error) {
    throw toCustomException(error);
  }
};

export type LinkEmailKind = "invite" | "reset";

// Invitation and admin-issued reset links. DASHBOARD_URL turns the token into a clickable link;
// without it the token itself is in the message. Both kinds are redeemed at /accept-invite.
const linkEmail = (kind: LinkEmailKind, token: string, validForHours: number): EmailMessage => {
  const base = process.env.DASHBOARD_URL?.trim().replace(/\/+$/, "");
  const link = base ? `${base}/accept-invite?token=${encodeURIComponent(token)}` : null;
  const intro =
    kind === "invite"
      ? "You have been invited to LOC. Set your password to finish creating your account."
      : "An administrator has started a password reset for your LOC account.";
  const how = link ? `Open this link: ${link}` : `Your one-time code is: ${token}`;
  const footer = `It works once and expires in ${validForHours} hours. If you did not expect it, ignore this email.`;
  return {
    subject: kind === "invite" ? "You are invited to LOC" : "Reset your LOC password",
    text: [intro, how, footer].join("\n\n"),
    html:
      `<p>${intro}</p>` +
      (link ? `<p><a href="${link}">Set your password</a></p>` : `<p style="font-family:monospace">${token}</p>`) +
      `<p style="color:#666">${footer}</p>`,
  };
};

const sendLinkEmail = async (to: string, kind: LinkEmailKind, token: string, validForHours: number): Promise<void> => {
  try {
    if (!emailConfigured()) {
      console.log(`[LINK][email] kind=${kind} to=${to} token=${token}`);
      if (process.env.NODE_ENV === "production") {
        console.error("[LINK] No email provider configured while NODE_ENV=production — the message was NOT delivered.");
      }
      return;
    }
    await deliverEmail(to, linkEmail(kind, token, validForHours)).catch(() => {
      throw new CustomException("Could not send the email right now. Please try again.", serviceUnavailable);
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

export const OtpSender = { sendSms, sendEmail, sendLinkEmail, smsConfigured, emailConfigured };
