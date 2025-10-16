const { name } = require("ejs");
const AppError = require("../utils/AppError");
const { successResponse } = require("../utils/formatResponse");
const ItemService = require("../services/Item_Service");

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
    const { ID, CategoryID, ManufacturerID, Name, ManageType, Quantity } =
      req.body;
    const result = await ItemService.createItemMaster(
      ID,
      CategoryID,
      ManufacturerID,
      Name,
      ManageType,
      Quantity
    );
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
    const { ID, CategoryID, ManufacturerID, Name, ManageType, Quantity } =
      req.body;
    const result = await ItemService.updateItemMaster(
      ID,
      CategoryID,
      ManufacturerID,
      Name,
      ManageType,
      Quantity
    );
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
module.exports = { createItemMaster, getItemMaster, updateItemMaster,deleteItemMaster };
