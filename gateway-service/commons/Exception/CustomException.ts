import { serverError } from "../Utils/StatusCode.js";

/**
 * Thrown deliberately from a Service to signal a specific,
 * known error (bad input, not found, unauthorized, ...).
 * Anything that is NOT a CustomException is treated as an
 * unexpected server error by commons/Response/Response.ts.
 */
export class CustomException extends Error {
  public errorCode: number;
  public displayMessage: string;
  /**
   * Optional structured detail returned in the response's `result` field.
   *
   * For cases where the client needs to act on more than the message — the
   * OTP screen, for instance, shows "4 attempts left" and disables the input
   * at zero. Parsing that out of a human-readable string would break the
   * moment the wording or language changes.
   */
  public data: unknown;

  constructor(displayMessage: string, errorCode: number = serverError, data?: unknown) {
    super(displayMessage);
    this.name = "CustomException";
    this.errorCode = errorCode;
    this.displayMessage = displayMessage;
    this.data = data ?? null;
    Object.setPrototypeOf(this, CustomException.prototype);
  }
}
