import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";

export const MIN_PASSWORD_LENGTH = 8;

// bcrypt silently ignores everything past 72 bytes, so a longer password would be a false promise.
export const MAX_PASSWORD_BYTES = 72;

// The rule for a password a person chooses (change, invite, reset). Older flows keep checking only
// the minimum; this adds the bcrypt ceiling so two different long passwords cannot hash alike.
export const parseNewPassword = (value: unknown): string => {
  if (typeof value !== "string" || value.length < MIN_PASSWORD_LENGTH) {
    throw new CustomException(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, badRequest);
  }
  if (Buffer.byteLength(value, "utf8") > MAX_PASSWORD_BYTES) {
    throw new CustomException(`Password must be at most ${MAX_PASSWORD_BYTES} bytes long.`, badRequest);
  }
  return value;
};

// OWASP guidance is a work factor of 10-12; 12 is the safer default and still
// within acceptable per-login latency.
export const SALT_ROUNDS = 12;

// No 0/O/1/l/I: a temporary password is read off a screen and typed by hand.
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const TEMP_PASSWORD_LENGTH = 16;

export const generateTemporaryPassword = (): string =>
  Array.from({ length: TEMP_PASSWORD_LENGTH }, () =>
    TEMP_PASSWORD_ALPHABET[crypto.randomInt(TEMP_PASSWORD_ALPHABET.length)]
  ).join("");
