import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { CustomerOrderingService } from "../Services/CustomerOrdering.Service.js";

/**
 * @openapi
 * /me/care-questions:
 *   get:
 *     operationId: getCareQuestions
 *     summary: "The opening care questions (normally one Yes/No: anything delicate?)"
 *     description: "**Who can call this:** customer (super_admin always allowed). Always selections and taps, never typing."
 *     tags: ["Customer - Ordering"]
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
 *                         questions:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string }
 *                               text: { type: string }
 *                               type: { type: string, enum: [yes_no, single_choice, multi_choice] }
 *                               options: { type: array, items: { type: string } }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getCareQuestions = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerOrderingService.getCareQuestions(user);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Care questions.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/care-questions/evaluate:
 *   post:
 *     operationId: evaluateCareAnswers
 *     summary: "Send the answers so far; get any follow-up questions"
 *     description: "**Who can call this:** customer (super_admin always allowed). A normal order ends after the first answer. Follow-ups appear only when something needs special care."
 *     tags: ["Customer - Ordering"]
 *     x-roles: [customer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [answers]
 *             properties:
 *               answers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [questionId, answer]
 *                   properties:
 *                     questionId: { type: string }
 *                     answer: { type: string, description: "a selected option, never free text" }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [garmentTypeId, serviceId]
 *                   properties:
 *                     garmentTypeId: { type: string, format: uuid }
 *                     serviceId: { type: string, format: uuid }
 *                     quantity: { type: integer, description: "pieces, for per-piece services" }
 *                     weightKg: { type: number, description: "kilograms, for by-weight services" }
 *                     fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *                     note: { type: string }
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
 *                         followUps:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string }
 *                               text: { type: string }
 *                               type: { type: string }
 *                               options: { type: array, items: { type: string } }
 *                         flags:
 *                           type: object
 *                           properties:
 *                             delicate: { type: boolean }
 *                             coldWash: { type: boolean }
 *                             handWash: { type: boolean }
 *                         offerPhotoAndNote: { type: boolean, description: "premium or delicate items may optionally add a photo or note" }
 *                         complete: { type: boolean }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const evaluateCareAnswers = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerOrderingService.evaluateCareAnswers(user, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Care answers evaluated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/catalog:
 *   get:
 *     operationId: getMyCatalog
 *     summary: "What can I order here? Categories, services and prices for my address"
 *     description: "**Who can call this:** customer (super_admin always allowed). Prices already reflect the global price list plus any store override. The store is the optional storeId, else a live store in the address city, else the first live store. Garment types are derived from the price lists. Extras beyond the contract are services[].unit and prices[].expressPrice."
 *     tags: ["Customer - Ordering"]
 *     x-roles: [customer]
 *     parameters:
 *       - in: query
 *         name: addressId
 *         required: true
 *         schema: { type: string, format: uuid, description: "one of my addresses; resolves the store and any local pricing" }
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid, description: "optional live store; default is chosen from the address" }
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
 *                         store:
 *                           type: object
 *                           properties:
 *                             id: { type: string, format: uuid }
 *                             name: { type: string }
 *                         categories:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               name: { type: string, description: "men's, women's, kids', household" }
 *                               garmentTypes:
 *                                 type: array
 *                                 items:
 *                                   type: object
 *                                   properties:
 *                                     id: { type: string, format: uuid }
 *                                     name: { type: string }
 *                                     unit: { type: string, enum: [piece, kg] }
 *                         services:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               name: { type: string }
 *                               turnaroundHours: { type: integer }
 *                               expressAvailable: { type: boolean }
 *                         prices:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               serviceId: { type: string, format: uuid }
 *                               garmentTypeId: { type: string, format: uuid }
 *                               price: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getMyCatalog = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerOrderingService.getMyCatalog(user, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Catalogue.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/express/availability:
 *   post:
 *     operationId: checkExpressAvailability
 *     summary: "Can Express honestly be offered right now?"
 *     description: "**Who can call this:** customer (super_admin always allowed). The rule is capacity only. Express is on while the store is live and its unfinished kilograms plus this basket stay within 80 percent of capacityKgPerDay. Staff and rider cover are not known here, so those two constraints are null. When off, nextAvailableSlot is the first open slot at least 24 hours away."
 *     tags: ["Customer - Ordering"]
 *     x-roles: [customer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [addressId]
 *             properties:
 *               addressId: { type: string, format: uuid }
 *               pickupSlotId: { type: string, format: uuid }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [garmentTypeId, serviceId]
 *                   properties:
 *                     garmentTypeId: { type: string, format: uuid }
 *                     serviceId: { type: string, format: uuid }
 *                     quantity: { type: integer, description: "pieces, for per-piece services" }
 *                     weightKg: { type: number, description: "kilograms, for by-weight services" }
 *                     fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *                     note: { type: string }
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
 *                         available: { type: boolean }
 *                         constraints:
 *                           type: object
 *                           properties:
 *                             machine: { type: boolean }
 *                             staff: { type: boolean }
 *                             rider: { type: boolean }
 *                         reasons: { type: array, items: { type: string } }
 *                         nextAvailableSlot:
 *                           type: object
 *                           properties:
 *                             from: { type: string, format: date-time }
 *                             to: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const checkExpressAvailability = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerOrderingService.checkExpressAvailability(user, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Express availability.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/orders:
 *   post:
 *     operationId: placeMyOrder
 *     summary: "Place an order"
 *     description: "**Who can call this:** customer (super_admin always allowed). Prices come from the server. The store is the pickup slot's store. Send an Idempotency-Key header (8 to 100 characters) to make a retry return the original order. couponCode, customerPackageId and paymentMethod package are refused with 400 until those features exist."
 *     tags: ["Customer - Ordering"]
 *     x-roles: [customer]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema: { type: string, minLength: 8, maxLength: 100 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [addressId, items, pickupSlotId, paymentMethod]
 *             properties:
 *               addressId: { type: string, format: uuid }
 *               deliveryAddressId: { type: string, format: uuid }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [garmentTypeId, serviceId]
 *                   properties:
 *                     garmentTypeId: { type: string, format: uuid }
 *                     serviceId: { type: string, format: uuid }
 *                     quantity: { type: integer, description: "pieces, for per-piece services" }
 *                     weightKg: { type: number, description: "kilograms, for by-weight services" }
 *                     fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *                     note: { type: string }
 *               careAnswers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [questionId, answer]
 *                   properties:
 *                     questionId: { type: string }
 *                     answer: { type: string, description: "a selected option, never free text" }
 *               careNotes: { type: string }
 *               express: { type: boolean }
 *               pickupSlotId: { type: string, format: uuid }
 *               couponCode: { type: string }
 *               customerPackageId: { type: string, format: uuid }
 *               paymentMethod: { type: string, enum: [online, cash_on_delivery, package] }
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
 *                         orderId: { type: string, format: uuid }
 *                         orderNumber: { type: string }
 *                         status: { type: string, enum: [placed, pickup_scheduled, picked_up, at_store, processing, quality_check, ready, out_for_delivery, delivered, cancelled] }
 *                         amountDue: { type: number, description: "Amount in INR" }
 *                         paymentRequired: { type: boolean }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       409:
 *         description: "Express is no longer available, or the chosen slot was full or too close to start."
 */
