// utils/qr.util.js
const crypto = require("crypto");

const SECRET = process.env.QR_SIGN_SECRET || "dev-secret-change-me";

// base64url helpers
const toB64U = (buf) =>
  Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
const fromB64U = (s) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function signToken(assetId) {
  const idB64 = toB64U(String(assetId));
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(String(assetId))
    .digest();
  return `${idB64}.${toB64U(sig)}`;
}

function verifyToken(token) {
  try {
    const [idB64, sigB64] = String(token || "").split(".");
    if (!idB64 || !sigB64) return null;
    const assetId = fromB64U(idB64).toString();
    const good = signToken(assetId).split(".")[1];
    if (sigB64 !== good) return null;
    return assetId;
  } catch {
    return null;
  }
}

function buildApiBase(req) {
  // Ưu tiên header gốc; fallback từ request
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host =
    req.headers["x-forwarded-host"] || req.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

module.exports = { signToken, verifyToken, buildApiBase };
