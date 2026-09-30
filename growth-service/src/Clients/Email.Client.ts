import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { serviceUnavailable } from "../../commons/Utils/StatusCode.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { escapeHtml, renderBaseEmail, toPlainText } from "../Templates/BaseEmail.js";

// HTTPS API only (Brevo or Resend): Render's free tier blocks the SMTP ports.
// Request shapes mirror gateway-service OtpSender.sendEmailByApi.
const EMAIL_API_TIMEOUT_MS = 10_000;

type EmailApiProvider = "brevo" | "resend";
type EmailMessage = { to: string; subject: string; title: string; bodyHtml: string; preheader?: string };

const emailApiProvider = (): EmailApiProvider | null => {
  const provider = process.env.EMAIL_API_PROVIDER;
  return provider === "brevo" || provider === "resend" ? provider : null;
};

const isConfigured = () =>
  Boolean(emailApiProvider() && process.env.EMAIL_API_KEY && process.env.EMAIL_FROM);

const send = async (message: EmailMessage): Promise<string | undefined> => {
  try {
    requireFields(message, ["to", "subject", "title", "bodyHtml"]);
    if (!isConfigured()) {
      throw new CustomException("Email provider is not configured.", serviceUnavailable);
    }

    const provider = emailApiProvider() as EmailApiProvider;
    const apiKey = process.env.EMAIL_API_KEY as string;
    const from = process.env.EMAIL_FROM as string;
    const html = renderBaseEmail(message);
    const text = toPlainText(`<h1>${escapeHtml(message.title)}</h1>${message.bodyHtml}`);

    const request: { url: string; headers: Record<string, string>; body: unknown } =
      provider === "brevo"
        ? {
            url: "https://api.brevo.com/v3/smtp/email",
            headers: { "api-key": apiKey },
            body: {
              sender: { email: from, name: "LOC" },
              to: [{ email: message.to }],
              subject: message.subject,
              htmlContent: html,
              textContent: text,
            },
          }
        : {
            url: "https://api.resend.com/emails",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: { from: `LOC <${from}>`, to: [message.to], subject: message.subject, html, text },
          };

    try {
      const response = await fetch(request.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...request.headers },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(EMAIL_API_TIMEOUT_MS),
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`${provider} rejected the email (HTTP ${response.status}): ${raw.slice(0, 300)}`);
      }
      // Brevo answers { messageId }, Resend { id }; a body we cannot read is still a sent email.
      try {
        const data = JSON.parse(raw) as { messageId?: string; id?: string };
        return data.messageId ?? data.id;
      } catch {
        return undefined;
      }
    } catch (error) {
      throw new CustomException(`Email delivery failed: ${(error as Error).message}`, serviceUnavailable);
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

export const EmailClient = { send, isConfigured };
