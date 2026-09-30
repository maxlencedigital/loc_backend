// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { AdminUsersController } from "../Controllers/AdminUsers.Controller.js";
import { verifyToken, requireRole } from "../Middleware/Auth.js";

const router = express.Router();

const asAdmin = [verifyToken, requireRole("admin")];

router.get("/users", ...asAdmin, AdminUsersController.listUsers);
router.get("/users/roles", ...asAdmin, AdminUsersController.listRoles);
router.get("/users/:id", ...asAdmin, AdminUsersController.getUser);
router.patch("/users/:id", ...asAdmin, AdminUsersController.updateUser);
router.post("/users/:id/deactivate", ...asAdmin, AdminUsersController.deactivateUser);
router.post("/users/:id/invite/resend", ...asAdmin, AdminUsersController.resendInvite);
router.post("/users/:id/reactivate", ...asAdmin, AdminUsersController.reactivateUser);
router.post("/users/:id/reset-password", ...asAdmin, AdminUsersController.adminResetPassword);
router.put("/users/:id/stores", ...asAdmin, AdminUsersController.setUserStores);

export default router;
