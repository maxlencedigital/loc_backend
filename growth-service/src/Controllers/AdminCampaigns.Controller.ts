// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import { Request, Response } from "express";
import { handleErrorResponse, handleNotImplementedResponse } from "../../commons/Response/Response.js";
import { requireFields } from "../../commons/Utils/Validation.js";

/**
 * @openapi
 * /campaigns:
 *   get:
 *     operationId: listCampaigns
 *     summary: "List campaigns"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Campaigns & Notifications"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, scheduled, sending, sent, cancelled] }
 *       - in: query
 *         name: channel
 *         schema: { type: string, enum: [sms, email, whatsapp] }
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
 *                               channel: { type: string, enum: [sms, email, whatsapp] }
 *                               audience:
 *                                 type: object
 *                                 properties:
 *                                   segment: { type: string }
 *                                   storeIds: { type: array, items: { type: string, format: uuid } }
 *                                   minOrders: { type: integer }
 *                                   inactiveDays: { type: integer }
 *                               templateId: { type: string, format: uuid }
 *                               message: { type: string }
 *                               scheduledAt: { type: string, format: date-time }
 *                               status: { type: string, enum: [draft, scheduled, sending, sent, cancelled] }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const listCampaigns = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /campaigns:
 *   post:
 *     operationId: createCampaign
 *     summary: "Create a campaign"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Campaigns & Notifications"]
 *     x-roles: [admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, channel, audience]
 *             properties:
 *               name: { type: string }
 *               channel: { type: string, enum: [sms, email, whatsapp] }
 *               audience:
 *                 type: object
 *                 properties:
 *                   segment: { type: string }
 *                   storeIds: { type: array, items: { type: string, format: uuid } }
 *                   minOrders: { type: integer }
 *                   inactiveDays: { type: integer }
 *               templateId: { type: string, format: uuid }
 *               message: { type: string }
 *               scheduledAt: { type: string, format: date-time }
 *               status: { type: string, enum: [draft, scheduled, sending, sent, cancelled] }
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
 *                         name: { type: string }
 *                         channel: { type: string, enum: [sms, email, whatsapp] }
 *                         audience:
 *                           type: object
 *                           properties:
 *                             segment: { type: string }
 *                             storeIds: { type: array, items: { type: string, format: uuid } }
 *                             minOrders: { type: integer }
 *                             inactiveDays: { type: integer }
 *                         templateId: { type: string, format: uuid }
 *                         message: { type: string }
 *                         scheduledAt: { type: string, format: date-time }
 *                         status: { type: string, enum: [draft, scheduled, sending, sent, cancelled] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const createCampaign = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["name", "channel", "audience"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /campaigns/audience-preview:
 *   post:
 *     operationId: previewCampaignAudience
 *     summary: "How many people would this reach?"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Campaigns & Notifications"]
 *     x-roles: [admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [audience]
 *             properties:
 *               audience:
 *                 type: object
 *                 properties:
 *                   segment: { type: string }
 *                   storeIds: { type: array, items: { type: string, format: uuid } }
 *                   minOrders: { type: integer }
 *                   inactiveDays: { type: integer }
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
 *                         count: { type: integer }
 *                         sample:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               customerId: { type: string, format: uuid }
 *                               name: { type: string }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const previewCampaignAudience = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["audience"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /campaigns/{id}:
 *   get:
 *     operationId: getCampaign
 *     summary: "Get a campaign"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Campaigns & Notifications"]
 *     x-roles: [admin]
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
 *                         name: { type: string }
 *                         channel: { type: string, enum: [sms, email, whatsapp] }
 *                         audience:
 *                           type: object
 *                           properties:
 *                             segment: { type: string }
 *                             storeIds: { type: array, items: { type: string, format: uuid } }
 *                             minOrders: { type: integer }
 *                             inactiveDays: { type: integer }
 *                         templateId: { type: string, format: uuid }
 *                         message: { type: string }
 *                         scheduledAt: { type: string, format: date-time }
 *                         status: { type: string, enum: [draft, scheduled, sending, sent, cancelled] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const getCampaign = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /campaigns/{id}:
 *   patch:
 *     operationId: updateCampaign
 *     summary: "Update a campaign"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Campaigns & Notifications"]
 *     x-roles: [admin]
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
 *               channel: { type: string, enum: [sms, email, whatsapp] }
 *               audience:
 *                 type: object
 *                 properties:
 *                   segment: { type: string }
 *                   storeIds: { type: array, items: { type: string, format: uuid } }
 *                   minOrders: { type: integer }
 *                   inactiveDays: { type: integer }
 *               templateId: { type: string, format: uuid }
 *               message: { type: string }
 *               scheduledAt: { type: string, format: date-time }
 *               status: { type: string, enum: [draft, scheduled, sending, sent, cancelled] }
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
 *                         channel: { type: string, enum: [sms, email, whatsapp] }
 *                         audience:
 *                           type: object
 *                           properties:
 *                             segment: { type: string }
 *                             storeIds: { type: array, items: { type: string, format: uuid } }
 *                             minOrders: { type: integer }
 *                             inactiveDays: { type: integer }
 *                         templateId: { type: string, format: uuid }
 *                         message: { type: string }
 *                         scheduledAt: { type: string, format: date-time }
 *                         status: { type: string, enum: [draft, scheduled, sending, sent, cancelled] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const updateCampaign = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /campaigns/{id}/cancel:
 *   post:
 *     operationId: cancelCampaign
 *     summary: "Cancel a scheduled campaign"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Campaigns & Notifications"]
 *     x-roles: [admin]
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
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const cancelCampaign = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /campaigns/{id}/schedule:
 *   post:
 *     operationId: scheduleCampaign
 *     summary: "Schedule a campaign"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Campaigns & Notifications"]
 *     x-roles: [admin]
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
 *             required: [scheduledAt]
 *             properties:
 *               scheduledAt: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const scheduleCampaign = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["scheduledAt"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /campaigns/{id}/send:
 *   post:
 *     operationId: sendCampaign
 *     summary: "Send a campaign now"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Campaigns & Notifications"]
 *     x-roles: [admin]
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
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const sendCampaign = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /campaigns/{id}/stats:
 *   get:
 *     operationId: getCampaignStats
 *     summary: "How a campaign performed"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Campaigns & Notifications"]
 *     x-roles: [admin]
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
 *                         sent: { type: integer }
 *                         delivered: { type: integer }
 *                         failed: { type: integer }
 *                         opened: { type: integer }
 *                         clicked: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const getCampaignStats = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /notification-templates:
 *   get:
 *     operationId: listNotificationTemplates
 *     summary: "List notification templates"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Campaigns & Notifications"]
 *     x-roles: [admin]
 *     parameters:
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
 *                               name: { type: string }
 *                               channel: { type: string, enum: [sms, email, whatsapp] }
 *                               body: { type: string }
 *                               variables: { type: array, items: { type: string } }
 *                               language: { type: string }
 *                               isActive: { type: boolean }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const listNotificationTemplates = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /notification-templates:
 *   post:
 *     operationId: createNotificationTemplate
 *     summary: "Create a notification template"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Campaigns & Notifications"]
 *     x-roles: [admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, channel, body]
 *             properties:
 *               name: { type: string }
 *               channel: { type: string, enum: [sms, email, whatsapp] }
 *               body: { type: string }
 *               variables: { type: array, items: { type: string } }
 *               language: { type: string }
 *               isActive: { type: boolean }
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
 *                         name: { type: string }
 *                         channel: { type: string, enum: [sms, email, whatsapp] }
 *                         body: { type: string }
 *                         variables: { type: array, items: { type: string } }
 *                         language: { type: string }
 *                         isActive: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const createNotificationTemplate = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["name", "channel", "body"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /notification-templates/{id}:
 *   get:
 *     operationId: getNotificationTemplate
 *     summary: "Get a notification template"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Campaigns & Notifications"]
 *     x-roles: [admin]
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
 *                         name: { type: string }
 *                         channel: { type: string, enum: [sms, email, whatsapp] }
 *                         body: { type: string }
 *                         variables: { type: array, items: { type: string } }
 *                         language: { type: string }
 *                         isActive: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const getNotificationTemplate = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /notification-templates/{id}:
 *   patch:
 *     operationId: updateNotificationTemplate
 *     summary: "Update a notification template"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Campaigns & Notifications"]
 *     x-roles: [admin]
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
 *               channel: { type: string, enum: [sms, email, whatsapp] }
 *               body: { type: string }
 *               variables: { type: array, items: { type: string } }
 *               language: { type: string }
 *               isActive: { type: boolean }
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
 *                         channel: { type: string, enum: [sms, email, whatsapp] }
 *                         body: { type: string }
 *                         variables: { type: array, items: { type: string } }
 *                         language: { type: string }
 *                         isActive: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const updateNotificationTemplate = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /notification-templates/{id}:
 *   delete:
 *     operationId: deleteNotificationTemplate
 *     summary: "Delete a notification template"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Campaigns & Notifications"]
 *     x-roles: [admin]
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
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const deleteNotificationTemplate = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /notifications:
 *   get:
 *     operationId: listNotificationLog
 *     summary: "Every notification sent, and whether it arrived"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Campaigns & Notifications"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: channel
 *         schema: { type: string, enum: [sms, email, whatsapp] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [queued, sent, failed] }
 *       - in: query
 *         name: customerId
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
 *                               customerId: { type: string, format: uuid }
 *                               channel: { type: string, enum: [sms, email, whatsapp] }
 *                               status: { type: string }
 *                               sentAt: { type: string, format: date-time }
 *                               error: { type: string }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const listNotificationLog = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /notifications/{id}:
 *   get:
 *     operationId: getNotificationLogEntry
 *     summary: "One notification"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Campaigns & Notifications"]
 *     x-roles: [admin]
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
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const getNotificationLogEntry = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /notifications/{id}/retry:
 *   post:
 *     operationId: retryNotification
 *     summary: "Try a failed notification again"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Campaigns & Notifications"]
 *     x-roles: [admin]
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
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const retryNotification = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AdminCampaignsController = {
  listCampaigns,
  createCampaign,
  previewCampaignAudience,
  getCampaign,
  updateCampaign,
  cancelCampaign,
  scheduleCampaign,
  sendCampaign,
  getCampaignStats,
  listNotificationTemplates,
  createNotificationTemplate,
  getNotificationTemplate,
  updateNotificationTemplate,
  deleteNotificationTemplate,
  listNotificationLog,
  getNotificationLogEntry,
  retryNotification,
};
