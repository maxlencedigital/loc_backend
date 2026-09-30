import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { escapeHtml } from "./BaseEmail.js";

type Params = Record<string, string>;
type EmailContent = { subject: string; title: string; bodyHtml: string; preheader: string };
type EmailTemplate = { required: string[]; build: (params: Params) => EmailContent };

const paragraph = (html: string) => `<p style="margin:0 0 16px 0;">${html}</p>`;

// Subject and preheader are plain text (the base layout escapes the preheader);
// every param interpolated into bodyHtml goes through escapeHtml.
const emailTemplates: Record<string, EmailTemplate> = {
  order_confirmed: {
    required: ["name", "orderId", "total"],
    build: (p) => ({
      subject: `Your LOC order ${p.orderId} is confirmed`,
      title: "Order confirmed",
      preheader: `We have received your order ${p.orderId}.`,
      bodyHtml:
        paragraph(`Hi ${escapeHtml(p.name)},`) +
        paragraph(`Your order <strong>${escapeHtml(p.orderId)}</strong> is confirmed. Total: <strong>${escapeHtml(p.total)}</strong>.`) +
        paragraph("Thank you for choosing LOC."),
    }),
  },
  pickup_scheduled: {
    required: ["name", "orderId", "pickupTime"],
    build: (p) => ({
      subject: `Pickup scheduled for order ${p.orderId}`,
      title: "Pickup scheduled",
      preheader: `Pickup time: ${p.pickupTime}.`,
      bodyHtml:
        paragraph(`Hi ${escapeHtml(p.name)},`) +
        paragraph(`Pickup for your order <strong>${escapeHtml(p.orderId)}</strong> is scheduled for <strong>${escapeHtml(p.pickupTime)}</strong>.`) +
        paragraph("Please have your items ready."),
    }),
  },
  out_for_delivery: {
    required: ["name", "orderId", "eta"],
    build: (p) => ({
      subject: `Your LOC order ${p.orderId} is out for delivery`,
      title: "Out for delivery",
      preheader: `Expected by ${p.eta}.`,
      bodyHtml:
        paragraph(`Hi ${escapeHtml(p.name)},`) +
        paragraph(`Your order <strong>${escapeHtml(p.orderId)}</strong> is out for delivery and should arrive by <strong>${escapeHtml(p.eta)}</strong>.`),
    }),
  },
  payment_received: {
    required: ["name", "orderId", "amount"],
    build: (p) => ({
      subject: `Payment received for order ${p.orderId}`,
      title: "Payment received",
      preheader: `We received your payment of ${p.amount}.`,
      bodyHtml:
        paragraph(`Hi ${escapeHtml(p.name)},`) +
        paragraph(`We received your payment of <strong>${escapeHtml(p.amount)}</strong> for order <strong>${escapeHtml(p.orderId)}</strong>.`) +
        paragraph("Thank you!"),
    }),
  },
  payment_failed: {
    required: ["name", "orderId", "amount"],
    build: (p) => ({
      subject: `Payment failed for order ${p.orderId}`,
      title: "Payment failed",
      preheader: `Your payment of ${p.amount} did not go through.`,
      bodyHtml:
        paragraph(`Hi ${escapeHtml(p.name)},`) +
        paragraph(`Your payment of <strong>${escapeHtml(p.amount)}</strong> for order <strong>${escapeHtml(p.orderId)}</strong> failed.`) +
        paragraph("Please retry in the LOC app."),
    }),
  },
};

const renderEmailTemplate = (templateId: string, params: Params): EmailContent => {
  // Own-property check so "constructor"/"__proto__" are not treated as templates.
  if (!Object.hasOwn(emailTemplates, templateId)) {
    throw new CustomException(`Unknown email template "${templateId}".`, badRequest);
  }
  const template = emailTemplates[templateId];
  requireFields(params, template.required);
  return template.build(params);
};

export { emailTemplates, renderEmailTemplate };
export type { EmailContent };
