const AppError = require("../utils/AppError");
const { validationResult } = require("express-validator");
const { successResponse } = require("../utils/formatResponse");
const RequestWarranty_Service = require("../services/RequestWarranty_Service");

const approveRequestWarranty = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await RequestWarranty_Service.approveRequestWarranty(
      id,
      req.body
    );
    successResponse(res, 200, result, "Approve Request Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

const getRequestWarrantyDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await RequestWarranty_Service.getRequestWarrantyDetail(id);
    successResponse(
      res,
      200,
      result,
      "Get Request Warranty Detail Successfully"
    );
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

const getAllRequestWarrantyDetail = async (req, res, next) => {
  try {
    const result = await RequestWarranty_Service.getAllRequestWarrantyDetail();
    successResponse(
      res,
      200,
      result,
      "Get All Request Warranty Detail Successfully"
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
  approveRequestWarranty,
  getRequestWarrantyDetail,
  getAllRequestWarrantyDetail,
};
