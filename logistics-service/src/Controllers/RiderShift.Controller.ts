import { Response } from "express";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { requestActor } from "../Middleware/StoreScope.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { RiderShiftService } from "../Services/RiderShift.Service.js";

/**
 * @openapi
 * /rider/availability:
 *   put:
 *     operationId: setRiderAvailability
 *     summary: "Mark myself available or unavailable for jobs"
 *     description: "**Who can call this:** driver (super_admin always allowed)."
 *     tags: ["Rider - Shift & Availability"]
 *     x-roles: [driver]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [available]
 *             properties:
 *               available: { type: boolean }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       409:
 *         description: "Not eligible for jobs — for example, vehicle insurance has expired."
 */
const setRiderAvailability = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderShiftService.setAvailability(actor, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/location:
 *   post:
 *     operationId: postRiderLocation
 *     summary: "Send my current location"
 *     description: "**Who can call this:** driver (super_admin always allowed)."
 *     tags: ["Rider - Shift & Availability"]
 *     x-roles: [driver]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [latitude, longitude]
 *             properties:
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               accuracy: { type: number }
 *               speed: { type: number }
 *     responses:
 *       200:
 *         description: "OK."
 *       409:
 *         description: "The request conflicts with the current state."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const postRiderLocation = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderShiftService.postLocation(actor, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/me:
 *   get:
 *     operationId: getRiderProfile
 *     summary: "My rider profile and status"
 *     description: "**Who can call this:** driver (super_admin always allowed)."
 *     tags: ["Rider - Shift & Availability"]
 *     x-roles: [driver]
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
 *                         name: { type: string }
 *                         phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                         vehicleType: { type: string, enum: [bike, scooter, bicycle, ev, other] }
 *                         vehicleNumber: { type: string }
 *                         available: { type: boolean }
 *                         onShift: { type: boolean }
 *                         homeStoreId: { type: string, format: uuid }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getRiderProfile = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderShiftService.profile(actor) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/shift/end:
 *   post:
 *     operationId: endRiderShift
 *     summary: "End my shift"
 *     description: "**Who can call this:** driver (super_admin always allowed)."
 *     tags: ["Rider - Shift & Availability"]
 *     x-roles: [driver]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               odometerKm: { type: number }
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
 *                         distanceKm: { type: number }
 *                         earnings: { type: number, description: "Amount in INR" }
 *       409:
 *         description: "The request conflicts with the current state."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const endRiderShift = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderShiftService.endShift(actor, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/shift/start:
 *   post:
 *     operationId: startRiderShift
 *     summary: "Start my shift"
 *     description: "**Who can call this:** driver (super_admin always allowed)."
 *     tags: ["Rider - Shift & Availability"]
 *     x-roles: [driver]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               vehicleChecked: { type: boolean }
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
 */
const startRiderShift = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderShiftService.startShift(actor, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/shift/summary:
 *   get:
 *     operationId: getRiderShiftSummary
 *     summary: "A summary of a day's shift"
 *     description: "**Who can call this:** driver (super_admin always allowed)."
 *     tags: ["Rider - Shift & Availability"]
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
 *                         jobsCompleted: { type: integer }
 *                         distanceKm: { type: number }
 *                         earnings: { type: number, description: "Amount in INR" }
 *                         hoursOnShift: { type: number }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getRiderShiftSummary = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderShiftService.summary(actor, req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const RiderShiftController = {
  setRiderAvailability,
  postRiderLocation,
  getRiderProfile,
  endRiderShift,
  startRiderShift,
  getRiderShiftSummary,
};
