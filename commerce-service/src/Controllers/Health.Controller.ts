import { Request, Response } from "express";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode, serviceUnavailable } from "../../commons/Utils/StatusCode.js";
import { CustomException } from "../../commons/Exception/CustomException.js";

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Liveness/readiness probe
 *     description: Returns 200 only if the database connection is actually reachable.
 *     responses:
 *       200:
 *         description: Service and database are healthy.
 *       503:
 *         description: Database is unreachable.
 */
const check = async (_req: Request, res: Response) => {
  try {
    // A real round trip: $connect() alone can succeed against a pool that has
    // not reached Postgres, making an unreachable database report healthy.
    await prisma.$queryRaw`SELECT 1`;
    return handleSuccessResponse(
      { statusCode: successCode, result: { service: "commerce-service", db: "up" } },
      res,
      "Service is healthy."
    );
  } catch (error) {
    console.error("Health check failed:", error);
    return handleErrorResponse(
      new CustomException("Database unreachable.", serviceUnavailable),
      res
    );
  }
};

export const HealthController = { check };
