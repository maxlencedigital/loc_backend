import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { UserQuery } from "../Queries/User.Query.js";
import { OtpService } from "./Otp.Service.js";
import { OtpChallengeQuery } from "../Queries/OtpChallenge.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { OtpSender } from "./OtpSender.Service.js";
import { OAuthService } from "./OAuth.Service.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, conflict, forbidden, unauthorized } from "../../commons/Utils/StatusCode.js";
import { UserRole, OAuthProvider } from "../Models/User/User.Interface.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

// OWASP guidance is a work factor of 10-12; 12 is the safer default and still
// within acceptable per-login latency.
const SALT_ROUNDS = 12;

// Pinned on both sign and verify, never left to the library's inference: an
// unconstrained verify is where JWT "alg confusion" bugs start.
const JWT_ALGORITHM = "HS256";

// No fallback secret: a service without JWT_SECRET must fail loudly, not sign
// tokens with a value sitting in source control.
const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new CustomException("Server misconfigured: JWT secret missing.", 500);
  }
  return secret;
};

const validateNewUserInput = (input: {
  name: string;
  email: string;
  phoneNumber: string;
  password: string;
}) => {
  if (!input.name?.trim() || !input.phoneNumber?.trim()) {
    throw new CustomException("Name and phone number are required.", badRequest);
  }
  if (!input.email || !EMAIL_PATTERN.test(input.email.trim())) {
    throw new CustomException("A valid email address is required.", badRequest);
  }
  if (!input.password || input.password.length < MIN_PASSWORD_LENGTH) {
    throw new CustomException(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      badRequest
    );
  }
};

const createUserRecord = async (input: {
  name: string;
  email: string;
  phoneNumber: string;
  password: string;
  role: UserRole;
}) => {
  const existing = await UserQuery.findByEmail(input.email);
  if (existing) {
    throw new CustomException("An account with this email already exists.", conflict);
  }
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  try {
    const user = await UserQuery.create({
      name: input.name.trim(),
      email: input.email.trim(),
      phoneNumber: input.phoneNumber.trim(),
      passwordHash,
      // This path (legacy /auth/register and admin-created accounts) takes the
      // number on trust — only the OTP flow can set isPhoneVerified.
      isPhoneVerified: false,
      oauthProvider: null,
      oauthSubject: null,
      role: input.role,
      isActive: true,
    });
    return { id: user.id, email: user.email, role: user.role };
  } catch (error: unknown) {
    // Two concurrent registrations can both pass the findByEmail check above,
    // so the unique constraint is the real guard — report it as the same 409.
    if (isUniqueViolation(error, "email")) {
      throw new CustomException("An account with this email already exists.", conflict);
    }
    if (isUniqueViolation(error, "phoneNumber")) {
      throw new CustomException("An account with this phone number already exists.", conflict);
    }
    throw error;
  }
};

// No `role` field on purpose: every self-registered account is a customer.
// Accepting one would let anyone register as "admin" and inherit full access.
const register = async (input: {
  name: string;
  email: string;
  phoneNumber: string;
  password: string;
}) => {
  validateNewUserInput(input);
  return createUserRecord({ ...input, role: "customer" });
};

const PRIVILEGED_ROLES_CREATABLE_VIA_API: UserRole[] = ["admin", "staff", "driver"];

// super_admin-only. Cannot create another super_admin: that tier is seeded
// only by a script needing deploy access, not just an API token.
const createPrivilegedUser = async (input: {
  name: string;
  email: string;
  phoneNumber: string;
  password: string;
  role: UserRole;
}) => {
  if (!PRIVILEGED_ROLES_CREATABLE_VIA_API.includes(input.role)) {
    throw new CustomException(
      `role must be one of: ${PRIVILEGED_ROLES_CREATABLE_VIA_API.join(", ")}.`,
      badRequest
    );
  }
  validateNewUserInput(input);
  return createUserRecord(input);
};

const login = async (email: string, password: string) => {
  if (!email || !password) {
    throw new CustomException("Email and password are required.", badRequest);
  }
  const user = await UserQuery.findByEmail(email);
  // Covers social-login accounts, which have no password: bcrypt.compare
  // against null would throw a 500 that reveals the account exists.
  if (!user || !user.isActive || !user.passwordHash) {
    throw new CustomException("Invalid email or password.", unauthorized);
  }
  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw new CustomException("Invalid email or password.", unauthorized);
  }
  const token = jwt.sign({ userId: user.id, role: user.role }, getJwtSecret(), {
    algorithm: JWT_ALGORITHM,
    expiresIn: "12h",
  });
  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
};

const verifyToken = (token: string): { userId: string; role: UserRole } => {
  try {
    return jwt.verify(token, getJwtSecret(), { algorithms: [JWT_ALGORITHM] }) as {
      userId: string;
      role: UserRole;
    };
  } catch {
    throw new CustomException("Invalid or expired token.", unauthorized);
  }
};

