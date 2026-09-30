import { Request, Response } from "express";
import { handleErrorResponse, handleNotImplementedResponse } from "../../commons/Response/Response.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";

/**
 * @openapi
 * /invoices/batch:
 *   post:
 *     summary: Kick off a batch invoice run (e.g. monthly, per customer or store)
 *     tags: ["Store - Invoices"]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [periodStart, periodEnd]
 *             properties:
 *               customerId: { type: string }
 *               storeId: { type: string }
 *               periodStart: { type: string, format: date }
 *               periodEnd: { type: string, format: date }
 *     responses:
 *       202:
 *         description: Batch run accepted.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: object
 *                   properties:
 *                     batchId: { type: string }
 *                     status: { type: string, example: processing }
 *       400:
 *         description: Missing required fields.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const runBatch = async (req: Request, res: Response) => {
  try {
    const { periodStart, periodEnd } = req.body ?? {};
    if (!periodStart || !periodEnd) {
      throw new CustomException("periodStart and periodEnd are required.", badRequest);
    }
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /invoices/{id}/print:
 *   get:
 *     summary: Get print-ready data for an invoice
 *     tags: ["Store - Invoices"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Print-ready invoice data.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: object
 *                   properties:
 *                     invoiceId: { type: string }
 *                     lineItems: { type: array, items: { type: object } }
 *                     total: { type: number }
 *                     customer: { type: object }
 *       404:
 *         description: Invoice not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const printInvoice = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

export const InvoiceController = { runBatch, printInvoice };
