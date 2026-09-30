// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import authAccountRoutes from "./AuthAccount.Routes.js";
import adminUsersRoutes from "./AdminUsers.Routes.js";

const router = express.Router();

router.use(authAccountRoutes);
router.use(adminUsersRoutes);

export default router;