// ---------------- Shared helpers for the OTP / OAuth flows ----------------

const issueTokenFor = (user: {
  id: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  role: UserRole;
}) => {
  const token = jwt.sign({ userId: user.id, role: user.role }, getJwtSecret(), {
    algorithm: JWT_ALGORITHM,
    expiresIn: "12h",
  });
  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
    },
  };
};

// ---------- Registration with phone verified by OTP (3 steps) ----------
// Mirrors the sign-up form: the number is proven mid-form, before the email
// and password exist — the OTP is not verified at final submit.

/**
 * Step 1 — send a code to the phone. Takes only the number, because that is
 * all the form has at this point.
 */
const registerSendOtp = async (phoneNumber: string) => {
  if (!phoneNumber?.trim()) {
    throw new CustomException("A phone number is required.", badRequest);
  }
  const normalised = phoneNumber.trim();

  // Fail before spending an SMS on a number that can't be registered.
  if (await UserQuery.findByPhoneNumber(normalised)) {
    throw new CustomException("An account with this phone number already exists.", conflict);
  }

  const { challenge, code } = await OtpService.issue({
    purpose: "register",
    destination: normalised,
  });

  await OtpSender.sendSms(normalised, code);
  return challenge;
};

// Step 2 — check the code. Proves the number and nothing more; no account yet.
// A wrong code returns `attemptsRemaining` so the form can count down.
const registerVerifyOtp = async (verificationId: string, otp: string) => {
  const challenge = await OtpService.verifyCode(verificationId, otp, "register");
  return {
    verified: true,
    phoneNumber: challenge.destination,
    // The proof stays good this long, so the user can finish the form.
    completionWindowSeconds: OtpService.POST_VERIFY_WINDOW_SECONDS,
  };
};

