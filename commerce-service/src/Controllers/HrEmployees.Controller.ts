import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { EmployeeService } from "../Services/Employee.Service.js";
import { EmployeeDocumentService } from "../Services/EmployeeDocument.Service.js";
import { OnboardingService } from "../Services/Onboarding.Service.js";
import { HrSummaryService } from "../Services/HrSummary.Service.js";

/**
 * @openapi
 * /hr/employees:
 *   get:
 *     operationId: listEmployees
 *     summary: "List employees"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Employees & Onboarding"]
 *     x-roles: [admin, hr, manager]
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
 *         name: employeeType
 *         schema: { type: string, enum: [staff, rider, manager, hr, admin] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, on_leave, notice, exited] }
 *       - in: query
 *         name: q
 *         schema: { type: string, description: "name or phone" }
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
 *                               code: { type: string, description: "e.g. EMP-00042" }
 *                               name: { type: string }
 *                               employeeType: { type: string, enum: [staff, rider, manager, hr, admin] }
 *                               phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                               email: { type: string, format: email }
 *                               storeId: { type: string, format: uuid, description: "riders may be unassigned; staff belong to one store" }
 *                               role: { type: string }
 *                               designation: { type: string }
 *                               payGrade: { type: string, description: "HR and admin only" }
 *                               joinDate: { type: string, format: date }
 *                               dateOfBirth: { type: string, format: date }
 *                               address: { type: string }
 *                               emergencyContact:
 *                                 type: object
 *                                 properties:
 *                                   name: { type: string }
 *                                   phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                                   relation: { type: string }
 *                               bankAccount:
 *                                 type: object
 *                                 properties:
 *                                   holderName: { type: string }
 *                                   accountNumber: { type: string, description: "masked to the last four digits unless the caller is HR or admin" }
 *                                   ifsc: { type: string }
 *                               gatewayUserId: { type: string, format: uuid, description: "the login account, once one exists" }
 *                               reportingTo: { type: string, format: uuid }
 *                               status: { type: string, enum: [active, on_leave, notice, exited] }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listEmployees = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EmployeeService.list(resolveStoreScope(req), req.user as RequestUser, req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/employees:
 *   post:
 *     operationId: createEmployee
 *     summary: "Create an employee"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Employees & Onboarding"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, employeeType, phone, role, joinDate]
 *             properties:
 *               name: { type: string }
 *               employeeType: { type: string, enum: [staff, rider, manager, hr, admin] }
 *               phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *               email: { type: string, format: email }
 *               storeId: { type: string, format: uuid, description: "riders may be unassigned; staff belong to one store" }
 *               role: { type: string }
 *               designation: { type: string }
 *               payGrade: { type: string, description: "HR and admin only" }
 *               joinDate: { type: string, format: date }
 *               dateOfBirth: { type: string, format: date }
 *               address: { type: string }
 *               emergencyContact:
 *                 type: object
 *                 properties:
 *                   name: { type: string }
 *                   phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                   relation: { type: string }
 *               bankAccount:
 *                 type: object
 *                 properties:
 *                   holderName: { type: string }
 *                   accountNumber: { type: string, description: "masked to the last four digits unless the caller is HR or admin" }
 *                   ifsc: { type: string }
 *               gatewayUserId: { type: string, format: uuid, description: "the login account, once one exists" }
 *               reportingTo: { type: string, format: uuid }
 *               status: { type: string, enum: [active, on_leave, notice, exited] }
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
 *                         code: { type: string, description: "e.g. EMP-00042" }
 *                         name: { type: string }
 *                         employeeType: { type: string, enum: [staff, rider, manager, hr, admin] }
 *                         phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                         email: { type: string, format: email }
 *                         storeId: { type: string, format: uuid, description: "riders may be unassigned; staff belong to one store" }
 *                         role: { type: string }
 *                         designation: { type: string }
 *                         payGrade: { type: string, description: "HR and admin only" }
 *                         joinDate: { type: string, format: date }
 *                         dateOfBirth: { type: string, format: date }
 *                         address: { type: string }
 *                         emergencyContact:
 *                           type: object
 *                           properties:
 *                             name: { type: string }
 *                             phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                             relation: { type: string }
 *                         bankAccount:
 *                           type: object
 *                           properties:
 *                             holderName: { type: string }
 *                             accountNumber: { type: string, description: "masked to the last four digits unless the caller is HR or admin" }
 *                             ifsc: { type: string }
 *                         gatewayUserId: { type: string, format: uuid, description: "the login account, once one exists" }
 *                         reportingTo: { type: string, format: uuid }
 *                         status: { type: string, enum: [active, on_leave, notice, exited] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "Phone or login account already belongs to another employee."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createEmployee = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await EmployeeService.create(req.user as RequestUser, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/employees/{id}:
 *   get:
 *     operationId: getEmployee
 *     summary: "Get an employee"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Employees & Onboarding"]
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
 *                         code: { type: string, description: "e.g. EMP-00042" }
 *                         name: { type: string }
 *                         employeeType: { type: string, enum: [staff, rider, manager, hr, admin] }
 *                         phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                         email: { type: string, format: email }
 *                         storeId: { type: string, format: uuid, description: "riders may be unassigned; staff belong to one store" }
 *                         role: { type: string }
 *                         designation: { type: string }
 *                         payGrade: { type: string, description: "HR and admin only" }
 *                         joinDate: { type: string, format: date }
 *                         dateOfBirth: { type: string, format: date }
 *                         address: { type: string }
 *                         emergencyContact:
 *                           type: object
 *                           properties:
 *                             name: { type: string }
 *                             phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                             relation: { type: string }
 *                         bankAccount:
 *                           type: object
 *                           properties:
 *                             holderName: { type: string }
 *                             accountNumber: { type: string, description: "masked to the last four digits unless the caller is HR or admin" }
 *                             ifsc: { type: string }
 *                         gatewayUserId: { type: string, format: uuid, description: "the login account, once one exists" }
 *                         reportingTo: { type: string, format: uuid }
 *                         status: { type: string, enum: [active, on_leave, notice, exited] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getEmployee = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EmployeeService.getById(req.params.id, resolveStoreScope(req), req.user as RequestUser) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/employees/{id}:
 *   patch:
 *     operationId: updateEmployee
 *     summary: "Update an employee"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Employees & Onboarding"]
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
 *               name: { type: string }
 *               employeeType: { type: string, enum: [staff, rider, manager, hr, admin] }
 *               phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *               email: { type: string, format: email }
 *               storeId: { type: string, format: uuid, description: "riders may be unassigned; staff belong to one store" }
 *               role: { type: string }
 *               designation: { type: string }
 *               payGrade: { type: string, description: "HR and admin only" }
 *               joinDate: { type: string, format: date }
 *               dateOfBirth: { type: string, format: date }
 *               address: { type: string }
 *               emergencyContact:
 *                 type: object
 *                 properties:
 *                   name: { type: string }
 *                   phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                   relation: { type: string }
 *               bankAccount:
 *                 type: object
 *                 properties:
 *                   holderName: { type: string }
 *                   accountNumber: { type: string, description: "masked to the last four digits unless the caller is HR or admin" }
 *                   ifsc: { type: string }
 *               gatewayUserId: { type: string, format: uuid, description: "the login account, once one exists" }
 *               reportingTo: { type: string, format: uuid }
 *               status: { type: string, enum: [active, on_leave, notice, exited] }
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
 *                         code: { type: string, description: "e.g. EMP-00042" }
 *                         name: { type: string }
 *                         employeeType: { type: string, enum: [staff, rider, manager, hr, admin] }
 *                         phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                         email: { type: string, format: email }
 *                         storeId: { type: string, format: uuid, description: "riders may be unassigned; staff belong to one store" }
 *                         role: { type: string }
 *                         designation: { type: string }
 *                         payGrade: { type: string, description: "HR and admin only" }
 *                         joinDate: { type: string, format: date }
 *                         dateOfBirth: { type: string, format: date }
 *                         address: { type: string }
 *                         emergencyContact:
 *                           type: object
 *                           properties:
 *                             name: { type: string }
 *                             phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                             relation: { type: string }
 *                         bankAccount:
 *                           type: object
 *                           properties:
 *                             holderName: { type: string }
 *                             accountNumber: { type: string, description: "masked to the last four digits unless the caller is HR or admin" }
 *                             ifsc: { type: string }
 *                         gatewayUserId: { type: string, format: uuid, description: "the login account, once one exists" }
 *                         reportingTo: { type: string, format: uuid }
 *                         status: { type: string, enum: [active, on_leave, notice, exited] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "Phone or login account already belongs to another employee."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateEmployee = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EmployeeService.update(req.params.id, resolveStoreScope(req), req.user as RequestUser, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/employees/{id}/deactivate:
 *   post:
 *     operationId: deactivateEmployee
 *     summary: "Record that someone has left"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). Also disables their login where the gateway allows it (loginDisabled in the answer says whether it did). The record is kept."
 *     tags: ["HR - Employees & Onboarding"]
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
 *             required: [lastWorkingDay]
 *             properties:
 *               lastWorkingDay: { type: string, format: date }
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The employee has already left."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const deactivateEmployee = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EmployeeService.deactivate(req.params.id, resolveStoreScope(req), req.user as RequestUser, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/employees/{id}/documents:
 *   post:
 *     operationId: uploadEmployeeDocument
 *     summary: "Add an employee document"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). The service keeps a reference to the stored file (no bytes are uploaded here), so the body is JSON."
 *     tags: ["HR - Employees & Onboarding"]
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
 *             required: [type, fileName, fileUrl]
 *             properties:
 *               type: { type: string, enum: [id_proof, address_proof, contract, certificate, medical, other] }
 *               fileName: { type: string }
 *               fileUrl: { type: string, format: uri, description: "https link to the file in object storage" }
 *               mimeType: { type: string }
 *               sizeBytes: { type: integer }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const uploadEmployeeDocument = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await EmployeeDocumentService.add(req.params.id, resolveStoreScope(req), req.user as RequestUser, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/employees/{id}/documents:
 *   get:
 *     operationId: listEmployeeDocuments
 *     summary: "An employee's documents"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Employees & Onboarding"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
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
 *                               type: { type: string }
 *                               fileName: { type: string }
 *                               uploadedAt: { type: string, format: date-time }
 *                               downloadUrl: { type: string, format: uri }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const listEmployeeDocuments = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EmployeeDocumentService.list(req.params.id, resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/employees/{id}/documents/{docId}:
 *   delete:
 *     operationId: deleteEmployeeDocument
 *     summary: "Remove an employee document"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Employees & Onboarding"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: docId
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
const deleteEmployeeDocument = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EmployeeDocumentService.remove(req.params.id, req.params.docId, resolveStoreScope(req)) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/employees/{id}/onboarding:
 *   get:
 *     operationId: getEmployeeOnboarding
 *     summary: "What a new joiner has been given, shown and still needs"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Employees & Onboarding"]
 *     x-roles: [admin, hr]
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
 *                         completionPct: { type: number }
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               title: { type: string }
 *                               category: { type: string, enum: [documents, equipment, access, training, induction] }
 *                               status: { type: string, enum: [pending, given, shown, done] }
 *                               doneAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getEmployeeOnboarding = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OnboardingService.getForEmployee(req.params.id, resolveStoreScope(req)) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/employees/{id}/onboarding/items/{itemId}:
 *   patch:
 *     operationId: updateOnboardingItem
 *     summary: "Tick off an induction item"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Employees & Onboarding"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [pending, given, shown, done] }
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
 */
