const AppError = require("../utils/AppError");
const { validationResult } = require("express-validator");
const { successResponse } = require("../utils/formatResponse");
const RequestAllocation_Service = require("../services/RequestAllocation_Service");

const CreateRequestAllocation = async (req, res, next) => {
  try {
    const result = await RequestAllocation_Service.createRequestAllocation(
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
const ApproveRequestAllocation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await RequestAllocation_Service.approveRequestAllocation(
      id,
      req.body
    );
    return successResponse(res, 200, result, "Approve Request Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
const getRequestAllocationDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await RequestAllocation_Service.getRequestAllocationDetail(
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
const getAllRequestAllocations = async (req, res, next) => {
  try {
    const result =
      await RequestAllocation_Service.getAllRequestAllocationDetail();
    return successResponse(
      res,
      200,
      result,
      "Get All Request Allocations Successfully"
    );
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
module.exports = {
  CreateRequestAllocation,
  ApproveRequestAllocation,
  getRequestAllocationDetail,
  getAllRequestAllocations,
};
