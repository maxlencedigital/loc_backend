import { Request, Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { PayService } from "../Services/Pay.Service.js";

/**
 * @openapi
 * /internal/hr/incentive-metrics:
 *   post:
 *     operationId: internalReportIncentiveMetrics
 *     summary: "Report what people did in a period, to feed their incentives (service to service)"
 *     description: "Internal. At most 200 values per call. A value replaces the earlier one for the same person, metric and period and re-evaluates the pending incentives of the schemes assigned to that person; approved and paid incentives never change. People who are unknown or have left are ignored and counted. The attendance metric is computed by HR and cannot be reported."
 *     tags: ["Internal - HR People"]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [metrics]
 *             properties:
 *               metrics:
 *                 type: array
 *                 maxItems: 200
 *                 items:
 *                   type: object
 *                   required: [employeeId, metric, period, value]
 *                   properties:
 *                     employeeId: { type: string, format: uuid }
 *                     metric: { type: string, enum: [jobs_completed, orders_processed, rating, distance] }
 *                     period: { type: string, description: "2026-09-15 (daily), 2026-W38 (weekly) or 2026-09 (monthly)" }
 *                     value: { type: number, description: "Up to 3 decimals; a rating is 0 to 5" }
 *     responses:
 *       200:
 *         description: "OK."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: object
 *                   properties:
 *                     accepted: { type: integer }
 *                     ignored: { type: integer }
 *       400:
 *         description: "Missing or invalid fields."
 *       401:
 *         description: "Not called by a service."
 */
const reportIncentiveMetrics = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PayService.ingestMetrics(req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const HrPeopleInternalController = { reportIncentiveMetrics };
