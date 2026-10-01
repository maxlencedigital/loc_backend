import express from "express";
import { InternalController } from "../Controllers/Internal.Controller.js";
import { requireServiceCall } from "../Middleware/InternalAuth.js";
import { handleErrorResponse } from "../../commons/Response/Response.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { notFound } from "../../commons/Utils/StatusCode.js";

// Mounted at /internal, before every user-token route. The gateway faces the internet, so the
// secret and service-name check is the first thing on the path (a probe of any /internal URL gets
// 401, never a hint of which paths exist); only then do the narrow handlers and a JSON 404 follow.
const router = express.Router();

router.use(requireServiceCall);
router.get("/users/:id", InternalController.getUser);
router.post("/users/lookup", InternalController.lookupUsers);
router.post("/users/:id/deactivate", InternalController.deactivateUser);
router.post("/users/:id/reactivate", InternalController.reactivateUser);
router.use((_req, res) => handleErrorResponse(new CustomException("Not found.", notFound), res));

export default router;
