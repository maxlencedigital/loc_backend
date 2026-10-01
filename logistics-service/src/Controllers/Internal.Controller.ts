import { Request, Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { InternalJobService } from "../Services/InternalJob.Service.js";

// Service-to-service handlers. Deliberately not in Swagger: the gateway never proxies /internal.

const createJob = async (req: Request, res: Response) => {
  try {
    const { job, created: isNew } = await InternalJobService.createJob(req.body);
    return handleSuccessResponse({ statusCode: isNew ? created : successCode, result: job }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

const jobsForOrder = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await InternalJobService.jobsForOrder(req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

const retrySync = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await InternalJobService.retrySync(req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

const recordRating = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await InternalJobService.recordRating(req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const InternalController = { createJob, jobsForOrder, retrySync, recordRating };
