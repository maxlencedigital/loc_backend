import { Request, Response } from "express";
import { AuthService } from "../Services/Auth.Service.js";
import { SessionService } from "../Services/Session.Service.js";
import {
  handleErrorResponse,
  handleSuccessResponse,
} from "../../commons/Response/Response.js";
import { created, successCode, badRequest } from "../../commons/Utils/StatusCode.js";
import { CustomException } from "../../commons/Exception/CustomException.js";

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Create an account
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, phoneNumber, password]
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               phoneNumber: { type: string }
 *               password: { type: string, minLength: 8 }
 *     responses:
 *       201:
 *         description: Account created. Always registers as role "customer" — elevated roles are granted separately, never accepted from this request.
 *       400:
 *         description: Missing or invalid fields.
 *       409:
 *         description: An account with this email already exists.
 */
const register = async (req: Request, res: Response) => {
  try {
    const result = await AuthService.register(req.body);
    return handleSuccessResponse(
      { statusCode: created, result },
      res,
      "Account created successfully."
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Log in and receive a JWT
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: "Login successful. Returns { token, user } where user is the dashboard User shape (id, name, email, phone, role, storeId, initials, status, lastActiveAt, joinedAt); role is the backend role. The token carries userId, role and storeId."
 *       401:
 *         description: Invalid email or password.
 */
const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const result = await AuthService.login(email, password);
    return handleSuccessResponse(
      { statusCode: successCode, result },
      res,
      "Login successful."
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/customer/login:
 *   post:
 *     operationId: customerLogin
 *     summary: Customer login with email and password
 *     description: >
 *       Public. For the customer app. Only customer accounts can sign in here: a team account
 *       (admin, manager, staff, ...) gets the same 401 as a wrong password, so this cannot be used to
 *       find out which emails belong to staff. Team members sign in with POST /auth/login.
 *       Accounts created with Google or Facebook have no password and cannot use this endpoint.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: "{ token, refreshToken, expiresIn, user: { id, name, email, phoneNumber, isPhoneVerified, role } }. Use refreshToken with POST /auth/refresh."
 *       400:
 *         description: Email or password missing.
 *       401:
 *         description: Invalid email or password.
 *       429:
 *         description: Too many attempts; wait and try again.
 */
const customerLogin = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};
    const result = await AuthService.customerLogin(email, password);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Login successful.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Exchange a refresh token for a new access token and a new refresh token
 *     description: >
 *       Public. The refresh token is single-use: it is replaced by the one in the response, so
 *       the client must store the new one. The user is re-read from the database, so a
 *       deactivated account is refused and a role or store change applies here.
 *       Presenting a token that was already used (after a 10 second grace for simultaneous
 *       tabs) revokes the whole sign-in, since it means the token was copied.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: "{ token, refreshToken, expiresIn (seconds the access token lives), user }."
 *       400:
 *         description: Missing refreshToken.
 *       401:
 *         description: "Unknown, expired, revoked or reused token; sign in again. result.retry is true when a simultaneous refresh won: read the latest stored token and retry once."
 */
const refresh = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      throw new CustomException("refreshToken is required.", badRequest);
    }
    const result = await SessionService.refresh(refreshToken);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Session refreshed.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/admin-users:
 *   post:
 *     summary: Create an admin, staff, or driver account (super_admin only)
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, phoneNumber, password, role]
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               phoneNumber: { type: string }
 *               password: { type: string, minLength: 8 }
 *               role: { type: string, enum: [admin, manager, hr, staff, driver] }
 *     responses:
 *       201:
 *         description: Account created.
 *       400:
 *         description: Missing/invalid fields, or role is not one of admin/staff/driver.
 *       403:
 *         description: Caller is not a super_admin.
 *       409:
 *         description: An account with this email already exists.
 */
const createPrivilegedUser = async (req: Request, res: Response) => {
  try {
    const result = await AuthService.createPrivilegedUser(req.body);
    return handleSuccessResponse(
      { statusCode: created, result },
      res,
      "Account created successfully."
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AuthController = { register, login, customerLogin, refresh, createPrivilegedUser };
