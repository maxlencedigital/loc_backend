import { Response } from "express";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { dispatchContext } from "../Middleware/StoreScope.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { DispatchJobService } from "../Services/DispatchJob.Service.js";

/**
 * @openapi
 * /jobs:
 *   post:
 *     operationId: createJob
 *     summary: "Create a pickup or delivery job for an order"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Jobs & Assignment"]
 *     x-roles: [admin, manager, staff]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, type, storeId]
 *             properties:
 *               orderId: { type: string, format: uuid }
 *               type: { type: string, enum: [pickup, delivery] }
 *               storeId: { type: string, format: uuid }
 *               address:
 *                 type: object
 *                 properties:
 *                   line1: { type: string }
 *                   line2: { type: string }
 *                   landmark: { type: string }
 *                   city: { type: string }
 *                   pincode: { type: string }
 *                   latitude: { type: number }
 *                   longitude: { type: number }
 *               slotFrom: { type: string, format: date-time }
 *               slotTo: { type: string, format: date-time }
 *               priority: { type: string, enum: [normal, express] }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: "Created."
 *       409:
 *         description: "The request conflicts with the current state."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createJob = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { actor, scope } = dispatchContext(req);
    return handleSuccessResponse(
      { statusCode: created, result: await DispatchJobService.create(actor, scope, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /jobs:
 *   get:
 *     operationId: listJobs
 *     summary: "Jobs across riders"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Jobs & Assignment"]
 *     x-roles: [admin, manager, staff]
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
 *         name: riderId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [assigned, en_route, arrived, picked_up, at_store, out_for_delivery, delivered, failed, cancelled] }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [pickup, delivery] }
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
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               orderId: { type: string, format: uuid }
 *                               type: { type: string, enum: [pickup, delivery] }
 *                               status: { type: string, enum: [assigned, en_route, arrived, picked_up, at_store, out_for_delivery, delivered, failed, cancelled] }
 *                               riderId: { type: string, format: uuid }
 *                               storeId: { type: string, format: uuid }
 *                               slotFrom: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listJobs = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { scope } = dispatchContext(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchJobService.list(scope, req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /jobs/auto-assign:
 *   post:
 *     operationId: autoAssignJobs
 *     summary: "Assign waiting jobs to the best available riders"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Jobs & Assignment"]
 *     x-roles: [admin, manager, staff]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [storeId]
 *             properties:
 *               storeId: { type: string, format: uuid }
 *               date: { type: string, format: date }
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
 *                         assigned: { type: integer }
 *                         unassigned: { type: integer }
 *       409:
 *         description: "The request conflicts with the current state."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const autoAssignJobs = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { actor, scope } = dispatchContext(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchJobService.autoAssign(actor, scope, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /jobs/unassigned:
 *   get:
 *     operationId: listUnassignedJobs
 *     summary: "Jobs still waiting for a rider"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Jobs & Assignment"]
 *     x-roles: [admin, manager, staff]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
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
 *                         jobs:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               type: { type: string, enum: [pickup, delivery] }
 *                               slotFrom: { type: string, format: date-time }
 *                               priority: { type: string }
 *                               orderNumber: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listUnassignedJobs = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { scope } = dispatchContext(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchJobService.unassigned(scope, req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /jobs/{id}:
 *   get:
 *     operationId: getJob
 *     summary: "One job"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Jobs & Assignment"]
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
const getJob = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { scope } = dispatchContext(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchJobService.get(scope, req.params.id as string) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /jobs/{id}:
 *   patch:
 *     operationId: updateJob
 *     summary: "Change a job's slot, address or priority"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Jobs & Assignment"]
 *     x-roles: [admin, manager, staff]
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
 *               slotFrom: { type: string, format: date-time }
 *               slotTo: { type: string, format: date-time }
 *               address:
 *                 type: object
 *                 properties:
 *                   line1: { type: string }
 *                   line2: { type: string }
 *                   landmark: { type: string }
 *                   city: { type: string }
 *                   pincode: { type: string }
 *                   latitude: { type: number }
 *                   longitude: { type: number }
 *               priority: { type: string, enum: [normal, express] }
 *               notes: { type: string }
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
const updateJob = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { actor, scope } = dispatchContext(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchJobService.update(actor, scope, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /jobs/{id}/assign:
 *   post:
 *     operationId: assignJob
 *     summary: "Give a job to a rider"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Jobs & Assignment"]
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
 *             required: [riderId]
 *             properties:
 *               riderId: { type: string, format: uuid }
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
 *         description: "That rider is not available or not eligible."
 */
