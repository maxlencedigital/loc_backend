import { isUniqueViolation } from "./DatabaseError.js";

// The shapes below are what each Prisma setup really produces. The pg driver adapter
// shape was captured from a live duplicate insert; it carries NO meta.target, which is
// why a check written against the classic shape silently returned false.
const adapterError = (index: string) => ({
  code: "P2002",
  message: `Invalid \`prisma.user.create()\` invocation:\n\nUnique constraint failed on the constraint: \`${index}\``,
  meta: {
    modelName: "User",
    driverAdapterError: {
      cause: {
        originalCode: "23505",
        kind: "UniqueConstraintViolation",
        constraint: { index },
        table: "gateway_users",
      },
    },
  },
});

describe("isUniqueViolation", () => {
  it("recognises a duplicate phone number from the pg driver adapter", () => {
    const error = adapterError("gateway_users_phoneNumber_key");

    expect(isUniqueViolation(error)).toBe(true);
    expect(isUniqueViolation(error, "phoneNumber")).toBe(true);
    expect(isUniqueViolation(error, "email")).toBe(false);
  });

  it("recognises a duplicate email from the pg driver adapter", () => {
    const error = adapterError("gateway_users_email_key");

    expect(isUniqueViolation(error, "email")).toBe(true);
    expect(isUniqueViolation(error, "phoneNumber")).toBe(false);
  });

  it("falls back to the message when the structured cause is missing", () => {
    const error = {
      code: "P2002",
      message: "Unique constraint failed on the constraint: `gateway_users_email_key`",
      meta: {},
    };

    expect(isUniqueViolation(error, "email")).toBe(true);
  });

  it("still understands the classic engine's meta.target", () => {
    expect(isUniqueViolation({ code: "P2002", meta: { target: ["email"] } }, "email")).toBe(true);
    expect(isUniqueViolation({ code: "P2002", meta: { target: "gateway_users_phoneNumber_key" } }, "phoneNumber")).toBe(true);
  });

  it("answers true with no field given, for any P2002", () => {
    expect(isUniqueViolation(adapterError("uniq_oauth_identity"))).toBe(true);
  });

  it("is false for other database errors and for non-errors", () => {
    expect(isUniqueViolation({ code: "P1001", message: "can't reach database" }, "email")).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined, "email")).toBe(false);
  });
});
