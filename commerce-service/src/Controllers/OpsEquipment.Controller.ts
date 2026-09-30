// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import { Request, Response } from "express";
import { handleErrorResponse, handleNotImplementedResponse } from "../../commons/Response/Response.js";
import { requireFields } from "../../commons/Utils/Validation.js";

/**
 * @openapi
 * /operations/equipment:
 *   get:
 *     operationId: listEquipment
 *     summary: "List equipment"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
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
 *         name: type
 *         schema: { type: string, enum: [washer, dryer, press, iron, boiler, generator, other] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, under_repair, out_of_service, retired] }
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
 *                               type: { type: string, enum: [washer, dryer, press, iron, boiler, generator, other] }
 *                               storeId: { type: string, format: uuid }
 *                               make: { type: string }
 *                               model: { type: string }
 *                               serialNumber: { type: string }
 *                               purchasedOn: { type: string, format: date }
 *                               purchaseCost: { type: number, description: "Amount in INR" }
 *                               capacityKg: { type: number }
 *                               status: { type: string, enum: [active, under_repair, out_of_service, retired] }
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
const listEquipment = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/equipment:
 *   post:
 *     operationId: createEquipmentItem
 *     summary: "Create an equipment item"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, type, storeId]
 *             properties:
 *               name: { type: string }
 *               type: { type: string, enum: [washer, dryer, press, iron, boiler, generator, other] }
 *               storeId: { type: string, format: uuid }
 *               make: { type: string }
 *               model: { type: string }
 *               serialNumber: { type: string }
 *               purchasedOn: { type: string, format: date }
 *               purchaseCost: { type: number, description: "Amount in INR" }
 *               capacityKg: { type: number }
 *               status: { type: string, enum: [active, under_repair, out_of_service, retired] }
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
 *                         type: { type: string, enum: [washer, dryer, press, iron, boiler, generator, other] }
 *                         storeId: { type: string, format: uuid }
 *                         make: { type: string }
 *                         model: { type: string }
 *                         serialNumber: { type: string }
 *                         purchasedOn: { type: string, format: date }
 *                         purchaseCost: { type: number, description: "Amount in INR" }
 *                         capacityKg: { type: number }
 *                         status: { type: string, enum: [active, under_repair, out_of_service, retired] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const createEquipmentItem = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["name", "type", "storeId"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/equipment/replacement-review:
 *   get:
 *     operationId: getReplacementReview
 *     summary: "Machines now costing more to keep than to replace"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr]
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
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               equipmentId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               repairCost12Months: { type: number, description: "Amount in INR" }
 *                               replacementCost: { type: number, description: "Amount in INR" }
 *                               recommendation: { type: string, enum: [keep, monitor, replace] }
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const getReplacementReview = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/equipment/summary:
 *   get:
 *     operationId: getEquipmentSummary
 *     summary: "The state of every machine at a glance"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
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
 *                         total: { type: integer }
 *                         byStatus: { type: object }
 *                         serviceDue: { type: integer }
 *                         serviceOverdue: { type: integer }
 *                         brokenDownLast30Days: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const getEquipmentSummary = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/equipment/{id}:
 *   get:
 *     operationId: getEquipmentItem
 *     summary: "Get an equipment item"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
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
 *                         name: { type: string }
 *                         type: { type: string, enum: [washer, dryer, press, iron, boiler, generator, other] }
 *                         storeId: { type: string, format: uuid }
 *                         make: { type: string }
 *                         model: { type: string }
 *                         serialNumber: { type: string }
 *                         purchasedOn: { type: string, format: date }
 *                         purchaseCost: { type: number, description: "Amount in INR" }
 *                         capacityKg: { type: number }
 *                         status: { type: string, enum: [active, under_repair, out_of_service, retired] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const getEquipmentItem = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/equipment/{id}:
 *   patch:
 *     operationId: updateEquipmentItem
 *     summary: "Update an equipment item"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
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
 *               type: { type: string, enum: [washer, dryer, press, iron, boiler, generator, other] }
 *               storeId: { type: string, format: uuid }
 *               make: { type: string }
 *               model: { type: string }
 *               serialNumber: { type: string }
 *               purchasedOn: { type: string, format: date }
 *               purchaseCost: { type: number, description: "Amount in INR" }
 *               capacityKg: { type: number }
 *               status: { type: string, enum: [active, under_repair, out_of_service, retired] }
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
 *                         type: { type: string, enum: [washer, dryer, press, iron, boiler, generator, other] }
 *                         storeId: { type: string, format: uuid }
 *                         make: { type: string }
 *                         model: { type: string }
 *                         serialNumber: { type: string }
 *                         purchasedOn: { type: string, format: date }
 *                         purchaseCost: { type: number, description: "Amount in INR" }
 *                         capacityKg: { type: number }
 *                         status: { type: string, enum: [active, under_repair, out_of_service, retired] }
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
const updateEquipmentItem = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/equipment/{id}/downtime:
 *   get:
 *     operationId: getEquipmentDowntime
 *     summary: "How often and how long a machine has been down"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
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
 *                         totalHours: { type: number }
 *                         incidents: { type: integer }
 *                         periods:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               from: { type: string, format: date-time }
 *                               to: { type: string, format: date-time }
 *                               reason: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const getEquipmentDowntime = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/equipment/{id}/inspections:
 *   post:
 *     operationId: recordEquipmentInspection
 *     summary: "Record an inspection"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr, manager]
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
 *             required: [date, result]
 *             properties:
 *               date: { type: string, format: date }
 *               result: { type: string, enum: [pass, fail, needs_attention] }
 *               checklist:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [item, ok]
 *                   properties:
 *                     item: { type: string }
 *                     ok: { type: boolean }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const recordEquipmentInspection = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["date", "result"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/equipment/{id}/inspections:
 *   get:
 *     operationId: listEquipmentInspections
 *     summary: "A machine's inspection history"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
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
 *                               date: { type: string, format: date }
 *                               result: { type: string }
 *                               inspector: { type: string }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const listEquipmentInspections = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/equipment/{id}/maintenance-schedule:
 *   get:
 *     operationId: getMaintenanceSchedule
 *     summary: "A machine's preventive maintenance schedule"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
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
 *                         tasks:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               name: { type: string }
 *                               everyDays: { type: integer }
 *                               lastDoneOn: { type: string, format: date }
 *                               nextDueOn: { type: string, format: date }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const getMaintenanceSchedule = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/equipment/{id}/maintenance-schedule:
 *   put:
 *     operationId: setMaintenanceSchedule
 *     summary: "Set a machine's preventive maintenance schedule"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
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
 *             required: [tasks]
 *             properties:
 *               tasks:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [name, everyDays]
 *                   properties:
 *                     name: { type: string }
 *                     everyDays: { type: integer }
 *                     lastDoneOn: { type: string, format: date }
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
const setMaintenanceSchedule = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["tasks"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/equipment/{id}/repairs:
 *   post:
 *     operationId: createEquipmentRepair
 *     summary: "Record a repair"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr, manager]
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
 *             required: [reportedOn, issue]
 *             properties:
 *               reportedOn: { type: string, format: date }
 *               issue: { type: string }
 *               cost: { type: number, description: "Amount in INR" }
 *               vendorId: { type: string, format: uuid }
 *               downtimeHours: { type: number }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const createEquipmentRepair = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["reportedOn", "issue"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/equipment/{id}/repairs:
 *   get:
 *     operationId: listEquipmentRepairs
 *     summary: "A machine's repair history"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
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
 *                               reportedOn: { type: string, format: date }
 *                               issue: { type: string }
 *                               cost: { type: number, description: "Amount in INR" }
 *                               resolvedOn: { type: string, format: date }
 *                               downtimeHours: { type: number }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const listEquipmentRepairs = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/equipment/{id}/repairs/{repairId}:
 *   patch:
 *     operationId: updateEquipmentRepair
 *     summary: "Update a repair"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: repairId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cost: { type: number, description: "Amount in INR" }
 *               resolvedOn: { type: string, format: date }
 *               downtimeHours: { type: number }
 *               notes: { type: string }
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
const updateEquipmentRepair = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/equipment/{id}/retire:
 *   post:
 *     operationId: retireEquipment
 *     summary: "Take a machine out of service for good"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
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
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
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
const retireEquipment = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["reason"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/maintenance/due:
 *   get:
 *     operationId: listMaintenanceDue
 *     summary: "Servicing due soon"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
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
 *                         tasks:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               taskId: { type: string, format: uuid }
 *                               equipmentId: { type: string, format: uuid }
 *                               equipmentName: { type: string }
 *                               name: { type: string }
 *                               dueOn: { type: string, format: date }
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const listMaintenanceDue = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/maintenance/overdue:
 *   get:
 *     operationId: listMaintenanceOverdue
 *     summary: "Servicing that has been missed"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
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
 *                         tasks:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               taskId: { type: string, format: uuid }
 *                               equipmentId: { type: string, format: uuid }
 *                               equipmentName: { type: string }
 *                               name: { type: string }
 *                               dueOn: { type: string, format: date }
 *                               daysOverdue: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const listMaintenanceOverdue = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/maintenance/tasks/{taskId}/complete:
 *   post:
 *     operationId: completeMaintenanceTask
 *     summary: "Record that servicing was done"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [doneOn]
 *             properties:
 *               doneOn: { type: string, format: date }
 *               notes: { type: string }
 *               cost: { type: number, description: "Amount in INR" }
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
const completeMaintenanceTask = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["doneOn"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const OpsEquipmentController = {
  listEquipment,
  createEquipmentItem,
  getReplacementReview,
  getEquipmentSummary,
  getEquipmentItem,
  updateEquipmentItem,
  getEquipmentDowntime,
  recordEquipmentInspection,
  listEquipmentInspections,
  getMaintenanceSchedule,
  setMaintenanceSchedule,
  createEquipmentRepair,
  listEquipmentRepairs,
  updateEquipmentRepair,
  retireEquipment,
  listMaintenanceDue,
  listMaintenanceOverdue,
  completeMaintenanceTask,
};
