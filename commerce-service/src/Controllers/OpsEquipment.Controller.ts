import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { StoreScope, resolveStoreScope } from "../Middleware/StoreScope.js";
import { EquipmentMaintenanceService } from "../Services/EquipmentMaintenance.Service.js";
import { EquipmentRecordsService } from "../Services/EquipmentRecords.Service.js";
import { OpsEquipmentService } from "../Services/OpsEquipment.Service.js";

// Every handler is the same three steps: work out who and where, call one service function,
// wrap the answer. Store scope is decided once, by resolveStoreScope.
interface Ctx {
  req: IdentifiedRequest;
  scope: StoreScope;
  user: RequestUser;
}

const handle = (status: number, message: string | undefined, work: (ctx: Ctx) => Promise<unknown>) => async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await work({ req, scope: resolveStoreScope(req), user: req.user as RequestUser });
    return handleSuccessResponse({ statusCode: status, result }, res, message);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

const id = (c: Ctx) => c.req.params.id as string;

/**
 * @openapi
 * /operations/equipment:
 *   get:
 *     operationId: listEquipment
 *     summary: "List equipment"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). A manager sees only their own store."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, description: "1-based page number" } }
 *       - { in: query, name: limit, schema: { type: integer, description: "page size, max 100" } }
 *       - { in: query, name: storeId, schema: { type: string, format: uuid } }
 *       - { in: query, name: type, schema: { type: string, enum: [washer, dryer, press, iron, boiler, generator, other] } }
 *       - { in: query, name: status, schema: { type: string, enum: [active, under_repair, out_of_service, retired] } }
 *     responses:
 *       200:
 *         description: "A page of equipment, newest first: { items, page, limit, total }. Each item has id, assetTag, name, type, storeId, machineId, make, model, serialNumber, purchasedOn, purchaseCost (INR), capacityKg, status, retiredAt, retiredReason, createdAt, updatedAt."
 *       400:
 *         description: "Invalid filter."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "storeId names a store the caller cannot see."
 */
const listEquipment = handle(successCode, undefined, (c) => OpsEquipmentService.list(c.scope, c.req.query));

/**
 * @openapi
 * /operations/equipment:
 *   post:
 *     operationId: createEquipmentItem
 *     summary: "Create an equipment item"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). The asset tag is generated (EQ-00001) unless one is given; it is unique company-wide. A washer, dryer, press, iron or other item with a capacity is also registered as a floor machine, and its id is kept in machineId."
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
 *               assetTag: { type: string }
 *               machineId: { type: string, format: uuid }
 *               make: { type: string }
 *               model: { type: string }
 *               serialNumber: { type: string }
 *               purchasedOn: { type: string, format: date }
 *               purchaseCost: { type: number, description: "Amount in INR" }
 *               capacityKg: { type: number }
 *               status: { type: string, enum: [active, under_repair, out_of_service], description: "Defaults to active; use retire to retire." }
 *     responses:
 *       201:
 *         description: "Created. The equipment item."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Store not found."
 *       409:
 *         description: "That asset tag already exists."
 */
const createEquipmentItem = handle(created, "Equipment created.", (c) => OpsEquipmentService.create(c.scope, c.user, c.req.body));

/**
 * @openapi
 * /operations/equipment/replacement-review:
 *   get:
 *     operationId: getReplacementReview
 *     summary: "Machines now costing more to keep than to replace"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). Live machines with repairs in the last 365 days, worst first. The purchase cost stands in for the replacement cost; repairs of half of it or more mean replace, a quarter or more mean monitor. Covers the 500 machines with the most repair spend."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: query, name: storeId, schema: { type: string, format: uuid } }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, description: "page size, max 100" } }
 *     responses:
 *       200:
 *         description: "{ items: [{ equipmentId, name, repairCost12Months, replacementCost, recommendation }], page, limit, total }."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getReplacementReview = handle(successCode, undefined, (c) => OpsEquipmentService.replacementReview(c.scope, c.req.query));

/**
 * @openapi
 * /operations/equipment/summary:
 *   get:
 *     operationId: getEquipmentSummary
 *     summary: "The state of every machine at a glance"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). serviceDue counts tasks due in the next 7 days; brokenDownLast30Days counts machines with a repair reported in the last 30 days."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - { in: query, name: storeId, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: "{ total, byStatus, serviceDue, serviceOverdue, brokenDownLast30Days }."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getEquipmentSummary = handle(successCode, undefined, (c) => OpsEquipmentService.summary(c.scope, c.req.query));

/**
 * @openapi
 * /operations/equipment/{id}:
 *   get:
 *     operationId: getEquipmentItem
 *     summary: "Get an equipment item"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). Includes the last 50 lifecycle changes as history."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: "The equipment item with its history."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Not found, or in another store."
 */