// Step 3 — create the account. The phone number is read off the verified
// challenge: otherwise a caller could verify one number and register another.
const registerComplete = async (input: {
  verificationId: string;
  name: string;
  email: string;
  password: string;
}) => {
  // Burns the challenge, so one verification can't create two accounts.
  const challenge = await OtpService.consumeVerified(input.verificationId, "register");
  const phoneNumber = challenge.destination;

  validateNewUserInput({
    name: input.name,
    email: input.email,
    phoneNumber,
    password: input.password,
  });
  const email = input.email.trim().toLowerCase();

  // Re-checked here: the gap between sending the code and submitting the form
  // is long enough for someone else to take this email or number.
  if (await UserQuery.findByEmail(email)) {
    throw new CustomException("An account with this email already exists.", conflict);
  }
  if (await UserQuery.findByPhoneNumber(phoneNumber)) {
    throw new CustomException("An account with this phone number already exists.", conflict);
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  let user;
  try {
    user = await UserQuery.create({
      name: input.name.trim(),
      email,
      phoneNumber,
      passwordHash,
      // The point of the whole flow: this number was proven, so record it.
      isPhoneVerified: true,
      oauthProvider: null,
      oauthSubject: null,
      role: "customer",
      isActive: true,
    });
  } catch (error: unknown) {
    // The re-checks above narrow the race but cannot close it, so report the
    // constraint's rejection as the same 409 rather than a 500 at final submit.
    if (isUniqueViolation(error, "email")) {
      throw new CustomException("An account with this email already exists.", conflict);
    }
    if (isUniqueViolation(error, "phoneNumber")) {
      throw new CustomException("An account with this phone number already exists.", conflict);
    }
    throw error;
  }

  return issueTokenFor(user);
};

// -------------------- Login by phone + OTP (2 steps) --------------------

// Always reports success: a 404 would turn this into a way to test which
// numbers are registered. A code is only sent when an account exists.
const loginOtpRequest = async (phoneNumber: string) => {
  if (!phoneNumber?.trim()) {
    throw new CustomException("A phone number is required.", badRequest);
  }
  const normalised = phoneNumber.trim();
  const user = await UserQuery.findByPhoneNumber(normalised);

  if (!user || !user.isActive) {
    // Same response shape and timing-insensitive cost as the real path.
    return {
      verificationId: crypto.randomUUID(),
      expiresInSeconds: OtpService.OTP_TTL_SECONDS,
      resendAvailableInSeconds: OtpService.RESEND_COOLDOWN_SECONDS,
    };
  }

  const { challenge, code } = await OtpService.issue({
    purpose: "login",
    destination: normalised,
    userId: user.id,
  });
  // Swallowed deliberately: a provider outage surfacing here would make known
  // accounts fail while unknown ones succeed — an enumeration oracle.
  await OtpSender.sendSms(normalised, code).catch((error) =>
    console.error("[OTP] login code delivery failed:", error?.message)
  );
  return challenge;
};

const loginOtpVerify = async (verificationId: string, otp: string) => {
  // Login has no second step, so the challenge is verified and spent at once.
  const challenge = await OtpService.verifyCode(verificationId, otp, "login");
  await OtpChallengeQuery.markConsumed(challenge.id);
  if (!challenge.userId) {
    throw new CustomException("That code is invalid or has expired.", badRequest);
  }
  const user = await UserQuery.findById(challenge.userId);
  if (!user || !user.isActive) {
    throw new CustomException("That code is invalid or has expired.", badRequest);
  }
  return issueTokenFor(user);
};

// ------------------------------ Social login ------------------------------

// The token is verified server-side and the identity read from the result,
// never the request body. Matched on provider `sub` first, then verified email.
const loginOAuth = async (provider: OAuthProvider, token: string) => {
  const identity = await OAuthService.verify(provider, token);

  let user = await UserQuery.findByOAuthIdentity(identity.provider, identity.subject);
  let isNewUser = false;

  if (!user) {
    const byEmail = await UserQuery.findByEmail(identity.email);
    if (byEmail) {
      // Only link on a provider-VERIFIED email: otherwise someone could claim a
      // victim's address at the provider and inherit their account.
      if (!identity.emailVerified) {
        throw new CustomException(
          "That provider account's email is not verified, so it can't be linked to an existing account.",
          unauthorized
        );
      }
      await UserQuery.linkOAuthIdentity(byEmail.id, identity.provider, identity.subject);
      user = byEmail;
    } else {
      user = await UserQuery.create({
        name: identity.name || identity.email.split("@")[0],
        email: identity.email,
        // No password and no phone: social accounts have neither.
        passwordHash: null,
        phoneNumber: null,
        isPhoneVerified: false,
        oauthProvider: identity.provider,
        oauthSubject: identity.subject,
        role: "customer",
        isActive: true,
      });
      isNewUser = true;
    }
  }

  if (!user.isActive) {
    throw new CustomException("This account has been deactivated.", forbidden);
  }

  return {
    ...issueTokenFor(user),
    isNewUser,
    // Delivery needs a phone number, and no provider supplies one — the app
    // uses this to decide whether to prompt for it.
    profileComplete: Boolean(user.phoneNumber && user.isPhoneVerified),
  };
};

// ---------------- Forgotten password, by email OTP (2 steps) ----------------

/** Always reports success — same anti-enumeration reasoning as login-by-OTP. */
const passwordForgot = async (email: string) => {
  if (!email || !EMAIL_PATTERN.test(email.trim())) {
    throw new CustomException("A valid email address is required.", badRequest);
  }
  const normalised = email.trim().toLowerCase();
  const user = await UserQuery.findByEmail(normalised);

  if (!user || !user.isActive) {
    return {
      verificationId: crypto.randomUUID(),
      expiresInSeconds: OtpService.OTP_TTL_SECONDS,
      resendAvailableInSeconds: OtpService.RESEND_COOLDOWN_SECONDS,
    };
  }

  const { challenge, code } = await OtpService.issue({
    purpose: "password_reset",
    destination: normalised,
    userId: user.id,
  });
  // Swallowed for the same anti-enumeration reason as login-by-OTP above.
  await OtpSender.sendEmail(normalised, code).catch((error) =>
    console.error("[OTP] reset code delivery failed:", error?.message)
  );
  return challenge;
};

/**
 * Verify and set in one call, so a verified code is never left outstanding as
 * a reusable password-change token.
 */
const passwordReset = async (verificationId: string, otp: string, newPassword: string) => {
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new CustomException(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      badRequest
    );
  }

  // Verified and spent in one call, so a checked code is never left
  // outstanding as a reusable password-change token.
  const challenge = await OtpService.verifyCode(verificationId, otp, "password_reset");
  await OtpChallengeQuery.markConsumed(challenge.id);
  if (!challenge.userId) {
    throw new CustomException("That code is invalid or has expired.", badRequest);
  }
  const user = await UserQuery.findById(challenge.userId);
  if (!user || !user.isActive) {
    throw new CustomException("That code is invalid or has expired.", badRequest);
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await UserQuery.setPassword(user.id, passwordHash);

  // Existing sessions are NOT revoked: these JWTs are stateless, so a token
  // stolen before the reset stays valid for up to 12h. Needs a token version.
  return { message: "Password updated. Please sign in with your new password." };
};

export const AuthService = {
  register,
  login,
  verifyToken,
  createPrivilegedUser,
  registerSendOtp,
  registerVerifyOtp,
  registerComplete,
  loginOtpRequest,
  loginOtpVerify,
  loginOAuth,
  passwordForgot,
  passwordReset,
};
