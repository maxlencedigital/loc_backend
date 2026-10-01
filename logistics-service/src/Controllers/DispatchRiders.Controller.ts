import { Response } from "express";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { dispatchContext } from "../Middleware/StoreScope.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { DispatchRiderService } from "../Services/DispatchRider.Service.js";

/**
 * @openapi
 * /field-payments:
 *   get:
 *     operationId: listFieldPayments
 *     summary: "Money riders collected at doors"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Riders & Cash"]
 *     x-roles: [admin, manager, staff]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: riderId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [collected, settled] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: "OK."
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     result:
 *                       type: object
 *                       properties:
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               riderId: { type: string, format: uuid }
 *                               orderId: { type: string, format: uuid }
 *                               amount: { type: number, description: "Amount in INR" }
 *                               method: { type: string }
 *                               status: { type: string }
 *                               collectedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listFieldPayments = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { scope } = dispatchContext(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchRiderService.listFieldPayments(scope, req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /field-payments/{id}:
 *   get:
 *     operationId: getFieldPayment
 *     summary: "One field payment"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Riders & Cash"]
 *     x-roles: [admin, manager, staff]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getFieldPayment = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { scope } = dispatchContext(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchRiderService.getFieldPayment(scope, req.params.id as string) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /field-payments/{id}/settle:
 *   post:
 *     operationId: settleFieldPayment
 *     summary: "Record that a rider handed the money over"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Riders & Cash"]
 *     x-roles: [admin, manager, staff]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [settledAmount]
 *             properties:
 *               settledAmount: { type: number, description: "Amount in INR" }
 *               storeId: { type: string, format: uuid }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "The amount does not match what was collected."
 */
const settleFieldPayment = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { actor, scope } = dispatchContext(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchRiderService.settleFieldPayment(actor, scope, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /riders:
 *   get:
 *     operationId: listRiders
 *     summary: "Riders and their availability"
 *     description: "**Who can call this:** admin, hr, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Riders & Cash"]
 *     x-roles: [admin, hr, manager, staff]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: available
 *         schema: { type: boolean }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, suspended, inactive] }
 *     responses:
 *       200:
 *         description: "OK."
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     result:
 *                       type: object
 *                       properties:
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               name: { type: string }
 *                               phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                               available: { type: boolean }
 *                               status: { type: string }
 *                               activeJobs: { type: integer }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listRiders = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchRiderService.list(req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /riders/available:
 *   get:
 *     operationId: listAvailableRiders
 *     summary: "Riders who can take a job right now"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Riders & Cash"]
 *     x-roles: [admin, manager, staff]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: at
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: "OK."
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     result:
 *                       type: object
 *                       properties:
 *                         riders:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               name: { type: string }
 *                               distanceKm: { type: number }
 *                               activeJobs: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listAvailableRiders = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { scope } = dispatchContext(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchRiderService.available(scope, req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /riders/{id}:
 *   get:
 *     operationId: getRider
 *     summary: "One rider"
 *     description: "**Who can call this:** admin, hr, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Riders & Cash"]
 *     x-roles: [admin, hr, manager, staff]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getRider = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchRiderService.get(req.params.id as string) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /riders/{id}/cash-balance:
 *   get:
 *     operationId: getRiderCashBalanceForDispatch
 *     summary: "Cash a rider is holding"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Riders & Cash"]
 *     x-roles: [admin, manager, staff]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     result:
 *                       type: object
 *                       properties:
 *                         collected: { type: number, description: "Amount in INR" }
 *                         settled: { type: number, description: "Amount in INR" }
 *                         outstanding: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getRiderCashBalanceForDispatch = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchRiderService.cashBalance(req.params.id as string) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /riders/{id}/location:
 *   get:
 *     operationId: getRiderLocation
 *     summary: "Where a rider is now"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Riders & Cash"]
 *     x-roles: [admin, manager, staff]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     result:
 *                       type: object
 *                       properties:
 *                         latitude: { type: number }
 *                         longitude: { type: number }
 *                         at: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getRiderLocation = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchRiderService.location(req.params.id as string) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const DispatchRidersController = {
  listFieldPayments,
  getFieldPayment,
  settleFieldPayment,
  listRiders,
  listAvailableRiders,
  getRider,
  getRiderCashBalanceForDispatch,
  getRiderLocation,
};
