const AppError = require("../utils/AppError");
const MaintenanceSchedule_Service = require("../services/MaintenanceSchedule_Service");
const { successResponse } = require("../utils/formatResponse");
const { validationResult } = require("express-validator");

// =====================================
// GET LIST /api/maintenance/schedules
// =====================================
const getSchedules = async (req, res, next) => {
  try {
    const result = await MaintenanceSchedule_Service.getSchedules();
    return successResponse(res, 200, result, "Get schedules successfully");
  } catch (error) {
    next(error instanceof AppError ? error :
      new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

// =====================================
// CREATE SCHEDULE (multi-assets)
// POST /api/maintenance/schedules
// =====================================
const createSchedule = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return next(new AppError("Validation Error", 400, errors.array()));

    const {
      Title,
      IntervalMonths,
      NextMaintenanceDate,
      Priority,
      Notes,
      AutoCreateWorkOrder,
      Assets // [{AssetID, AssignedToUserID, ReminderDaysBefore, ...}]
    } = req.body;

    if (!Title || !NextMaintenanceDate || !Array.isArray(Assets))
      return next(new AppError("Missing required params", 400));

    const userId = req.user?.UserID || null;

    const result = await MaintenanceSchedule_Service.createSchedule({
      Title,
      IntervalMonths,
      NextMaintenanceDate,
      Priority,
      Notes,
      AutoCreateWorkOrder,
      CreatedByUserID: userId,
      Assets
    });

    return successResponse(res, 200, result, "Create schedule successfully");
  } catch (error) {
    next(error instanceof AppError ? error :
      new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

// =====================================
// PATCH /api/maintenance/schedules/:id
// =====================================
const updateSchedule = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) return next(new AppError("Missing id", 400));

    const result = await MaintenanceSchedule_Service.updateSchedule(
      Number(id),
      req.body
    );

    return successResponse(res, 200, result, "Update schedule successfully");
  } catch (error) {
    next(error instanceof AppError ? error :
      new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

// =====================================
// POST /api/maintenance/schedules/:id/generate-wo
// =====================================
const generateWOForSchedule = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) return next(new AppError("Missing id", 400));

    const userId = req.user?.UserID || null;

    const result = await MaintenanceSchedule_Service.generateWOForSchedule(
      Number(id),
      userId
    );

    return successResponse(res, 200, result, "Generate work orders successfully");
  } catch (error) {
    next(error instanceof AppError ? error :
      new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

module.exports = {
  getSchedules,
  createSchedule,
  updateSchedule,
  generateWOForSchedule,
};
