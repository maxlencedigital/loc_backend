// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import { Request, Response } from "express";
import { handleErrorResponse, handleNotImplementedResponse } from "../../commons/Response/Response.js";
import { requireFields } from "../../commons/Utils/Validation.js";

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
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const getRiderApplicationStatus = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
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
 *       400:
 *         description: "Missing or invalid fields."
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const submitRiderApplication = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["name", "phone", "city", "vehicleType", "vehicleNumber", "drivingLicenceNumber", "idType", "idNumber"]);
    return handleNotImplementedResponse(res);
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
 *     description: "**Public** — no token required. Multipart."
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [uploadToken, type, file]
 *             properties:
 *               uploadToken: { type: string }
 *               type: { type: string, enum: [id_proof, licence, vehicle_rc, insurance, photo] }
 *               file: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const uploadRiderApplicationDocument = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const RiderOnboardingController = {
  getRiderApplicationStatus,
  submitRiderApplication,
  uploadRiderApplicationDocument,
};
