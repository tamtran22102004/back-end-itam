const express = require("express");
const Ctrl = require("../controllers/Stocktake_Controller");
const router = express.Router();

router.get("/statistics/range", Ctrl.getStatistics);

// Danh sách / chi tiết
router.get("/", Ctrl.getSessions);
router.get("/:id", Ctrl.getSession);
router.get("/:id/lines", Ctrl.getLines);

// Tạo & seed
router.post("/add", Ctrl.createSession);
router.post("/seed/:id", Ctrl.seedSession);
router.post("/:id/scan", Ctrl.scanAsset);

// Cập nhật dòng & đóng phiên
router.patch("/:id/line/:lineId", Ctrl.updateLine);
router.post("/:id/close", Ctrl.closeSession);

module.exports = router;
