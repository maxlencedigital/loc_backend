import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { AuditService } from "../Services/Audit.Service.js";

/**
 * @openapi
 * /operations/audits:
 *   post:
 *     operationId: createAudit
 *     summary: "Schedule an audit"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Audits"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, title, scheduledFor]
 *             properties:
 *               type: { type: string, enum: [internal, external] }
 *               title: { type: string }
 *               scheduledFor: { type: string, format: date }
 *               scope: { type: string }
 *               auditor: { type: string }
 *               storeId: { type: string, format: uuid }
 *               checklist: { type: array, items: { type: object, required: [title], properties: { title: { type: string }, result: { type: string, enum: [pass, fail, na] }, note: { type: string }, evidence: { type: array, items: { type: object, properties: { url: { type: string }, name: { type: string } } } } } } }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createAudit = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as RequestUser;
    const result = await AuditService.create(scope, user, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res, "Audit scheduled.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/audits:
 *   get:
 *     operationId: listAudits
 *     summary: "Audits, planned and done"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Audits"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [scheduled, in_progress, completed, cancelled] }
 *       - in: query
 *         name: type
 *         schema: { type: string }
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
 *                               type: { type: string }
 *                               title: { type: string }
 *                               scheduledFor: { type: string, format: date }
 *                               status: { type: string }
 *                               openFindings: { type: integer }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listAudits = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await AuditService.list(scope, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/audits/evidence:
 *   get:
 *     operationId: getAuditEvidence
 *     summary: "Answer an auditor's question from the system's own record of who did what"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Audits"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: userId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: entity
 *         schema: { type: string }
 *       - in: query
 *         name: action
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
 *                         generatedAt: { type: string, format: date-time }
 *                         entries:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               at: { type: string, format: date-time }
 *                               userId: { type: string, format: uuid }
 *                               action: { type: string }
 *                               entity: { type: string }
 *                               entityId: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getAuditEvidence = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await AuditService.evidence(scope, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/audits/findings/open:
 *   get:
 *     operationId: listOpenAuditFindings
 *     summary: "Findings still open, visible to management until fixed"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Audits"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: severity
 *         schema: { type: string, enum: [low, medium, high, critical] }
 *       - in: query
 *         name: ownerId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: overdue
 *         schema: { type: boolean }
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
 *                         findings:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               auditId: { type: string, format: uuid }
 *                               title: { type: string }
 *                               severity: { type: string, enum: [low, medium, high, critical] }
 *                               ownerId: { type: string, format: uuid }
 *                               dueDate: { type: string, format: date }
 *                               daysOverdue: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listOpenAuditFindings = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await AuditService.listOpenFindings(scope, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/audits/findings/{findingId}:
 *   patch:
 *     operationId: updateAuditFinding
 *     summary: "Set the owner, due date or status of a finding"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Audits"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: path
 *         name: findingId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ownerId: { type: string, format: uuid }
 *               dueDate: { type: string, format: date }
 *               status: { type: string, enum: [open, in_progress, closed] }
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
const updateAuditFinding = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as RequestUser;
    const result = await AuditService.updateFinding(req.params.findingId, scope, user, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/audits/findings/{findingId}/close:
 *   post:
 *     operationId: closeAuditFinding
 *     summary: "Close a finding once the corrective action is actually done"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Audits"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: path
 *         name: findingId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [correctiveAction]
 *             properties:
 *               correctiveAction: { type: string }
 *               evidence: { type: string }
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
const closeAuditFinding = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as RequestUser;
    const result = await AuditService.closeFinding(req.params.findingId, scope, user, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/audits/{id}:
 *   get:
 *     operationId: getAudit
 *     summary: "One audit"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Audits"]
 *     x-roles: [admin, hr, manager]
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
const getAudit = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await AuditService.getById(req.params.id, scope);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/audits/{id}:
 *   patch:
 *     operationId: updateAudit
 *     summary: "Change an audit's plan"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Audits"]
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
 *               title: { type: string }
 *               scheduledFor: { type: string, format: date }
 *               scope: { type: string }
 *               auditor: { type: string }
 *               checklist: { type: array, items: { type: object } }
 *               status: { type: string, enum: [cancelled], description: "Only cancelled is accepted here, with cancelReason." }
 *               cancelReason: { type: string }
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
const updateAudit = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as RequestUser;
    const result = await AuditService.update(req.params.id, scope, user, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/audits/{id}/complete:
 *   post:
 *     operationId: completeAudit
 *     summary: "Finish the audit"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Audits"]
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
 *               summary: { type: string }
 *               waiveCriticalReason: { type: string, description: "Completes the audit although critical findings are open; stored." }
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
const completeAudit = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as RequestUser;
    const result = await AuditService.complete(req.params.id, scope, user, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/audits/{id}/findings:
 *   post:
 *     operationId: createAuditFinding
 *     summary: "Record a finding"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Audits"]
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
 *             required: [title, severity]
 *             properties:
 *               title: { type: string }
 *               severity: { type: string, enum: [low, medium, high, critical] }
 *               description: { type: string }
 *               ownerId: { type: string, format: uuid }
 *               dueDate: { type: string, format: date }
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
const createAuditFinding = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as RequestUser;
    const result = await AuditService.createFinding(req.params.id, scope, user, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res, "Finding recorded.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/audits/{id}/findings:
 *   get:
 *     operationId: listAuditFindings
 *     summary: "An audit's findings"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Audits"]
 *     x-roles: [admin, hr, manager]
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
 *                               title: { type: string }
 *                               severity: { type: string, enum: [low, medium, high, critical] }
 *                               status: { type: string }
 *                               ownerId: { type: string, format: uuid }
 *                               dueDate: { type: string, format: date }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const listAuditFindings = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await AuditService.listFindings(req.params.id, scope, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/audits/{id}/start:
 *   post:
 *     operationId: startAudit
 *     summary: "Begin the audit"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Audits"]
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
const startAudit = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as RequestUser;
    const result = await AuditService.start(req.params.id, scope, user);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const OpsAuditsController = {
  createAudit,
  listAudits,
  getAuditEvidence,
  listOpenAuditFindings,
  updateAuditFinding,
  closeAuditFinding,
  getAudit,
  updateAudit,
  completeAudit,
  createAuditFinding,
  listAuditFindings,
  startAudit,
};
