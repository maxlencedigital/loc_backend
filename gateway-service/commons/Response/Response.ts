import { Response } from "express";
import { serverError, notImplemented } from "../Utils/StatusCode.js";
import { unknownErrorMessage, successMessage } from "../Constant/Constants.js";
import { CustomException } from "../Exception/CustomException.js";

interface SuccessPayload {
  statusCode: number;
  result?: any;
}

// Every response from every service follows this exact shape, so a client never
// needs to know which service answered.
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

// Single error path for every controller. A CustomException's code and message
// are used as-is; anything else is logged and reported as a generic 500.
const handleErrorResponse = (error: unknown, res: Response) => {
  if (error instanceof CustomException) {
    return res.status(error.errorCode).json({
      statusCode: error.errorCode,
      // Usually null. Carries structured detail when the client must act on
      // more than the message, e.g. OTP attempts remaining.
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

// For routes scaffolded per the API contract but not yet implemented. Distinct
// from handleErrorResponse so a stub is never mistaken for a runtime failure.
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
