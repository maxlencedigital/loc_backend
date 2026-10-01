import { Response } from "express";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { actorOf } from "../Middleware/StoreScope.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { parsePage } from "../../commons/Utils/Pagination.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { DashboardService } from "../Services/Dashboard.Service.js";

/**
 * @openapi
 * /dashboard/orders:
 *   get:
 *     operationId: getDashboardOrders
 *     summary: "Order volume, turnaround and delays"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Dashboard"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: storeId
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
 *                         total: { type: integer }
 *                         byStatus: { type: object }
 *                         avgTurnaroundHours: { type: number }
 *                         onTimePct: { type: number }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getDashboardOrders = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await DashboardService.orders(req.query as Record<string, unknown>, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /dashboard/overview:
 *   get:
 *     operationId: getDashboardOverview
 *     summary: "One view of the whole business"
 *     description: "**Who can call this:** admin (super_admin always allowed). Revenue, orders, capacity, costs, cash, people, customer satisfaction and outstanding risks in one response — enough to tell at a glance whether the business is healthy, and where to look if it is not."
 *     tags: ["Admin - Dashboard"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: storeId
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
 *                         asOf: { type: string, format: date-time }
 *                         revenue:
 *                           type: object
 *                           properties:
 *                             today: { type: number, description: "Amount in INR" }
 *                             monthToDate: { type: number, description: "Amount in INR" }
 *                             trendPct: { type: number }
 *                         orders:
 *                           type: object
 *                           properties:
 *                             today: { type: integer }
 *                             inProgress: { type: integer }
 *                             delayed: { type: integer }
 *                         capacity:
 *                           type: object
 *                           properties:
 *                             bottleneck: { type: string, enum: [machines, staff, riders, none] }
 *                             utilisationPct: { type: number }
 *                             expressCanAccept: { type: boolean }
 *                         costs:
 *                           type: object
 *                           properties:
 *                             monthToDate: { type: number, description: "Amount in INR" }
 *                             perOrder: { type: number, description: "Amount in INR" }
 *                         cash:
 *                           type: object
 *                           properties:
 *                             collected: { type: number, description: "Amount in INR" }
 *                             banked: { type: number, description: "Amount in INR" }
 *                             variance: { type: number, description: "Amount in INR" }
 *                         people:
 *                           type: object
 *                           properties:
 *                             headcount: { type: integer }
 *                             presentToday: { type: integer }
 *                             onLeave: { type: integer }
 *                             openGrievances: { type: integer }
 *                             overdueTraining: { type: integer }
 *                         satisfaction:
 *                           type: object
 *                           properties:
 *                             average: { type: number }
 *                             complaintsOpen: { type: integer }
 *                         risks:
 *                           type: object
 *                           properties:
 *                             expiringCompliance: { type: integer }
 *                             expiredInsurance: { type: integer }
 *                             openAuditFindings: { type: integer }
 *                             seriousIncidents: { type: integer }
 *                             equipmentServiceOverdue: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getDashboardOverview = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await DashboardService.overview(req.query as Record<string, unknown>, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /dashboard/people:
 *   get:
 *     operationId: getDashboardPeople
 *     summary: "Headcount, attendance, leave, grievances and training, summarised"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Dashboard"]
 *     x-roles: [admin]
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
 *                         headcount: { type: integer }
 *                         presentToday: { type: integer }
 *                         onLeave: { type: integer }
 *                         openGrievances: { type: integer }
 *                         overdueTraining: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getDashboardPeople = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await DashboardService.people(req.query as Record<string, unknown>, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /dashboard/revenue:
 *   get:
 *     operationId: getDashboardRevenue
 *     summary: "Revenue and how it is trending"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Dashboard"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: granularity
 *         schema: { type: string, enum: [day, week, month] }
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
 *                         total: { type: number, description: "Amount in INR" }
 *                         trendPct: { type: number }
 *                         series:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               date: { type: string, format: date }
 *                               revenue: { type: number, description: "Amount in INR" }
 *                               orders: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getDashboardRevenue = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await DashboardService.revenue(req.query as Record<string, unknown>, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /dashboard/risks:
 *   get:
 *     operationId: getDashboardRisks
 *     summary: "Everything outstanding that could hurt the business"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Dashboard"]
 *     x-roles: [admin]
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
 *                               kind: { type: string, enum: [compliance, insurance, audit, incident, equipment] }
 *                               title: { type: string }
 *                               severity: { type: string, enum: [low, medium, high] }
 *                               dueOn: { type: string, format: date }
 *                               link: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getDashboardRisks = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await DashboardService.risks(req.query as Record<string, unknown>, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /dashboard/satisfaction:
 *   get:
 *     operationId: getDashboardSatisfaction
 *     summary: "How customers are feeling"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Dashboard"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: storeId
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
 *                         average: { type: number }
 *                         trend: { type: number }
 *                         complaintsOpen: { type: integer }
 *                         byStore:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               storeId: { type: string, format: uuid }
 *                               average: { type: number }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getDashboardSatisfaction = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await DashboardService.satisfaction(req.query as Record<string, unknown>, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /dashboard/stores:
 *   get:
 *     operationId: getDashboardStores
 *     summary: "Stores side by side"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Dashboard"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: storeId
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
 *                         stores:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               storeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               revenue: { type: number, description: "Amount in INR" }
 *                               orders: { type: integer }
 *                               onTimePct: { type: number }
 *                               satisfaction: { type: number }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getDashboardStores = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await DashboardService.stores(req.query as Record<string, unknown>, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AdminDashboardController = {
  getDashboardOrders,
  getDashboardOverview,
  getDashboardPeople,
  getDashboardRevenue,
  getDashboardRisks,
  getDashboardSatisfaction,
  getDashboardStores,
};
