const express = require("express");
const RequestDisposal_Controller = require("../controllers/RequestDisposal_Controller");
const router = express.Router();

router.post(
  "/approverequest/:id",
  RequestDisposal_Controller.approveRequestDisposal
);
router.get("/getallrequest", RequestDisposal_Controller.getAllRequestDisposalDetail);
router.get(
  "/getrequestdetail/:id",
  RequestDisposal_Controller.getRequestDisposalDetail
);

module.exports = router;
