import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { ItDeviceService } from "../Services/ItDevice.Service.js";
import { ItLicenceService } from "../Services/ItLicence.Service.js";
import { ItRequestService } from "../Services/ItRequest.Service.js";

// IT assets belong to the company, not a store, so there is no store scope here. Requests
// are the exception: the service limits non-desk roles to what they raised themselves.
interface Ctx {
  req: IdentifiedRequest;
  user: RequestUser;
}

const handle = (status: number, message: string | undefined, work: (ctx: Ctx) => Promise<unknown>) => async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: status, result: await work({ req, user: req.user as RequestUser }) }, res, message);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

const id = (c: Ctx) => c.req.params.id as string;

/**
 * @openapi
 * /operations/it/devices:
 *   get:
 *     operationId: listDevices
 *     summary: "List devices"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, description: "1-based page number" } }
 *       - { in: query, name: limit, schema: { type: integer, description: "page size, max 100" } }
 *       - { in: query, name: type, schema: { type: string, enum: [laptop, phone, tablet, printer, scanner, router, other] } }
 *       - { in: query, name: status, schema: { type: string, enum: [in_stock, assigned, in_repair, retired] } }
 *       - { in: query, name: assignedTo, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: "{ items, page, limit, total }, newest first. Each item has id, assetTag, type, make, model, serialNumber, purchasedOn, warrantyUntil, condition, status, assignedToEmployeeId, assignedAt, createdAt, updatedAt."
 *       400:
 *         description: "Invalid filter."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listDevices = handle(successCode, undefined, (c) => ItDeviceService.list(c.req.query));

/**
 * @openapi
 * /operations/it/devices:
 *   post:
 *     operationId: createDevice
 *     summary: "Create a device"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). A new device is in_stock (or in_repair); use assign to give it to someone. Store a reference only, never a password or key."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [assetTag, type]
 *             properties:
 *               assetTag: { type: string }
 *               type: { type: string, enum: [laptop, phone, tablet, printer, scanner, router, other] }
 *               make: { type: string }
 *               model: { type: string }
 *               serialNumber: { type: string }
 *               purchasedOn: { type: string, format: date }
 *               warrantyUntil: { type: string, format: date }
 *               condition: { type: string, enum: [new, good, fair, poor] }
 *               status: { type: string, enum: [in_stock, in_repair] }
 *     responses:
 *       201:
 *         description: "Created. The device."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       409:
 *         description: "That asset tag already exists."
 */
const createDevice = handle(created, "Device created.", (c) => ItDeviceService.create(c.user, c.req.body));

/**
 * @openapi
 * /operations/it/devices/{id}:
 *   get:
 *     operationId: getDevice
 *     summary: "Get a device"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). Includes the last 50 assignment and status changes as history."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: "The device with its history."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getDevice = handle(successCode, undefined, (c) => ItDeviceService.getById(id(c)));

/**
 * @openapi
 * /operations/it/devices/{id}:
 *   patch:
 *     operationId: updateDevice
 *     summary: "Update a device"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). Status moves by PATCH are in_stock and in_repair to each other or to retired; assigned is entered with assign and left with return. A retired device cannot be changed."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               assetTag: { type: string }
 *               type: { type: string, enum: [laptop, phone, tablet, printer, scanner, router, other] }
 *               make: { type: string }
 *               model: { type: string }
 *               serialNumber: { type: string }
 *               purchasedOn: { type: string, format: date }
 *               warrantyUntil: { type: string, format: date }
 *               condition: { type: string, enum: [new, good, fair, poor] }
 *               status: { type: string, enum: [in_stock, in_repair, retired] }
 *     responses:
 *       200:
 *         description: "The updated device."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "Retired, a status move that is not allowed, or a duplicate asset tag."
 */
const updateDevice = handle(successCode, "Device updated.", (c) => ItDeviceService.update(id(c), c.user, c.req.body));

/**
 * @openapi
 * /operations/it/devices/{id}/assign:
 *   post:
 *     operationId: assignDevice
 *     summary: "Give a device to someone"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). Only a device that is in_stock can be assigned; two simultaneous assignments cannot both succeed. employeeId is the HR employee id and is not checked against the HR module."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employeeId]
 *             properties:
 *               employeeId: { type: string, format: uuid }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: "The assigned device."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "The device is not in stock."
 */
const assignDevice = handle(successCode, "Device assigned.", (c) => ItDeviceService.assign(id(c), c.user, c.req.body));

/**
 * @openapi
 * /operations/it/devices/{id}/repairs:
 *   post:
 *     operationId: createDeviceRepair
 *     summary: "Record a device repair"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). repairedOn defaults to today and cannot be in the future. Recording a repair does not change the device status; set in_repair with the update call."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [issue]
 *             properties:
 *               issue: { type: string }
 *               cost: { type: number, description: "Amount in INR" }
 *               repairedOn: { type: string, format: date }
 *     responses:
 *       201:
 *         description: "Created. { id, issue, cost, repairedOn }."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "The device is retired."
 */
