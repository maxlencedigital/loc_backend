import { CustomException } from "./CustomException.js";
import { serverError } from "../Utils/StatusCode.js";
import { unknownErrorMessage } from "../Constant/Constants.js";

// Known errors pass through untouched. Anything else (driver, network, a bug) is
// logged once and becomes a generic 500, so only the standard format leaves a service.
export const toCustomException = (error: unknown): CustomException => {
  if (error instanceof CustomException) return error;
  console.error(error);
  return new CustomException(unknownErrorMessage, serverError);
};
