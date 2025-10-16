const express = require("express");
const Item_Controller = require("../controllers/Item_Controller");
const AssetValidator = require("../validator/Asset_Validator");
const validate = require("../middleware/validate");
const router = express.Router();

router.get("/", Item_Controller.getItemMaster);
router.post("/add", Item_Controller.createItemMaster);
router.post("/update/:id", Item_Controller.updateItemMaster);
router.post("/delete/:id", Item_Controller.deleteItemMaster);

router.get("/asset", Item_Controller.getAsset);
router.post(
  "/asset/add",
  AssetValidator.createAssetValidator,
  validate,
  Item_Controller.createAsset
);
router.post(
  "/asset/update/:id",
  AssetValidator.updateAssetValidator,
  validate,
  Item_Controller.updateAsset
);
router.post("/asset/delete/:id", Item_Controller.deleteAsset);

router.get("/:id/attribute",Item_Controller.getItemMasterAttribute)
module.exports = router;
