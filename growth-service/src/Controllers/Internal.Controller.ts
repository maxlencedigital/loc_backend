import { Request, Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { CouponService } from "../Services/Coupon.Service.js";
import { LoyaltyService } from "../Services/Loyalty.Service.js";
import { NotificationService } from "../Services/Notification.Service.js";
import { PackageService } from "../Services/Package.Service.js";

// Service-to-service endpoints (not in Swagger: they are never proxied by the gateway). Each
// answers 200 with the shapes documented in design/modules/P12-growth.md.
const respond = (work: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await work(req) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const InternalController = {
  dispatchNotification: respond((req) => NotificationService.dispatch(req.body)),
  validateCoupon: respond((req) => CouponService.validateInternal(req.body)),
  redeemCoupon: respond((req) => CouponService.redeemInternal(req.body)),
  earnPoints: respond((req) => LoyaltyService.earn(req.body)),
  expirePoints: respond(() => LoyaltyService.expireDormant()),
  activatePackage: respond((req) => PackageService.activate(req.body)),
};
