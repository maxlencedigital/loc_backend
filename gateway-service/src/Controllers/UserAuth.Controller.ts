import { Request, Response } from "express";
import { AuthService } from "../Services/Auth.Service.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";

/**
 * @openapi
 * components:
 *   schemas:
 *     OtpChallenge:
 *       type: object
 *       description: Returned whenever an OTP has been dispatched. Never contains the OTP itself.
 *       properties:
 *         verificationId:
 *           type: string
 *           description: Opaque, single-use. Pass back to the matching verify endpoint.
 *           example: "9f1c1f3e-77b1-4a1e-9a1d-2b4f6c8e0a12"
 *         expiresInSeconds: { type: integer, example: 300 }
 *         resendAvailableInSeconds:
 *           type: integer
 *           description: How long the client must wait before a resend is accepted.
 *           example: 30
 *     AuthenticatedUser:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         name: { type: string, example: "Asha Rao" }
 *         email: { type: string, format: email, example: "asha@example.com" }
 *         phoneNumber:
 *           type: string
 *           nullable: true
 *           description: Null for social-login accounts until the user adds one.
 *           example: "+919876543210"
 *         role:
 *           type: string
 *           enum: [super_admin, admin, staff, driver, customer]
 *           example: customer
 *     AuthTokens:
 *       type: object
 *       properties:
 *         token:
 *           type: string
 *           description: "JWT, valid 12h. Send as `Authorization: Bearer <token>`."
 *         user:
 *           $ref: '#/components/schemas/AuthenticatedUser'
 */

// -------------------------- Registration (OTP) --------------------------

/**
 * @openapi
 * /auth/register/send-otp:
 *   post:
 *     summary: Step 1 of 3 — send an OTP to the phone
 *     description: |
 *       Takes only the phone number, because at this point in the sign-up form that is all
 *       the user has entered. Sends a 6-digit code; **no account is created**.
 *
 *       Also used by the form's "Re-Send OTP" button — a resend is the same call, subject to
 *       a 30s cooldown and a cap of 5 codes per hour for a given number (enforced per phone
 *       number, not per IP, so cycling IPs can't be used to spam someone or run up the bill).
 *
 *       **No SMS provider is configured yet** — the code is written to the server log
 *       (`[OTP][sms] to=... code=...`) instead of being delivered.
 *     tags: [Auth - Registration]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phoneNumber]
 *             properties:
 *               phoneNumber: { type: string, example: "+919876543210" }
 *     responses:
 *       200:
 *         description: Code dispatched.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     result: { $ref: '#/components/schemas/OtpChallenge' }
 *       400: { description: Missing phone number. }
 *       409: { description: That phone number is already registered. }
 *       429: { description: Resend cooldown, or too many codes for this number. }
 */
