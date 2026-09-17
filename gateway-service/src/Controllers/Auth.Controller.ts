import { Request, Response } from "express";
import { AuthService } from "../Services/Auth.Service.js";
import {
  handleErrorResponse,
  handleSuccessResponse,
  handleNotImplementedResponse,
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
 *         description: Login successful — returns a Bearer token.
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
 * /auth/refresh:
 *   post:
 *     summary: Exchange a refresh token for a new access token
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
 *         description: "Scaffolded per API contract — not yet implemented. Once wired up, returns: { token: string }."
 *       400:
 *         description: Missing refreshToken.
 *       501:
 *         description: Endpoint scaffolded per API contract — implementation pending.
 */
const refresh = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      throw new CustomException("refreshToken is required.", badRequest);
    }
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AuthController = { register, login, refresh };
