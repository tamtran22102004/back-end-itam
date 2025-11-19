const MaintenanceWorkOrder_Service = require("../services/MaintenanceWorkOrder_Service");
const AppError = require("../utils/AppError");
const { validationResult } = require("express-validator");
const { successResponse } = require("../utils/formatResponse");

/* ============================================================
   GET WORK ORDERS
   GET /api/maintenance/workorders?status=&asset=&assignee=&scheduleAssetId=&from=&to=
============================================================ */
const getWorkOrders = async (req, res, next) => {
  try {
    const result = await MaintenanceWorkOrder_Service.getWorkOrders(req.query);
    return successResponse(res, 200, result, "Get work orders successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError("Internal Server Error", 500)
    );
  }
};

/* ============================================================
   CREATE WORK ORDER
   POST /api/maintenance/workorders
============================================================ */
const createWorkOrder = async (req, res, next) => {
  try {
    const {
      ScheduleAssetID,
      AssetID,
      DueDate,
      PlannedStart,
      PlannedEnd,
      AssignedToUserID,
      Notes,
    } = req.body;

    if (!ScheduleAssetID)
      return next(new AppError("ScheduleAssetID is required", 400));
    if (!AssetID) return next(new AppError("AssetID is required", 400));
    if (!DueDate) return next(new AppError("DueDate is required", 400));

    const userId = req.user?.UserID || null;

    const result = await MaintenanceWorkOrder_Service.createWorkOrder({
      ScheduleAssetID,
      AssetID,
      DueDate,
      PlannedStart,
      PlannedEnd,
      AssignedToUserID,
      Notes,
      CreatedByUserID: req.user?.UserID || null,
    });

    return successResponse(res, 200, result, "Create work order successfully");
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(error.message, 500));
  }
};

/* ============================================================
   START WORK ORDER
   PATCH /api/maintenance/workorders/:id/start
============================================================ */
const startWorkOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      PlannedStart = null,
      ReceiverUserID,
      ReceiverDepartmentID = null,
    } = req.body;

    if (!Number(id)) return next(new AppError("Invalid WorkOrderID", 400));
    if (!ReceiverUserID)
      return next(new AppError("ReceiverUserID is required", 400));

    const result = await MaintenanceWorkOrder_Service.startWorkOrder(
      Number(id),
      {
        PlannedStart,
        ReceiverUserID: Number(ReceiverUserID),
        ReceiverDepartmentID:
          ReceiverDepartmentID !== null && ReceiverDepartmentID !== undefined
            ? Number(ReceiverDepartmentID)
            : null,
      }
    );

    return successResponse(res, 200, result, "Start work order successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

/* ============================================================
   COMPLETE WORK ORDER
   PATCH /api/maintenance/workorders/:id/complete
============================================================ */
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
    } = req.body;

    if (!Number(id)) return next(new AppError("Invalid WorkOrderID", 400));
    if (!ReturnUserID)
      return next(new AppError("ReturnUserID is required", 400));

    const result = await MaintenanceWorkOrder_Service.completeWorkOrder(
      Number(id),
      {
        CompletedAt,
        ResultNotes,
        Cost: Cost !== null && Cost !== undefined ? Number(Cost) : null,
        UpdateScheduleNext: Boolean(UpdateScheduleNext),
        ReturnUserID: Number(ReturnUserID),
        ReturnDepartmentID:
          ReturnDepartmentID !== null && ReturnDepartmentID !== undefined
            ? Number(ReturnDepartmentID)
            : null,
      }
    );

    return successResponse(
      res,
      200,
      result,
      "Complete work order successfully"
    );
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

/* ============================================================
   CANCEL WORK ORDER
   PATCH /api/maintenance/workorders/:id/cancel
============================================================ */
const cancelWorkOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { Reason = null } = req.body;

    if (!Number(id)) return next(new AppError("Invalid WorkOrderID", 400));

    const result = await MaintenanceWorkOrder_Service.cancelWorkOrder(
      Number(id),
      Reason
    );

    return successResponse(res, 200, result, "Cancel work order successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

module.exports = {
  getWorkOrders,
  createWorkOrder,
  startWorkOrder,
  completeWorkOrder,
  cancelWorkOrder,
};
