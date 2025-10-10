const express = require("express");
const Category_Controller = require("../controllers/Category_Controller");
const categoryValidator = require("../validator/Category_Validator");
const validate = require("../middleware/validate");
const authent = require("../middleware/authe");
const router = express.Router();

router.post(
  "/add",
  categoryValidator.createCategory,
  authent,
  validate,
  Category_Controller.CreateCategory
);
router.get("/", Category_Controller.getCategory);
router.post("/update/:id", Category_Controller.updateCategory);
router.delete("/delete/:id", Category_Controller.deleteCategory);

router.post("/attribute/add",Category_Controller.createCategoryAttribute)
module.exports = router;
