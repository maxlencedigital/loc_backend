import express from "express";
import { AdminUsersController } from "../Controllers/AdminUsers.Controller.js";
import { verifyToken, requireRole } from "../Middleware/Auth.js";

// Not generated: the catalogue scaffold guards GET /users as admin-only and has no
// POST /users, while managers must list their own store's team. The service scopes them.
const router = express.Router();

router.get("/users", verifyToken, requireRole("admin", "manager"), AdminUsersController.listUsers);
router.post("/users", verifyToken, requireRole("admin"), AdminUsersController.createUser);

export default router;
