import express from "express";
import { AdminUsersController } from "../Controllers/AdminUsers.Controller.js";
import { verifyToken, requireRole } from "../Middleware/Auth.js";

// Not generated: the catalogue scaffold guards GET /users as admin-only and has no
// POST /users, while managers must list their own store's team. The service scopes them.
const router = express.Router();

router.get("/users", verifyToken, requireRole("admin", "manager"), AdminUsersController.listUsers);
router.post("/users", verifyToken, requireRole("admin"), AdminUsersController.createUser);
// Declared before /users/:id so "roles" is never read as an id. A manager may read one account of
// their own store, so GET /users/:id lives here rather than in the admin-only generated routes.
router.get("/users/roles", verifyToken, requireRole("admin"), AdminUsersController.listRoles);
router.get("/users/:id", verifyToken, requireRole("admin", "manager"), AdminUsersController.getUser);

export default router;