const createDeviceRepair = handle(created, "Repair recorded.", (c) => ItDeviceService.createRepair(id(c), c.user, c.req.body));

/**
 * @openapi
 * /operations/it/devices/{id}/repairs:
 *   get:
 *     operationId: listDeviceRepairs
 *     summary: "A device's repair history"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, description: "1-based page number" } }
 *       - { in: query, name: limit, schema: { type: integer, description: "page size, max 100" } }
 *     responses:
 *       200:
 *         description: "{ items: [{ id, issue, cost, repairedOn }], page, limit, total }, newest first."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const listDeviceRepairs = handle(successCode, undefined, (c) => ItDeviceService.listRepairs(id(c), c.req.query));

/**
 * @openapi
 * /operations/it/devices/{id}/return:
 *   post:
 *     operationId: returnDevice
 *     summary: "Take a device back"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). Back to in_stock, with the condition it came back in if given."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               condition: { type: string, enum: [new, good, fair, poor] }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: "The returned device."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "The device is not assigned."
 */
const returnDevice = handle(successCode, "Device returned.", (c) => ItDeviceService.returnDevice(id(c), c.user, c.req.body));

/**
 * @openapi
 * /operations/it/licences:
 *   get:
 *     operationId: listSoftwareLicences
 *     summary: "List software licences"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). Alphabetical by software."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, description: "1-based page number" } }
 *       - { in: query, name: limit, schema: { type: integer, description: "page size, max 100" } }
 *     responses:
 *       200:
 *         description: "{ items, page, limit, total }. Each item has id, software, vendor, seats, seatsUsed, seatsAvailable, validUntil, cost (INR), createdAt, updatedAt."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listSoftwareLicences = handle(successCode, undefined, (c) => ItLicenceService.list(c.req.query));

/**
 * @openapi
 * /operations/it/licences:
 *   post:
 *     operationId: createSoftwareLicence
 *     summary: "Create a software licence"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). Never send a licence key; this records the entitlement only."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [software, seats]
 *             properties:
 *               software: { type: string }
 *               vendor: { type: string }
 *               seats: { type: integer, description: "1 to 100000" }
 *               validUntil: { type: string, format: date }
 *               cost: { type: number, description: "Amount in INR" }
 *     responses:
 *       201:
 *         description: "Created. The licence."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createSoftwareLicence = handle(created, "Licence created.", (c) => ItLicenceService.create(c.req.body));

/**
 * @openapi
 * /operations/it/licences/{id}:
 *   get:
 *     operationId: getSoftwareLicence
 *     summary: "Get a software licence"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). Adds holders (up to 200 current seat holders) and the last 50 grants and revocations as history."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: "The licence with holders and history."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getSoftwareLicence = handle(successCode, undefined, (c) => ItLicenceService.getById(id(c)));

/**
 * @openapi
 * /operations/it/licences/{id}:
 *   patch:
 *     operationId: updateSoftwareLicence
 *     summary: "Update a software licence"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). The seat total cannot be lowered below the seats in use."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               software: { type: string }
 *               vendor: { type: string }
 *               seats: { type: integer }
 *               validUntil: { type: string, format: date }
 *               cost: { type: number, description: "Amount in INR" }
 *     responses:
 *       200:
 *         description: "The updated licence."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "More seats are in use than the new total."
 */
const updateSoftwareLicence = handle(successCode, "Licence updated.", (c) => ItLicenceService.update(id(c), c.req.body));

/**
 * @openapi
 * /operations/it/licences/{id}:
 *   delete:
 *     operationId: deleteSoftwareLicence
 *     summary: "Delete a software licence"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). Hidden, not erased, so the grant history stays; refused while seats are in use."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: "{ id, deleted }."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "Seats are still in use."
 */
const deleteSoftwareLicence = handle(successCode, "Licence deleted.", (c) => ItLicenceService.remove(id(c)));

/**
 * @openapi
 * /operations/it/licences/{id}/assign:
 *   post:
 *     operationId: assignLicence
 *     summary: "Give someone a seat on a licence"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). Atomic: the seat count can never pass the total, even with simultaneous requests. An expired licence takes no new seats. employeeId is the HR employee id and is not checked against the HR module."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employeeId]
 *             properties:
 *               employeeId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: "The licence with its new seat count."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "No seats left, the licence has expired, or that person already has a seat."
 */
const assignLicence = handle(successCode, "Seat assigned.", (c) => ItLicenceService.assign(id(c), c.user, c.req.body));