const registerSendOtp = async (req: Request, res: Response) => {
  try {
    const result = await AuthService.registerSendOtp(req.body?.phoneNumber);
    return handleSuccessResponse(
      { statusCode: successCode, result },
      res,
      "Verification code sent."
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/register/verify-otp:
 *   post:
 *     summary: Step 2 of 3 — verify the code (inline, mid-form)
 *     description: |
 *       Checks the code the user typed into the OTP boxes and proves the phone number.
 *       **No account is created here** — the form still has an email and password to
 *       collect. Call `/auth/register/complete` afterwards with the same `verificationId`.
 *
 *       On a wrong code the `400` response carries `result.attemptsRemaining`, so the form
 *       can render "Invalid OTP. 4 Attempts left" and disable the input at zero without
 *       parsing the message string. Five wrong attempts burn the challenge.
 *
 *       Once verified, the proof stays valid for `completionWindowSeconds` (15 minutes) so
 *       the user has time to finish the rest of the form.
 *     tags: [Auth - Registration]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [verificationId, otp]
 *             properties:
 *               verificationId: { type: string, format: uuid }
 *               otp: { type: string, example: "482913" }
 *     responses:
 *       200:
 *         description: Phone number verified.
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
 *                         verified: { type: boolean, example: true }
 *                         phoneNumber: { type: string, example: "+919876543210" }
 *                         completionWindowSeconds: { type: integer, example: 900 }
 *       400:
 *         description: Wrong or expired code. `result.attemptsRemaining` says how many guesses are left.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ErrorResponse'
 *                 - type: object
 *                   properties:
 *                     result:
 *                       type: object
 *                       properties:
 *                         attemptsRemaining: { type: integer, example: 4 }
 *       429: { description: Too many incorrect attempts — request a new code. }
 */
const registerVerifyOtp = async (req: Request, res: Response) => {
  try {
    const { verificationId, otp } = req.body ?? {};
    const result = await AuthService.registerVerifyOtp(verificationId, otp);
    return handleSuccessResponse(
      { statusCode: successCode, result },
      res,
      "Phone number verified."
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/register/complete:
 *   post:
 *     summary: Step 3 of 3 — create the account ("Create Account")
 *     description: |
 *       Submits the rest of the form once the phone has been verified in step 2, creates the
 *       account and signs the user straight in — no separate login call needed.
 *
 *       The phone number is **not** taken from this request; it is read back off the verified
 *       challenge. Otherwise a caller could verify a number they control and then register
 *       someone else's number against it.
 *
 *       Always creates a `customer`. There is deliberately no `role` field: every downstream
 *       service trusts the gateway-issued role, so a self-assigned role here would grant real
 *       authority platform-wide.
 *
 *       The verification is single-use — the same `verificationId` cannot create a second account.
 *     tags: [Auth - Registration]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [verificationId, name, email, password]
 *             properties:
 *               verificationId:
 *                 type: string
 *                 format: uuid
 *                 description: From step 1, after being verified in step 2.
 *               name: { type: string, example: "Asha Rao" }
 *               email: { type: string, format: email, example: "asha@example.com" }
 *               password: { type: string, format: password, minLength: 8 }
 *     responses:
 *       201:
 *         description: Account created and signed in.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     result: { $ref: '#/components/schemas/AuthTokens' }
 *       400:
 *         description: |
 *           Phone not verified yet, verification already used or expired, invalid email,
 *           or password shorter than 8 characters.
 *       409: { description: Email or phone was taken by someone else while the form was being filled in. }
 */
const registerComplete = async (req: Request, res: Response) => {
  try {
    const result = await AuthService.registerComplete(req.body ?? {});
    return handleSuccessResponse(
      { statusCode: created, result },
      res,
      "Account created successfully."
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

// ----------------------------- Login (OTP) -----------------------------

/**
 * @openapi
 * /auth/login/otp/request:
 *   post:
 *     summary: Login by phone — request a code
 *     description: |
 *       Always returns 200 with a challenge, whether or not the number belongs to an
 *       account; a code is only actually sent when it does. Returning 404 for unknown
 *       numbers would let anyone test which phone numbers are registered.
 *
 *       **No SMS provider is configured yet** — the code is written to the server log.
 *     tags: [Auth - Login]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phoneNumber]
 *             properties:
 *               phoneNumber: { type: string, example: "+919876543210" }
 *     responses:
 *       200:
 *         description: Challenge issued (code sent only if the account exists).
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     result: { $ref: '#/components/schemas/OtpChallenge' }
 *       400: { description: Missing phone number. }
 *       429: { description: Resend cooldown, or too many codes for this number. }
 */
const loginOtpRequest = async (req: Request, res: Response) => {
  try {
    const result = await AuthService.loginOtpRequest(req.body?.phoneNumber);
    console.log("loginOtpRequest result:", result); 
    return handleSuccessResponse(
      { statusCode: successCode, result },
      res,
      "If that number is registered, a code has been sent."
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/login/otp/verify:
 *   post:
 *     summary: Login by phone — verify the code
 *     tags: [Auth - Login]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [verificationId, otp]
 *             properties:
 *               verificationId: { type: string, format: uuid }
 *               otp: { type: string, example: "482913" }
 *     responses:
 *       200:
 *         description: Signed in.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     result: { $ref: '#/components/schemas/AuthTokens' }
 *       400:
 *         description: |
 *           Wrong code, expired/used verificationId, or no account for that number — all
 *           return the same message, since distinguishing them reveals which numbers exist.
 *       429: { description: Too many incorrect attempts — request a new code. }
 */
const loginOtpVerify = async (req: Request, res: Response) => {
  try {
    const { verificationId, otp } = req.body ?? {};
    const result = await AuthService.loginOtpVerify(verificationId, otp);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Login successful.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

// ---------------------------- Social login ----------------------------

/**
 * @openapi
 * /auth/login/oauth:
 *   post:
 *     summary: Login with Google, Facebook or Apple
 *     description: |
 *       The client completes the provider's sign-in with its own SDK and posts the resulting
 *       token here; the backend verifies it directly with the provider before issuing its own
 *       JWT. No redirect/callback flow, so web and mobile share one code path.
 *
 *       The identity is read out of the **verified** token — a client-supplied email or name
 *       is never trusted, since that would let anyone sign in as any address. The token's
 *       audience is checked against this server's own client ids, so a validly-signed token
 *       issued to a different app is rejected.
 *
 *       Matching is by the provider's stable user id first, then by verified email (so an
 *       existing password account is linked rather than duplicated). A brand-new account has
 *       no phone number — `profileComplete` is false until one is added and verified.
 *
 *       **Google and Facebook are implemented.** Google needs `GOOGLE_AUTH_CLIENT_ID`, which
 *       accepts a comma-separated list — Google issues a separate client id per platform, so
 *       the web, Android and iOS ids must all be listed or tokens from the missing platforms
 *       come back 401 as "issued for a different application". Facebook needs
 *       `FACEBOOK_AUTH_APP_ID` + `FACEBOOK_AUTH_APP_SECRET` (one app across all platforms).
 *       Either returns 500 until configured.
 *
 *       **Apple is not implemented** and always returns 500 — it refuses rather than
 *       accepting a token it cannot verify.
 *     tags: [Auth - Login]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [provider, token]
 *             properties:
 *               provider: { type: string, enum: [google, facebook, apple] }
 *               token:
 *                 type: string
 *                 description: Google/Apple — the ID token. Facebook — the user access token.
 *     responses:
 *       200:
 *         description: Signed in.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     result:
 *                       allOf:
 *                         - $ref: '#/components/schemas/AuthTokens'
 *                         - type: object
 *                           properties:
 *                             isNewUser: { type: boolean }
 *                             profileComplete:
 *                               type: boolean
 *                               description: False while the account has no verified phone number.
 *       400: { description: Unsupported provider, missing token, or provider account has no email. }
 *       401: { description: Provider rejected the token, or it was issued to a different application. }
 *       403: { description: Matching account is deactivated. }
 *       500: { description: Provider not configured on this server (or Apple, which is unimplemented). }
 */
const loginOAuth = async (req: Request, res: Response) => {
  try {
    const { provider, token } = req.body ?? {};
    const result = await AuthService.loginOAuth(provider, token);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Login successful.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

// --------------------------- Password reset ---------------------------

/**
 * @openapi
 * /auth/password/forgot:
 *   post:
 *     summary: Step 1 of 2 — send a password-reset code to the email
 *     description: |
 *       Always returns 200, whether or not the email is registered — same anti-enumeration
 *       reasoning as login-by-phone.
 *
 *       **No email provider is configured yet** — the code is written to the server log
 *       (`[OTP][email] to=... code=...`) instead of being delivered.
 *     tags: [Auth - Password Reset]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200:
 *         description: Challenge issued (email sent only if the account exists).
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     result: { $ref: '#/components/schemas/OtpChallenge' }
 *       400: { description: Malformed email address. }
 *       429: { description: Resend cooldown, or too many codes for this address. }
 */
const passwordForgot = async (req: Request, res: Response) => {
  try {
    const result = await AuthService.passwordForgot(req.body?.email);
    return handleSuccessResponse(
      { statusCode: successCode, result },
      res,
      "If that email is registered, a reset code has been sent."
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /auth/password/reset:
 *   post:
 *     summary: Step 2 of 2 — verify the code and set a new password
 *     description: |
 *       Verifying and setting happen in one call, so a verified code is never left
 *       outstanding as a reusable password-change token.
 *
 *       **Known limitation:** existing sessions are NOT revoked. These JWTs are stateless and
 *       nothing tracks issued tokens, so a token stolen before the reset stays valid until it
 *       expires (up to 12h). Closing that needs a token-version or denylist checked at verify
 *       time — tracked, not done.
 *     tags: [Auth - Password Reset]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [verificationId, otp, newPassword]
 *             properties:
 *               verificationId: { type: string, format: uuid }
 *               otp: { type: string, example: "482913" }
 *               newPassword: { type: string, format: password, minLength: 8 }
 *     responses:
 *       200: { description: Password updated. }
 *       400: { description: Wrong code, expired/used verificationId, or password too short. }
 *       429: { description: Too many incorrect attempts — request a new code. }
 */
const passwordReset = async (req: Request, res: Response) => {
  try {
    const { verificationId, otp, newPassword } = req.body ?? {};
    const result = await AuthService.passwordReset(verificationId, otp, newPassword);
    return handleSuccessResponse({ statusCode: successCode, result }, res, result.message);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const UserAuthController = {
  registerSendOtp,
  registerVerifyOtp,
  registerComplete,
  loginOtpRequest,
  loginOtpVerify,
  loginOAuth,
  passwordForgot,
  passwordReset,
};
