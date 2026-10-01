import bcrypt from "bcrypt";
import crypto from "crypto";
import { UserQuery } from "../Queries/User.Query.js";
import { UserTokenQuery } from "../Queries/UserToken.Query.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, conflict, tooManyRequests } from "../../commons/Utils/StatusCode.js";
import { IUser } from "../Models/User/User.Interface.js";
import { UserTokenPurpose } from "../Models/UserToken/UserToken.Interface.js";
import { OtpSender, LinkEmailKind } from "./OtpSender.Service.js";
import { otpInResponse } from "./OtpDelivery.js";
import { SessionService } from "./Session.Service.js";
import { SALT_ROUNDS, parseNewPassword } from "./Password.js";
import { UserActor, loadTeamMember, requireSuperAdminFor } from "./TeamAccess.js";

// One-time links an admin sends to a team member: an invitation to set a first password, or a
// password reset. The token is 256 random bits; only its SHA-256 is stored; it works once.

const HOUR_MS = 60 * 60 * 1000;
const INVITE_TTL_HOURS = 72;
// A reset link is the more dangerous of the two (it takes over a working account), so it lives shorter.
const RESET_TTL_HOURS = 24;
const RESEND_COOLDOWN_MS = 60 * 1000;
const TOKEN_BYTES = 32;
const MAX_TOKEN_LENGTH = 200;
const PURGE_EVERY_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const hashToken = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

// Unknown, used, expired and voided tokens all answer alike, so the response never says which.
const invalidLink = () => new CustomException("This link is invalid or has expired. Ask for a new one.", 410);

let lastPurgeAt = 0;
const purgeOccasionally = () => {
  const now = Date.now();
  if (now - lastPurgeAt < PURGE_EVERY_MS) return;
  lastPurgeAt = now;
  UserTokenQuery.purgeExpired(new Date(now - DAY_MS)).catch((error) =>
    console.error("[invite] purging expired tokens failed:", (error as Error).message)
  );
};

export interface LinkIssued {
  message: string;
  expiresAt: string;
  /** Present only when OTP_DELIVERY=response, the integration mode in which nothing is emailed. */
  inviteToken?: string;
  resetToken?: string;
}

// Voids any earlier link of this kind, stores the new one and delivers it. A delivery failure voids
// the new link again, so no live token exists that nobody received.
const issueAndDeliver = async (
  actor: UserActor,
  target: IUser,
  purpose: UserTokenPurpose,
  kind: LinkEmailKind,
  ttlHours: number
): Promise<LinkIssued> => {
  const latest = await UserTokenQuery.findLatest(target.id, purpose);
  if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new CustomException("A link was sent a moment ago. Wait a minute before sending another.", tooManyRequests);
  }

  purgeOccasionally();
  const raw = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours * HOUR_MS);
  await UserTokenQuery.inTransaction(async (tx) => {
    await UserTokenQuery.invalidateOutstanding(target.id, purpose, tx);
    await UserTokenQuery.create(
      { userId: target.id, purpose, tokenHash: hashToken(raw), expiresAt, createdById: actor.id },
      tx
    );
  });

  if (otpInResponse()) {
    const key = purpose === "invite" ? "inviteToken" : "resetToken";
    return { message: "Link created. Nothing was emailed (OTP_DELIVERY=response).", expiresAt: expiresAt.toISOString(), [key]: raw };
  }
  try {
    await OtpSender.sendLinkEmail(target.email, kind, raw, ttlHours);
  } catch (error) {
    await UserTokenQuery.invalidateOutstanding(target.id, purpose);
    throw error;
  }
  return { message: "Link sent by email.", expiresAt: expiresAt.toISOString() };
};

// Sends the invitation again (the first one is the temporary password POST /users creates). Only
// for an active account that has never signed in: after that, a password reset is the right tool.
const resendInvite = async (actor: UserActor, id: string): Promise<LinkIssued> => {
  try {
    const target = await loadTeamMember(id);
    requireSuperAdminFor(actor, target.role);
    if (!target.isActive) throw new CustomException("Reactivate this account before inviting it.", conflict);
    if (target.lastLoginAt) {
      throw new CustomException("This person has already signed in. Send a password reset instead.", conflict);
    }
    return await issueAndDeliver(actor, target, "invite", "invite", INVITE_TTL_HOURS);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Sends a one-time reset link. The admin never sees or chooses a password, and nothing changes
// until the person redeems the link.
const adminResetPassword = async (actor: UserActor, id: string): Promise<LinkIssued> => {
  try {
    const target = await loadTeamMember(id);
    requireSuperAdminFor(actor, target.role);
    if (!target.isActive) throw new CustomException("Reactivate this account before resetting its password.", conflict);
    return await issueAndDeliver(actor, target, "password_reset", "reset", RESET_TTL_HOURS);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Public. Redeems either kind of link: sets the password, ends every existing sign-in (the
// temporary password or the old one may be known to someone else) and voids the user's other links.
const acceptInvite = async (inviteToken: unknown, newPassword: unknown): Promise<{ message: string }> => {
  try {
    if (typeof inviteToken !== "string" || !inviteToken || inviteToken.length > MAX_TOKEN_LENGTH) {
      throw new CustomException("inviteToken is required.", badRequest);
    }
    const password = parseNewPassword(newPassword);

    const token = await UserTokenQuery.findByHash(hashToken(inviteToken));
    if (!token || token.consumedAt || token.expiresAt.getTime() <= Date.now()) throw invalidLink();
    const user = await UserQuery.findById(token.userId);
    // A deactivated account is never revived by an old link.
    if (!user || !user.isActive) throw invalidLink();

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await UserTokenQuery.inTransaction(async (tx) => {
      if (!(await UserTokenQuery.consume(token.id, new Date(), tx))) throw invalidLink();
      await UserQuery.setPassword(user.id, passwordHash, tx);
      await UserTokenQuery.invalidateOutstanding(user.id, undefined, tx);
    });
    await SessionService.revokeAllFor(user.id, "password_reset");
    return { message: "Password set. You can now sign in." };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const InviteService = { resendInvite, adminResetPassword, acceptInvite, INVITE_TTL_HOURS, RESET_TTL_HOURS };
