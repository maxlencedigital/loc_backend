import { Request, Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { successCode, unauthorized } from "../../commons/Utils/StatusCode.js";
import { AuthenticatedRequest } from "../Middleware/Auth.js";
import { AuthService } from "../Services/Auth.Service.js";
import { SessionService } from "../Services/Session.Service.js";
import { TwoFactorService } from "../Services/TwoFactor.Service.js";
import { AccountService } from "../Services/Account.Service.js";
import { InviteService } from "../Services/Invite.Service.js";

const userOf = (req: AuthenticatedRequest) => {
  if (!req.user) throw new CustomException("Authentication required.", unauthorized);
  return req.user;
};

/**
 * @openapi
 * /auth/2fa/disable:
 *   post:
 *     operationId: disableTwoFactor
 *     summary: "Turn the extra verification step off"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed, but super_admin never uses two-factor). Needs a current authenticator code or an unused recovery code. Five wrong codes in a row lock the check for 15 minutes. Answers 503 when the server has no TWO_FACTOR_ENCRYPTION_KEY."
 *     tags: ["Auth - Account & Security"]
 *     x-roles: [admin, hr, manager]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string, description: "6-digit authenticator code, or a recovery code like ABCDE-23456" }
 *     responses:
 *       200:
 *         description: "Two-factor sign-in is off."
 *       400:
 *         description: "Missing code, wrong code (result.attemptsRemaining), or two-factor is not on."
 *       403:
 *         description: Your role is not allowed to call this.
 *       429:
 *         description: "Too many wrong codes; the check is locked for a while."
 *       503:
 *         description: "Two-factor is not configured on this server."
 */
const disableTwoFactor = async (req: AuthenticatedRequest, res: Response) => {
  try {
    requireFields(req.body, ["code"]);
    await TwoFactorService.disable(userOf(req), req.body.code);
    return handleSuccessResponse({ statusCode: successCode, result: null }, res, "Two-factor sign-in turned off.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/2fa/enable:
 *   post:
 *     operationId: enableTwoFactor
 *     summary: "Turn on the extra verification step: step 1, get the secret"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed, but a super_admin gets 403 because that account is never challenged, so it cannot be locked out). Returns a new authenticator secret, shown once; two-factor stays off until the first code is proved with POST /auth/2fa/verify. Calling it again before that replaces the pending secret. Answers 503 when the server has no TWO_FACTOR_ENCRYPTION_KEY, rather than store a secret in plain."
 *     tags: ["Auth - Account & Security"]
 *     x-roles: [admin, hr, manager]
 *     responses:
 *       200:
 *         description: "OK."
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     result:
 *                       type: object
 *                       properties:
 *                         secret: { type: string, description: "base32, for manual entry" }
 *                         otpauthUrl: { type: string, format: uri, description: "show as a QR code" }
 *       403:
 *         description: Your role is not allowed to call this.
 *       409:
 *         description: "Two-factor is already on."
 *       503:
 *         description: "Two-factor is not configured on this server."
 */
const enableTwoFactor = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await TwoFactorService.enable(userOf(req));
    res.setHeader("Cache-Control", "no-store");
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Scan the secret, then confirm with a code.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/2fa/verify:
 *   post:
 *     operationId: verifyTwoFactor
 *     summary: "Confirm the extra verification step with a code"
 *     description: "Two uses, told apart by the body. **Signed in** (Bearer token, roles admin, hr, manager; body is just code): proves the first authenticator code after enable, switches two-factor on and returns ten single-use recovery codes, shown once. **Signing in** (no token; body is challengeId, challengeToken and code): completes a sign-in that answered twoFactorRequired, and returns the same session as POST /auth/login. The code may be an authenticator code or an unused recovery code. A code can be used once (a repeat inside its 30 seconds is refused); five wrong codes in a row lock the check for 15 minutes."
 *     tags: ["Auth - Account & Security"]
 *     security: [{}, { BearerAuth: [] }]
 *     x-roles: [admin, hr, manager]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string }
 *               challengeId: { type: string, format: uuid, description: "only when completing a sign-in" }
 *               challengeToken: { type: string, description: "only when completing a sign-in" }
 *     responses:
 *       200:
 *         description: "Enrolment: { enabled, recoveryCodes }. Sign-in: { token, refreshToken, expiresIn, user }."
 *       400:
 *         description: "Missing fields, or a wrong code (result.attemptsRemaining)."
 *       401:
 *         description: "No token and no challenge, or the sign-in challenge expired or was already used."
 *       403:
 *         description: Your role is not allowed to call this.
 *       429:
 *         description: "Too many wrong codes; the check is locked for a while."
 *       503:
 *         description: "Two-factor is not configured on this server."
 */
const verifyTwoFactor = async (req: AuthenticatedRequest, res: Response) => {
  try {
    requireFields(req.body, ["code"]);
    const result =
      req.body.challengeId !== undefined
        ? await TwoFactorService.completeLogin(req.body)
        : await TwoFactorService.confirm(userOf(req), req.body.code);
    res.setHeader("Cache-Control", "no-store");
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Verified.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/invite/accept:
 *   post:
 *     operationId: acceptInvite
 *     summary: "Accept a staff or rider invite and set my own password"
 *     description: "**Public** — no token required. Staff never sign themselves up: admin creates the login, and they set their own password on first use. The same endpoint redeems a password-reset link an admin sent. The token works once; a used, expired or voided token answers 410. Setting the password ends every existing sign-in of that account. It does not sign the person in and never revives a deactivated account."
 *     tags: ["Auth - Account & Security"]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [inviteToken, newPassword]
 *             properties:
 *               inviteToken: { type: string }
 *               newPassword: { type: string, minLength: 8, description: "At most 72 bytes." }
 *     responses:
 *       200:
 *         description: "Password set; sign in with it."
 *       400:
 *         description: "Missing or invalid fields."
 *       410:
 *         description: "The invite has expired, was already used, or is not valid."
 */
const acceptInvite = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["inviteToken", "newPassword"]);
    const result = await InviteService.acceptInvite(req.body.inviteToken, req.body.newPassword);
    return handleSuccessResponse({ statusCode: successCode, result }, res, result.message);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     operationId: logout
 *     summary: "Sign out"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver, customer (super_admin always allowed). Revokes the sign-in the given refresh token belongs to, or every sign-in of the account with allDevices. Safe to repeat. The short-lived access token cannot be recalled and simply expires."
 *     tags: ["Auth - Account & Security"]
 *     x-roles: [admin, hr, manager, staff, driver, customer]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken: { type: string }
 *               allDevices: { type: boolean, default: false }
 *     responses:
 *       200:
 *         description: "Signed out."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const logout = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) throw new CustomException("Authentication required.", unauthorized);
    await SessionService.logout(userId, req.body?.refreshToken, req.body?.allDevices === true);
    return handleSuccessResponse({ statusCode: successCode, result: null }, res, "Signed out.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/me:
 *   get:
 *     operationId: getMe
 *     summary: "Who am I? My profile and role"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver, customer (super_admin always allowed). Read fresh from the database, so it is the source of truth after a page reload."
 *     tags: ["Auth - Account & Security"]
 *     x-roles: [admin, hr, manager, staff, driver, customer]
 *     responses:
 *       200:
 *         description: "The dashboard User shape; role is the backend role."
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     result:
 *                       type: object
 *                       properties:
 *                         id: { type: string, format: uuid }
 *                         name: { type: string }
 *                         email: { type: string, format: email }
 *                         phone: { type: string }
 *                         role: { type: string, enum: [super_admin, admin, manager, hr, staff, driver, customer] }
 *                         storeId: { type: string, format: uuid, nullable: true }
 *                         initials: { type: string }
 *                         status: { type: string, enum: [active, suspended] }
 *                         lastActiveAt: { type: string, format: date-time }
 *                         joinedAt: { type: string, format: date-time }
 *                         twoFactorEnabled: { type: boolean }
 *       401:
 *         description: The account no longer exists or has been deactivated.
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getMe = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await AuthService.getProfile(userOf(req).id);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Profile fetched.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/me:
 *   patch:
 *     operationId: updateMe
 *     summary: "Update my name"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver, customer (super_admin always allowed). Only name can change here. The catalogue also lists email; it is refused with 400 because the email is the sign-in identity (ask an administrator). A phone number changes through the two phone OTP endpoints."
 *     tags: ["Auth - Account & Security"]
 *     x-roles: [admin, hr, manager, staff, driver, customer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, maxLength: 100 }
 *     responses:
 *       200:
 *         description: "The updated dashboard User."
 *       400:
 *         description: "Missing or invalid name, or an attempt to change email or phone here."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const updateMe = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await AccountService.updateMe(userOf(req).id, req.body ?? {});
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Profile updated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/me/phone/send-otp:
 *   post:
 *     operationId: sendPhoneChangeOtp
 *     summary: "Change my phone number — step 1: send a code to the new number"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver, customer (super_admin always allowed). With OTP_DELIVERY=response the code is returned as otp and nothing is sent; that proves nothing about owning the number, so it is for integration only."
 *     tags: ["Auth - Account & Security"]
 *     x-roles: [admin, hr, manager, staff, driver, customer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phoneNumber]
 *             properties:
 *               phoneNumber: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *     responses:
 *       200:
 *         description: "{ verificationId, expiresInSeconds, resendAvailableInSeconds } (plus otp in response mode)."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       409:
 *         description: "Another account already has this number."
 *       429:
 *         description: "Asked again too soon, or too many codes for this number."
 */
const sendPhoneChangeOtp = async (req: AuthenticatedRequest, res: Response) => {
  try {
    requireFields(req.body, ["phoneNumber"]);
    const result = await AccountService.sendPhoneChangeOtp(userOf(req).id, req.body.phoneNumber);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Verification code sent.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/me/phone/verify-otp:
 *   post:
 *     operationId: verifyPhoneChangeOtp
 *     summary: "Change my phone number — step 2: verify the code"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver, customer (super_admin always allowed). The number saved is the one the code was sent to, and the code must have been requested by the same account."
 *     tags: ["Auth - Account & Security"]
 *     x-roles: [admin, hr, manager, staff, driver, customer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [verificationId, otp]
 *             properties:
 *               verificationId: { type: string, format: uuid }
 *               otp: { type: string }
 *     responses:
 *       200:
 *         description: "The updated dashboard User, with the new verified phone."
 *       400:
 *         description: "Missing fields, or a wrong or expired code (result.attemptsRemaining)."
 *       403:
 *         description: Your role is not allowed to call this.
 *       409:
 *         description: "Another account took this number in the meantime."
 *       429:
 *         description: "Too many incorrect attempts; request a new code."
 */
const verifyPhoneChangeOtp = async (req: AuthenticatedRequest, res: Response) => {
  try {
    requireFields(req.body, ["verificationId", "otp"]);
    const result = await AccountService.verifyPhoneChangeOtp(userOf(req).id, req.body.verificationId, req.body.otp);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Phone number updated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/password/change:
 *   post:
 *     operationId: changePassword
 *     summary: "Change my password while signed in"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver, customer (super_admin always allowed). Ends every other sign-in of the account. Send the refreshToken of the current sign-in so that one stays; without a valid one every sign-in ends, including this one (currentSessionKept is false). A wrong current password is answered 400, not 401, so the dashboard does not read it as a dead session. Access tokens already issued live out their 15 minutes."
 *     tags: ["Auth - Account & Security"]
 *     x-roles: [admin, hr, manager, staff, driver, customer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string, minLength: 8, description: "At most 72 bytes; must differ from the current one." }
 *               refreshToken: { type: string, description: "The refresh token of this sign-in, so it is kept." }
 *     responses:
 *       200:
 *         description: "{ message, currentSessionKept }."
 *       400:
 *         description: "Missing or invalid fields, or the current password is wrong."
 *       403:
 *         description: Your role is not allowed to call this.
 *       429:
 *         description: "Too many attempts; wait and try again."
 */
const changePassword = async (req: AuthenticatedRequest, res: Response) => {
  try {
    requireFields(req.body, ["currentPassword", "newPassword"]);
    const result = await AccountService.changePassword(userOf(req).id, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, result.message);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AuthAccountController = {
  disableTwoFactor,
  enableTwoFactor,
  verifyTwoFactor,
  acceptInvite,
  logout,
  getMe,
  updateMe,
  sendPhoneChangeOtp,
  verifyPhoneChangeOtp,
  changePassword,
};
