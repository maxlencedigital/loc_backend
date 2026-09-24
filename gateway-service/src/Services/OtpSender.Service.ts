import nodemailer, { Transporter } from "nodemailer";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { serviceUnavailable } from "../../commons/Utils/StatusCode.js";

/**
 * Where OTPs actually go.
 *
 * Providers match the Tecnogex backend so one set of credentials covers both:
 *   SMS   — TransmitSMS (https://transmitsms.com), HTTP Basic auth
 *   Email — SMTP via nodemailer
 *
 * Both are optional. With their credentials unset the code is written to the
 * server log instead, which keeps every flow testable locally without an
 * account or a per-message bill. The code is never returned in an API
 * response, not even in development — an endpoint that hands back its own OTP
 * is not an OTP flow, and that kind of "temporary" convenience is exactly what
 * survives to production.
 */

const TRANSMIT_SMS_ENDPOINT = "https://api.transmitsms.com/send-sms.json";

const smsConfigured = () =>
  Boolean(
    process.env.TRANSMIT_SMS_API_KEY &&
      process.env.TRANSMIT_SMS_API_SECRET &&
      process.env.TRANSMIT_SMS_FROM_NUMBER
  );

const emailConfigured = () =>
  Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);

/** TransmitSMS expects digits only — no leading '+'. */
const digitsOnly = (value: string) => (value || "").replace(/[^\d]/g, "");

const logToConsole = (channel: "sms" | "email", to: string, code: string) => {
  console.log(`[OTP][${channel}] to=${to} code=${code}`);
  if (process.env.NODE_ENV === "production") {
    // Loud, because in production this means codes are reaching nobody and
    // every dependent flow is silently broken for real users.
    console.error(
      `[OTP] No ${channel} provider configured while NODE_ENV=production — ` +
        `the code was NOT delivered.`
    );
  }
};

const sendSms = async (to: string, code: string): Promise<void> => {
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
    const data = (await response.json()) as { error?: { code?: string; description?: string } };

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
};

/**
 * Built once and reused. Creating a transporter per message reopens an SMTP
 * connection every time, which is slow and gets throttled by most providers.
 */
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

const sendEmail = async (to: string, code: string): Promise<void> => {
  if (!emailConfigured()) {
    logToConsole("email", to, code);
    return;
  }

  try {
    await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject: "Your LOC verification code",
      text:
        `${code} is your LOC verification code. It expires in 5 minutes.\n\n` +
        `If you did not request this, you can ignore this email.`,
      html:
        `<p style="font-size:16px">Your LOC verification code is:</p>` +
        `<p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>` +
        `<p style="color:#666">It expires in 5 minutes. If you did not request this, ignore this email.</p>`,
    });
  } catch (error) {
    console.error(`[OTP][email] delivery failed for ${to}:`, (error as Error).message);
    throw new CustomException(
      "Could not send the verification code right now. Please try again.",
      serviceUnavailable
    );
  }
};

export const OtpSender = { sendSms, sendEmail, smsConfigured, emailConfigured };
