import { Request, Response, NextFunction } from "express";
import { handleErrorResponse } from "../../commons/Response/Response.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { unauthorized, forbidden } from "../../commons/Utils/StatusCode.js";

export type UserRole = "super_admin" | "admin" | "staff" | "driver" | "customer";

export interface IdentifiedRequest extends Request {
  user?: { id: string; role: UserRole };
}

// Applied to every route except /health. Only the gateway holds this secret;
// without the check, x-user-id and x-user-role are headers anyone can set.
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

// Reads the identity the gateway already verified by JWT. Only meaningful once
// requireInternalSecret has run.
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

// `super_admin` always passes, whichever roles are listed — it sits above the
// rest of the hierarchy, so new tiers can slot in without touching call sites.
const requireRole = (...roles: UserRole[]) => {
  return (req: IdentifiedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return handleErrorResponse(new CustomException("Authentication required.", unauthorized), res);
    }
    if (req.user.role !== "super_admin" && !roles.includes(req.user.role)) {
      return handleErrorResponse(
        new CustomException("You do not have permission to perform this action.", forbidden),
        res
      );
    }
    next();
  };
};

export { requireInternalSecret, requireIdentity, requireRole };
