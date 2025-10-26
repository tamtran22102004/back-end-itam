const express = require("express");
const RequestMaintenance_Controller = require("../controllers/RequestMaintenance_Controller.js");
const router = express.Router();

router.post(
  "/approverequest/:id",
  RequestMaintenance_Controller.ApproveRequestMaintenance
);

router.get("/getallrequest", RequestMaintenance_Controller.getAllRequestMaintenances);
router.get("/getrequestdetail/:id", RequestMaintenance_Controller.getRequestMaintenanceDetail);
module.exports = router;
