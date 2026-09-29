import bcrypt from "bcrypt";
import crypto from "crypto";
import { OtpChallengeQuery } from "../Queries/OtpChallenge.Query.js";
import { IOtpChallenge, OtpPurpose } from "../Models/OtpChallenge/OtpChallenge.Interface.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, tooManyRequests } from "../../commons/Utils/StatusCode.js";

const OTP_LENGTH = 6;
const OTP_TTL_SECONDS = 5 * 60;
// How long a verified challenge stays usable while the user finishes the rest
// of the form. The 5-minute code lifetime is the security-relevant one.
const POST_VERIFY_WINDOW_SECONDS = 15 * 60;
const MAX_VERIFY_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 30;
/** Per destination, per hour — the guard against running up an SMS bill. */
const MAX_CHALLENGES_PER_HOUR = 5;
// Lower than the password cost (12): a 6-digit code lives 5 minutes and dies
// after 5 guesses, so cost 12 would add ~300ms per verify for no real gain.
const OTP_HASH_ROUNDS = 8;

// crypto.randomInt, not Math.random: the latter is not a CSPRNG and its output
// is predictable from prior values, which for an auth code means guessable.
const generateCode = (): string =>
  String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");

export interface OtpChallengeResponse {
  verificationId: string;
  expiresInSeconds: number;
  resendAvailableInSeconds: number;
}

// Throttles per destination, independently of the IP limiter, so someone
// cycling IPs still cannot spam one person's phone.
const assertCanIssue = async (destination: string, purpose: OtpPurpose): Promise<void> => {
  const latest = await OtpChallengeQuery.findLatestFor(destination, purpose);
  if (latest) {
    const secondsSince = (Date.now() - latest.createdAt.getTime()) / 1000;
    if (secondsSince < RESEND_COOLDOWN_SECONDS) {
      throw new CustomException(
        `Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSince)}s before requesting another code.`,
        tooManyRequests
      );
    }
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await OtpChallengeQuery.countRecentFor(destination, purpose, oneHourAgo);
  if (recent >= MAX_CHALLENGES_PER_HOUR) {
    throw new CustomException(
      "Too many codes requested for this number. Try again later.",
      tooManyRequests
    );
  }
};

const issue = async (input: {
  purpose: OtpPurpose;
  destination: string;
  userId?: string;
}): Promise<{ challenge: OtpChallengeResponse; code: string }> => {
  await assertCanIssue(input.destination, input.purpose);

  const code = generateCode();
  const otpHash = await bcrypt.hash(code, OTP_HASH_ROUNDS);
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

  const created = await OtpChallengeQuery.create({
    purpose: input.purpose,
    destination: input.destination,
    otpHash,
    userId: input.userId ?? null,
    expiresAt,
  });

  return {
    // The caller sends `code`; it is never put in an API response.
    code,
    challenge: {
      verificationId: created.id,
      expiresInSeconds: OTP_TTL_SECONDS,
      resendAvailableInSeconds: RESEND_COOLDOWN_SECONDS,
    },
  };
};

// Checks the code and marks the challenge verified — it does NOT spend it,
// because registration proves the phone mid-form with the rest still to type.
const verifyCode = async (
  verificationId: string,
  code: string,
  expectedPurpose: OtpPurpose
): Promise<IOtpChallenge> => {
  // One message for every non-attempt failure: distinguishing "wrong code"
  // from "expired" from "no such challenge" tells an attacker what to work on.
  const invalid = (attemptsRemaining?: number) =>
    new CustomException(
      "That code is invalid or has expired.",
      badRequest,
      attemptsRemaining === undefined ? undefined : { attemptsRemaining }
    );

  if (!verificationId || !code) throw invalid();

  const challenge = await OtpChallengeQuery.findById(verificationId);
  if (!challenge) throw invalid();
  if (challenge.purpose !== expectedPurpose) throw invalid();
  if (challenge.consumedAt) throw invalid();
  if (challenge.expiresAt.getTime() < Date.now()) throw invalid();

  if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
    throw new CustomException(
      "Too many incorrect attempts. Request a new code.",
      tooManyRequests,
      { attemptsRemaining: 0 }
    );
  }

  const matches = await bcrypt.compare(code, challenge.otpHash);
  if (!matches) {
    // Counted before returning, so a wrong guess always costs an attempt.
    await OtpChallengeQuery.recordAttempt(verificationId);
    throw invalid(Math.max(0, MAX_VERIFY_ATTEMPTS - (challenge.attempts + 1)));
  }

  await OtpChallengeQuery.markVerified(
    verificationId,
    new Date(Date.now() + POST_VERIFY_WINDOW_SECONDS * 1000)
  );
  return challenge;
};

// Loads an already-verified challenge and burns it. Re-read from the database
// rather than trusted from the client, so one proof cannot create two accounts.
const consumeVerified = async (
  verificationId: string,
  expectedPurpose: OtpPurpose
): Promise<IOtpChallenge> => {
  const notVerified = () =>
    new CustomException("Verify your phone number before continuing.", badRequest);

  if (!verificationId) throw notVerified();

  const challenge = await OtpChallengeQuery.findById(verificationId);
  if (!challenge) throw notVerified();
  if (challenge.purpose !== expectedPurpose) throw notVerified();
  if (!challenge.verifiedAt) throw notVerified();
  // Already used to create an account — a second attempt must not work.
  if (challenge.consumedAt) throw notVerified();
  if (challenge.expiresAt.getTime() < Date.now()) {
    throw new CustomException("Your verification expired. Please request a new code.", badRequest);
  }

  await OtpChallengeQuery.markConsumed(verificationId);
  return challenge;
};

export const OtpService = {
  issue,
  verifyCode,
  consumeVerified,
  OTP_TTL_SECONDS,
  POST_VERIFY_WINDOW_SECONDS,
  RESEND_COOLDOWN_SECONDS,
  MAX_VERIFY_ATTEMPTS,
};
