// routes/Dashboard_Router.js
const express = require("express");
const router = express.Router();

const Dashboard_Controller = require("../controllers/Dashboard_Controller");

// Tất cả endpoint dashboard đều yêu cầu đăng nhập
router.get("/summary" , Dashboard_Controller.getSummary);
router.get("/series" , Dashboard_Controller.getSeries);
router.get("/alerts", Dashboard_Controller.getAlerts);

module.exports = router;
