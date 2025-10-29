const MaintenanceWorkOrder_Service = require("../services/MaintenanceWorkOrder_Service");
const AppError = require("../utils/AppError");
const { validationResult } = require("express-validator");
const { successResponse } = require("../utils/formatResponse");

// GET /api/maintenance/workorders?status=&asset=&from=&to=&assignee=
const getWorkOrders = async (req, res, next) => {
  try {
    const result = await MaintenanceWorkOrder_Service.getWorkOrders(req.query);
    return successResponse(res, 200, result, "Get work orders successfully");
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(error.message || "Internal Server Error", 500));
  }
};

// POST /api/maintenance/workorders
const createWorkOrder = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new AppError("Validation Error", 400, errors.array()));

    const {
      ScheduleID,
      AssetID,
      DueDate,
      PlannedStart,
      PlannedEnd,
      AssignedToUserID,
      Notes,
    } = req.body;

    if (!AssetID || !DueDate) return next(new AppError("Missing required params", 400));
    const userId = req.user?.UserID || null;

    const result = await MaintenanceWorkOrder_Service.createWorkOrder({
      ScheduleID,
      AssetID,
      DueDate,
      PlannedStart,
      PlannedEnd,
      AssignedToUserID,
      Notes,
      CreatedByUserID: userId,
    });
    return successResponse(res, 200, result, "Create work order successfully");
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(error.message || "Internal Server Error", 500));
  }
};

// PATCH /api/maintenance/workorders/:id/start
const startWorkOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { PlannedStart } = req.body || {};
    const result = await MaintenanceWorkOrder_Service.startWorkOrder(Number(id), PlannedStart);
    return successResponse(res, 200, result, "Start work order successfully");
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(error.message || "Internal Server Error", 500));
  }
};

// PATCH /api/maintenance/workorders/:id/complete
const completeWorkOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      CompletedAt,
      ResultNotes,
      Cost,
      UpdateScheduleNext = true,
    } = req.body || {};
    if (!CompletedAt) return next(new AppError("Missing CompletedAt", 400));

    const result = await MaintenanceWorkOrder_Service.completeWorkOrder(
      Number(id),
      CompletedAt,
      ResultNotes,
      Cost,
      UpdateScheduleNext
    );
    return successResponse(res, 200, result, "Complete work order successfully");
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(error.message || "Internal Server Error", 500));
  }
};

// PATCH /api/maintenance/workorders/:id/cancel
const cancelWorkOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { Reason } = req.body || {};
    const result = await MaintenanceWorkOrder_Service.cancelWorkOrder(Number(id), Reason);
    return successResponse(res, 200, result, "Cancel work order successfully");
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(error.message || "Internal Server Error", 500));
  }
};

module.exports = {
  getWorkOrders,
  createWorkOrder,
  startWorkOrder,
  completeWorkOrder,
  cancelWorkOrder,
};
