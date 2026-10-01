import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { serviceUnavailable } from "../../commons/Utils/StatusCode.js";

// Sensitive HR columns (bank account numbers) are encrypted at rest with AES-256-GCM.
// The key is HR_DATA_KEY (base64, 32 bytes). On a developer laptop (IS_LOCAL=true) with
// no key set, one is derived from the internal secret so local runs work; anywhere else
// a missing key refuses the write rather than storing the value in clear.
const VERSION = "v1";

let cachedKey: Buffer | null = null;

const loadKey = (): Buffer => {
  if (cachedKey) return cachedKey;
  const configured = process.env.HR_DATA_KEY;
  if (configured) {
    const key = Buffer.from(configured, "base64");
    if (key.length !== 32) throw new CustomException("Bank details cannot be stored right now.", serviceUnavailable);
    cachedKey = key;
  } else if (process.env.IS_LOCAL === "true") {
    cachedKey = crypto.scryptSync(process.env.INTERNAL_SERVICE_SECRET ?? "local-development", "hr-core-local", 32);
  } else {
    console.error("[hr-core] HR_DATA_KEY is not set; refusing to store sensitive fields.");
    throw new CustomException("Bank details cannot be stored right now.", serviceUnavailable);
  }
  return cachedKey;
};

export const encryptField = (plain: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", loadKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
};

export const decryptField = (blob: string): string => {
  const [version, iv, tag, data] = blob.split(":");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Unrecognised encrypted field.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", loadKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
};

/** Test hook: forget the cached key. */
export const resetFieldCipher = (): void => {
  cachedKey = null;
};
