const Asset_Service = require("../services/Asset_Service");
const AppError = require("../utils/AppError");
const { validationResult } = require("express-validator");
const { successResponse } = require("../utils/formatResponse");
const { get } = require("mongoose");

const createAsset = async (req, res, next) => {
  try {
    const result = await Asset_Service.createAssetService(req.body);
    return successResponse(res, 200, result, "Create Asset Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

const getAsset = async (req, res, next) => {
  try {
    const result = await Asset_Service.getAssetService();
    return successResponse(res, 200, result, "Get Asset Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
const updateAsset = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await Asset_Service.updateAssetService(id, req.body);
    return successResponse(res, 200, result, "Cập nhật Asset thành công");
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(error.message, 500));
  }
};
const deleteAsset = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await Asset_Service.deleteAssetService(id);
    return successResponse(res, 200, result, "Xóa Asset thành công");
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(error.message, 500));
  }
};

const getAssetConfig = async (req, res, next) => {
  try {
    const result = await Asset_Service.getAssetConfig();
    return successResponse(res, 200, result, "Get Asset Detail Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

const createAssetConfig = async (req, res, next) => {
  try {
    const { AssetID, AttributeID, Value } = req.body;
    const result = await Asset_Service.createAssetConfig(
      AssetID,
      AttributeID,
      Value
    );
    return successResponse(
      res,
      200,
      result,
      "Create Asset Detail Successfully"
    );
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
const updateAssetConfig = async (req, res, next) => {
  try {
    const { ID, Value } = req.body;
    const result = await Asset_Service.updateAssetConfig(ID, Value);
    return successResponse(
      res,
      200,
      result,
      "Update Asset Config Successfully"
    );
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
const deleteAssetConfig = async (req, res, next) => {
  try {
    const { id } = req.params; // ✅ chỉ lấy giá trị id
    const result = await Asset_Service.deleteAssetConfig(id);
    return successResponse(res, 200, result, "Delete AssetConfig Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
const getAssetDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await Asset_Service.getAssetDetail(id);
    return successResponse(res, 200, result, "Get Asset Detail Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
const getAssetHistory = async (req, res, next) => {
  try {
    const result = await Asset_Service.getAssetHistory();
    return successResponse(res, 200, result, "Get Asset History Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
module.exports = {
  createAsset,
  getAsset,
  updateAsset,
  deleteAsset,
  getAssetConfig,
  createAssetConfig,
  updateAssetConfig,
  deleteAssetConfig,
  getAssetDetail,
  getAssetHistory,
};
