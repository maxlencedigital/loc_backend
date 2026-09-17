import { Request, Response, NextFunction } from "express";
import { AuthService } from "../Services/Auth.Service.js";
import { handleErrorResponse } from "../../commons/Response/Response.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { unauthorized, forbidden } from "../../commons/Utils/StatusCode.js";
import { UserRole } from "../Models/User/User.Interface.js";

export interface AuthenticatedRequest extends Request {
  user?: { id: string; role: UserRole };
}

/**
 * Every request is authenticated exactly once, here, at the
 * gateway. Downstream services (commerce/logistics/finance/growth)
 * trust the x-user-id / x-user-role headers this middleware's
 * proxy attaches afterwards — they do not re-verify the JWT.
 */
const verifyToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new CustomException(
        "Please provide a valid Authorization header with a Bearer token.",
        unauthorized
      );
    }
    const token = authHeader.slice(7);
    const decoded = AuthService.verifyToken(token);
    req.user = { id: decoded.userId, role: decoded.role };
    next();
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

const requireRole = (...roles: UserRole[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return handleErrorResponse(new CustomException("Authentication required.", unauthorized), res);
    }
    if (!roles.includes(req.user.role)) {
      return handleErrorResponse(
        new CustomException("You do not have permission to perform this action.", forbidden),
        res
      );
    }
    next();
  };
};

export { verifyToken, requireRole };
