const express = require("express");
const config = require("../config/env");
const router = express.Router();
const QR_Controller = require("../controllers/QR_Controller");


router.post("/:id/mint-qr", QR_Controller.mintQr)
router.get("/:id/qr.png", QR_Controller.qrPngByAssetId);
router.get("/:token", QR_Controller.resolveToken);

module.exports = router;
