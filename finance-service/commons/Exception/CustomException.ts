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

  constructor(displayMessage: string, errorCode: number = serverError) {
    super(displayMessage);
    this.name = "CustomException";
    this.errorCode = errorCode;
    this.displayMessage = displayMessage;
    Object.setPrototypeOf(this, CustomException.prototype);
  }
}
