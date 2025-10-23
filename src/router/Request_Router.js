// routes/request.js
const express = require("express");
const Request_Controller = require("../controllers/Request_Controller");
const router = express.Router();

router.post("/createrequest", Request_Controller.CreateRequest);

module.exports = router;
