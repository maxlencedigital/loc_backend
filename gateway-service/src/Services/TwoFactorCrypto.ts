import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { serviceUnavailable } from "../../commons/Utils/StatusCode.js";

// TOTP secrets are encrypted at rest with AES-256-GCM. The data key is derived (HKDF-SHA256) from
// TWO_FACTOR_ENCRYPTION_KEY, so the variable is never used as a cipher key directly and the same
// value can safely be reused for nothing else. Each secret is bound to its owner by the GCM
// additional data, so a ciphertext copied onto another user's row fails to decrypt.

const KEY_PATTERN = /^[A-Za-z0-9+/_-]{43}={0,1}$/;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const VERSION = "v1";
const HKDF_INFO = "gateway-service/two-factor-secret/v1";

export const NOT_CONFIGURED_MESSAGE =
  "Two-factor authentication is not available on this server right now. Ask an administrator to configure it.";

const unavailable = () => new CustomException(NOT_CONFIGURED_MESSAGE, serviceUnavailable);

// The decoded key material, or null when the variable is missing or is not 32 bytes of base64.
const keyMaterial = (): Buffer | null => {
  const raw = process.env.TWO_FACTOR_ENCRYPTION_KEY?.trim();
  if (!raw || !KEY_PATTERN.test(raw)) return null;
  const bytes = Buffer.from(raw, "base64");
  return bytes.length === KEY_BYTES ? bytes : null;
};

export const twoFactorConfigured = (): boolean => keyMaterial() !== null;

const dataKey = (): Buffer => {
  const material = keyMaterial();
  if (!material) throw unavailable();
  return Buffer.from(crypto.hkdfSync("sha256", material, Buffer.alloc(0), HKDF_INFO, KEY_BYTES));
};

/** Throws a 503 unless a usable key is configured: the secret is never stored in plain. */
export const assertTwoFactorConfigured = (): void => {
  if (!twoFactorConfigured()) throw unavailable();
};

export const encryptSecret = (secret: Buffer, userId: string): string => {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", dataKey(), iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
};

export const decryptSecret = (envelope: string, userId: string): Buffer => {
  try {
    const [version, iv, tag, ciphertext] = envelope.split(".");
    if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error("unrecognised envelope");
    const decipher = crypto.createDecipheriv("aes-256-gcm", dataKey(), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]);
  } catch (error) {
    if (error instanceof CustomException) throw error;
    // Wrong key (rotated without re-enrolment) or a damaged row. The detail stays in the log.
    console.error(`[two-factor] could not decrypt the secret of user ${userId}: ${(error as Error).message}`);
    throw unavailable();
  }
};
