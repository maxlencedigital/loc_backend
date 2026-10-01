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
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { MIN_PASSWORD_LENGTH, SALT_ROUNDS } from "./Password.js";
import { toDashboardUser } from "../Models/User/DashboardUser.js";
import { JWT_ALGORITHM, getJwtSecret } from "./Token.js";
import { SessionService } from "./Session.Service.js";
import { decoyCode, otpInResponse } from "./OtpDelivery.js";
import { TwoFactorService } from "./TwoFactor.Service.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  try {
    validateNewUserInput(input);
    return await createUserRecord({ ...input, role: "customer" });
  } catch (error) {
    throw toCustomException(error);
  }
};

const PRIVILEGED_ROLES_CREATABLE_VIA_API: UserRole[] = ["admin", "manager", "hr", "staff", "driver"];

// super_admin-only. Cannot create another super_admin: that tier is seeded
// only by a script needing deploy access, not just an API token.
const createPrivilegedUser = async (input: {
  name: string;
  email: string;
  phoneNumber: string;
  password: string;
  role: UserRole;
}) => {
  try {
    if (!PRIVILEGED_ROLES_CREATABLE_VIA_API.includes(input.role)) {
      throw new CustomException(
        `role must be one of: ${PRIVILEGED_ROLES_CREATABLE_VIA_API.join(", ")}.`,
        badRequest
      );
    }
    validateNewUserInput(input);
    return await createUserRecord(input);
  } catch (error) {
    throw toCustomException(error);
  }
};

// One message for every way a credential check can fail, so the answer never says
// whether the email exists, is a social account, is switched off, or has another role.
const invalidCredentials = () => new CustomException("Invalid email or password.", unauthorized);

// Checks email and password and returns the account. Every failure is the same 401.
const authenticate = async (email: unknown, password: unknown) => {
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    throw new CustomException("Email and password are required.", badRequest);
  }
  const user = await UserQuery.findByEmail(email);
  // Covers social-login accounts, which have no password: bcrypt.compare
  // against null would throw a 500 that reveals the account exists.
  if (!user || !user.isActive || !user.passwordHash) throw invalidCredentials();
  if (!(await bcrypt.compare(password, user.passwordHash))) throw invalidCredentials();
  return user;
};

const login = async (email: string, password: string) => {
  try {
    const user = await authenticate(email, password);
    // An account with a second factor stops here: no session until POST /auth/2fa/verify.
    const challenge = await TwoFactorService.challengeIfRequired(user);
    if (challenge) return challenge;
    const loggedIn = await UserQuery.recordLogin(user.id);
    return { ...(await SessionService.issue(loggedIn)), user: toDashboardUser(loggedIn) };
  } catch (error) {
    throw toCustomException(error);
  }
};

