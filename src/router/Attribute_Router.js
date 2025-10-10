const express = require("express");
const Attribute_Controller = require("../controllers/Attribute_Controller");
const validate = require("../middleware/validate");
const AppError = require("../utils/AppError");
const router = express.Router();

router.get("/attributeDetail", Attribute_Controller.getAttribute);
router.post("/add", Attribute_Controller.createAttribute);
router.post("/update/:id", Attribute_Controller.updateAttribute);
router.delete("/delete/:id", Attribute_Controller.deleteAttribute);

module.exports = router;
