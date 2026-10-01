import bcrypt from "bcrypt";
import { UserQuery } from "../Queries/User.Query.js";
import { OtpChallengeQuery } from "../Queries/OtpChallenge.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, conflict, unauthorized } from "../../commons/Utils/StatusCode.js";
import { IUser } from "../Models/User/User.Interface.js";
import { IDashboardUser, toDashboardUser } from "../Models/User/DashboardUser.js";
import { OtpService } from "./Otp.Service.js";
import { OtpSender } from "./OtpSender.Service.js";
import { otpInResponse } from "./OtpDelivery.js";
import { SessionService } from "./Session.Service.js";
import { SALT_ROUNDS, parseNewPassword } from "./Password.js";
import { UUID_PATTERN, invalid, parseName, parsePhone } from "./UserInput.js";

// Self-service: what a signed-in person may change about their own account.

const MAX_PASSWORD_INPUT_LENGTH = 200;

const loadActive = async (userId: string): Promise<IUser> => {
  const user = await UserQuery.findById(userId);
  if (!user || !user.isActive) throw new CustomException("Your account is no longer active.", unauthorized);
  return user;
};

// Whitelist of one: name. Email is the sign-in identity and is refused (see the module note);
// the phone number changes only through the OTP steps below. Nothing else in the body is read.
const updateMe = async (userId: string, input: Record<string, unknown>): Promise<IDashboardUser> => {
  try {
    if (input.email !== undefined) {
      throw invalid("Your email address is your sign-in and cannot be changed here. Ask an administrator.");
    }
    if (input.phone !== undefined || input.phoneNumber !== undefined) {
      throw invalid("Change your phone number with the phone verification steps (POST /auth/me/phone/send-otp).");
    }
    if (input.name === undefined) throw invalid("Provide name.");

    await loadActive(userId);
    return toDashboardUser(await UserQuery.updateProfile(userId, { name: parseName(input.name) }));
  } catch (error) {
    throw toCustomException(error);
  }
};

// The caller is already authenticated, so a wrong current password is a plain 400 (a 401 would make
// the dashboard think the session died and sign the person out). Every other sign-in ends; the
// one the refresh token belongs to stays.
const changePassword = async (
  userId: string,
  input: { currentPassword?: unknown; newPassword?: unknown; refreshToken?: unknown }
): Promise<{ message: string; currentSessionKept: boolean }> => {
  try {
    const { currentPassword } = input;
    if (typeof currentPassword !== "string" || !currentPassword || currentPassword.length > MAX_PASSWORD_INPUT_LENGTH) {
      throw invalid("currentPassword is required.");
    }
    const newPassword = parseNewPassword(input.newPassword);

    const user = await loadActive(userId);
    if (!user.passwordHash) {
      throw invalid("This account signs in with a social provider and has no password to change.");
    }
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw invalid("Your current password is incorrect.");
    }
    if (newPassword === currentPassword) throw invalid("Choose a password different from the current one.");

    await UserQuery.setPassword(userId, await bcrypt.hash(newPassword, SALT_ROUNDS));
    const currentSessionKept = await SessionService.revokeOthersFor(userId, input.refreshToken, "password_change");
    return {
      message: currentSessionKept
        ? "Password changed. Your other sign-ins have been ended."
        : "Password changed. Every sign-in has been ended: please sign in again.",
      currentSessionKept,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const invalidCode = () => new CustomException("That code is invalid or has expired.", badRequest);

// Step 1 of a phone change: a code to the NEW number. The caller is signed in, so telling them a
// number is taken (409) is no more revealing than registration already is.
const sendPhoneChangeOtp = async (userId: string, rawPhone: unknown) => {
  try {
    const phoneNumber = parsePhone(rawPhone);
    const user = await loadActive(userId);
    if (user.phoneNumber === phoneNumber && user.isPhoneVerified) {
      throw invalid("That is already your verified phone number.");
    }
    const owner = await UserQuery.findByPhoneNumber(phoneNumber);
    if (owner && owner.id !== userId) {
      throw new CustomException("An account with this phone number already exists.", conflict);
    }

    const { challenge, code } = await OtpService.issue({ purpose: "phone_change", destination: phoneNumber, userId });
    if (otpInResponse()) return { ...challenge, otp: code };
    await OtpSender.sendSms(phoneNumber, code);
    return challenge;
  } catch (error) {
    throw toCustomException(error);
  }
};

// Step 2: the number is read off the verified challenge, never re-sent by the client, and the
// challenge must belong to the caller. The unique index is the final guard against a race.
const verifyPhoneChangeOtp = async (userId: string, verificationId: unknown, otp: unknown): Promise<IDashboardUser> => {
  try {
    if (typeof verificationId !== "string" || !UUID_PATTERN.test(verificationId) || typeof otp !== "string" || !otp) {
      throw invalidCode();
    }
    const existing = await OtpChallengeQuery.findById(verificationId);
    if (!existing || existing.userId !== userId) throw invalidCode();

    const challenge = await OtpService.verifyCode(verificationId, otp, "phone_change");
    await OtpChallengeQuery.markConsumed(challenge.id);
    await loadActive(userId);
    try {
      return toDashboardUser(await UserQuery.setVerifiedPhone(userId, challenge.destination));
    } catch (error) {
      if (isUniqueViolation(error, "phoneNumber")) {
        throw new CustomException("An account with this phone number already exists.", conflict);
      }
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

export const AccountService = { updateMe, changePassword, sendPhoneChangeOtp, verifyPhoneChangeOtp };
