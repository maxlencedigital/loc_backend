import { Response } from "express";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { requestActor } from "../Middleware/StoreScope.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { RiderJobService } from "../Services/RiderJob.Service.js";

/**
 * @openapi
 * /rider/jobs:
 *   get:
 *     operationId: listRiderJobs
 *     summary: "Today's pickups and deliveries, in a sensible route order"
 *     description: "**Who can call this:** driver (super_admin always allowed)."
 *     tags: ["Rider - Jobs"]
 *     x-roles: [driver]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [assigned, en_route, arrived, picked_up, at_store, out_for_delivery, delivered, failed, cancelled] }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [pickup, delivery] }
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
 *                               type: { type: string, enum: [pickup, delivery] }
 *                               sequence: { type: integer, description: "stop number in the day's route" }
 *                               status: { type: string, enum: [assigned, en_route, arrived, picked_up, at_store, out_for_delivery, delivered, failed, cancelled] }
 *                               orderId: { type: string, format: uuid }
 *                               orderNumber: { type: string }
 *                               customerName: { type: string }
 *                               customerPhone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                               address:
 *                                 type: object
 *                                 properties:
 *                                   line1: { type: string }
 *                                   line2: { type: string }
 *                                   landmark: { type: string }
 *                                   city: { type: string }
 *                                   pincode: { type: string }
 *                                   latitude: { type: number }
 *                                   longitude: { type: number }
 *                               slot:
 *                                 type: object
 *                                 properties:
 *                                   from: { type: string, format: date-time }
 *                                   to: { type: string, format: date-time }
 *                               etaMinutes: { type: integer }
 *                               isPremium: { type: boolean }
 *                               isDelicate: { type: boolean }
 *                               requiresInspection: { type: boolean, description: "the app opens the inspection screen instead of a plain scan" }
 *                               amountToCollect: { type: number, description: "Amount in INR" }
 *                               storeId: { type: string, format: uuid }
 *                               storeName: { type: string }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listRiderJobs = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderJobService.list(actor, req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/jobs/{id}:
 *   get:
 *     operationId: getRiderJob
 *     summary: "One job in full, with the customer's care notes"
 *     description: "**Who can call this:** driver (super_admin always allowed)."
 *     tags: ["Rider - Jobs"]
 *     x-roles: [driver]
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
 *                         id: { type: string, format: uuid }
 *                         type: { type: string, enum: [pickup, delivery] }
 *                         sequence: { type: integer, description: "stop number in the day's route" }
 *                         status: { type: string, enum: [assigned, en_route, arrived, picked_up, at_store, out_for_delivery, delivered, failed, cancelled] }
 *                         orderId: { type: string, format: uuid }
 *                         orderNumber: { type: string }
 *                         customerName: { type: string }
 *                         customerPhone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                         address:
 *                           type: object
 *                           properties:
 *                             line1: { type: string }
 *                             line2: { type: string }
 *                             landmark: { type: string }
 *                             city: { type: string }
 *                             pincode: { type: string }
 *                             latitude: { type: number }
 *                             longitude: { type: number }
 *                         slot:
 *                           type: object
 *                           properties:
 *                             from: { type: string, format: date-time }
 *                             to: { type: string, format: date-time }
 *                         etaMinutes: { type: integer }
 *                         isPremium: { type: boolean }
 *                         isDelicate: { type: boolean }
 *                         requiresInspection: { type: boolean, description: "the app opens the inspection screen instead of a plain scan" }
 *                         amountToCollect: { type: number, description: "Amount in INR" }
 *                         storeId: { type: string, format: uuid }
 *                         storeName: { type: string }
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               name: { type: string }
 *                               careFlags: { type: array, items: { type: string } }
 *                               customerNote: { type: string }
 *                         customerCareNotes: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getRiderJob = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderJobService.getOne(actor, req.params.id as string) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/jobs/{id}/arrived:
 *   post:
 *     operationId: markRiderArrived
 *     summary: "I have arrived"
 *     description: "**Who can call this:** driver (super_admin always allowed)."
 *     tags: ["Rider - Jobs"]
 *     x-roles: [driver]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       200:
 *         description: "OK."
 *       409:
 *         description: "The request conflicts with the current state."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const markRiderArrived = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderJobService.arrived(actor, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/jobs/{id}/issue:
 *   post:
 *     operationId: reportRiderJobIssue
 *     summary: "Report a problem at the door"
 *     description: "**Who can call this:** driver (super_admin always allowed)."
 *     tags: ["Rider - Jobs"]
 *     x-roles: [driver]
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
 *             required: [reason]
 *             properties:
 *               reason: { type: string, enum: [customer_unavailable, address_wrong, customer_refused, vehicle_breakdown, unsafe, other] }
 *               note: { type: string }
 *               reschedule: { type: boolean }
 *               rescheduleFor: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: "OK."
 *       409:
 *         description: "The request conflicts with the current state."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const reportRiderJobIssue = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderJobService.reportIssue(actor, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/jobs/{id}/start:
 *   post:
 *     operationId: startRiderJob
 *     summary: "Set off for this job"
 *     description: "**Who can call this:** driver (super_admin always allowed)."
 *     tags: ["Rider - Jobs"]
 *     x-roles: [driver]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       200:
 *         description: "OK."
 *       409:
 *         description: "The request conflicts with the current state."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const startRiderJob = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderJobService.start(actor, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/route:
 *   get:
 *     operationId: getRiderRoute
 *     summary: "The day's route as a whole"
 *     description: "**Who can call this:** driver (super_admin always allowed)."
 *     tags: ["Rider - Jobs"]
 *     x-roles: [driver]
 *     parameters:
 *       - in: query
 *         name: date
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
 *                         stops:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               jobId: { type: string, format: uuid }
 *                               sequence: { type: integer }
 *                               latitude: { type: number }
 *                               longitude: { type: number }
 *                               etaMinutes: { type: integer }
 *                         totalDistanceKm: { type: number }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getRiderRoute = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderJobService.route(actor, req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const RiderJobsController = {
  listRiderJobs,
  getRiderJob,
  markRiderArrived,
  reportRiderJobIssue,
  startRiderJob,
  getRiderRoute,
};
