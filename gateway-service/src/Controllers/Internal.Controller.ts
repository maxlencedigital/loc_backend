import { Request, Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { UsersService } from "../Services/Users.Service.js";

// Service-to-service only (see Routes/Internal.Routes.ts): deliberately no OpenAPI doc blocks, so
// these never appear on the public Swagger page.

const getUser = async (req: Request, res: Response) => {
  try {
    const result = await UsersService.getInternalUser(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "User fetched.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

const lookupUsers = async (req: Request, res: Response) => {
  try {
    const result = await UsersService.lookupInternalUsers(req.body?.ids);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Users fetched.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

const deactivateUser = async (req: Request, res: Response) => {
  try {
    const result = await UsersService.deactivateInternalUser(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "User deactivated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

const reactivateUser = async (req: Request, res: Response) => {
  try {
    const result = await UsersService.reactivateInternalUser(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "User reactivated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const InternalController = { getUser, lookupUsers, deactivateUser, reactivateUser };
