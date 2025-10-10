const AttributeService = require("../services/Attribute_Service");
const AppError = require("../utils/AppError");
const { validationResult } = require("express-validator");
const { successResponse } = require("../utils/formatResponse");

const getAttribute = async (req, res, next) => {
  try {
    const result = await AttributeService.getAttribute();
    return successResponse(res, 200, result, "Get attribute successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
const createAttribute = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError("Validation Error", 400, errors.array()));
    }
    const { name, measurementUnit } = req.body;
    if (!name || !measurementUnit) {
      return next(new AppError("Missing required params", 400));
    }
    const result = await AttributeService.creaeAttribute(name, measurementUnit);
    return successResponse(res, 200, result, "Create attribute successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
const updateAttribute = async (req, res, next) => {
  try {
    const { id, name, measurementUnit } = req.body;
    const result = await AttributeService.updateAttribute(
      id,
      name,
      measurementUnit
    );
    return successResponse(res, 200, result, "Update attribute successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
const deleteAttribute = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await AttributeService.deleteAttribute(id);
    return successResponse(res, 200, result, "Delete attribute successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
module.exports = {
  getAttribute,
  createAttribute,
  updateAttribute,
  deleteAttribute,
};
