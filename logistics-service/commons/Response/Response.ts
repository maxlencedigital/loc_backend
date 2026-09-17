import { Response } from "express";
import { serverError } from "../Utils/StatusCode.js";
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
      result: null,
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

export { handleSuccessResponse, handleErrorResponse };
