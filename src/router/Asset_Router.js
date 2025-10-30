const express = require("express");
const Asset_Controller = require("../controllers/Asset_Controller");
const validate = require("../middleware/validate");
const AppError = require("../utils/AppError");
const AssetValidator = require("../validator/Asset_Validator")


const router = express.Router();

router.get("/", Asset_Controller.getAsset);
router.post(
  "/add",
  AssetValidator.createAssetValidator,
  validate,
  Asset_Controller.createAsset
);
router.post(
  "/update/:id",
  AssetValidator.updateAssetValidator,
  validate,
  Asset_Controller.updateAsset
);
router.post("/delete/:id", Asset_Controller.deleteAsset);

router.get("/assetconfig",Asset_Controller.getAssetConfig)
router.post("/assetconfig/add",Asset_Controller.createAssetConfig)
router.post("/assetconfig/update",Asset_Controller.updateAssetConfig)
router.post("/assetconfig/delete/:id",Asset_Controller.deleteAssetConfig)


router.get("/assetdetail/:id",Asset_Controller.getAssetDetail)

router.get("/assethistory",Asset_Controller.getAssetHistory)








module.exports = router