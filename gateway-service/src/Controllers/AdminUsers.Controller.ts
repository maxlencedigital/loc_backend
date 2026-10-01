import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { created, successCode, unauthorized } from "../../commons/Utils/StatusCode.js";
import { AuthenticatedRequest } from "../Middleware/Auth.js";
import { UsersService } from "../Services/Users.Service.js";
import { InviteService } from "../Services/Invite.Service.js";

const actorOf = (req: AuthenticatedRequest) => {
  if (!req.user) throw new CustomException("Authentication required.", unauthorized);
  return req.user;
};

/**
 * @openapi
 * /users:
 *   get:
 *     operationId: listUsers
 *     summary: "Team accounts (super_admin, admin, manager, staff)"
 *     description: "**Who can call this:** admin, manager (super_admin always allowed). A manager only ever sees their own store."
 *     tags: ["Admin - Users"]
 *     x-roles: [admin, manager]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [super_admin, admin, manager, staff] }
 *       - in: query
 *         name: q
 *         schema: { type: string, description: "name, email or phone" }
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
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           name: { type: string }
 *                           email: { type: string, format: email }
 *                           phone: { type: string }
 *                           role: { type: string, enum: [super_admin, admin, manager, staff] }
 *                           storeId: { type: string, format: uuid, nullable: true }
 *                           initials: { type: string }
 *                           status: { type: string, enum: [active, suspended] }
 *                           lastActiveAt: { type: string, format: date-time }
 *                           joinedAt: { type: string, format: date-time }
 *       400:
 *         description: "Invalid storeId or role filter."
 *       403:
 *         description: Your role is not allowed to call this, or a manager has no store.
 */
const listUsers = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { storeId, role, q } = req.query;
    const result = await UsersService.listUsers(actorOf(req), { storeId, role, q });
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Users fetched.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /users:
 *   post:
 *     operationId: createUser
 *     summary: "Create a team account"
 *     description: "**Who can call this:** admin (super_admin always allowed). Only a super_admin may create an admin. Without a password a temporary one is generated and returned once as temporaryPassword."
 *     tags: ["Admin - Users"]
 *     x-roles: [admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, phone, role]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *               role: { type: string, enum: [admin, manager, staff] }
 *               storeId: { type: string, format: uuid }
 *               password: { type: string, minLength: 8 }
 *     responses:
 *       201:
 *         description: "The created User, plus temporaryPassword when one was generated."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to create this role.
 *       409:
 *         description: "An account with this email or phone number already exists."
 */
const createUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await UsersService.createUser(actorOf(req), req.body ?? {});
    return handleSuccessResponse({ statusCode: created, result }, res, "User created.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /users/roles:
 *   get:
 *     operationId: listRoles
 *     summary: "The roles that exist and what each can do"
 *     description: "**Who can call this:** admin (super_admin always allowed). Lists the roles the caller may hand out through the team screens: a super_admin sees admin, manager and staff; an admin sees manager and staff. super_admin, hr, driver and customer are never assignable here."
 *     tags: ["Admin - Users"]
 *     x-roles: [admin]
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
 *                         roles:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               role: { type: string, enum: [super_admin, admin, manager, hr, staff, driver, customer] }
 *                               description: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listRoles = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await UsersService.listRoles(actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Roles fetched.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     operationId: getUser
 *     summary: "One account"
 *     description: "**Who can call this:** admin, manager (super_admin always allowed). Same scoping as the list: a manager sees only their own store's team, and anyone outside it is a 404. The row is the dashboard User shape (as in the list) plus phoneNumber, isActive, isPhoneVerified and storeIds (zero or one id, since an account has one store). Only team roles (super_admin, admin, manager, staff) are reachable here."
 *     tags: ["Admin - Users"]
 *     x-roles: [admin, manager]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
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
 *                         id: { type: string, format: uuid }
 *                         name: { type: string }
 *                         email: { type: string, format: email }
 *                         phone: { type: string }
 *                         phoneNumber: { type: string, nullable: true, description: "E.164 phone number, e.g. +919876543210" }
 *                         role: { type: string, enum: [super_admin, admin, manager, staff] }
 *                         storeId: { type: string, format: uuid, nullable: true }
 *                         initials: { type: string }
 *                         status: { type: string, enum: [active, suspended] }
 *                         lastActiveAt: { type: string, format: date-time }
 *                         joinedAt: { type: string, format: date-time }
 *                         isActive: { type: boolean }
 *                         isPhoneVerified: { type: boolean }
 *                         storeIds: { type: array, items: { type: string, format: uuid } }
 *       403:
 *         description: "Your role is not allowed to call this, or a manager has no store."
 *       404:
 *         description: "Not found, or outside the manager's store."
 */
const getUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await UsersService.getUser(actorOf(req), req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "User fetched.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /users/{id}:
 *   patch:
 *     operationId: updateUser
 *     summary: "Change a name, phone, role or store"
 *     description: "**Who can call this:** admin (super_admin always allowed). Only a super_admin may touch admin or super_admin accounts. A new storeId reaches the token at the user's next login."
 *     tags: ["Admin - Users"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               role: { type: string, enum: [admin, manager, staff] }
 *               storeId: { type: string, format: uuid, nullable: true }
 *     responses:
 *       200:
 *         description: "The updated User."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to change this account.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "Duplicate phone number, or this would demote the last super_admin."
 */
const updateUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await UsersService.updateUser(actorOf(req), req.params.id, req.body ?? {});
    return handleSuccessResponse({ statusCode: successCode, result }, res, "User updated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /users/{id}/deactivate:
 *   post:
 *     operationId: deactivateUser
 *     summary: "Stop an account signing in"
 *     description: "**Who can call this:** admin (super_admin always allowed). An existing token keeps working until it expires."
 *     tags: ["Admin - Users"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "The updated User."
 *       400:
 *         description: "You cannot deactivate yourself."
 *       403:
 *         description: Your role is not allowed to change this account.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "The last active super_admin cannot be deactivated."
 */
const deactivateUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await UsersService.deactivateUser(actorOf(req), req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "User deactivated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /users/{id}/invite/resend:
 *   post:
 *     operationId: resendInvite
 *     summary: "Send the invite again"
 *     description: "**Who can call this:** admin (super_admin always allowed; only a super_admin may invite an admin). Emails a one-time invite link (valid 72 hours, replaces any earlier one) that the person redeems with POST /auth/invite/accept. Only for an active account that has never signed in. One link per minute per account. With OTP_DELIVERY=response nothing is emailed and the token comes back as inviteToken (integration only)."
 *     tags: ["Admin - Users"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "{ message, expiresAt } (plus inviteToken in response mode)."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "The account is deactivated, or the person has already signed in."
 *       429:
 *         description: "A link was sent less than a minute ago."
 *       503:
 *         description: "The email could not be sent."
 */
const resendInvite = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await InviteService.resendInvite(actorOf(req), req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res, result.message);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /users/{id}/reactivate:
 *   post:
 *     operationId: reactivateUser
 *     summary: "Let an account sign in again"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Users"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "The updated User."
 *       403:
 *         description: Your role is not allowed to change this account.
 *       404:
 *         description: Not found.
 */
const reactivateUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await UsersService.reactivateUser(actorOf(req), req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "User reactivated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /users/{id}/reset-password:
 *   post:
 *     operationId: adminResetPassword
 *     summary: "Send this person a password-reset link"
 *     description: "**Who can call this:** admin (super_admin always allowed; only a super_admin may reset an admin). Emails a one-time reset link (valid 24 hours, replaces any earlier one) that the person redeems with POST /auth/invite/accept. No password is ever returned or chosen by the admin, and nothing changes until the link is used. With OTP_DELIVERY=response nothing is emailed and the token comes back as resetToken (integration only)."
 *     tags: ["Admin - Users"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "{ message, expiresAt } (plus resetToken in response mode)."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "The account is deactivated."
 *       429:
 *         description: "A link was sent less than a minute ago."
 *       503:
 *         description: "The email could not be sent."
 */
const adminResetPassword = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await InviteService.adminResetPassword(actorOf(req), req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res, result.message);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /users/{id}/stores:
 *   put:
 *     operationId: setUserStores
 *     summary: "Limit a staff account to specific stores"
 *     description: "**Who can call this:** admin (super_admin always allowed; only a super_admin may change an admin). Each store stands on its own: staff see only their own store's orders, stock and garments. An account has one store, so storeIds holds at most one id and an empty list removes the store. Admin accounts are not store-bound and are refused a store. The account's refresh tokens are revoked so the new store applies at its next sign-in; an access token already issued keeps the old store for up to 15 minutes."
 *     tags: ["Admin - Users"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [storeIds]
 *             properties:
 *               storeIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "storeIds missing, not a list of UUIDs, longer than one, or a store for an admin account."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const setUserStores = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await UsersService.setUserStores(actorOf(req), req.params.id, req.body ?? {});
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Store updated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AdminUsersController = {
  listUsers,
  createUser,
  listRoles,
  getUser,
  updateUser,
  deactivateUser,
  resendInvite,
  reactivateUser,
  adminResetPassword,
  setUserStores,
};
