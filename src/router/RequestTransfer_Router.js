// routes/RequestTransfer_Router.js
const express = require("express");
const RequestTransfer_Controller = require("../controllers/RequestTransfer_Controller");

const router = express.Router();

router.post(
  "/approverequest/:id",
  RequestTransfer_Controller.ApproveRequestTransfer
);

router.get(
  "/getrequestdetail/:id",
  RequestTransfer_Controller.getRequestTransferDetail
);

router.get("/getallrequest", RequestTransfer_Controller.getAllRequestTransfers);

module.exports = router;
