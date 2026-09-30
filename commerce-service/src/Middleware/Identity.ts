import { Request, Response, NextFunction } from "express";
import { handleErrorResponse } from "../../commons/Response/Response.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { unauthorized, forbidden } from "../../commons/Utils/StatusCode.js";

export type UserRole = "super_admin" | "admin" | "manager" | "hr" | "staff" | "driver" | "customer";

export interface RequestUser {
  id: string;
  role: UserRole;
  // The store the account belongs to (x-user-store-id, set by the gateway from the token).
  storeId: string | null;
  // The store an admin chose to view (x-store-scope); the gateway only sets it for admins.
  scopeStoreId: string | null;
  // Display name for audit trails; absent unless the gateway forwards x-user-name.
  name: string | null;
}

export interface IdentifiedRequest extends Request {
  user?: RequestUser;
}

const headerOrNull = (req: Request, name: string): string | null => req.header(name)?.trim() || null;

// The gateway percent-encodes the name; a malformed value is dropped, not a 500.
const decodeName = (value: string | null): string | null => {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

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
  req.user = {
    id: userId,
    role,
    storeId: headerOrNull(req, "x-user-store-id"),
    scopeStoreId: headerOrNull(req, "x-store-scope"),
    name: decodeName(headerOrNull(req, "x-user-name")),
  };
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
