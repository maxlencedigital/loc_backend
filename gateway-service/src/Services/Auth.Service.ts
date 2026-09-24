import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { UserQuery } from "../Queries/User.Query.js";
import { OtpService } from "./Otp.Service.js";
import { OtpChallengeQuery } from "../Queries/OtpChallenge.Query.js";
import { OtpSender } from "./OtpSender.Service.js";
import { OAuthService } from "./OAuth.Service.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, conflict, forbidden, unauthorized } from "../../commons/Utils/StatusCode.js";
import { UserRole, OAuthProvider } from "../Models/User/User.Interface.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

// OWASP's current bcrypt guidance (2023+) is a work factor of 10-12;
// 12 is the safer default for a new project and still well within
// acceptable per-login latency.
const SALT_ROUNDS = 12;

// Pinned explicitly on both sign and verify — never left to the
// library's default inference — so a future dependency change can't
// silently widen what's accepted (the classic JWT "alg confusion"
// class of bug starts with an unconstrained verify).
const JWT_ALGORITHM = "HS256";

/**
 * No hardcoded fallback secret — a service without JWT_SECRET
 * set must fail loudly, not silently sign tokens with a value
 * that's sitting in source control.
 */
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
  } catch (error: any) {
    // Two concurrent registrations for the same email can both pass the
    // findByEmail check above; the DB's unique constraint is the real
    // guard, so translate its rejection into the same 409 instead of a
    // generic 500.
    if (error?.name === "SequelizeUniqueConstraintError") {
      throw new CustomException("An account with this email already exists.", conflict);
    }
    throw error;
  }
};

/**
 * Public self-registration input. There is deliberately no `role` field:
 * every self-registered account is a "customer". Elevated roles
 * (admin/staff/driver) must be granted separately by an already-authenticated
 * super_admin — never accepted from an anonymous request body, or any caller
 * could register as `role: "admin"` and inherit full access system-wide
 * (every downstream service trusts the gateway-issued x-user-role header
 * as-is).
 */
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

/**
 * super_admin-only: create an admin/staff/driver account. Deliberately
 * cannot create another super_admin — that tier is seeded only via
 * scripts/seed-super-admin.mjs, which requires direct DB/deploy access,
 * not just an API token. Keeps "who can mint the top of the hierarchy"
 * a strictly higher bar than "who can call an authenticated endpoint".
 */
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
  // `!user.passwordHash` covers social-login accounts, which have no password
  // at all. Without it, bcrypt.compare against null would throw a 500 and,
  // worse, the shape of that failure would reveal that the account exists.
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

// --------------------------------------------------------------------------
// Shared helpers for the OTP / OAuth flows below
// --------------------------------------------------------------------------

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

// --------------------------------------------------------------------------
// Registration with phone verified by OTP  (3 steps)
//
// Mirrors the actual sign-up form, where the number is proven mid-form: the
// user types a name and mobile, taps send, enters the code and sees it
// validated inline, and only then fills in email and password before
// submitting. So the OTP is verified on its own, before the rest of the
// details exist — not as the final submit.
// --------------------------------------------------------------------------

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

/**
 * Step 2 — check the code. Proves the number and nothing more: no account is
 * created, because the form hasn't collected an email or password yet.
 *
 * A wrong code comes back with `attemptsRemaining` so the form can show
 * "4 attempts left" and disable the input at zero.
 */
const registerVerifyOtp = async (verificationId: string, otp: string) => {
  const challenge = await OtpService.verifyCode(verificationId, otp, "register");
  return {
    verified: true,
    phoneNumber: challenge.destination,
    // The proof stays good this long, so the user can finish the form.
    completionWindowSeconds: OtpService.POST_VERIFY_WINDOW_SECONDS,
  };
};

/**
 * Step 3 — create the account, once the form is complete.
 *
 * The phone number is read back off the verified challenge, never taken from
 * this request: otherwise a caller could verify a number they own and then
 * register someone else's.
 */
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

  const user = await UserQuery.create({
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

  return issueTokenFor(user);
};

// --------------------------------------------------------------------------
// Login by phone + OTP  (2 steps)
// --------------------------------------------------------------------------

/**
 * Always reports success, whether or not the number belongs to an account —
 * a 404 here would turn this endpoint into a way to test which phone numbers
 * are registered. A code is only actually sent when there's an account.
 */
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
  // Swallowed deliberately. This endpoint returns success even for an
  // unknown number, so letting a provider outage surface as an error here
  // would make known accounts fail while unknown ones succeed — an account
  // enumeration oracle that only appears during an outage.
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

// --------------------------------------------------------------------------
// Social login
// --------------------------------------------------------------------------

/**
 * The provider token is verified server-side (see OAuth.Service) and the
 * identity is read out of the verified result — never from the request body.
 *
 * Matching order is deliberate: provider `sub` first (stable), then verified
 * email (so someone who signed up with a password can later use "Continue
 * with Google" and land on the same account rather than a duplicate).
 */
const loginOAuth = async (provider: OAuthProvider, token: string) => {
  const identity = await OAuthService.verify(provider, token);

  let user = await UserQuery.findByOAuthIdentity(identity.provider, identity.subject);
  let isNewUser = false;

  if (!user) {
    const byEmail = await UserQuery.findByEmail(identity.email);
    if (byEmail) {
      // Only link on a provider-verified email. Linking on an unverified one
      // would let someone register a provider account claiming a victim's
      // address and inherit their account.
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

// --------------------------------------------------------------------------
// Forgotten password, by email OTP  (2 steps)
// --------------------------------------------------------------------------

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

  // NOTE: existing sessions are not revoked, because these JWTs are stateless
  // and nothing tracks issued tokens yet — so a token stolen before the reset
  // stays valid until it expires (12h). Closing that properly needs a token
  // version/denylist on the user row, checked at verify time. Documented on
  // the endpoint rather than quietly left as a surprise.
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
