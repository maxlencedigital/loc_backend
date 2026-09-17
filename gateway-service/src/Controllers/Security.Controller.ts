import { Request, Response } from "express";
import { handleNotImplementedResponse } from "../../commons/Response/Response.js";

/**
 * @openapi
 * /security/backup-status:
 *   get:
 *     summary: Get the status of the twice-daily database backup job (admin only)
 *     tags: [Security]
 *     responses:
 *       200:
 *         description: "Scaffolded per API contract — not yet implemented. Once wired up, returns: { lastBackupAt: string (date-time), status: \"success\"|\"failed\", locations: string[] }."
 *       403:
 *         description: Authenticated but not an admin.
 *       501:
 *         description: Endpoint scaffolded per API contract — implementation pending.
 */
const backupStatus = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

export const SecurityController = { backupStatus };
