// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { HrEmployeesController } from "../Controllers/HrEmployees.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asHrOrManager = [requireIdentity, requireRole("admin", "hr", "manager")];
const asHr = [requireIdentity, requireRole("admin", "hr")];

router.get("/hr/employees", ...asHrOrManager, HrEmployeesController.listEmployees);
router.post("/hr/employees", ...asHr, HrEmployeesController.createEmployee);
router.get("/hr/employees/:id", ...asHrOrManager, HrEmployeesController.getEmployee);
router.patch("/hr/employees/:id", ...asHr, HrEmployeesController.updateEmployee);
router.post("/hr/employees/:id/deactivate", ...asHr, HrEmployeesController.deactivateEmployee);
router.post("/hr/employees/:id/documents", ...asHr, HrEmployeesController.uploadEmployeeDocument);
router.get("/hr/employees/:id/documents", ...asHr, HrEmployeesController.listEmployeeDocuments);
router.delete("/hr/employees/:id/documents/:docId", ...asHr, HrEmployeesController.deleteEmployeeDocument);
router.get("/hr/employees/:id/onboarding", ...asHr, HrEmployeesController.getEmployeeOnboarding);
router.patch("/hr/employees/:id/onboarding/items/:itemId", ...asHr, HrEmployeesController.updateOnboardingItem);
router.post("/hr/employees/:id/reactivate", ...asHr, HrEmployeesController.reactivateEmployee);
router.get("/hr/onboarding/templates/:role", ...asHr, HrEmployeesController.getOnboardingTemplate);
router.put("/hr/onboarding/templates/:role", ...asHr, HrEmployeesController.setOnboardingTemplate);
router.get("/hr/summary", ...asHrOrManager, HrEmployeesController.getHrSummary);

export default router;
