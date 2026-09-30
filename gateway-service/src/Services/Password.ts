import crypto from "crypto";

export const MIN_PASSWORD_LENGTH = 8;

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
