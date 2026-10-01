import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { ComplaintService } from "../Services/Complaint.Service.js";
import { FeedbackService } from "../Services/Feedback.Service.js";
import { TicketService } from "../Services/Ticket.Service.js";

const who = (req: IdentifiedRequest) => req.user as RequestUser;
const idempotencyKey = (req: IdentifiedRequest) => req.header("idempotency-key");

/**
 * @openapi
 * /me/complaints:
 *   post:
 *     operationId: raiseMyComplaint
 *     summary: "Raise a complaint against one of my orders"
 *     description: "**Who can call this:** customer. The order must be the caller's own (anyone else's is a 404). Send an Idempotency-Key header to make a retry safe. A second live complaint of the same type on the same order is not created: the caller gets their existing one back (200), or 409 if a store logged it."
 *     tags: ["Customer - Feedback, Complaints & Support"]
 *     x-roles: [customer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, type, description]
 *             properties:
 *               orderId: { type: string, format: uuid }
 *               type: { type: string, enum: [damaged_item, late_delivery, wrong_charge, missing_item, quality, rider_behaviour, other] }
 *               description: { type: string, maxLength: 2000 }
 *               itemId: { type: string, format: uuid, description: "An item of that order" }
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
 *                         orderId: { type: string, format: uuid }
 *                         status: { type: string, enum: [open, assigned, in_progress, resolved, escalated, closed] }
 *       200:
 *         description: "An earlier request or an existing live complaint answered; nothing new was created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Order not found (or not yours)."
 *       409:
 *         description: "A store already logged this complaint type for the order."
 */
