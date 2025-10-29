const express = require("express");
const RequestWarranty_Controller = require("../controllers/RequestWarranty_Controller");
const router = express.Router();

router.post(
  "/approverequest/:id",
  RequestWarranty_Controller.approveRequestWarranty
);
router.get("/getallrequest", RequestWarranty_Controller.getAllRequestWarrantyDetail);
router.get(
  "/getrequestdetail/:id",
  RequestWarranty_Controller.getRequestWarrantyDetail
);

module.exports = router;