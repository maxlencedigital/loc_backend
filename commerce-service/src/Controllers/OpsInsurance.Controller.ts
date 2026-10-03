import { Response } from "express";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode, unauthorized } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { OpsClaimService } from "../Services/OpsClaim.Service.js";
import { OpsPolicyService } from "../Services/OpsPolicy.Service.js";

const userOf = (req: IdentifiedRequest): RequestUser => {
  if (!req.user) throw new CustomException("Authentication required.", unauthorized);
  return req.user;
};

/**
 * @openapi
 * /operations/insurance/claims:
 *   post:
 *     operationId: createInsuranceClaim
 *     summary: "Raise a claim"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Insurance & Claims"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [policyId, type, description, incidentDate, claimAmount]
 *             properties:
 *               policyId: { type: string, format: uuid }
 *               type: { type: string }
 *               description: { type: string }
 *               incidentDate: { type: string, format: date }
 *               claimAmount: { type: number, description: "Amount in INR" }
 *               incidentId: { type: string, format: uuid, description: "link the incident that caused it" }
 *               storeId: { type: string, format: uuid }
 *               employeeId: { type: string, format: uuid }
 *               orderId: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The policy is cancelled."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createInsuranceClaim = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await OpsClaimService.create(userOf(req), req.body, req.header("idempotency-key")) }, res, "Claim raised.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/insurance/claims:
 *   get:
 *     operationId: listInsuranceClaims
 *     summary: "Claims"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Insurance & Claims"]
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
 *         schema: { type: string, enum: [raised, submitted, under_review, settled, rejected] }
 *       - in: query
 *         name: policyId
 *         schema: { type: string, format: uuid }
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
 *                               policyId: { type: string, format: uuid }
 *                               status: { type: string, enum: [raised, submitted, under_review, settled, rejected] }
 *                               claimAmount: { type: number, description: "Amount in INR" }
 *                               raisedOn: { type: string, format: date }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listInsuranceClaims = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsClaimService.list(req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/insurance/claims/history:
 *   get:
 *     operationId: getClaimsHistory
 *     summary: "What was claimed, paid and rejected, and how long it took"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Insurance & Claims"]
 *     x-roles: [admin, hr]
 *     parameters:
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
 *                         totalClaimed: { type: number, description: "Amount in INR" }
 *                         totalPaid: { type: number, description: "Amount in INR" }
 *                         rejected: { type: integer }
 *                         averageDaysToSettle: { type: number }
 *                         byType: { type: object }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getClaimsHistory = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsClaimService.history(req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/insurance/claims/{id}:
 *   get:
 *     operationId: getInsuranceClaim
 *     summary: "One claim with its evidence"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Insurance & Claims"]
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
const getInsuranceClaim = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsClaimService.getById(req.params.id as string) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/insurance/claims/{id}:
 *   patch:
 *     operationId: updateInsuranceClaim
 *     summary: "Update a claim's status or insurer reference"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Insurance & Claims"]
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
 *               status: { type: string, enum: [raised, submitted, under_review, settled, rejected] }
 *               insurerReference: { type: string }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The claim cannot make that move, or was changed meanwhile."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateInsuranceClaim = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsClaimService.update(req.params.id as string, userOf(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/insurance/claims/{id}/documents:
 *   post:
 *     operationId: uploadInsuranceClaimDocument
 *     summary: "Attach evidence to a claim"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Insurance & Claims"]
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
 *             required: [url]
 *             properties:
 *               url: { type: string, format: uri, description: "https link to the file, which is kept elsewhere" }
 *               name: { type: string }
 *               contentType: { type: string, example: application/pdf }
 *               sizeBytes: { type: integer }
 *               caption: { type: string }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The claim already holds 20 documents."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const uploadInsuranceClaimDocument = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await OpsClaimService.attachDocument(req.params.id as string, userOf(req), req.body) }, res, "Document attached.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/insurance/claims/{id}/settle:
 *   post:
 *     operationId: settleInsuranceClaim
 *     summary: "Record how the claim ended"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Insurance & Claims"]
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
 *             required: [outcome]
 *             properties:
 *               outcome: { type: string, enum: [paid, partially_paid, rejected] }
 *               amount: { type: number, description: "Amount in INR" }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The claim is not submitted or under review, or was changed meanwhile."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const settleInsuranceClaim = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsClaimService.settle(req.params.id as string, userOf(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/insurance/policies:
 *   get:
 *     operationId: listInsurancePolicies
 *     summary: "List insurance policies"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Insurance & Claims"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [property, equipment, public_liability, rider_vehicle, staff_medical, staff_accident, other] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, expiring, expired, cancelled] }
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
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
 *                               type: { type: string, enum: [property, equipment, public_liability, rider_vehicle, staff_medical, staff_accident, other] }
 *                               insurer: { type: string }
 *                               policyNumber: { type: string }
 *                               coverageAmount: { type: number, description: "Amount in INR" }
 *                               premium: { type: number, description: "Amount in INR" }
 *                               startDate: { type: string, format: date }
 *                               endDate: { type: string, format: date }
 *                               covers: { type: string, description: "what it actually covers" }
 *                               appliesTo:
 *                                 type: object
 *                                 properties:
 *                                   storeIds: { type: array, items: { type: string, format: uuid } }
 *                                   employeeIds: { type: array, items: { type: string, format: uuid } }
 *                               status: { type: string, enum: [active, expiring, expired, cancelled] }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listInsurancePolicies = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsPolicyService.list(userOf(req), resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/insurance/policies:
 *   post:
 *     operationId: createInsurancePolicy
 *     summary: "Create an insurance policy"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Insurance & Claims"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, insurer, policyNumber, startDate, endDate]
 *             properties:
 *               type: { type: string, enum: [property, equipment, public_liability, rider_vehicle, staff_medical, staff_accident, other] }
 *               insurer: { type: string }
 *               policyNumber: { type: string }
 *               coverageAmount: { type: number, description: "Amount in INR" }
 *               premium: { type: number, description: "Amount in INR" }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *               covers: { type: string, description: "what it actually covers" }
 *               appliesTo:
 *                 type: object
 *                 properties:
 *                   storeIds: { type: array, items: { type: string, format: uuid } }
 *                   employeeIds: { type: array, items: { type: string, format: uuid } }
 *               status: { type: string, enum: [active, expiring, expired, cancelled] }
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
 *                         id: { type: string, format: uuid }
 *                         type: { type: string, enum: [property, equipment, public_liability, rider_vehicle, staff_medical, staff_accident, other] }
 *                         insurer: { type: string }
 *                         policyNumber: { type: string }
 *                         coverageAmount: { type: number, description: "Amount in INR" }
 *                         premium: { type: number, description: "Amount in INR" }
 *                         startDate: { type: string, format: date }
 *                         endDate: { type: string, format: date }
 *                         covers: { type: string, description: "what it actually covers" }
 *                         appliesTo:
 *                           type: object
 *                           properties:
 *                             storeIds: { type: array, items: { type: string, format: uuid } }
 *                             employeeIds: { type: array, items: { type: string, format: uuid } }
 *                         status: { type: string, enum: [active, expiring, expired, cancelled] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "This insurer already has a policy with that number."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createInsurancePolicy = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await OpsPolicyService.create(userOf(req), req.body) }, res, "Policy created.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/insurance/policies/{id}:
 *   get:
 *     operationId: getInsurancePolicy
 *     summary: "Get an insurance policy"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Insurance & Claims"]
 *     x-roles: [admin, hr, manager]
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
 *                         type: { type: string, enum: [property, equipment, public_liability, rider_vehicle, staff_medical, staff_accident, other] }
 *                         insurer: { type: string }
 *                         policyNumber: { type: string }
 *                         coverageAmount: { type: number, description: "Amount in INR" }
 *                         premium: { type: number, description: "Amount in INR" }
 *                         startDate: { type: string, format: date }
 *                         endDate: { type: string, format: date }
 *                         covers: { type: string, description: "what it actually covers" }
 *                         appliesTo:
 *                           type: object
 *                           properties:
 *                             storeIds: { type: array, items: { type: string, format: uuid } }
 *                             employeeIds: { type: array, items: { type: string, format: uuid } }
 *                         status: { type: string, enum: [active, expiring, expired, cancelled] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getInsurancePolicy = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsPolicyService.getById(req.params.id as string, userOf(req), resolveStoreScope(req)) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/insurance/policies/{id}:
 *   patch:
 *     operationId: updateInsurancePolicy
 *     summary: "Update an insurance policy"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Insurance & Claims"]
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
 *               type: { type: string, enum: [property, equipment, public_liability, rider_vehicle, staff_medical, staff_accident, other] }
 *               insurer: { type: string }
 *               policyNumber: { type: string }
 *               coverageAmount: { type: number, description: "Amount in INR" }
 *               premium: { type: number, description: "Amount in INR" }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *               covers: { type: string, description: "what it actually covers" }
 *               appliesTo:
 *                 type: object
 *                 properties:
 *                   storeIds: { type: array, items: { type: string, format: uuid } }
 *                   employeeIds: { type: array, items: { type: string, format: uuid } }
 *               status: { type: string, enum: [active, expiring, expired, cancelled] }
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
 *                         type: { type: string, enum: [property, equipment, public_liability, rider_vehicle, staff_medical, staff_accident, other] }
 *                         insurer: { type: string }
 *                         policyNumber: { type: string }
 *                         coverageAmount: { type: number, description: "Amount in INR" }
 *                         premium: { type: number, description: "Amount in INR" }
 *                         startDate: { type: string, format: date }
 *                         endDate: { type: string, format: date }
 *                         covers: { type: string, description: "what it actually covers" }
 *                         appliesTo:
 *                           type: object
 *                           properties:
 *                             storeIds: { type: array, items: { type: string, format: uuid } }
 *                             employeeIds: { type: array, items: { type: string, format: uuid } }
 *                         status: { type: string, enum: [active, expiring, expired, cancelled] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "Duplicate policy number, or the policy is cancelled."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateInsurancePolicy = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsPolicyService.update(req.params.id as string, userOf(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/insurance/policies/{id}/documents:
 *   post:
 *     operationId: uploadInsurancePolicyDocument
 *     summary: "Attach the policy document"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Insurance & Claims"]
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
 *             required: [url]
 *             properties:
 *               url: { type: string, format: uri, description: "https link to the file, which is kept elsewhere" }
 *               name: { type: string }
 *               contentType: { type: string, example: application/pdf }
 *               sizeBytes: { type: integer }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The policy already holds 10 documents."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const uploadInsurancePolicyDocument = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await OpsPolicyService.attachDocument(req.params.id as string, userOf(req), req.body) }, res, "Document attached.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/insurance/policies/{id}/renew:
 *   post:
 *     operationId: renewInsurancePolicy
 *     summary: "Renew a policy"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Insurance & Claims"]
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
 *             required: [newEndDate]
 *             properties:
 *               newEndDate: { type: string, format: date }
 *               premium: { type: number, description: "Amount in INR" }
 *               policyNumber: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The policy is cancelled, changed meanwhile, or the new number is taken."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const renewInsurancePolicy = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsPolicyService.renew(req.params.id as string, userOf(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/insurance/renewals:
 *   get:
 *     operationId: listInsuranceRenewals
 *     summary: "Policies nearing expiry, flagged well before they lapse"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Insurance & Claims"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: withinDays
 *         schema: { type: integer }
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
 *                         renewals:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               policyId: { type: string, format: uuid }
 *                               type: { type: string, enum: [property, equipment, public_liability, rider_vehicle, staff_medical, staff_accident, other] }
 *                               insurer: { type: string }
 *                               endDate: { type: string, format: date }
 *                               daysLeft: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listInsuranceRenewals = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsPolicyService.renewals(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/insurance/riders/{riderId}/cover-status:
 *   get:
 *     operationId: getRiderCoverStatus
 *     summary: "Is this rider's vehicle insurance valid?"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Insurance & Claims"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: path
 *         name: riderId
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
 *                         valid: { type: boolean }
 *                         expiresOn: { type: string, format: date }
 *                         policyNumber: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getRiderCoverStatus = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsPolicyService.riderCoverStatus(req.params.riderId as string, resolveStoreScope(req)) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const OpsInsuranceController = {
  createInsuranceClaim,
  listInsuranceClaims,
  getClaimsHistory,
  getInsuranceClaim,
  updateInsuranceClaim,
  uploadInsuranceClaimDocument,
  settleInsuranceClaim,
  listInsurancePolicies,
  createInsurancePolicy,
  getInsurancePolicy,
  updateInsurancePolicy,
  uploadInsurancePolicyDocument,
  renewInsurancePolicy,
  listInsuranceRenewals,
  getRiderCoverStatus,
};
