import { serverError } from "../Utils/StatusCode.js";

// Thrown from a Service for a known error (bad input, not found, unauthorized).
// Anything else is treated as an unexpected server error by Response.ts.
export class CustomException extends Error {
  public errorCode: number;
  public displayMessage: string;
  // Structured detail returned in the response's `result`, for when the client
  // must act on more than the message — e.g. the OTP screen's attempts left.
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
