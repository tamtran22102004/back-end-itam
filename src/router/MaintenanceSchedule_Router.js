const express = require("express");
const MaintenanceSchedule_Controller = require("../controllers/MaintenanceSchedule_Controller");
const MaintenanceWorkOrder_Controller = require("../controllers/MaintenanceWorkOrder_Controller");
const router = express.Router();

// SCHEDULE routes
router.get("/schedules", MaintenanceSchedule_Controller.getSchedules);
router.post("/schedules", MaintenanceSchedule_Controller.createSchedule);
router.patch("/schedules/:id", MaintenanceSchedule_Controller.updateSchedule);
router.post(
  "/schedules/:id/generate-wo",
  MaintenanceSchedule_Controller.generateWOForSchedule
);

// GET list work orders
router.get("/workorders", MaintenanceWorkOrder_Controller.getWorkOrders);

// CREATE WO
router.post("/workorders", MaintenanceWorkOrder_Controller.createWorkOrder);

// START WO
router.patch(
  "/workorders/:id/start",
  MaintenanceWorkOrder_Controller.startWorkOrder
);

// COMPLETE WO
router.patch(
  "/workorders/:id/complete",
  MaintenanceWorkOrder_Controller.completeWorkOrder
);

// CANCEL WO
router.patch(
  "/workorders/:id/cancel",
  MaintenanceWorkOrder_Controller.cancelWorkOrder
);

module.exports = router;