const assignJob = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { actor, scope } = dispatchContext(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchJobService.assign(actor, scope, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /jobs/{id}/cancel:
 *   post:
 *     operationId: cancelJob
 *     summary: "Cancel a job"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Jobs & Assignment"]
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
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
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
const cancelJob = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { actor, scope } = dispatchContext(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchJobService.cancel(actor, scope, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /jobs/{id}/proof:
 *   get:
 *     operationId: getJobProof
 *     summary: "Proof of pickup or delivery: signature, photos, inspection notes, timestamps"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). What settles a 'this stain wasn't there before' dispute."
 *     tags: ["Dispatch - Jobs & Assignment"]
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
 *                         signature: { type: string }
 *                         receivedBy: { type: string }
 *                         photos: { type: array, items: { type: string, format: uri } }
 *                         inspection:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               itemId: { type: string, format: uuid }
 *                               condition: { type: string, enum: [ok, stain, tear, loose_button, colour_fade, damaged, other] }
 *                               note: { type: string }
 *                         pickedUpAt: { type: string, format: date-time }
 *                         deliveredAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getJobProof = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { scope } = dispatchContext(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchJobService.proof(scope, req.params.id as string) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /jobs/{id}/reassign:
 *   post:
 *     operationId: reassignJob
 *     summary: "Move a job to a different rider"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Jobs & Assignment"]
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
 *             required: [riderId, reason]
 *             properties:
 *               riderId: { type: string, format: uuid }
 *               reason: { type: string }
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
const reassignJob = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { actor, scope } = dispatchContext(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchJobService.reassign(actor, scope, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /jobs/{id}/timeline:
 *   get:
 *     operationId: getJobTimeline
 *     summary: "Everything that happened on a job"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Jobs & Assignment"]
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
 *                         events:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               at: { type: string, format: date-time }
 *                               status: { type: string, enum: [assigned, en_route, arrived, picked_up, at_store, out_for_delivery, delivered, failed, cancelled] }
 *                               by: { type: string }
 *                               note: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getJobTimeline = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { scope } = dispatchContext(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchJobService.timeline(scope, req.params.id as string) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /routes:
 *   get:
 *     operationId: listRoutes
 *     summary: "Route plans"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Jobs & Assignment"]
 *     x-roles: [admin, manager, staff]
 *     parameters:
 *       - in: query
 *         name: riderId
 *         schema: { type: string, format: uuid }
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
 *                         routes:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               riderId: { type: string, format: uuid }
 *                               date: { type: string, format: date }
 *                               stops: { type: integer }
 *                               distanceKm: { type: number }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listRoutes = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { scope } = dispatchContext(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchJobService.listRoutes(scope, req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /routes/optimize:
 *   post:
 *     operationId: optimizeRoute
 *     summary: "Re-plan a rider's route"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Dispatch - Jobs & Assignment"]
 *     x-roles: [admin, manager, staff]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [riderId, date]
 *             properties:
 *               riderId: { type: string, format: uuid }
 *               date: { type: string, format: date }
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
 *                               etaMinutes: { type: integer }
 *                         totalDistanceKm: { type: number }
 *       409:
 *         description: "The request conflicts with the current state."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const optimizeRoute = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { actor, scope } = dispatchContext(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await DispatchJobService.optimizeRoute(actor, scope, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const DispatchJobsController = {
  createJob,
  listJobs,
  autoAssignJobs,
  listUnassignedJobs,
  getJob,
  updateJob,
  assignJob,
  cancelJob,
  getJobProof,
  reassignJob,
  getJobTimeline,
  listRoutes,
  optimizeRoute,
};
