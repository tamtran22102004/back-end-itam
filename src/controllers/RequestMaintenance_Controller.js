const AppError = require("../utils/AppError");
const { validationResult } = require("express-validator");
const { successResponse } = require("../utils/formatResponse");
const RequestMaintenance_Service = require("../services/RequestMaintenance_Service");

const ApproveRequestMaintenance = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await RequestMaintenance_Service.approveRequestMaintenance(
      id,
      req.body
    );
    return successResponse(res, 200, result, "Create Request Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
const getRequestMaintenanceDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await RequestMaintenance_Service.getRequestMaintenanceDetail(
      id
    );
    return successResponse(res, 200, result, "Get Request Detail Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
const getAllRequestMaintenances = async (req, res, next) => {
  try {
    const result =
      await RequestMaintenance_Service.getAllRequestMaintenanceDetail();
    return successResponse(
      res,
      200,
      result,
      "Get All Request Maintenances Successfully"
    );
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

module.exports = { ApproveRequestMaintenance, getRequestMaintenanceDetail, getAllRequestMaintenances };
