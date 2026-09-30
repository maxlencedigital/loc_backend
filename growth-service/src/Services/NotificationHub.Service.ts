import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { SmsClient } from "../Clients/Sms.Client.js";
import { EmailClient } from "../Clients/Email.Client.js";
import { WhatsAppClient } from "../Clients/WhatsApp.Client.js";
import { renderSmsTemplate } from "../Templates/SmsTemplates.js";
import { renderEmailTemplate } from "../Templates/EmailTemplates.js";
import { toPlainText } from "../Templates/BaseEmail.js";
import { getWhatsAppTemplate, toBodyParams } from "../Templates/WhatsAppTemplates.js";

// Every outbound SMS/email/WhatsApp goes through dispatch (see HLD: Notification Hub).
type NotificationChannel = "sms" | "email" | "whatsapp";
type DispatchInput = {
  channel: NotificationChannel;
  to: string;
  templateId: string;
  params: Record<string, string>;
};
type DispatchResult = {
  channel: NotificationChannel;
  delivered: boolean;
  providerMessageId?: string;
  error?: string;
};

const CHANNELS: NotificationChannel[] = ["sms", "email", "whatsapp"];

const isConfigured = (channel: NotificationChannel): boolean => {
  if (channel === "sms") return SmsClient.isConfigured();
  if (channel === "email") return EmailClient.isConfigured();
  if (channel === "whatsapp") return WhatsAppClient.isConfigured();
  return false;
};

// Renders for the channel (which validates templateId and params, throwing 400)
// and returns a readable preview plus the provider call.
const prepare = (input: DispatchInput) => {
  const { channel, to, templateId, params } = input;
  switch (channel) {
    case "sms": {
      const message = renderSmsTemplate(templateId, params);
      return { preview: message, send: () => SmsClient.send(to, templateId, params) };
    }
    case "email": {
      const email = renderEmailTemplate(templateId, params);
      return {
        preview: `${email.subject}\n${toPlainText(email.bodyHtml)}`,
        send: () => EmailClient.send({ to, ...email }),
      };
    }
    case "whatsapp": {
      const template = getWhatsAppTemplate(templateId);
      const bodyParams = toBodyParams(template, params);
      return {
        preview: `${template.name} [${template.language}] ${JSON.stringify(bodyParams)}`,
        send: () => WhatsAppClient.sendTemplateMessage(to, template.name, template.language, bodyParams),
      };
    }
  }
};

// Never throws for a provider failure: a failed notification must not break the
// order/payment flow that triggered it. Throws 400 only for caller bugs.
const dispatch = async (input: DispatchInput): Promise<DispatchResult> => {
  try {
    requireFields(input, ["channel", "to", "templateId"]);
    if (!CHANNELS.includes(input.channel)) {
      throw new CustomException(`Unknown channel "${input.channel}".`, badRequest);
    }
    const params = input.params ?? {};
    if (typeof params !== "object" || Array.isArray(params)) {
      throw new CustomException("params must be an object.", badRequest);
    }
    const { channel, to } = input;
    const { preview, send } = prepare({ ...input, params });

    if (!isConfigured(channel)) {
      if (process.env.NODE_ENV === "production") {
        // Loud: in production this means customers silently get nothing.
        console.error(`[Notification] No ${channel} provider configured while NODE_ENV=production — NOT delivered.`);
      } else {
        console.log(`[Notification][${channel}] to=${to} ${preview}`);
      }
      return { channel, delivered: false, error: "not configured" };
    }

    try {
      const providerMessageId = await send();
      return { channel, delivered: true, ...(providerMessageId ? { providerMessageId } : {}) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Notification][${channel}] delivery failed for to=${to}:`, message);
      return { channel, delivered: false, error: message };
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

export const NotificationHub = { dispatch, isConfigured };
export type { NotificationChannel, DispatchInput, DispatchResult };
