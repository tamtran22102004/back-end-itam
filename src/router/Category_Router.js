const express = require("express");
const Category_Controller = require("../controllers/Category_Controller");
const categoryValidator = require("../validator/Category_Validator");
const validate = require("../middleware/validate");
const authent = require("../middleware/authe");
const { getCategory } = require("../services/Category_Serivce");
const router = express.Router();

router.post("/add",  Category_Controller.CreateCategory);
router.get("/", Category_Controller.getCategory);
router.post("/update/:id", Category_Controller.updateCategory);
router.delete("/delete/:id", Category_Controller.deleteCategory);
router.post("/attribute/add",Category_Controller.createCategoryAttribute)

router.get("/:categoryId/attribute-config", Category_Controller.getAttributeConfig);
router.post("/:categoryId/attribute-config", Category_Controller.saveAttributeConfig);


router.get("/manufacturer",Category_Controller.getManufacturer)
module.exports = router;
