import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { handleErrorResponse } from "../../commons/Response/Response.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { unauthorized } from "../../commons/Utils/StatusCode.js";

// The gateway is the one public service, so unlike the others its /internal routes cannot rely on
// "only the gateway can reach me": they check the shared secret themselves, and which service is calling.

const SERVICE_NAMES = ["gateway", "commerce", "logistics", "finance", "growth"];

// Hashing both sides first gives timingSafeEqual equal-length inputs, so neither the content nor
// the length of the real secret leaks through timing.
const sameSecret = (given: string, expected: string): boolean =>
  crypto.timingSafeEqual(
    crypto.createHash("sha256").update(given).digest(),
    crypto.createHash("sha256").update(expected).digest()
  );

// One message for every refusal: a probe learns nothing about which check failed.
const refuse = (res: Response) =>
  handleErrorResponse(new CustomException("This endpoint is for other services only.", unauthorized), res);

export const requireServiceCall = (req: Request, res: Response, next: NextFunction) => {
  const expected = process.env.INTERNAL_SERVICE_SECRET;
  const given = req.header("x-internal-secret");
  const service = req.header("x-service-name");
  if (!expected || !given || !service || !SERVICE_NAMES.includes(service)) return refuse(res);
  if (!sameSecret(given, expected)) return refuse(res);
  next();
};
