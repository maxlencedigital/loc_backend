import crypto from "crypto";

// How a code reaches the person. "send" (default): SMS or email through the providers.
// "response": nothing is sent and the code is returned in the API response, so a team can
// integrate without paying for messages. That makes the code useless as proof of owning
// a phone or inbox, so it is opt-in per environment and never for team accounts.

export type OtpDeliveryMode = "send" | "response";

export const otpDeliveryMode = (): OtpDeliveryMode =>
  process.env.OTP_DELIVERY === "response" ? "response" : "send";

export const otpInResponse = (): boolean => otpDeliveryMode() === "response";

/** Refuses to boot on a typo: "respone" would silently fall back to paid sending. */
export const assertValidOtpDelivery = (): void => {
  const value = process.env.OTP_DELIVERY;
  if (value !== undefined && value !== "" && value !== "send" && value !== "response") {
    throw new Error(`OTP_DELIVERY must be "send" or "response", got "${value}".`);
  }
};

// An unknown account must look exactly like a known one, and that includes carrying a code.
export const decoyCode = (): string => String(crypto.randomInt(0, 10 ** 6)).padStart(6, "0");
