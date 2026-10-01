import { Response } from "express";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { requestActor } from "../Middleware/StoreScope.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { HrRiderService } from "../Services/HrRider.Service.js";

/**
 * @openapi
 * /rider-applications:
 *   get:
 *     operationId: listRiderApplications
 *     summary: "Rider applications to review"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Rider Management"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [submitted, documents_requested, under_review, approved, rejected] }
 *       - in: query
 *         name: city
 *         schema: { type: string }
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
 *                               name: { type: string }
 *                               phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                               city: { type: string }
 *                               vehicleType: { type: string, enum: [bike, scooter, bicycle, ev, other] }
 *                               status: { type: string, enum: [submitted, documents_requested, under_review, approved, rejected] }
 *                               submittedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listRiderApplications = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await HrRiderService.listApplications(req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider-applications/{id}:
 *   get:
 *     operationId: getRiderApplication
 *     summary: "One application with its documents"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Rider Management"]
 *     x-roles: [admin, hr]
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
const getRiderApplication = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await HrRiderService.getApplication(req.params.id as string) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider-applications/{id}/approve:
 *   post:
 *     operationId: approveRiderApplication
 *     summary: "Approve: the account becomes active"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). Riders never get access automatically. Creates the login and the employee record."
 *     tags: ["HR - Rider Management"]
 *     x-roles: [admin, hr]
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
 *               storeId: { type: string, format: uuid }
 *               notes: { type: string }
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
 *                         riderId: { type: string, format: uuid }
 *                         loginCreated: { type: boolean }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "Verification is incomplete."
 */
const approveRiderApplication = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await HrRiderService.approve(actor, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider-applications/{id}/reject:
 *   post:
 *     operationId: rejectRiderApplication
 *     summary: "Reject an application"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Rider Management"]
 *     x-roles: [admin, hr]
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
const rejectRiderApplication = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await HrRiderService.reject(actor, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider-applications/{id}/request-documents:
 *   post:
 *     operationId: requestRiderDocuments
 *     summary: "Ask the applicant for missing documents"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Rider Management"]
 *     x-roles: [admin, hr]
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
 *             required: [documents]
 *             properties:
 *               documents: { type: array, items: { type: string } }
 *               message: { type: string }
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
const requestRiderDocuments = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await HrRiderService.requestDocuments(actor, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider-applications/{id}/verify:
 *   post:
 *     operationId: verifyRiderApplication
 *     summary: "Record what was verified: identity, vehicle and insurance"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Rider Management"]
 *     x-roles: [admin, hr]
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
 *             required: [identityVerified, vehicleVerified, insuranceValid]
 *             properties:
 *               identityVerified: { type: boolean }
 *               vehicleVerified: { type: boolean }
 *               insuranceValid: { type: boolean }
 *               insuranceExpiry: { type: string, format: date }
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
const verifyRiderApplication = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await HrRiderService.verify(actor, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider-performance:
 *   get:
 *     operationId: listRiderPerformance
 *     summary: "How every rider is doing, side by side"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Rider Management"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: period
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
 *                         riders:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               riderId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               jobsCompleted: { type: integer }
 *                               onTimePct: { type: number }
 *                               avgRating: { type: number }
 *                               distanceKm: { type: number }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listRiderPerformance = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await HrRiderService.listPerformance(req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /riders/{id}/eligibility:
 *   get:
 *     operationId: getRiderEligibility
 *     summary: "May this rider be given jobs?"
 *     description: "**Who can call this:** admin, hr, manager, staff (super_admin always allowed). A rider whose vehicle insurance has expired is blocked before it becomes the business's problem."
 *     tags: ["HR - Rider Management"]
 *     x-roles: [admin, hr, manager, staff]
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
 *                         eligible: { type: boolean }
 *                         blockers:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               code: { type: string }
 *                               message: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getRiderEligibility = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await HrRiderService.eligibility(req.params.id as string) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /riders/{id}/performance:
 *   get:
 *     operationId: getRiderPerformance
 *     summary: "One rider's performance over time"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Rider Management"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
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
 *                         jobsCompleted: { type: integer }
 *                         avgTimeMinutes: { type: number }
 *                         distanceKm: { type: number }
 *                         onTimePct: { type: number }
 *                         avgRating: { type: number }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getRiderPerformance = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await HrRiderService.getPerformance(req.params.id as string, req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /riders/{id}/reinstate:
 *   post:
 *     operationId: reinstateRider
 *     summary: "Let a suspended rider work again"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Rider Management"]
 *     x-roles: [admin, hr]
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
 *               note: { type: string }
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
const reinstateRider = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await HrRiderService.reinstate(actor, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /riders/{id}/suspend:
 *   post:
 *     operationId: suspendRider
 *     summary: "Stop giving a rider jobs"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Rider Management"]
 *     x-roles: [admin, hr]
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
const suspendRider = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await HrRiderService.suspend(actor, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const HrRidersController = {
  listRiderApplications,
  getRiderApplication,
  approveRiderApplication,
  rejectRiderApplication,
  requestRiderDocuments,
  verifyRiderApplication,
  listRiderPerformance,
  getRiderEligibility,
  getRiderPerformance,
  reinstateRider,
  suspendRider,
};
