const express = require('express');
const RequestAllocation_Controller = require('../controllers/RequestAllocation_Controller');
const router = express.Router();

router.post("/approverequest/:id", RequestAllocation_Controller.ApproveRequestAllocation);
router.get("/getrequestdetail/:id", RequestAllocation_Controller.getRequestAllocationDetail);
router.get("/getallrequest", RequestAllocation_Controller.getAllRequestAllocations);
module.exports = router; 