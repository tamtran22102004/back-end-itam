// controllers/RequestTransfer_Controller.js
const AppError = require("../utils/AppError");
const { validationResult } = require("express-validator");
const { successResponse } = require("../utils/formatResponse");
const RequestTransfer_Service = require("../services/RequestTransfer_Service");

const ApproveRequestTransfer = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Nếu có xài express-validator thì check, còn không dùng có thể bỏ block này
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError("VALIDATION_ERROR", 400, errors.array()));
    }

    const result = await RequestTransfer_Service.approveRequestTransfer(
      id,
      req.body
    );
    return successResponse(res, 200, result, "Approve Transfer Request Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

const getRequestTransferDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await RequestTransfer_Service.getRequestTransferDetail(id);
    return successResponse(res, 200, result, "Get Transfer Request Detail Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

const getAllRequestTransfers = async (req, res, next) => {
  try {
    const result =
      await RequestTransfer_Service.getAllRequestTransferDetail();
    return successResponse(
      res,
      200,
      result,
      "Get All Transfer Requests Successfully"
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
  ApproveRequestTransfer,
  getRequestTransferDetail,
  getAllRequestTransfers,
};
