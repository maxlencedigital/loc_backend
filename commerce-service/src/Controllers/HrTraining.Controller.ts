import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { TrainingService } from "../Services/Training.Service.js";

/**
 * @openapi
 * /hr/training/assignments:
 *   post:
 *     operationId: assignTraining
 *     summary: "Assign a course to people"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Training"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [courseId, employeeIds]
 *             properties:
 *               courseId: { type: string, format: uuid }
 *               employeeIds: { type: array, items: { type: string, format: uuid } }
 *               dueDate: { type: string, format: date }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const assignTraining = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await TrainingService.assign(req.user as RequestUser, resolveStoreScope(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/training/assignments:
 *   get:
 *     operationId: listTrainingAssignments
 *     summary: "Training assignments"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Training"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: employeeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: courseId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [assigned, in_progress, completed, overdue] }
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
 *                               employeeId: { type: string, format: uuid }
 *                               courseId: { type: string, format: uuid }
 *                               status: { type: string }
 *                               dueDate: { type: string, format: date }
 *                               completedAt: { type: string, format: date-time }
 *                               score: { type: number }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listTrainingAssignments = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await TrainingService.listAssignments(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/training/assignments/{id}:
 *   patch:
 *     operationId: updateTrainingAssignment
 *     summary: "Record progress or completion"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Training"]
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
 *               status: { type: string, enum: [assigned, in_progress, completed] }
 *               completedAt: { type: string, format: date-time }
 *               score: { type: number }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "A completed record cannot be changed, or the change is not an allowed step."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateTrainingAssignment = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await TrainingService.updateAssignment(resolveStoreScope(req), req.params.id, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/training/courses:
 *   get:
 *     operationId: listTrainingCourses
 *     summary: "List training courses"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["HR - Training"]
 *     x-roles: [admin, hr, manager, staff, driver]
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
 *                               title: { type: string }
 *                               category: { type: string, enum: [software, customer_handling, safety, compliance, other] }
 *                               description: { type: string }
 *                               durationMinutes: { type: integer }
 *                               materialUrl: { type: string, format: uri }
 *                               validForDays: { type: integer, description: "refresher interval; omit if it never expires" }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listTrainingCourses = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await TrainingService.listCourses(req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/training/courses:
 *   post:
 *     operationId: createTrainingCourse
 *     summary: "Create a training course"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Training"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, category]
 *             properties:
 *               title: { type: string }
 *               category: { type: string, enum: [software, customer_handling, safety, compliance, other] }
 *               description: { type: string }
 *               durationMinutes: { type: integer }
 *               materialUrl: { type: string, format: uri }
 *               validForDays: { type: integer, description: "refresher interval; omit if it never expires" }
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
 *                         title: { type: string }
 *                         category: { type: string, enum: [software, customer_handling, safety, compliance, other] }
 *                         description: { type: string }
 *                         durationMinutes: { type: integer }
 *                         materialUrl: { type: string, format: uri }
 *                         validForDays: { type: integer, description: "refresher interval; omit if it never expires" }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createTrainingCourse = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await TrainingService.createCourse(req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/training/courses/{id}:
 *   get:
 *     operationId: getTrainingCourse
 *     summary: "Get a training course"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["HR - Training"]
 *     x-roles: [admin, hr, manager, staff, driver]
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
 *                         title: { type: string }
 *                         category: { type: string, enum: [software, customer_handling, safety, compliance, other] }
 *                         description: { type: string }
 *                         durationMinutes: { type: integer }
 *                         materialUrl: { type: string, format: uri }
 *                         validForDays: { type: integer, description: "refresher interval; omit if it never expires" }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getTrainingCourse = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await TrainingService.getCourse(req.params.id) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/training/courses/{id}:
 *   patch:
 *     operationId: updateTrainingCourse
 *     summary: "Update a training course"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Training"]
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
 *               category: { type: string, enum: [software, customer_handling, safety, compliance, other] }
 *               description: { type: string }
 *               durationMinutes: { type: integer }
 *               materialUrl: { type: string, format: uri }
 *               validForDays: { type: integer, description: "refresher interval; omit if it never expires" }
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
 *                         title: { type: string }
 *                         category: { type: string, enum: [software, customer_handling, safety, compliance, other] }
 *                         description: { type: string }
 *                         durationMinutes: { type: integer }
 *                         materialUrl: { type: string, format: uri }
 *                         validForDays: { type: integer, description: "refresher interval; omit if it never expires" }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateTrainingCourse = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await TrainingService.updateCourse(req.params.id, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/training/courses/{id}:
 *   delete:
 *     operationId: deleteTrainingCourse
 *     summary: "Delete a training course"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Training"]
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
 *         description: "People still have the course open."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const deleteTrainingCourse = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await TrainingService.deleteCourse(req.params.id) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/training/overdue:
 *   get:
 *     operationId: listOverdueTraining
 *     summary: "Who is behind on training"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Training"]
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
 *                         overdue:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               employeeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               courseTitle: { type: string }
 *                               dueDate: { type: string, format: date }
 *                               daysOverdue: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listOverdueTraining = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await TrainingService.listOverdue(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/training/refreshers-due:
 *   get:
 *     operationId: listRefreshersDue
 *     summary: "Refreshers coming due, before they are missed"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Training"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
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
 *                         refreshers:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               employeeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               courseTitle: { type: string }
 *                               dueOn: { type: string, format: date }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listRefreshersDue = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await TrainingService.listRefreshersDue(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/training/requirements:
 *   get:
 *     operationId: listTrainingRequirements
 *     summary: "Which courses each role must complete"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Training"]
 *     x-roles: [admin, hr]
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
 *                         roles:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               role: { type: string }
 *                               courseIds: { type: array, items: { type: string, format: uuid } }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listTrainingRequirements = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await TrainingService.listRequirements() }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/training/requirements/{role}:
 *   put:
 *     operationId: setTrainingRequirements
 *     summary: "Set the required courses for a role"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Training"]
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
 *             required: [courseIds]
 *             properties:
 *               courseIds: { type: array, items: { type: string, format: uuid } }
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
const setTrainingRequirements = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await TrainingService.setRequirements(req.params.role, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const HrTrainingController = {
  assignTraining,
  listTrainingAssignments,
  updateTrainingAssignment,
  listTrainingCourses,
  createTrainingCourse,
  getTrainingCourse,
  updateTrainingCourse,
  deleteTrainingCourse,
  listOverdueTraining,
  listRefreshersDue,
  listTrainingRequirements,
  setTrainingRequirements,
};
