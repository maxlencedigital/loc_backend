// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { AdminExpensesController } from "../Controllers/AdminExpenses.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asAdmin = [requireIdentity, requireRole("admin")];
const asManager = [requireIdentity, requireRole("admin", "manager")];

router.get("/expense-categories", ...asAdmin, AdminExpensesController.listExpenseCategories);
router.post("/expense-categories", ...asAdmin, AdminExpensesController.createExpenseCategory);
router.get("/expense-categories/:id", ...asAdmin, AdminExpensesController.getExpenseCategory);
router.patch("/expense-categories/:id", ...asAdmin, AdminExpensesController.updateExpenseCategory);
router.delete("/expense-categories/:id", ...asAdmin, AdminExpensesController.deleteExpenseCategory);
router.get("/expenses", ...asManager, AdminExpensesController.listExpenses);
router.post("/expenses", ...asAdmin, AdminExpensesController.createExpense);
router.get("/expenses/:id", ...asManager, AdminExpensesController.getExpense);
router.patch("/expenses/:id", ...asAdmin, AdminExpensesController.updateExpense);
router.delete("/expenses/:id", ...asAdmin, AdminExpensesController.deleteExpense);
router.post("/expenses/:id/approve", ...asAdmin, AdminExpensesController.approveExpense);
router.post("/expenses/:id/receipt", ...asAdmin, AdminExpensesController.uploadExpenseReceipt);
router.get("/operating-costs", ...asAdmin, AdminExpensesController.listOperatingCosts);
router.post("/operating-costs", ...asAdmin, AdminExpensesController.createOperatingCost);
router.get("/operating-costs/monthly", ...asAdmin, AdminExpensesController.getMonthlyOperatingCost);
router.get("/operating-costs/:id", ...asAdmin, AdminExpensesController.getOperatingCost);
router.patch("/operating-costs/:id", ...asAdmin, AdminExpensesController.updateOperatingCost);
router.delete("/operating-costs/:id", ...asAdmin, AdminExpensesController.deleteOperatingCost);

export default router;
