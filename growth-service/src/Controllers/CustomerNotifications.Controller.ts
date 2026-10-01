import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { NotificationService } from "../Services/Notification.Service.js";
import { actorId } from "./Actor.js";

/**
 * @openapi
 * /me/notification-preferences:
 *   get:
 *     operationId: getMyNotificationPreferences
 *     summary: "How I want to hear about my orders"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Notifications"]
 *     x-roles: [customer]
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
 *                         channels:
 *                           type: object
 *                           properties:
 *                             sms: { type: boolean }
 *                             email: { type: boolean }
 *                             whatsapp: { type: boolean }
 *                             push: { type: boolean }
 *                         language: { type: string }
 *                         quietHours:
 *                           type: object
 *                           properties:
 *                             from: { type: string }
 *                             to: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getMyNotificationPreferences = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await NotificationService.getPreferences(actorId(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/notification-preferences:
 *   put:
 *     operationId: setMyNotificationPreferences
 *     summary: "Choose SMS, email or WhatsApp updates"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Notifications"]
 *     x-roles: [customer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [channels]
 *             properties:
 *               channels:
 *                 type: object
 *                 properties:
 *                   sms: { type: boolean }
 *                   email: { type: boolean }
 *                   whatsapp: { type: boolean }
 *                   push: { type: boolean }
 *               language: { type: string }
 *               quietHours:
 *                 type: object
 *                 properties:
 *                   from: { type: string, description: "HH:MM" }
 *                   to: { type: string, description: "HH:MM" }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const setMyNotificationPreferences = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await NotificationService.setPreferences(actorId(req), req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/notifications:
 *   get:
 *     operationId: listMyNotifications
 *     summary: "My notification inbox"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Notifications"]
 *     x-roles: [customer]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: unread
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
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               title: { type: string }
 *                               body: { type: string }
 *                               channel: { type: string, enum: [sms, email, whatsapp] }
 *                               read: { type: boolean }
 *                               at: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listMyNotifications = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await NotificationService.listMine(actorId(req), req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/notifications/{id}/read:
 *   post:
 *     operationId: markMyNotificationRead
 *     summary: "Mark a notification read"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Notifications"]
 *     x-roles: [customer]
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
const markMyNotificationRead = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await NotificationService.markRead(actorId(req), req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const CustomerNotificationsController = {
  getMyNotificationPreferences,
  setMyNotificationPreferences,
  listMyNotifications,
  markMyNotificationRead,
};
