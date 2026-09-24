import { Response } from "express";
import { serverError, notImplemented } from "../Utils/StatusCode.js";
import { unknownErrorMessage, successMessage } from "../Constant/Constants.js";
import { CustomException } from "../Exception/CustomException.js";

interface SuccessPayload {
  statusCode: number;
  result?: any;
}

/**
 * Every response from every service follows this exact shape,
 * so a client doesn't need to know which service answered.
 */
const handleSuccessResponse = (
  { statusCode, result = null }: SuccessPayload,
  res: Response,
  displayMessage: string = successMessage
) => {
  return res.status(statusCode).json({
    statusCode,
    result,
    displayMessage,
    status: true,
  });
};

/**
 * Single error path for every controller: pass whatever the
 * try/catch caught. A CustomException's own code/message is
 * used as-is; anything else is logged server-side and reported
 * to the client as a generic 500 (never leaks internals).
 */
const handleErrorResponse = (error: unknown, res: Response) => {
  if (error instanceof CustomException) {
    return res.status(error.errorCode).json({
      statusCode: error.errorCode,
      // Usually null. Carries structured detail when the client needs to act
      // on more than the message (e.g. OTP attempts remaining).
      result: error.data ?? null,
      displayMessage: error.displayMessage,
      status: false,
    });
  }
  console.error(error);
  return res.status(serverError).json({
    statusCode: serverError,
    result: null,
    displayMessage: unknownErrorMessage,
    status: false,
  });
};

/**
 * For routes that are scaffolded per the API contract but not yet
 * wired to real logic — the route, request/response shape, and Swagger
 * doc are final; only the implementation is pending. Kept distinct from
 * handleErrorResponse so a contract stub is never confused with an
 * actual runtime failure.
 */
const handleNotImplementedResponse = (
  res: Response,
  displayMessage: string = "Endpoint scaffolded per API contract — implementation pending."
) => {
  return res.status(notImplemented).json({
    statusCode: notImplemented,
    result: null,
    displayMessage,
    status: false,
  });
};

export { handleSuccessResponse, handleErrorResponse, handleNotImplementedResponse };
