const AppError = require("../utils/AppError");
const MaintenanceSchedule_Service = require("../services/MaintenanceSchedule_Service");
const { successResponse } = require("../utils/formatResponse");
const { validationResult } = require("express-validator");
// GET /api/maintenance/schedules?status=&assignee=&from=&to=&asset=
const getSchedules = async (req, res, next) => {
  try {
    const result = await MaintenanceSchedule_Service.getSchedules(req.query);
    return successResponse(res, 200, result, "Get schedules successfully");
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(error.message || "Internal Server Error", 500));
  }
};

// POST /api/maintenance/schedules
const createSchedule = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new AppError("Validation Error", 400, errors.array()));

    const {
      AssetID,
      IntervalMonths,
      NextMaintenanceDate,
      AssignedToUserID,
      ReminderDaysBefore,
      WindowStart,
      WindowEnd,
      EstimatedHours,
      Priority,
      Notes,
      AutoCreateWorkOrder,
    } = req.body;

    if (!AssetID || !NextMaintenanceDate) return next(new AppError("Missing required params", 400));

    const userId = req.user?.UserID || null;
    const result = await MaintenanceSchedule_Service.createSchedule({
      AssetID,
      IntervalMonths,
      NextMaintenanceDate,
      AssignedToUserID,
      ReminderDaysBefore,
      WindowStart,
      WindowEnd,
      EstimatedHours,
      Priority,
      Notes,
      AutoCreateWorkOrder,
      CreatedByUserID: userId,
    });

    return successResponse(res, 200, result, "Create schedule successfully");
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(error.message || "Internal Server Error", 500));
  }
};

// PATCH /api/maintenance/schedules/:id  (update fields or Cancel)
const updateSchedule = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) return next(new AppError("Missing id", 400));

    const result = await MaintenanceSchedule_Service.updateSchedule(Number(id), req.body);
    return successResponse(res, 200, result, "Update schedule successfully");
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(error.message || "Internal Server Error", 500));
  }
};

// POST /api/maintenance/schedules/:id/generate-wo
const generateWOForSchedule = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) return next(new AppError("Missing id", 400));
    const userId = req.user?.UserID || null;

    const result = await MaintenanceSchedule_Service.generateWOForCurrentCycle(Number(id), userId);
    return successResponse(res, 200, result, "Generate work order successfully");
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(error.message || "Internal Server Error", 500));
  }
};

module.exports = {
  getSchedules,
  createSchedule,
  updateSchedule,
  generateWOForSchedule,
};

