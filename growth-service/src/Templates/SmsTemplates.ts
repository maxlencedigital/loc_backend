import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import { requireFields } from "../../commons/Utils/Validation.js";

// templateId -> message body. Keep bodies short: one SMS segment is 160 characters.
const smsTemplates: Record<string, string> = {
  order_confirmed: "Hi {{name}}, your LOC order {{orderId}} is confirmed. Total: {{total}}. Thank you!",
  pickup_scheduled: "Hi {{name}}, pickup for your LOC order {{orderId}} is scheduled for {{pickupTime}}.",
  out_for_delivery: "Hi {{name}}, your LOC order {{orderId}} is out for delivery and should arrive by {{eta}}.",
  payment_received: "Hi {{name}}, we received your payment of {{amount}} for LOC order {{orderId}}. Thank you!",
  payment_failed: "Hi {{name}}, your payment of {{amount}} for LOC order {{orderId}} failed. Please retry in the app.",
};

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

const renderSmsTemplate = (templateId: string, params: Record<string, string>): string => {
  // Own-property check: "constructor" or "__proto__" must not resolve to Object.prototype members.
  if (!Object.hasOwn(smsTemplates, templateId)) {
    throw new CustomException(`Unknown SMS template "${templateId}".`, badRequest);
  }
  const body = smsTemplates[templateId];
  const placeholders = [...body.matchAll(PLACEHOLDER)].map((match) => match[1]);
  requireFields(params, placeholders);
  // Single pass, so a value containing "{{x}}" is never expanded a second time.
  return body.replace(PLACEHOLDER, (_match, key: string) => String(params[key]));
};

export { smsTemplates, renderSmsTemplate };
