import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import {
  assertTwoFactorConfigured,
  decryptSecret,
  encryptSecret,
  twoFactorConfigured,
} from "./TwoFactorCrypto.js";

const KEY = crypto.randomBytes(32).toString("base64");
const OTHER_KEY = crypto.randomBytes(32).toString("base64");
const secret = crypto.randomBytes(20);

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  process.env.TWO_FACTOR_ENCRYPTION_KEY = KEY;
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
  errorSpy.mockRestore();
});

const statusOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as CustomException).errorCode;
  }
  return null;
};

describe("encryptSecret / decryptSecret", () => {
  it("round-trips and never stores the secret in plain", () => {
    const stored = encryptSecret(secret, "user-1");

    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored).not.toContain(secret.toString("base64url"));
    expect(stored).not.toContain(secret.toString("hex"));
    expect(decryptSecret(stored, "user-1").equals(secret)).toBe(true);
  });

  it("uses a fresh random IV, so the same secret never encrypts to the same text", () => {
    expect(encryptSecret(secret, "user-1")).not.toBe(encryptSecret(secret, "user-1"));
  });

  it("refuses a ciphertext moved onto another user's row", () => {
    const stored = encryptSecret(secret, "user-1");

    expect(statusOf(() => decryptSecret(stored, "user-2"))).toBe(503);
  });

  it("refuses a tampered ciphertext, a tampered tag and a different key", () => {
    const stored = encryptSecret(secret, "user-1");
    const [v, iv, tag, ct] = stored.split(".");
    const flip = (value: string) => (value[0] === "A" ? "B" : "A") + value.slice(1);

    expect(statusOf(() => decryptSecret([v, iv, tag, flip(ct)].join("."), "user-1"))).toBe(503);
    expect(statusOf(() => decryptSecret([v, iv, flip(tag), ct].join("."), "user-1"))).toBe(503);
    process.env.TWO_FACTOR_ENCRYPTION_KEY = OTHER_KEY;
    expect(statusOf(() => decryptSecret(stored, "user-1"))).toBe(503);
  });

  it("refuses an unrecognised envelope without leaking detail", () => {
    expect(statusOf(() => decryptSecret("not-an-envelope", "user-1"))).toBe(503);
    expect(statusOf(() => decryptSecret("v2.a.b.c", "user-1"))).toBe(503);
  });
});

describe("configuration", () => {
  it("is configured with 32 bytes of base64", () => {
    expect(twoFactorConfigured()).toBe(true);
    expect(() => assertTwoFactorConfigured()).not.toThrow();
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["too short", crypto.randomBytes(16).toString("base64")],
    ["too long", crypto.randomBytes(48).toString("base64")],
    ["not base64", "!".repeat(44)],
  ])("answers 503 and will not encrypt when the key is %s", (_name, value) => {
    if (value === undefined) delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
    else process.env.TWO_FACTOR_ENCRYPTION_KEY = value;

    expect(twoFactorConfigured()).toBe(false);
    expect(statusOf(() => assertTwoFactorConfigured())).toBe(503);
    expect(statusOf(() => encryptSecret(secret, "user-1"))).toBe(503);
  });
});