// The customer app's login. Customers only: a team account is refused with the same
// 401 as a wrong password, after the password check, so neither the message nor the
// timing reveals that the email belongs to staff.
const customerLogin = async (email: string, password: string) => {
  try {
    const user = await authenticate(email, password);
    if (user.role !== "customer") throw invalidCredentials();
    const loggedIn = await UserQuery.recordLogin(user.id);
    return {
      ...(await SessionService.issue(loggedIn)),
      user: {
        id: loggedIn.id,
        name: loggedIn.name,
        email: loggedIn.email,
        phoneNumber: loggedIn.phoneNumber,
        isPhoneVerified: loggedIn.isPhoneVerified,
        role: loggedIn.role,
      },
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// Fresh from the database: the token alone cannot show a deactivation or a new store.
const getProfile = async (userId: string) => {
  try {
    const user = await UserQuery.findById(userId);
    if (!user || !user.isActive) {
      throw new CustomException("Your account is no longer active.", unauthorized);
    }
    return { ...toDashboardUser(user), twoFactorEnabled: await TwoFactorService.isEnabled(user.id) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const verifyToken = (
  token: string
): { userId: string; role: UserRole; storeId: string | null; name: string | null } => {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: [JWT_ALGORITHM] }) as {
      userId: string;
      role: UserRole;
      storeId?: string | null;
      name?: string;
    };
    // Tokens issued before storeId existed carry none.
    return {
      userId: decoded.userId,
      role: decoded.role,
      storeId: decoded.storeId ?? null,
      name: decoded.name ?? null,
    };
  } catch {
    throw new CustomException("Invalid or expired token.", unauthorized);
  }
};

// ---------------- Shared helpers for the OTP / OAuth flows ----------------

const issueTokenFor = async (user: {
  id: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  role: UserRole;
  storeId: string | null;
}) => ({
  ...(await SessionService.issue(user)),
  user: {
    id: user.id,
    name: user.name,
    email: user.email,
    phoneNumber: user.phoneNumber,
    role: user.role,
  },
});

// ---------- Registration with phone verified by OTP (3 steps) ----------
// Mirrors the sign-up form: the number is proven mid-form, before the email
// and password exist — the OTP is not verified at final submit.

/**
 * Step 1 — send a code to the phone. Takes only the number, because that is
 * all the form has at this point.
 */
const registerSendOtp = async (phoneNumber: string) => {
  try {
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

    if (otpInResponse()) return { ...challenge, otp: code };
    await OtpSender.sendSms(normalised, code);
    return challenge;
  } catch (error) {
    throw toCustomException(error);
  }
};

// Step 2 — check the code. Proves the number and nothing more; no account yet.
// A wrong code returns `attemptsRemaining` so the form can count down.
const registerVerifyOtp = async (verificationId: string, otp: string) => {
  try {
    const challenge = await OtpService.verifyCode(verificationId, otp, "register");
    return {
      verified: true,
      phoneNumber: challenge.destination,
      // The proof stays good this long, so the user can finish the form.
      completionWindowSeconds: OtpService.POST_VERIFY_WINDOW_SECONDS,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// Step 3 — create the account. The phone number is read off the verified
// challenge: otherwise a caller could verify one number and register another.
const registerComplete = async (input: {
  verificationId: string;
  name: string;
  email: string;
  password: string;
}) => {
  try {
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

    return await issueTokenFor(user);
  } catch (error) {
    throw toCustomException(error);
  }
};

// -------------------- Login by phone + OTP (2 steps) --------------------

// Always reports success: a 404 would turn this into a way to test which
// numbers are registered. A code is only sent when an account exists.
const loginOtpRequest = async (phoneNumber: string) => {
  try {
    if (!phoneNumber?.trim()) {
      throw new CustomException("A phone number is required.", badRequest);
    }
    const normalised = phoneNumber.trim();
    const user = await UserQuery.findByPhoneNumber(normalised);

    // With codes returned in the response, a team account must not be reachable this way:
    // anyone who knew the phone number could sign in as that admin.
    if (!user || !user.isActive || (otpInResponse() && user.role !== "customer")) {
      // Same response shape and timing-insensitive cost as the real path.
      return {
        verificationId: crypto.randomUUID(),
        expiresInSeconds: OtpService.OTP_TTL_SECONDS,
        resendAvailableInSeconds: OtpService.RESEND_COOLDOWN_SECONDS,
        ...(otpInResponse() ? { otp: decoyCode() } : {}),
      };
    }

    const { challenge, code } = await OtpService.issue({
      purpose: "login",
      destination: normalised,
      userId: user.id,
    });
    if (otpInResponse()) return { ...challenge, otp: code };
    // Swallowed deliberately: a provider outage surfacing here would make known
    // accounts fail while unknown ones succeed — an enumeration oracle.
    await OtpSender.sendSms(normalised, code).catch((error) =>
      console.error("[OTP] login code delivery failed:", error?.message)
    );
    return challenge;
  } catch (error) {
    throw toCustomException(error);
  }
};

const loginOtpVerify = async (verificationId: string, otp: string) => {
  try {
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
    // A phone code is one factor; an account with an authenticator still owes the second.
    return (await TwoFactorService.challengeIfRequired(user)) ?? (await issueTokenFor(user));
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------ Social login ------------------------------

// The token is verified server-side and the identity read from the result,
// never the request body. Matched on provider `sub` first, then verified email.
const loginOAuth = async (provider: OAuthProvider, token: string) => {
  try {
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

    const challenge = await TwoFactorService.challengeIfRequired(user);
    if (challenge) return challenge;

    return {
      ...(await issueTokenFor(user)),
      isNewUser,
      // Delivery needs a phone number, and no provider supplies one — the app
      // uses this to decide whether to prompt for it.
      profileComplete: Boolean(user.phoneNumber && user.isPhoneVerified),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ---------------- Forgotten password, by email OTP (2 steps) ----------------

/** Always reports success — same anti-enumeration reasoning as login-by-OTP. */
const passwordForgot = async (email: string) => {
  try {
    if (!email || !EMAIL_PATTERN.test(email.trim())) {
      throw new CustomException("A valid email address is required.", badRequest);
    }
    const normalised = email.trim().toLowerCase();
    const user = await UserQuery.findByEmail(normalised);

    // Same rule as login by OTP: with codes in the response, a reset must never open a team account.
    if (!user || !user.isActive || (otpInResponse() && user.role !== "customer")) {
      return {
        verificationId: crypto.randomUUID(),
        expiresInSeconds: OtpService.OTP_TTL_SECONDS,
        resendAvailableInSeconds: OtpService.RESEND_COOLDOWN_SECONDS,
        ...(otpInResponse() ? { otp: decoyCode() } : {}),
      };
    }

    const { challenge, code } = await OtpService.issue({
      purpose: "password_reset",
      destination: normalised,
      userId: user.id,
    });
    if (otpInResponse()) return { ...challenge, otp: code };
    // Swallowed for the same anti-enumeration reason as login-by-OTP above.
    await OtpSender.sendEmail(normalised, code).catch((error) =>
      console.error("[OTP] reset code delivery failed:", error?.message)
    );
    return challenge;
  } catch (error) {
    throw toCustomException(error);
  }
};

/**
 * Verify and set in one call, so a verified code is never left outstanding as
 * a reusable password-change token.
 */
const passwordReset = async (verificationId: string, otp: string, newPassword: string) => {
  try {
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

    // Every refresh token dies with the old password; an access token already issued
    // lives out its few minutes.
    await SessionService.revokeAllFor(user.id, "password_reset");
    return { message: "Password updated. Please sign in with your new password." };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const AuthService = {
  register,
  login,
  customerLogin,
  getProfile,
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