const raiseMyComplaint = async (req: IdentifiedRequest, res: Response) => {
  try {
    const outcome = await ComplaintService.raise(who(req), req.body, idempotencyKey(req));
    return handleSuccessResponse(
      { statusCode: outcome.created ? created : successCode, result: outcome.data },
      res,
      outcome.created ? "Complaint raised." : "You already have this complaint open."
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/complaints:
 *   get:
 *     operationId: listMyComplaints
 *     summary: "My complaints and where each has got to"
 *     description: "**Who can call this:** customer. Only the caller's own complaints; newest first."
 *     tags: ["Customer - Feedback, Complaints & Support"]
 *     x-roles: [customer]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, assigned, in_progress, resolved, escalated, closed] }
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
 *                               orderId: { type: string, format: uuid }
 *                               orderRef: { type: string }
 *                               type: { type: string, enum: [damaged_item, late_delivery, wrong_charge, missing_item, quality, rider_behaviour, other] }
 *                               status: { type: string, enum: [open, assigned, in_progress, resolved, escalated, closed] }
 *                               createdAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       400:
 *         description: "Invalid filter."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listMyComplaints = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await ComplaintService.listMine(who(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/complaints/{id}:
 *   get:
 *     operationId: getMyComplaint
 *     summary: "One complaint, who is looking at it and what was decided"
 *     description: "**Who can call this:** customer. Staff-only notes and the reason for escalation are never shown."
 *     tags: ["Customer - Feedback, Complaints & Support"]
 *     x-roles: [customer]
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
 *                         orderId: { type: string, format: uuid }
 *                         type: { type: string }
 *                         description: { type: string }
 *                         status: { type: string, enum: [open, assigned, in_progress, resolved, escalated, closed] }
 *                         assignedTo: { type: string, nullable: true }
 *                         decision: { type: string, nullable: true }
 *                         resolution: { type: string, nullable: true }
 *                         refundAmount: { type: number, nullable: true, description: "Amount in INR" }
 *                         photos: { type: array, items: { type: object } }
 *                         timeline:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               at: { type: string, format: date-time }
 *                               event: { type: string }
 *                               by: { type: string }
 *                               message: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Not found (or not yours)."
 */
const getMyComplaint = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await ComplaintService.getMine(who(req), req.params.id as string) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/complaints/{id}/comments:
 *   post:
 *     operationId: commentOnMyComplaint
 *     summary: "Add a message to my complaint"
 *     description: "**Who can call this:** customer. Writing on a resolved complaint reopens it; a closed one accepts nothing (409)."
 *     tags: ["Customer - Feedback, Complaints & Support"]
 *     x-roles: [customer]
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
 *             required: [message]
 *             properties:
 *               message: { type: string, maxLength: 2000 }
 *     responses:
 *       200:
 *         description: "The complaint as the customer sees it, with the new message."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Not found (or not yours)."
 *       409:
 *         description: "The complaint is closed, or its thread is full."
 */
const commentOnMyComplaint = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ComplaintService.commentMine(who(req), req.params.id as string, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Message added.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/complaints/{id}/photos:
 *   post:
 *     operationId: uploadMyComplaintPhotos
 *     summary: "Attach photo references to a complaint"
 *     description: "**Who can call this:** customer. Deviation from the catalogue, which listed multipart upload. There is no file storage yet, so the app hosts the image and sends https links (at most 5 per call, 10 per complaint). Sending a link again changes nothing."
 *     tags: ["Customer - Feedback, Complaints & Support"]
 *     x-roles: [customer]
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
 *             required: [photos]
 *             properties:
 *               photos:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 5
 *                 items:
 *                   type: object
 *                   required: [url]
 *                   properties:
 *                     url: { type: string, description: "https link to a named host" }
 *                     caption: { type: string, maxLength: 200 }
 *                     contentType: { type: string, enum: [image/jpeg, image/png, image/webp, image/heic] }
 *                     sizeBytes: { type: integer }
 *     responses:
 *       201:
 *         description: "Created. Returns all photos now on the complaint."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Not found (or not yours)."
 *       409:
 *         description: "The complaint is closed or already has 10 photos."
 */
const uploadMyComplaintPhotos = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ComplaintService.addPhotos(who(req), req.params.id as string, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res, "Photos added.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/orders/{id}/feedback:
 *   post:
 *     operationId: submitMyFeedback
 *     summary: "Rate a delivered order, good or bad"
 *     description: "**Who can call this:** customer. Only the caller's own order, and only once it is delivered. One rating per order. A rider rating is attributed to the rider who delivered, when logistics can say who that was."
 *     tags: ["Customer - Feedback, Complaints & Support"]
 *     x-roles: [customer]
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
 *             required: [rating]
 *             properties:
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *               comment: { type: string, maxLength: 1000 }
 *               storeRating: { type: integer, minimum: 1, maximum: 5 }
 *               riderRating: { type: integer, minimum: 1, maximum: 5 }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Order not found (or not yours)."
 *       409:
 *         description: "Feedback was already left for this order, or the order is not delivered yet."
 */
const submitMyFeedback = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await FeedbackService.submit(who(req), req.params.id as string, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res, "Thank you for your feedback.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/orders/{id}/feedback:
 *   get:
 *     operationId: getMyFeedback
 *     summary: "The feedback I left on an order"
 *     description: "**Who can call this:** customer. 404 when the caller left none on that order."
 *     tags: ["Customer - Feedback, Complaints & Support"]
 *     x-roles: [customer]
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
 *                         rating: { type: integer }
 *                         comment: { type: string, nullable: true }
 *                         storeRating: { type: integer, nullable: true }
 *                         riderRating: { type: integer, nullable: true }
 *                         createdAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getMyFeedback = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await FeedbackService.getMine(who(req), req.params.id as string) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/support-tickets:
 *   post:
 *     operationId: openSupportTicket
 *     summary: "Ask for support, without calling anyone"
 *     description: "**Who can call this:** customer. Send an Idempotency-Key header to make a retry safe (a repeat returns the same ticket with 200)."
 *     tags: ["Customer - Feedback, Complaints & Support"]
 *     x-roles: [customer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subject, message]
 *             properties:
 *               subject: { type: string, maxLength: 120 }
 *               message: { type: string, maxLength: 2000 }
 *               orderId: { type: string, format: uuid, description: "One of the caller's own orders" }
 *     responses:
 *       201:
 *         description: "Created. The ticket with its first message."
 *       200:
 *         description: "A retry with the same Idempotency-Key; the original ticket."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Order not found (or not yours)."
 */
const openSupportTicket = async (req: IdentifiedRequest, res: Response) => {
  try {
    const outcome = await TicketService.open(who(req), req.body, idempotencyKey(req));
    return handleSuccessResponse(
      { statusCode: outcome.created ? created : successCode, result: outcome.data },
      res,
      outcome.created ? "Ticket opened." : "Ticket already opened."
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/support-tickets:
 *   get:
 *     operationId: listMySupportTickets
 *     summary: "My support tickets"
 *     description: "**Who can call this:** customer. Only the caller's own tickets, most recently active first."
 *     tags: ["Customer - Feedback, Complaints & Support"]
 *     x-roles: [customer]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, answered, closed] }
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
 *                               subject: { type: string }
 *                               status: { type: string, enum: [open, answered, closed] }
 *                               orderId: { type: string, format: uuid, nullable: true }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       400:
 *         description: "Invalid filter."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listMySupportTickets = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await TicketService.listMine(who(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/support-tickets/{id}:
 *   get:
 *     operationId: getMySupportTicket
 *     summary: "One support ticket and its messages"
 *     description: "**Who can call this:** customer. Only the caller's own ticket."
 *     tags: ["Customer - Feedback, Complaints & Support"]
 *     x-roles: [customer]
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
 *                         subject: { type: string }
 *                         status: { type: string, enum: [open, answered, closed] }
 *                         messages:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               from: { type: string, enum: [customer, support] }
 *                               message: { type: string }
 *                               at: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Not found (or not yours)."
 */
const getMySupportTicket = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await TicketService.getMine(who(req), req.params.id as string) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/support-tickets/{id}/messages:
 *   post:
 *     operationId: replyToMySupportTicket
 *     summary: "Reply on a support ticket"
 *     description: "**Who can call this:** customer. An answered ticket goes back to open; a closed ticket accepts nothing (409)."
 *     tags: ["Customer - Feedback, Complaints & Support"]
 *     x-roles: [customer]
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
 *             required: [message]
 *             properties:
 *               message: { type: string, maxLength: 2000 }
 *     responses:
 *       200:
 *         description: "The ticket with its messages."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Not found (or not yours)."
 *       409:
 *         description: "The ticket is closed, or has reached its message limit."
 */
const replyToMySupportTicket = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await TicketService.replyMine(who(req), req.params.id as string, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Message sent.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const CustomerSupportController = {
  raiseMyComplaint,
  listMyComplaints,
  getMyComplaint,
  commentOnMyComplaint,
  uploadMyComplaintPhotos,
  submitMyFeedback,
  getMyFeedback,
  openSupportTicket,
  listMySupportTickets,
  getMySupportTicket,
  replyToMySupportTicket,
};
