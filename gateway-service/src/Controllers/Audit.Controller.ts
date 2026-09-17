import { Request, Response } from "express";
import { ActivityLogQuery } from "../Queries/ActivityLog.Query.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";

/**
 * @openapi
 * /audit/logs:
 *   get:
 *     summary: Search the activity log (admin only)
 *     tags: [Security]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: service
 *         schema: { type: string }
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: Paginated activity log rows.
 *       401:
 *         description: Missing or invalid token.
 *       403:
 *         description: Authenticated but not an admin.
 */
const getLogs = async (req: Request, res: Response) => {
  try {
    const { service, userId, from, to, page = "1", limit = "50" } = req.query;
    const result = await ActivityLogQuery.search({
      service: service as string | undefined,
      userId: userId as string | undefined,
      from: from ? new Date(from as string) : undefined,
      to: to ? new Date(to as string) : undefined,
      page: Number(page),
      limit: Number(limit),
    });
    return handleSuccessResponse(
      { statusCode: successCode, result },
      res,
      "Audit logs fetched successfully."
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AuditController = { getLogs };
