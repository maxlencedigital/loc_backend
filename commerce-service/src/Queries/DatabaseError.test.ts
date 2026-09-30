import { isUniqueViolation } from "./DatabaseError.js";

// Shape captured from a live duplicate insert through the pg driver adapter: no meta.target.
const adapterError = (index: string) => ({
  code: "P2002",
  message: `Unique constraint failed on the constraint: \`${index}\``,
  meta: { driverAdapterError: { cause: { constraint: { index } } } },
});

describe("isUniqueViolation", () => {
  it("tells a duplicate store code from a duplicate customer phone", () => {
    const code = adapterError("commerce_stores_code_key");
    expect(isUniqueViolation(code, "code")).toBe(true);
    expect(isUniqueViolation(code, "phone")).toBe(false);
    expect(isUniqueViolation(adapterError("commerce_customers_phone_key"), "phone")).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isUniqueViolation(new Error("boom"), "code")).toBe(false);
    expect(isUniqueViolation({ code: "P2025" })).toBe(false);
  });
});
