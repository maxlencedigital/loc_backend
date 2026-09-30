import { CustomException } from "../../commons/Exception/CustomException.js";
import { getWhatsAppTemplate, toBodyParams, whatsAppTemplates } from "./WhatsAppTemplates.js";

describe("whatsAppTemplates definitions", () => {
  it("has the four first-wave templates, all snake_case UTILITY in English", () => {
    expect(Object.keys(whatsAppTemplates).sort()).toEqual(
      ["order_confirmed", "out_for_delivery", "payment_received", "pickup_scheduled"]
    );
    for (const template of Object.values(whatsAppTemplates)) {
      expect(template.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(template.category).toBe("UTILITY");
      expect(template.language).toBe("en");
    }
  });

  it("keeps placeholders, examples and paramOrder in step and obeys Meta's body rules", () => {
    for (const template of Object.values(whatsAppTemplates)) {
      const placeholders = [...template.body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
      // {{1}}..{{n}} in order, each once.
      expect(placeholders).toEqual(placeholders.map((_value, index) => index + 1));
      expect(template.example).toHaveLength(placeholders.length);
      expect(template.paramOrder).toHaveLength(placeholders.length);
      // Meta rejects bodies that start or end with a variable.
      expect(template.body).not.toMatch(/^\{\{/);
      expect(template.body).not.toMatch(/\}\}$/);
    }
  });
});

describe("getWhatsAppTemplate", () => {
  it("returns the definition for a known id", () => {
    expect(getWhatsAppTemplate("order_confirmed").name).toBe("order_confirmed");
  });

  it("throws 400 for an id without a WhatsApp template (payment_failed, unknown, prototype keys)", () => {
    for (const id of ["payment_failed", "nope", "constructor", "__proto__"]) {
      expect(() => getWhatsAppTemplate(id)).toThrow(CustomException);
    }
    try {
      getWhatsAppTemplate("payment_failed");
    } catch (error) {
      expect((error as CustomException).errorCode).toBe(400);
    }
  });
});

describe("toBodyParams", () => {
  it("orders params by the template's paramOrder, not by the caller's key order", () => {
    const template = getWhatsAppTemplate("payment_received");
    expect(toBodyParams(template, { orderId: "LOC-1", amount: "$9", name: "Asha" })).toEqual(["Asha", "$9", "LOC-1"]);
  });

  it("collapses newlines and repeated spaces that Meta would reject", () => {
    const template = getWhatsAppTemplate("order_confirmed");
    expect(toBodyParams(template, { name: " Asha\n  K ", orderId: "LOC-1", total: "$9" })[0]).toBe("Asha K");
  });

  it("throws 400 on a missing param", () => {
    const template = getWhatsAppTemplate("order_confirmed");
    expect(() => toBodyParams(template, { name: "Asha" })).toThrow(CustomException);
  });
});
