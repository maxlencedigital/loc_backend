import { Response, NextFunction } from "express";
import { ActivityLogQuery } from "../Queries/ActivityLog.Query.js";
import { AuthenticatedRequest } from "./Auth.js";

/**
 * Writes one audit row per request, after the response is sent,
 * so logging never adds latency to the actual request. This is
 * the Security module's activity log, folded into the gateway.
 */
const activityLogger = (serviceName: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    res.on("finish", () => {
      ActivityLogQuery.create({
        service: serviceName,
        method: req.method,
        path: req.originalUrl,
        userId: req.user?.id,
        statusCode: res.statusCode,
        ip: req.ip,
      }).catch((error) => console.error("Failed to write activity log:", error));
    });
    next();
  };
};

export { activityLogger };
