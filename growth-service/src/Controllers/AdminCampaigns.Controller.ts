import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { CampaignService } from "../Services/Campaign.Service.js";
import { NotificationService } from "../Services/Notification.Service.js";
import { actorId } from "./Actor.js";

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
 */
const listCampaigns = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CampaignService.list(req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
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
 */
const createCampaign = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CampaignService.create(actorId(req), req.body);
    return handleSuccessResponse({ statusCode: created, result }, res);
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
 */
const previewCampaignAudience = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CampaignService.previewAudience(req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
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
 */
const getCampaign = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CampaignService.get(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
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
 */
const updateCampaign = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CampaignService.update(req.params.id, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
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
 */
const cancelCampaign = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CampaignService.cancel(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
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
 */
const scheduleCampaign = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CampaignService.schedule(req.params.id, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
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
 *         description: "Progress of this batch. Call again until done is true; each call sends one bounded batch."
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
 *                         status: { type: string, enum: [sending, sent, cancelled] }
 *                         processed: { type: integer }
 *                         delivered: { type: integer }
 *                         failed: { type: integer }
 *                         skipped: { type: integer }
 *                         claimed: { type: integer }
 *                         maxRecipients: { type: integer }
 *                         done: { type: boolean }
 *       409:
 *         description: "The campaign is finished or cancelled, or another batch is running."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const sendCampaign = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CampaignService.send(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
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
 */
const getCampaignStats = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CampaignService.stats(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
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
 */
const listNotificationTemplates = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await NotificationService.listTemplates(req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
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
 */
const createNotificationTemplate = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await NotificationService.createTemplate(req.body);
    return handleSuccessResponse({ statusCode: created, result }, res);
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
 */
const getNotificationTemplate = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await NotificationService.getTemplate(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
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
 */
const updateNotificationTemplate = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await NotificationService.updateTemplate(req.params.id, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
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
 */
const deleteNotificationTemplate = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await NotificationService.deleteTemplate(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
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
 */
const listNotificationLog = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await NotificationService.listLog(req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
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
 */
const getNotificationLogEntry = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await NotificationService.getLogEntry(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
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
 */
const retryNotification = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await NotificationService.retry(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
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