const getEquipmentItem = handle(successCode, undefined, (c) => OpsEquipmentService.getById(id(c), c.scope));

/**
 * @openapi
 * /operations/equipment/{id}:
 *   patch:
 *     operationId: updateEquipmentItem
 *     summary: "Update an equipment item"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). Status moves follow the lifecycle (active, under_repair and out_of_service move freely; retired is final and set only by the retire action). A retired item cannot be changed. The asset tag cannot be changed. Optional fields can be cleared with null."
 *     tags: ["Ops - Equipment & Maintenance"]
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
 *               name: { type: string }
 *               type: { type: string, enum: [washer, dryer, press, iron, boiler, generator, other] }
 *               storeId: { type: string, format: uuid }
 *               machineId: { type: string, format: uuid }
 *               make: { type: string }
 *               model: { type: string }
 *               serialNumber: { type: string }
 *               purchasedOn: { type: string, format: date }
 *               purchaseCost: { type: number, description: "Amount in INR" }
 *               capacityKg: { type: number }
 *               status: { type: string, enum: [active, under_repair, out_of_service] }
 *     responses:
 *       200:
 *         description: "The updated equipment item."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Not found, or in another store."
 *       409:
 *         description: "The item is retired, or the status move is not allowed."
 */
const updateEquipmentItem = handle(successCode, "Equipment updated.", (c) => OpsEquipmentService.update(id(c), c.scope, c.user, c.req.body));

/**
 * @openapi
 * /operations/equipment/{id}/downtime:
 *   get:
 *     operationId: getEquipmentDowntime
 *     summary: "How often and how long a machine has been down"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). One period per repair in the range (default the last 90 days): the recorded downtime, else the days between reported and resolved, else the time so far (ongoing, to is null)."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *     responses:
 *       200:
 *         description: "{ totalHours, incidents, periods: [{ from, to, reason, ongoing }] }."
 *       400:
 *         description: "Invalid range."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getEquipmentDowntime = handle(successCode, undefined, (c) => EquipmentRecordsService.downtime(id(c), c.scope, c.req.query));

/**
 * @openapi
 * /operations/equipment/{id}/inspections:
 *   post:
 *     operationId: recordEquipmentInspection
 *     summary: "Record an inspection"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). The inspector is the caller. The date cannot be in the future; a retired machine cannot be inspected."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
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
 *                 description: "At most 50 items."
 *                 items:
 *                   type: object
 *                   required: [item, ok]
 *                   properties:
 *                     item: { type: string }
 *                     ok: { type: boolean }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: "Created. { id, date, result, checklist, notes, inspector }."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Not found, or in another store."
 *       409:
 *         description: "The machine is retired."
 */
const recordEquipmentInspection = handle(created, "Inspection recorded.", (c) => EquipmentRecordsService.recordInspection(id(c), c.scope, c.user, c.req.body));

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
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, description: "1-based page number" } }
 *       - { in: query, name: limit, schema: { type: integer, description: "page size, max 100" } }
 *     responses:
 *       200:
 *         description: "{ items: [{ id, date, result, checklist, notes, inspector }], page, limit, total }, newest first."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const listEquipmentInspections = handle(successCode, undefined, (c) => EquipmentRecordsService.listInspections(id(c), c.scope, c.req.query));

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
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: "{ tasks: [{ id, name, everyDays, lastDoneOn, nextDueOn }] }, soonest due first."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getMaintenanceSchedule = handle(successCode, undefined, (c) => EquipmentMaintenanceService.getSchedule(id(c), c.scope));

/**
 * @openapi
 * /operations/equipment/{id}/maintenance-schedule:
 *   put:
 *     operationId: setMaintenanceSchedule
 *     summary: "Set a machine's preventive maintenance schedule"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). Replaces the schedule: tasks are matched by name (so ids and history are kept), new names are added, missing names are removed. The next due date is lastDoneOn plus everyDays; with no lastDoneOn it counts from the day the task was first scheduled."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
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
 *                 description: "At most 50 tasks."
 *                 items:
 *                   type: object
 *                   required: [name, everyDays]
 *                   properties:
 *                     name: { type: string }
 *                     everyDays: { type: integer, description: "1 to 3650" }
 *                     lastDoneOn: { type: string, format: date }
 *     responses:
 *       200:
 *         description: "{ tasks: [...] }, the saved schedule."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "The machine is retired."
 */
