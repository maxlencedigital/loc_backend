import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { SmsClient } from "../Clients/Sms.Client.js";
import { EmailClient } from "../Clients/Email.Client.js";
import { WhatsAppClient } from "../Clients/WhatsApp.Client.js";
import { renderSmsTemplate } from "../Templates/SmsTemplates.js";
import { renderEmailTemplate } from "../Templates/EmailTemplates.js";
import { escapeHtml, toPlainText } from "../Templates/BaseEmail.js";
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

type Preview = { title: string; body: string };
type TextInput = { channel: "sms" | "email"; to: string; subject: string; text: string };

const humanize = (templateId: string) => {
  const words = templateId.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// What the customer would read, for the in-app inbox. Validates the template and params
// exactly as dispatch does, so a caller bug is a 400 before anything is recorded or sent.
const preview = (input: DispatchInput): Preview => {
  try {
    const params = input.params ?? {};
    switch (input.channel) {
      case "sms":
        return { title: humanize(input.templateId), body: renderSmsTemplate(input.templateId, params) };
      case "email": {
        const email = renderEmailTemplate(input.templateId, params);
        return { title: email.subject, body: toPlainText(email.bodyHtml) };
      }
      case "whatsapp": {
        const template = getWhatsAppTemplate(input.templateId);
        const values = toBodyParams(template, params);
        return { title: humanize(input.templateId), body: template.body.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => values[Number(n) - 1] ?? "") };
      }
      default:
        throw new CustomException(`Unknown channel "${String(input.channel)}".`, badRequest);
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

// Free-form text for campaigns and win-backs (SMS and email only: WhatsApp business-initiated
// messages must be an approved template). Same contract as dispatch: a provider failure is a result.
const dispatchText = async (input: TextInput): Promise<DispatchResult> => {
  try {
    requireFields(input, ["channel", "to", "subject", "text"]);
    if (input.channel !== "sms" && input.channel !== "email") {
      throw new CustomException("Free-form messages are only available on sms and email.", badRequest);
    }
    const { channel, to } = input;
    if (!isConfigured(channel)) {
      if (process.env.NODE_ENV === "production") {
        console.error(`[Notification] No ${channel} provider configured while NODE_ENV=production, NOT delivered.`);
      } else {
        console.log(`[Notification][${channel}] to=${to} ${input.subject}`);
      }
      return { channel, delivered: false, error: "not configured" };
    }
    try {
      const providerMessageId =
        channel === "sms"
          ? await SmsClient.sendText(to, input.text)
          : await EmailClient.send({
              to,
              subject: input.subject,
              title: input.subject,
              preheader: input.text.slice(0, 90),
              bodyHtml: input.text
                .split(/\n{2,}/)
                .map((p) => `<p style="margin:0 0 16px 0;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
                .join(""),
            });
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

export const NotificationHub = { dispatch, dispatchText, preview, isConfigured };
export type { NotificationChannel, DispatchInput, DispatchResult, TextInput, Preview };
