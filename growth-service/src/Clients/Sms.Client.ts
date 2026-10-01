import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, serviceUnavailable } from "../../commons/Utils/StatusCode.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { renderSmsTemplate } from "../Templates/SmsTemplates.js";

// TransmitSMS, same integration as gateway-service OtpSender.sendSms.
const TRANSMIT_SMS_ENDPOINT = "https://api.transmitsms.com/send-sms.json";
const SMS_API_TIMEOUT_MS = 10_000;

const senderId = () => process.env.SMS_SENDER_ID || process.env.TRANSMIT_SMS_FROM_NUMBER;

const isConfigured = () =>
  Boolean(process.env.TRANSMIT_SMS_API_KEY && process.env.TRANSMIT_SMS_API_SECRET && senderId());

/** TransmitSMS expects digits only — no leading '+'. */
const digitsOnly = (value: string) => (value || "").replace(/[^\d]/g, "");

// A numeric sender is normalised like any number; an alphanumeric sender id
// ("LOC") would be emptied by digitsOnly, so it is sent as configured.
const formatSender = (value: string) => (/^[+\d\s()-]+$/.test(value) ? digitsOnly(value) : value);

// Sends already-rendered text (templates and campaign messages both end up here).
const sendText = async (to: string, message: string): Promise<string | undefined> => {
  try {
    const number = digitsOnly(to);
    if (!number) throw new CustomException("to must be a valid phone number.", badRequest);

    if (!isConfigured()) {
      throw new CustomException("SMS provider is not configured.", serviceUnavailable);
    }

    const body = new URLSearchParams({
      to: number,
      message,
      from: formatSender(senderId() as string),
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
        signal: AbortSignal.timeout(SMS_API_TIMEOUT_MS),
      });

      // Read the body ONCE: .text() then .json() on the same response throws.
      const raw = await response.text();
      let data: { message_id?: string | number; error?: { code?: string; description?: string } };
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`non-JSON provider response (HTTP ${response.status}): ${raw.slice(0, 200)}`);
      }

      // TransmitSMS answers 200 even for rejected sends; the verdict is in the body.
      if (data?.error?.code !== "SUCCESS") {
        throw new Error(data?.error?.description || data?.error?.code || "unknown provider error");
      }
      return data.message_id === undefined ? undefined : String(data.message_id);
    } catch (error) {
      throw new CustomException(`SMS delivery failed: ${(error as Error).message}`, serviceUnavailable);
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const send = async (
  to: string,
  templateId: string,
  params: Record<string, string>
): Promise<string | undefined> => {
  try {
    requireFields({ to, templateId }, ["to", "templateId"]);
    if (!digitsOnly(to)) throw new CustomException("to must be a valid phone number.", badRequest);
    return await sendText(to, renderSmsTemplate(templateId, params));
  } catch (error) {
    throw toCustomException(error);
  }
};

export const SmsClient = { send, sendText, isConfigured };
