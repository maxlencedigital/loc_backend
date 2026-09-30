import { CustomException } from "../../commons/Exception/CustomException.js";
import { renderSmsTemplate, smsTemplates } from "./SmsTemplates.js";

const params = { name: "Asha", orderId: "LOC-1042", total: "$24.50", pickupTime: "9 AM", eta: "6 PM", amount: "$24.50" };

describe("renderSmsTemplate", () => {
  it("has the five required template ids", () => {
    expect(Object.keys(smsTemplates)).toEqual(
      expect.arrayContaining(["order_confirmed", "pickup_scheduled", "out_for_delivery", "payment_received", "payment_failed"])
    );
  });

  it("fills every placeholder and leaves none behind", () => {
    const message = renderSmsTemplate("order_confirmed", params);
    expect(message).toContain("Asha");
    expect(message).toContain("LOC-1042");
    expect(message).toContain("$24.50");
    expect(message).not.toContain("{{");
  });

  it("renders every registered template with the full param set", () => {
    for (const id of Object.keys(smsTemplates)) {
      expect(renderSmsTemplate(id, params)).not.toMatch(/\{\{|\}\}/);
    }
  });

  it("throws 400 for an unknown templateId", () => {
    expect.assertions(2);
    try {
      renderSmsTemplate("nope", params);
    } catch (error) {
      expect(error).toBeInstanceOf(CustomException);
      expect((error as CustomException).errorCode).toBe(400);
    }
  });

  it("does not resolve Object.prototype members as templates", () => {
    expect(() => renderSmsTemplate("constructor", params)).toThrow(CustomException);
    expect(() => renderSmsTemplate("__proto__", params)).toThrow(CustomException);
  });

  it("throws 400 naming the missing param instead of sending {{x}} literally", () => {
    expect.assertions(3);
    try {
      renderSmsTemplate("order_confirmed", { name: "Asha", orderId: "LOC-1" });
    } catch (error) {
      expect((error as CustomException).errorCode).toBe(400);
      expect((error as CustomException).displayMessage).toContain("total");
      expect((error as CustomException).displayMessage).not.toContain("{{");
    }
  });

  it("treats a blank param as missing", () => {
    expect(() => renderSmsTemplate("order_confirmed", { ...params, total: "" })).toThrow(CustomException);
  });

  it("does not re-expand a placeholder supplied inside a value", () => {
    const message = renderSmsTemplate("order_confirmed", { ...params, name: "{{total}}" });
    expect(message).toContain("Hi {{total}},");
  });
});