const setMaintenanceSchedule = handle(successCode, "Schedule saved.", (c) => EquipmentMaintenanceService.setSchedule(id(c), c.scope, c.req.body));

/**
 * @openapi
 * /operations/equipment/{id}/repairs:
 *   post:
 *     operationId: createEquipmentRepair
 *     summary: "Record a repair"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). A repair is open until it is resolved. Recording one on an active machine moves it to under_repair in the same step, and the floor machine goes into maintenance."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
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
 *         description: "Created. { id, reportedOn, issue, cost, vendorId, resolvedOn, downtimeHours, notes }."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Not found, or in another store."
 *       409:
 *         description: "The machine is retired."
 */
const createEquipmentRepair = handle(created, "Repair recorded.", (c) => EquipmentRecordsService.createRepair(id(c), c.scope, c.user, c.req.body));

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
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, description: "1-based page number" } }
 *       - { in: query, name: limit, schema: { type: integer, description: "page size, max 100" } }
 *     responses:
 *       200:
 *         description: "{ items: [{ id, reportedOn, issue, cost, vendorId, resolvedOn, downtimeHours, notes }], page, limit, total }, newest first."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const listEquipmentRepairs = handle(successCode, undefined, (c) => EquipmentRecordsService.listRepairs(id(c), c.scope, c.req.query));

/**
 * @openapi
 * /operations/equipment/{id}/repairs/{repairId}:
 *   patch:
 *     operationId: updateEquipmentRepair
 *     summary: "Update a repair"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). Setting resolvedOn closes the repair; when it was the last open one and the machine is under_repair, the machine goes back to active and the floor machine returns to idle."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: path, name: repairId, required: true, schema: { type: string } }
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
 *         description: "The updated repair."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Machine or repair not found."
 */
const updateEquipmentRepair = handle(successCode, "Repair updated.", (c) =>
  EquipmentRecordsService.updateRepair(id(c), c.req.params.repairId as string, c.scope, c.user, c.req.body)
);

/**
 * @openapi
 * /operations/equipment/{id}/retire:
 *   post:
 *     operationId: retireEquipment
 *     summary: "Take a machine out of service for good"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed). Final: the maintenance schedule is removed, every record is kept."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
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
 *         description: "The retired equipment item."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "Already retired."
 */
const retireEquipment = handle(successCode, "Equipment retired.", (c) => OpsEquipmentService.retire(id(c), c.scope, c.user, c.req.body));

/**
 * @openapi
 * /operations/maintenance/due:
 *   get:
 *     operationId: listMaintenanceDue
 *     summary: "Servicing due soon"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). Tasks due from today through withinDays (default 7, at most 365), soonest first, paged."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - { in: query, name: storeId, schema: { type: string, format: uuid } }
 *       - { in: query, name: withinDays, schema: { type: integer } }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, description: "page size, max 100" } }
 *     responses:
 *       200:
 *         description: "{ tasks: [{ taskId, equipmentId, equipmentName, name, dueOn }], page, limit, total }."
 *       400:
 *         description: "Invalid parameter."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listMaintenanceDue = handle(successCode, undefined, (c) => EquipmentMaintenanceService.listDue(c.scope, c.req.query));

/**
 * @openapi
 * /operations/maintenance/overdue:
 *   get:
 *     operationId: listMaintenanceOverdue
 *     summary: "Servicing that has been missed"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). Tasks whose due date has passed, longest overdue first, paged."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - { in: query, name: storeId, schema: { type: string, format: uuid } }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, description: "page size, max 100" } }
 *     responses:
 *       200:
 *         description: "{ tasks: [{ taskId, equipmentId, equipmentName, name, dueOn, daysOverdue }], page, limit, total }."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listMaintenanceOverdue = handle(successCode, undefined, (c) => EquipmentMaintenanceService.listOverdue(c.scope, c.req.query));

/**
 * @openapi
 * /operations/maintenance/tasks/{taskId}/complete:
 *   post:
 *     operationId: completeMaintenanceTask
 *     summary: "Record that servicing was done"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). Moves the next due date to doneOn plus everyDays and keeps a service record. A date on or before the last recorded service is refused."
 *     tags: ["Ops - Equipment & Maintenance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - { in: path, name: taskId, required: true, schema: { type: string } }
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
 *         description: "The task with its new dates, plus the service record."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Not found, or in another store."
 *       409:
 *         description: "That service was already recorded."
 */
const completeMaintenanceTask = handle(successCode, "Service recorded.", (c) =>
  EquipmentMaintenanceService.completeTask(c.req.params.taskId as string, c.scope, c.user, c.req.body)
);

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
