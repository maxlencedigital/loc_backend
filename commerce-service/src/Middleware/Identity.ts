import { Request, Response, NextFunction } from "express";
import { handleErrorResponse } from "../../commons/Response/Response.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { unauthorized, forbidden } from "../../commons/Utils/StatusCode.js";

export type UserRole = "admin" | "staff" | "driver" | "customer";

export interface IdentifiedRequest extends Request {
  user?: { id: string; role: UserRole };
}

/**
 * Applied globally, to every route except /health. This service is
 * never meant to be reachable except through the gateway (network
 * isolation is the real boundary in a real deployment — this is
 * defense-in-depth for local dev and anyone who mis-wires that).
 * The gateway is the only holder of INTERNAL_SERVICE_SECRET; without
 * it, x-user-id / x-user-role are just headers anyone could set by
 * hand, so they must never be trusted without this check passing first.
 */
const requireInternalSecret = (req: Request, res: Response, next: NextFunction) => {
  const secret = req.header("x-internal-secret");
  if (!secret || secret !== process.env.INTERNAL_SERVICE_SECRET) {
    return handleErrorResponse(
      new CustomException("This service only accepts requests routed through the gateway.", unauthorized),
      res
    );
  }
  next();
};

/**
 * Reads the identity the gateway already verified via JWT. Only
 * meaningful once requireInternalSecret has already run — see above.
 */
const requireIdentity = (req: IdentifiedRequest, res: Response, next: NextFunction) => {
  const userId = req.header("x-user-id");
  const role = req.header("x-user-role") as UserRole | undefined;
  if (!userId || !role) {
    return handleErrorResponse(
      new CustomException("Missing verified identity — route this request through the gateway.", unauthorized),
      res
    );
  }
  req.user = { id: userId, role };
  next();
};

const requireRole = (...roles: UserRole[]) => {
  return (req: IdentifiedRequest, res: Response, next: NextFunction) => {
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

export { requireInternalSecret, requireIdentity, requireRole };
