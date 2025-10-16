const express = require("express");
const Item_Controller = require("../controllers/Item_Controller");
const authValidator = require("../validator/Auth_Validator");
const validate = require("../middleware/validate");
const router = express.Router();

router.get("/",Item_Controller.getItemMaster)
router.post("/add",Item_Controller.createItemMaster)
router.post("/update/:id",Item_Controller.updateItemMaster)
router.post("/delete/:id",Item_Controller.deleteItemMaster)
module.exports = router