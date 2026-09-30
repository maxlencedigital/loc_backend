import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, serviceUnavailable } from "../../commons/Utils/StatusCode.js";
import { requireFields } from "../../commons/Utils/Validation.js";

// Meta WhatsApp Cloud API. Business-initiated messages must be approved templates.
const WHATSAPP_API_TIMEOUT_MS = 10_000;

const isConfigured = () =>
  Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

/** The Cloud API expects the number in international format, digits only. */
const digitsOnly = (value: string) => (value || "").replace(/[^\d]/g, "");

type MetaResponse = {
  messages?: { id?: string }[];
  error?: { message?: string; code?: number };
};

const sendTemplateMessage = async (
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[]
): Promise<string> => {
  try {
    requireFields({ to, templateName, languageCode }, ["to", "templateName", "languageCode"]);
    const number = digitsOnly(to);
    if (!number) throw new CustomException("to must be a valid phone number.", badRequest);
    if (!isConfigured()) {
      throw new CustomException("WhatsApp provider is not configured.", serviceUnavailable);
    }

    const version = process.env.WHATSAPP_API_VERSION || "v21.0";
    const url = `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const body = {
      messaging_product: "whatsapp",
      to: number,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: bodyParams.length
          ? [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) }]
          : [],
      },
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(WHATSAPP_API_TIMEOUT_MS),
      });

      const raw = await response.text();
      let data: MetaResponse = {};
      try {
        data = JSON.parse(raw);
      } catch {
        // Handled below: a non-JSON body is a failure either way.
      }

      if (!response.ok) {
        const detail = data.error
          ? `${data.error.message} (code ${data.error.code})`
          : raw.slice(0, 300);
        throw new Error(`Meta rejected the message (HTTP ${response.status}): ${detail}`);
      }
      const messageId = data.messages?.[0]?.id;
      if (!messageId) throw new Error(`Meta response had no message id: ${raw.slice(0, 300)}`);
      return messageId;
    } catch (error) {
      throw new CustomException(`WhatsApp delivery failed: ${(error as Error).message}`, serviceUnavailable);
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

export const WhatsAppClient = { sendTemplateMessage, isConfigured };
