import { CustomException } from "../../commons/Exception/CustomException.js";
import { emailTemplates, renderEmailTemplate } from "./EmailTemplates.js";

const params = { name: "Asha", orderId: "LOC-1042", total: "$24.50", pickupTime: "9 AM", eta: "6 PM", amount: "$24.50" };

describe("renderEmailTemplate", () => {
  it("has the same five template ids as the SMS registry", () => {
    expect(Object.keys(emailTemplates).sort()).toEqual(
      ["order_confirmed", "out_for_delivery", "payment_failed", "payment_received", "pickup_scheduled"]
    );
  });

  it("builds subject, title and body from the params", () => {
    const email = renderEmailTemplate("order_confirmed", params);
    expect(email.subject).toContain("LOC-1042");
    expect(email.title).toBe("Order confirmed");
    expect(email.bodyHtml).toContain("Asha");
    expect(email.bodyHtml).toContain("$24.50");
  });

  it("renders every template without leaving undefined behind", () => {
    for (const id of Object.keys(emailTemplates)) {
      const email = renderEmailTemplate(id, params);
      expect(`${email.subject}${email.bodyHtml}${email.preheader}`).not.toContain("undefined");
    }
  });

  it("escapes a malicious param in the body", () => {
    const email = renderEmailTemplate("payment_received", { ...params, name: "<script>alert(1)</script>" });
    expect(email.bodyHtml).not.toContain("<script>");
    expect(email.bodyHtml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("throws 400 for an unknown templateId, including prototype keys", () => {
    for (const id of ["nope", "constructor", "__proto__"]) {
      expect(() => renderEmailTemplate(id, params)).toThrow(CustomException);
    }
    try {
      renderEmailTemplate("nope", params);
    } catch (error) {
      expect((error as CustomException).errorCode).toBe(400);
    }
  });

  it("throws 400 when a required param is missing", () => {
    expect.assertions(2);
    try {
      renderEmailTemplate("pickup_scheduled", { name: "Asha", orderId: "LOC-1" });
    } catch (error) {
      expect((error as CustomException).errorCode).toBe(400);
      expect((error as CustomException).displayMessage).toContain("pickupTime");
    }
  });
});
