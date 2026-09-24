import { Op } from "sequelize";
import { OtpChallengeModel } from "../Models/OtpChallenge/OtpChallenge.Model.js";
import { IOtpChallengeCreate, OtpPurpose } from "../Models/OtpChallenge/OtpChallenge.Interface.js";

const create = async (challenge: IOtpChallengeCreate): Promise<OtpChallengeModel> => {
  return OtpChallengeModel.create(challenge);
};

const findById = async (id: string): Promise<OtpChallengeModel | null> => {
  return OtpChallengeModel.findByPk(id);
};

const recordAttempt = async (id: string): Promise<void> => {
  // Atomic increment rather than read-modify-write: two simultaneous wrong
  // guesses must both count, or the attempt cap can be walked past by racing.
  await OtpChallengeModel.increment("attempts", { by: 1, where: { id } });
};

/**
 * The phone/email is proven. The challenge is not spent yet.
 *
 * `newExpiresAt` extends the deadline: the 5-minute life of the *code* is a
 * security property, but once the number is proven the user still has a form
 * to finish, and expiring mid-typing would send them back to the start.
 */
const markVerified = async (id: string, newExpiresAt: Date): Promise<void> => {
  await OtpChallengeModel.update(
    { verifiedAt: new Date(), expiresAt: newExpiresAt },
    { where: { id } }
  );
};

/** The challenge is spent and can never be used again. */
const markConsumed = async (id: string): Promise<void> => {
  await OtpChallengeModel.update({ consumedAt: new Date() }, { where: { id } });
};

/**
 * How many challenges were issued to this destination recently — the input to
 * the resend throttle. Rate limiting by IP alone wouldn't stop someone cycling
 * IPs to spam one person's phone (and run up the SMS bill).
 */
const countRecentFor = async (
  destination: string,
  purpose: OtpPurpose,
  since: Date
): Promise<number> => {
  return OtpChallengeModel.count({
    where: { destination, purpose, createdAt: { [Op.gte]: since } },
  });
};

const findLatestFor = async (
  destination: string,
  purpose: OtpPurpose
): Promise<OtpChallengeModel | null> => {
  return OtpChallengeModel.findOne({
    where: { destination, purpose },
    order: [["createdAt", "DESC"]],
  });
};

/**
 * Housekeeping. Expired challenges are useless but still hold a phone number
 * and email, so there's no reason to keep them around.
 */
const deleteExpiredBefore = async (cutoff: Date): Promise<number> => {
  return OtpChallengeModel.destroy({ where: { expiresAt: { [Op.lt]: cutoff } } });
};

export const OtpChallengeQuery = {
  create,
  findById,
  recordAttempt,
  markVerified,
  markConsumed,
  countRecentFor,
  findLatestFor,
  deleteExpiredBefore,
};
