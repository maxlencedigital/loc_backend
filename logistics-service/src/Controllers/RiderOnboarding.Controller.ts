import { Request, Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { RiderOnboardingService } from "../Services/RiderOnboarding.Service.js";

/**
 * @openapi
 * /public/rider-application-status:
 *   get:
 *     operationId: getRiderApplicationStatus
 *     summary: "Check where an application has got to"
 *     description: "**Public** — no token required."
 *     tags: ["Rider - Onboarding"]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: applicationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: phone
 *         required: true
 *         schema: { type: string, description: "E.164 phone number, e.g. +919876543210" }
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
 *                         status: { type: string, enum: [submitted, documents_requested, under_review, approved, rejected] }
 *                         message: { type: string }
 *                         missingDocuments: { type: array, items: { type: string } }
 */
const getRiderApplicationStatus = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderOnboardingService.status(req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /public/rider-applications:
 *   post:
 *     operationId: submitRiderApplication
 *     summary: "Apply to become a rider"
 *     description: "**Public** — no token required. No account exists yet; HR reviews the application before any access is granted."
 *     tags: ["Rider - Onboarding"]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone, city, vehicleType, vehicleNumber, drivingLicenceNumber, idType, idNumber]
 *             properties:
 *               name: { type: string }
 *               phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *               email: { type: string, format: email }
 *               city: { type: string }
 *               vehicleType: { type: string, enum: [bike, scooter, bicycle, ev, other] }
 *               vehicleNumber: { type: string }
 *               drivingLicenceNumber: { type: string }
 *               idType: { type: string, enum: [aadhaar, pan, driving_licence, voter_id] }
 *               idNumber: { type: string }
 *               preferredStoreId: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: "Created."
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
 *                         applicationId: { type: string, format: uuid }
 *                         uploadToken: { type: string, description: "needed to upload documents" }
 *                         status: { type: string, enum: [submitted, documents_requested, under_review, approved, rejected] }
 *       409:
 *         description: "The request conflicts with the current state."
 *       400:
 *         description: "Missing or invalid fields."
 */
const submitRiderApplication = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: created, result: await RiderOnboardingService.submit(req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /public/rider-applications/{id}/documents:
 *   post:
 *     operationId: uploadRiderApplicationDocument
 *     summary: "Upload a document for an application"
 *     description: "**Public** — no token required. Send JSON with an https link to the already-uploaded file; logistics has no file storage of its own."
 *     tags: ["Rider - Onboarding"]
 *     security: []
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
 *             required: [uploadToken, type, fileUrl]
 *             properties:
 *               uploadToken: { type: string }
 *               type: { type: string, enum: [id_proof, licence, vehicle_rc, insurance, photo] }
 *               fileUrl: { type: string, format: uri, description: "https link to the uploaded file" }
 *     responses:
 *       201:
 *         description: "Created."
 *       409:
 *         description: "The request conflicts with the current state."
 *       400:
 *         description: "Missing or invalid fields."
 *       404:
 *         description: Not found.
 */
const uploadRiderApplicationDocument = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: created, result: await RiderOnboardingService.uploadDocument(req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const RiderOnboardingController = {
  getRiderApplicationStatus,
  submitRiderApplication,
  uploadRiderApplicationDocument,
};
