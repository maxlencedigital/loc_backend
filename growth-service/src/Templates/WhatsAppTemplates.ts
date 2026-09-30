import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import { requireFields } from "../../commons/Utils/Validation.js";

// One entry per template to submit in Meta's template manager (mirrored in
// design/WHATSAPP_TEMPLATES.md). `paramOrder` maps {{1}}.. to our param names;
// `example` is the sample value Meta requires for each placeholder.
type WhatsAppTemplate = {
  name: string;
  category: "UTILITY";
  language: string;
  body: string;
  example: string[];
  paramOrder: string[];
};

// Keyed by our templateId. payment_failed has no entry on purpose: it is SMS/email only for now.
const whatsAppTemplates: Record<string, WhatsAppTemplate> = {
  order_confirmed: {
    name: "order_confirmed",
    category: "UTILITY",
    language: "en",
    body: "Hi {{1}}, your LOC order {{2}} is confirmed. Total: {{3}}. Thank you for choosing LOC!",
    example: ["Asha", "LOC-1042", "$24.50"],
    paramOrder: ["name", "orderId", "total"],
  },
  pickup_scheduled: {
    name: "pickup_scheduled",
    category: "UTILITY",
    language: "en",
    body: "Hi {{1}}, pickup for your LOC order {{2}} is scheduled for {{3}}. Please have your items ready.",
    example: ["Asha", "LOC-1042", "Tue 14 Oct, 9:00-11:00 AM"],
    paramOrder: ["name", "orderId", "pickupTime"],
  },
  out_for_delivery: {
    name: "out_for_delivery",
    category: "UTILITY",
    language: "en",
    body: "Hi {{1}}, your LOC order {{2}} is out for delivery and should arrive by {{3}}.",
    example: ["Asha", "LOC-1042", "6:00 PM today"],
    paramOrder: ["name", "orderId", "eta"],
  },
  payment_received: {
    name: "payment_received",
    category: "UTILITY",
    language: "en",
    body: "Hi {{1}}, we received your payment of {{2}} for LOC order {{3}}. Thank you!",
    example: ["Asha", "$24.50", "LOC-1042"],
    paramOrder: ["name", "amount", "orderId"],
  },
};

const getWhatsAppTemplate = (templateId: string): WhatsAppTemplate => {
  // Own-property check so "constructor"/"__proto__" are not treated as templates.
  if (!Object.hasOwn(whatsAppTemplates, templateId)) {
    throw new CustomException(`No WhatsApp template for "${templateId}".`, badRequest);
  }
  return whatsAppTemplates[templateId];
};

// Named params -> positional body params. Meta rejects newlines, tabs and runs of
// spaces inside a parameter, so whitespace is collapsed.
const toBodyParams = (template: WhatsAppTemplate, params: Record<string, string>): string[] => {
  requireFields(params, template.paramOrder);
  return template.paramOrder.map((key) => String(params[key]).replace(/\s+/g, " ").trim());
};

export { whatsAppTemplates, getWhatsAppTemplate, toBodyParams };
export type { WhatsAppTemplate };
