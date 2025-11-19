// routes/qr.js
const express = require("express");
const router = express.Router();
const QR_Controller = require("../controllers/QR_Controller");

// Tạo / xem QR (base)
router.post("/:id/mint-qr", QR_Controller.mintQr);

// Lấy ảnh PNG QR theo AssetID
router.get("/:id/qr.png", QR_Controller.qrPngByAssetId);

// Scan QR (token) → redirect FE
router.get("/:token", QR_Controller.resolveToken);

// 🔥 API mới: Re-mint QR hoàn toàn mới (token mới)
router.post("/:id/remint", QR_Controller.reMintQr);

module.exports = router;
