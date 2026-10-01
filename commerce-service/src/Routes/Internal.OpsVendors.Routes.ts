import express from "express";
import { requireServiceCall } from "../Middleware/Identity.js";

const router = express.Router();

// Vendors and insurance
// Service-to-service endpoints only: every path starts with /internal and is answered for
// another service (never a user). The gateway refuses to proxy /internal from outside.
router.use("/internal", requireServiceCall);

export default router;
