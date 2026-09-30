import { Request, Response } from "express";
import {
  handleErrorResponse,
  handleNotImplementedResponse,
  handleSuccessResponse,
} from "../../commons/Response/Response.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { successCode, unauthorized } from "../../commons/Utils/StatusCode.js";
import { AuthenticatedRequest } from "../Middleware/Auth.js";
import { AuthService } from "../Services/Auth.Service.js";
import { SessionService } from "../Services/Session.Service.js";

/**
 * @openapi
 * /auth/2fa/disable:
 *   post:
 *     operationId: disableTwoFactor
 *     summary: "Turn the extra verification step off"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
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
 *               code: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const disableTwoFactor = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["code"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/2fa/enable:
 *   post:
 *     operationId: enableTwoFactor
 *     summary: "Turn on the extra verification step"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). Recommended for any account that can see or change a lot — admin especially."
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
 *                         secret: { type: string }
 *                         otpauthUrl: { type: string, format: uri, description: "show as a QR code" }
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const enableTwoFactor = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
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
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
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
 *               code: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const verifyTwoFactor = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["code"]);
    return handleNotImplementedResponse(res);
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
 *     description: "**Public** — no token required. Staff never sign themselves up: admin creates the login, and they set their own password on first use."
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
 *               newPassword: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       410:
 *         description: "The invite has expired."
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const acceptInvite = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["inviteToken", "newPassword"]);
    return handleNotImplementedResponse(res);
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
 *       401:
 *         description: The account no longer exists or has been deactivated.
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getMe = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) throw new CustomException("Authentication required.", unauthorized);
    const result = await AuthService.getProfile(req.user.id);
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
 *     summary: "Update my name or email"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver, customer (super_admin always allowed)."
 *     tags: ["Auth - Account & Security"]
 *     x-roles: [admin, hr, manager, staff, driver, customer]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const updateMe = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
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
 *     description: "**Who can call this:** admin, hr, manager, staff, driver, customer (super_admin always allowed)."
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
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const sendPhoneChangeOtp = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["phoneNumber"]);
    return handleNotImplementedResponse(res);
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
 *     description: "**Who can call this:** admin, hr, manager, staff, driver, customer (super_admin always allowed)."
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
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const verifyPhoneChangeOtp = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["verificationId", "otp"]);
    return handleNotImplementedResponse(res);
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
 *     description: "**Who can call this:** admin, hr, manager, staff, driver, customer (super_admin always allowed)."
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
 *               newPassword: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       401:
 *         description: "The current password is wrong."
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const changePassword = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["currentPassword", "newPassword"]);
    return handleNotImplementedResponse(res);
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
