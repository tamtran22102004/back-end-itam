// controllers/QR_Controller.js
const config = require("../config/env");
const AppError = require("../utils/AppError");
const {
  ensureAssetQr,
  buildQrPngBuffer,
  findAssetByToken,
} = require("../services/QR_Service");
const { buildApiBase, parseAndVerify } = require("../utils/qr"); // ⬅️ sửa lại import
const { successResponse } = require("../utils/formatResponse");

// POST /api/qr/:id/mint-qr
const mintQr = async (req, res, next) => {
  try {
    const assetId = String(req.params.id);
    const forceRaw = String(req.query.force || "");
    const force = ["1", "true", "yes"].includes(forceRaw.toLowerCase());

    const token = await ensureAssetQr(assetId, { force });

    const apiBase = buildApiBase(req);
    const qrUrl = `${apiBase}/api/qr/${encodeURIComponent(token)}`;

    const buf = await buildQrPngBuffer(qrUrl, { width: 480, margin: 1 });
    const data = {
      assetId,
      token,
      qrUrl,
      pngBase64: `data:image/png;base64,${buf.toString("base64")}`,
    };
    return successResponse(res, 200, data, "Mint QR successfully");
  } catch (err) {
    return next(
      err instanceof AppError ? err : new AppError("QR_MINTING_FAILED", 500)
    );
  }
};

// GET /api/qr/:id/qr.png   ⬅️ trả binary PNG
const qrPngByAssetId = async (req, res, next) => {
  try {
    const assetId = String(req.params.id);
    const token = await ensureAssetQr(assetId, { force: false });

    const apiBase = buildApiBase(req);
    const qrUrl = `${apiBase}/api/qr/${encodeURIComponent(token)}`;

    const buf = await buildQrPngBuffer(qrUrl, { width: 720, margin: 1 });

    res.setHeader("Content-Type", "image/png");
    // res.setHeader("Cache-Control", "public, max-age=300, immutable");
    return res.send(buf);
  } catch (err) {
    return next(
      err instanceof AppError ? err : new AppError("QR_PNG_GENERATION_FAILED", 500)
    );
  }
};

// GET /api/qr/:token
const resolveToken = async (req, res, next) => {
  try {
    const token = String(req.params.token || "");
    const parsed = parseAndVerify(token);
    if (!parsed) throw new AppError("INVALID_QR_TOKEN", 404);

    const idFromDb = await findAssetByToken(token);
    if (!idFromDb || idFromDb.ID !== parsed.assetId) {
      throw new AppError("QR_TOKEN_REVOKED_OR_NOT_FOUND", 404);
    }

    const FE = config.app.PUBLIC_WEB_ORIGIN || "http://localhost:5173";
    const redirectUrl = `${FE}/assetdetail/${encodeURIComponent(parsed.assetId)}`;

    if (String(req.query.json || "") === "1") {
      const data = { success: true, assetId: parsed.assetId, redirect: redirectUrl };
      return successResponse(res, 200, data, "QR Token resolved successfully");
    }
    return res.redirect(302, redirectUrl);
  } catch (err) {
    return next(
      err instanceof AppError ? err : new AppError("QR_PROCESSING_FAILED", 500)
    );
  }
};

module.exports = { mintQr, qrPngByAssetId, resolveToken };
