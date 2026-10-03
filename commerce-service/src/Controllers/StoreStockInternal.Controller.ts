import { Request, Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created } from "../../commons/Utils/StatusCode.js";
import { StoreStockService } from "../Services/StoreStock.Service.js";

/**
 * @openapi
 * /internal/stores/{storeId}/stock/{itemId}/movements:
 *   post:
 *     summary: "Record a stock movement (other services only)"
 *     description: "Consumption, a receipt outside a purchase order, or a correction. Changes the quantity and appends the ledger row in one transaction; a repeated idempotencyKey returns the first result."
 *     tags: ["Internal"]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [kind, quantity, actor]
 *             properties:
 *               kind: { type: string, enum: [consumption, receipt, correction] }
 *               quantity: { type: number, description: "Positive, at most three decimals" }
 *               direction: { type: string, enum: [increase, decrease], description: "Required for a correction" }
 *               reason: { type: string, description: "Required for a correction" }
 *               idempotencyKey: { type: string }
 *               actor: { type: object, required: [name], properties: { name: { type: string }, id: { type: string } } }
 *     responses:
 *       201:
 *         description: "Recorded."
 *       400:
 *         description: "Invalid fields."
 *       404:
 *         description: "Unknown store or item."
 *       409:
 *         description: "Not enough stock on hand."
 */
const recordMovement = async (req: Request, res: Response) => {
  try {
    const result = await StoreStockService.recordMovement(req.params.storeId, req.params.itemId, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const StoreStockInternalController = { recordMovement };
