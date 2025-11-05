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
// body: { PlannedStart?, ReceiverUserID (required), ReceiverDepartmentID? }
const startWorkOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      PlannedStart = null,
      ReceiverUserID,
      ReceiverDepartmentID = null,
    } = req.body || {};

    const woId = Number(id);
    if (!woId) return next(new AppError("Invalid work order id", 400));
    if (!ReceiverUserID)
      return next(new AppError("ReceiverUserID is required", 400));

    const result = await MaintenanceWorkOrder_Service.startWorkOrder(woId, {
      PlannedStart,
      ReceiverUserID: Number(ReceiverUserID),
      ReceiverDepartmentID:
        ReceiverDepartmentID !== undefined && ReceiverDepartmentID !== null
          ? Number(ReceiverDepartmentID)
          : null,
    });

    return successResponse(res, 200, result, "Start work order successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

// PATCH /api/maintenance/workorders/:id/complete
// body: {
//   CompletedAt?, ResultNotes?, Cost?, UpdateScheduleNext?=true,
//   ReturnUserID (required), ReturnDepartmentID?
// }
const completeWorkOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      CompletedAt = null,
      ResultNotes = null,
      Cost = null,
      UpdateScheduleNext = true,
      ReturnUserID,
      ReturnDepartmentID = null,
    } = req.body || {};

    const woId = Number(id);
    if (!woId) return next(new AppError("Invalid work order id", 400));
    if (!ReturnUserID)
      return next(new AppError("ReturnUserID is required", 400));

    const result = await MaintenanceWorkOrder_Service.completeWorkOrder(woId, {
      CompletedAt,
      ResultNotes,
      Cost: Cost !== undefined && Cost !== null ? Number(Cost) : null,
      UpdateScheduleNext: Boolean(UpdateScheduleNext),
      ReturnUserID: Number(ReturnUserID),
      ReturnDepartmentID:
        ReturnDepartmentID !== undefined && ReturnDepartmentID !== null
          ? Number(ReturnDepartmentID)
          : null,
    });

    return successResponse(res, 200, result, "Complete work order successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
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