/**
 * @openapi
 * /operations/it/licences/{id}/revoke:
 *   post:
 *     operationId: revokeLicence
 *     summary: "Take a seat back"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employeeId]
 *             properties:
 *               employeeId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: "The licence with its new seat count."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Licence not found, or that person holds no seat."
 */
const revokeLicence = handle(successCode, "Seat revoked.", (c) => ItLicenceService.revoke(id(c), c.user, c.req.body));

/**
 * @openapi
 * /operations/it/requests:
 *   post:
 *     operationId: raiseItRequest
 *     summary: "Ask for IT help: a device, software or access"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed). Raised as a request rather than a phone call. Never put a password or key in the description."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [category, description]
 *             properties:
 *               category: { type: string, enum: [device_problem, software_issue, access_request, new_device, other] }
 *               description: { type: string }
 *               priority: { type: string, enum: [low, normal, high, urgent] }
 *               deviceId: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: "Created. The request."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const raiseItRequest = handle(created, "Request raised.", (c) => ItRequestService.raise(c.user, c.req.body));

/**
 * @openapi
 * /operations/it/requests:
 *   get:
 *     operationId: listItRequests
 *     summary: "IT requests (staff see their own; HR sees all)"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed). Admin and hr see every request (mine=true narrows to their own); everyone else sees only what they raised."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, description: "1-based page number" } }
 *       - { in: query, name: limit, schema: { type: integer, description: "page size, max 100" } }
 *       - { in: query, name: mine, schema: { type: boolean } }
 *       - { in: query, name: status, schema: { type: string, enum: [open, in_progress, resolved, closed] } }
 *       - { in: query, name: category, schema: { type: string, enum: [device_problem, software_issue, access_request, new_device, other] } }
 *     responses:
 *       200:
 *         description: "{ items, page, limit, total }, newest first."
 *       400:
 *         description: "Invalid filter."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listItRequests = handle(successCode, undefined, (c) => ItRequestService.list(c.user, c.req.query));

/**
 * @openapi
 * /operations/it/requests/{id}:
 *   get:
 *     operationId: getItRequest
 *     summary: "One IT request"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed). With its messages (last 200) and history (last 100). Someone else's request is not found."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: "The request, comments and history."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Not found, or raised by someone else."
 */
const getItRequest = handle(successCode, undefined, (c) => ItRequestService.getById(id(c), c.user));

/**
 * @openapi
 * /operations/it/requests/{id}:
 *   patch:
 *     operationId: updateItRequest
 *     summary: "Assign or change the status of an IT request"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). Status moves open to in_progress or resolved, in_progress to open or resolved, resolved back to in_progress; closed only through the close action. Assigning an open request starts it. The assignee is checked with the gateway and must be an active user (null unassigns)."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               assigneeId: { type: string, format: uuid }
 *               status: { type: string, enum: [open, in_progress, resolved] }
 *               priority: { type: string, enum: [low, normal, high, urgent] }
 *     responses:
 *       200:
 *         description: "The updated request."
 *       400:
 *         description: "Missing or invalid fields, or an unknown assignee."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "The request is closed or the move is not allowed."
 *       503:
 *         description: "The gateway could not be reached to check the assignee."
 */
const updateItRequest = handle(successCode, "Request updated.", (c) => ItRequestService.update(id(c), c.user, c.req.body));

/**
 * @openapi
 * /operations/it/requests/{id}/close:
 *   post:
 *     operationId: closeItRequest
 *     summary: "Close an IT request"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). Final."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [resolution]
 *             properties:
 *               resolution: { type: string }
 *     responses:
 *       200:
 *         description: "The closed request."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "Already closed."
 */
const closeItRequest = handle(successCode, "Request closed.", (c) => ItRequestService.close(id(c), c.user, c.req.body));

/**
 * @openapi
 * /operations/it/requests/{id}/comments:
 *   post:
 *     operationId: commentOnItRequest
 *     summary: "Add a message to an IT request"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed). Allowed to the person who raised the request and to admin and hr; a closed request takes no more messages."
 *     tags: ["Ops - IT Assets & Requests"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string }
 *     responses:
 *       200:
 *         description: "The message: { id, author, message, createdAt }."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Not found, or raised by someone else."
 *       409:
 *         description: "The request is closed."
 */
const commentOnItRequest = handle(successCode, "Message added.", (c) => ItRequestService.comment(id(c), c.user, c.req.body));

export const OpsItController = {
  listDevices,
  createDevice,
  getDevice,
  updateDevice,
  assignDevice,
  createDeviceRepair,
  listDeviceRepairs,
  returnDevice,
  listSoftwareLicences,
  createSoftwareLicence,
  getSoftwareLicence,
  updateSoftwareLicence,
  deleteSoftwareLicence,
  assignLicence,
  revokeLicence,
  raiseItRequest,
  listItRequests,
  getItRequest,
  updateItRequest,
  closeItRequest,
  commentOnItRequest,
};
