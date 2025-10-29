// services/QR_Service.js
const db = require("../config/database");
const AppError = require("../utils/AppError");
const { signToken } = require("../utils/qr.util");
const QRCode = require("qrcode");

const ensureAssetQr = async (assetId, { force = false } = {}) => {
  const [[asset]] = await db.execute(
    "SELECT ID, QRCode FROM asset WHERE ID = ? LIMIT 1",
    [assetId]
  );
  if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);

  if (asset.QRCode && !force) return asset.QRCode;

  const token = signToken(assetId);
  // Lưu token vào cột QRCode (khuyến nghị unique)
  await db.execute("UPDATE asset SET QRCode=? WHERE ID=?", [token, assetId]);
  return token;
};

const findAssetByToken = async (token) => {
  const [[row]] = await db.execute(
    "SELECT ID FROM asset WHERE QRCode = ? LIMIT 1",
    [token]
  );
  return row || null;
};

const buildQrPngBuffer = async (url, { width = 512, margin = 1 } = {}) => {
  return await QRCode.toBuffer(url, {
    type: "png",
    width,
    margin,
    errorCorrectionLevel: "M",
  });
};

module.exports = {
  ensureAssetQr,
  findAssetByToken,
  buildQrPngBuffer,
};
