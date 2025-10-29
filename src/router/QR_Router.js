// routes/qr.route.js
const express = require("express");
const router = express.Router();
const { verifyToken } = require("../utils/qr.util");
const AppError = require("../utils/AppError");

router.get("/:token", async (req, res, next) => {
  try {
    const token = String(req.params.token || "");
    const assetId = verifyToken(token);
    if (!assetId) throw new AppError("INVALID_QR_TOKEN", 404);

    const FE = process.env.PUBLIC_WEB_ORIGIN || "http://localhost:5173";
    const to = `${FE}/asset/${encodeURIComponent(assetId)}`;

    if (String(req.query.json || "") === "1") {
      return res.json({ success: true, assetId, redirect: to });
    }
    res.redirect(302, to);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
