// services/QR_Service.js
const db = require("../config/database");
const AppError = require("../utils/AppError");
const { signToken } = require("../utils/qr");
const QRCode = require("qrcode");

/**
 * Đảm bảo asset có QRCode.
 * - Nếu đã có và force = false → trả lại QRCode cũ.
 * - Nếu chưa có hoặc force = true → sinh token mới, cập nhật vào asset.QRCode.
 */
const ensureAssetQr = async (assetId, { force = false } = {}) => {
  if (!assetId) throw new AppError("ASSET_ID_REQUIRED", 400);

  const [[asset]] = await db.execute(
    "SELECT ID, QRCode FROM asset WHERE ID = ? LIMIT 1",
    [assetId]
  );
  if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);

  if (asset.QRCode && !force) return asset.QRCode;

  // Sinh token mới cùng format với logic cũ
  const token = signToken(assetId);

  // Cập nhật lại QRCode cho asset
  await db.execute("UPDATE asset SET QRCode = ? WHERE ID = ?", [
    token,
    assetId,
  ]);

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
  return QRCode.toBuffer(url, {
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
