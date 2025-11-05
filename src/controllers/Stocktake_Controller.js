// src/controllers/Stocktake_Controller.js
const AppError = require("../utils/AppError");
const { successResponse } = require("../utils/formatResponse");
const Svc = require("../services/Stocktake_Service.js");

const getSessions = async (req, res, next) => {
  try {
    const data = await Svc.getSessions();
    return successResponse(res, 200, data, "Get Stocktake Sessions Successfully");
  } catch (e) {
    next(e instanceof AppError ? e : new AppError(e.message, 500));
  }
};

const getSession = async (req, res, next) => {
  try {
    const data = await Svc.getSession(req.params.id);
    return successResponse(res, 200, data, "Get Stocktake Session Successfully");
  } catch (e) {
    next(e instanceof AppError ? e : new AppError(e.message, 500));
  }
};

const getLines = async (req, res, next) => {
  try {
    const data = await Svc.getLines(req.params.id);
    return successResponse(res, 200, data, "Get Stocktake Lines Successfully");
  } catch (e) {
    next(e instanceof AppError ? e : new AppError(e.message, 500));
  }
};

const createSession = async (req, res, next) => {
  try {
    const CreatedBy = req.user?.UserID || req.body.CreatedBy || null; // nếu có auth
    const data = await Svc.createSession({ ...req.body, CreatedBy });
    return successResponse(res, 200, data, "Create Stocktake Session Successfully");
  } catch (e) {
    next(e instanceof AppError ? e : new AppError(e.message, 500));
  }
};

const seedSession = async (req, res, next) => {
  try {
    const SessionID = req.params.id;
    const { assetIds = [], foundLocationId = null, defaultFound = true } = req.body || {};
    const data = await Svc.seedSession({ SessionID, assetIds, foundLocationId, defaultFound });
    return successResponse(res, 200, data, "Seed Stocktake Session Successfully");
  } catch (e) {
    next(e instanceof AppError ? e : new AppError(e.message, 500));
  }
};

const scanAsset = async (req, res, next) => {
  try {
    const SessionID = req.params.id;
    const payload = { SessionID, ...req.body };
    const data = await Svc.scanAsset(payload);
    return successResponse(res, 200, data, "Scan Asset Successfully");
  } catch (e) {
    next(e instanceof AppError ? e : new AppError(e.message, 500));
  }
};

const updateLine = async (req, res, next) => {
  try {
    const SessionID = req.params.id;
    const LineID = req.params.lineId;
    const data = await Svc.updateLine({ SessionID, LineID, ...req.body });
    return successResponse(res, 200, data, "Update Stocktake Line Successfully");
  } catch (e) {
    next(e instanceof AppError ? e : new AppError(e.message, 500));
  }
};

const closeSession = async (req, res, next) => {
  try {
    const SessionID = req.params.id;
    const data = await Svc.closeSession({ SessionID });
    return successResponse(res, 200, data, "Close Stocktake Session Successfully");
  } catch (e) {
    next(e instanceof AppError ? e : new AppError(e.message, 500));
  }
};

const getStatistics = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) throw new AppError("Thiếu tham số from/to (YYYY-MM-DD)", 400);
    const data = await Svc.getStatistics({ from, to });
    return successResponse(res, 200, data, "Get Stocktake Statistics Successfully");
  } catch (e) {
    next(e instanceof AppError ? e : new AppError(e.message, 500));
  }
};

module.exports = {
  getSessions,
  getSession,
  getLines,
  createSession,
  seedSession,
  scanAsset,
  updateLine,
  closeSession,
  getStatistics,
};