const placeMyOrder = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerOrderingService.placeMyOrder(user, req.header("idempotency-key"), req.body);
    return handleSuccessResponse({ statusCode: created, result }, res, "Order placed.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/orders/{id}/photos:
 *   post:
 *     operationId: uploadMyOrderPhotos
 *     summary: "Attach optional photos to an order (an existing stain, a loose button)"
 *     description: "**Who can call this:** customer (super_admin always allowed). Always optional. There is no file storage yet, so this takes JSON references to images already hosted over https (up to 5 per order) instead of multipart uploads."
 *     tags: ["Customer - Ordering"]
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
 *                     url: { type: string, format: uri, description: "https link to the image" }
 *                     itemId: { type: string, format: uuid, description: "an item of this order" }
 *                     note: { type: string }
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
const uploadMyOrderPhotos = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerOrderingService.uploadMyOrderPhotos(user, req.params.id as string, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res, "Photos added.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/pickup-slots:
 *   get:
 *     operationId: listPickupSlots
 *     summary: "Pickup windows for an address and date"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Ordering"]
 *     x-roles: [customer]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: addressId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid, description: "optional live store" }
 *       - in: query
 *         name: date
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: express
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
 *                               from: { type: string, format: date-time }
 *                               to: { type: string, format: date-time }
 *                               available: { type: boolean }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listPickupSlots = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerOrderingService.listPickupSlots(user, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Pickup slots.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/price-quote:
 *   post:
 *     operationId: getPriceQuote
 *     summary: "Price a basket before placing the order"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Ordering"]
 *     x-roles: [customer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [addressId, items]
 *             properties:
 *               addressId: { type: string, format: uuid }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [garmentTypeId, serviceId]
 *                   properties:
 *                     garmentTypeId: { type: string, format: uuid }
 *                     serviceId: { type: string, format: uuid }
 *                     quantity: { type: integer, description: "pieces, for per-piece services" }
 *                     weightKg: { type: number, description: "kilograms, for by-weight services" }
 *                     fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *                     note: { type: string }
 *               express: { type: boolean }
 *               couponCode: { type: string }
 *               customerPackageId: { type: string, format: uuid }
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
 *                         lines:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               garmentTypeId: { type: string, format: uuid }
 *                               serviceId: { type: string, format: uuid }
 *                               quantity: { type: integer }
 *                               amount: { type: number, description: "Amount in INR" }
 *                         subtotal: { type: number, description: "Amount in INR" }
 *                         discount: { type: number, description: "Amount in INR" }
 *                         expressSurcharge: { type: number, description: "Amount in INR" }
 *                         tax: { type: number, description: "Amount in INR" }
 *                         total: { type: number, description: "Amount in INR" }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getPriceQuote = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerOrderingService.getPriceQuote(user, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Price quote.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const CustomerOrderingController = {
  getCareQuestions,
  evaluateCareAnswers,
  getMyCatalog,
  checkExpressAvailability,
  placeMyOrder,
  uploadMyOrderPhotos,
  listPickupSlots,
  getPriceQuote,
};
