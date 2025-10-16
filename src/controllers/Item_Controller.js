const { name } = require("ejs");
const AppError = require("../utils/AppError");
const { successResponse } = require("../utils/formatResponse");
const ItemService = require("../services/Item_Service");
const { app } = require("../config/env");

const getItemMaster = async (req, res, next) => {
  try {
    const result = await ItemService.getItemMaster();
    successResponse(res, 200, result, "Get Data ItemMaster Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

const createItemMaster = async (req, res, next) => {
  try {
    const result = await ItemService.createItemMaster(req.body);
    return successResponse(res, 200, result, "Create category successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
const updateItemMaster = async (req, res, next) => {
  try {
    const result = await ItemService.updateItemMaster(req.params.id, req.body);
    return successResponse(res, 200, result, "Update Item Master Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
const deleteItemMaster = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await ItemService.deleteItemMaster(id);
    return successResponse(res, 200, result, "Delete Item Master Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

const createAsset = async (req, res, next) => {
  try {
    const result = await ItemService.createAssetService(req.body);
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
    const result = await ItemService.getAssetService();
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
    const result = await ItemService.updateAssetService(id, req.body);
    return successResponse(res, 200, result, "Cập nhật Asset thành công");
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(error.message, 500));
  }
};
const deleteAsset = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await ItemService.deleteAssetService(id);
    return successResponse(res, 200, result, "Xóa Asset thành công");
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(error.message, 500));
  }
};
const getItemMasterAttribute =async(req,res,next)=>{
  try {
    const itemId = req.params.id;
    const result = await ItemService.getItemMasterAttributeService(itemId)
    return successResponse(res,200,result,"Get ItemMasterAttribute Successfully")
  } catch (error) {
    next(
      error instanceof AppError
      ?error
      :new AppError(error.message || "Không thể tải thuộc tính", 500));
  }
};


module.exports = {
  createItemMaster,
  getItemMaster,
  updateItemMaster,
  deleteItemMaster,
  createAsset,
  getAsset,
  updateAsset,
  deleteAsset,
  getItemMasterAttribute
};
