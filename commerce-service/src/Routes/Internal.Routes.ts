import express from "express";
import customerAccountInternal from "./Internal.CustomerAccount.Routes.js";
import supportFeedbackInternal from "./Internal.SupportFeedback.Routes.js";
import storeFloorInternal from "./Internal.StoreFloor.Routes.js";
import storeAdminInternal from "./Internal.StoreAdmin.Routes.js";
import hrCoreInternal from "./Internal.HrCore.Routes.js";
import hrPeopleInternal from "./Internal.HrPeople.Routes.js";
import opsVendorsInternal from "./Internal.OpsVendors.Routes.js";
import opsEquipmentInternal from "./Internal.OpsEquipment.Routes.js";
import opsComplianceInternal from "./Internal.OpsCompliance.Routes.js";
import essInternal from "./Internal.Ess.Routes.js";

// One internal router per work package, so packages never edit the same file.
const router = express.Router();

router.use(customerAccountInternal);
router.use(supportFeedbackInternal);
router.use(storeFloorInternal);
router.use(storeAdminInternal);
router.use(hrCoreInternal);
router.use(hrPeopleInternal);
router.use(opsVendorsInternal);
router.use(opsEquipmentInternal);
router.use(opsComplianceInternal);
router.use(essInternal);

export default router;
