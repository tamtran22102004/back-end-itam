const express = require("express")
const router =express.Router()
const validate = require("../middleware/validate");
const vendorController = require("../controllers/vendorController")

router.get("/",vendorController.getVendor);
router.post("/add",vendorController.createVendor)

module.exports = router;