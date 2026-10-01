import crypto from "crypto";

// TOTP, RFC 6238 over HMAC-SHA1 (RFC 4226), the profile every authenticator app supports:
// 6 digits, 30 second steps, a 160-bit secret shown to the user as base32.

export const STEP_SECONDS = 30;
export const CODE_DIGITS = 6;
const SECRET_BYTES = 20;
// One step either side tolerates a phone clock a few seconds off; wider would widen the guess window.
const SKEW_STEPS = 1;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const generateSecret = (): Buffer => crypto.randomBytes(SECRET_BYTES);

export const base32Encode = (bytes: Buffer): string => {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
};

export const currentStep = (nowMs: number): number => Math.floor(nowMs / 1000 / STEP_SECONDS);

// The 6 digit code for one counter value (RFC 4226 dynamic truncation).
export const hotp = (secret: Buffer, counter: number): string => {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secret).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, "0");
};

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

// The time-step the code belongs to, or null. Every step in the window is always checked, so the
// time taken does not say which one matched; the latest match wins.
export const matchStep = (secret: Buffer, code: string, nowMs: number): number | null => {
  const now = currentStep(nowMs);
  let matched: number | null = null;
  for (let step = now - SKEW_STEPS; step <= now + SKEW_STEPS; step++) {
    if (step >= 0 && safeEqual(hotp(secret, step), code)) matched = step;
  }
  return matched;
};

export const otpauthUrl = (secret: Buffer, account: string, issuer: string): string => {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: "SHA1",
    digits: String(CODE_DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
};