const updateOnboardingItem = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OnboardingService.updateItem(req.params.id, req.params.itemId, resolveStoreScope(req), req.user as RequestUser, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/employees/{id}/reactivate:
 *   post:
 *     operationId: reactivateEmployee
 *     summary: "Bring a former employee back"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Employees & Onboarding"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       409:
 *         description: "The employee has not left."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const reactivateEmployee = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EmployeeService.reactivate(req.params.id, resolveStoreScope(req), req.user as RequestUser) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/onboarding/templates/{role}:
 *   get:
 *     operationId: getOnboardingTemplate
 *     summary: "The induction checklist for a role"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Employees & Onboarding"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: path
 *         name: role
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
 *                         role: { type: string }
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               title: { type: string }
 *                               category: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getOnboardingTemplate = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OnboardingService.getTemplate(req.params.role) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/onboarding/templates/{role}:
 *   put:
 *     operationId: setOnboardingTemplate
 *     summary: "Define the induction checklist for a role"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Employees & Onboarding"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: path
 *         name: role
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [title]
 *                   properties:
 *                     title: { type: string }
 *                     category: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const setOnboardingTemplate = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OnboardingService.setTemplate(req.params.role, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/summary:
 *   get:
 *     operationId: getHrSummary
 *     summary: "Headcount, attendance, leave, grievances and overdue training in one view"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Employees & Onboarding"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
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
 *                         headcount: { type: integer }
 *                         presentToday: { type: integer }
 *                         onLeave: { type: integer }
 *                         absentToday: { type: integer }
 *                         openGrievances: { type: integer }
 *                         overdueTraining: { type: integer }
 *                         pendingLeaveRequests: { type: integer }
 *                         byType: { type: object, additionalProperties: { type: integer } }
 *                         byStatus: { type: object, additionalProperties: { type: integer } }
 *                         byStore: { type: object, additionalProperties: { type: integer }, description: "only when the view is not limited to one store" }
 *                         exitsLast90Days: { type: integer }
 *                         attritionRate90dPct: { type: number }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getHrSummary = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await HrSummaryService.getSummary(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const HrEmployeesController = {
  listEmployees,
  createEmployee,
  getEmployee,
  updateEmployee,
  deactivateEmployee,
  uploadEmployeeDocument,
  listEmployeeDocuments,
  deleteEmployeeDocument,
  getEmployeeOnboarding,
  updateOnboardingItem,
  reactivateEmployee,
  getOnboardingTemplate,
  setOnboardingTemplate,
  getHrSummary,
};
