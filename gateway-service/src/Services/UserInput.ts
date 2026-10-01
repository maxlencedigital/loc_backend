import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";

// Field parsing shared by the team-account and self-service endpoints: each returns the
// canonical value or throws a 400 a person can read.

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_PATTERN = /^\+?[0-9]{8,15}$/;
export const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 150;

export const invalid = (message: string) => new CustomException(message, badRequest);

export const parseName = (value: unknown): string => {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    throw invalid(`name is required and must be at most ${MAX_NAME_LENGTH} characters.`);
  }
  return name;
};

export const parseEmail = (value: unknown): string => {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!EMAIL_PATTERN.test(email) || email.length > MAX_EMAIL_LENGTH) {
    throw invalid("A valid email address is required.");
  }
  return email;
};

// Spaces and dashes are typed freely ("+91 98765 43210"); one canonical form keeps the unique index honest.
export const parsePhone = (value: unknown): string => {
  const phone = typeof value === "string" ? value.replace(/[\s()-]/g, "") : "";
  if (!PHONE_PATTERN.test(phone)) {
    throw invalid("A valid phone number is required, e.g. +919876543210.");
  }
  return phone;
};

export const parseStoreId = (value: unknown): string => {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw invalid("storeId must be a store id (UUID).");
  }
  return value;
};
