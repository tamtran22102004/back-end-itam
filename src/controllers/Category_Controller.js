const CategoryService = require("../services/Category_Serivce");
const AppError = require("../utils/AppError");
const { validationResult } = require("express-validator");
const { successResponse } = require("../utils/formatResponse");

const CreateCategory = async (req, res, next) => {
  try {
    const { name, codePrefix, maintenanceIntervalHours } = req.body;
    if (!name || !codePrefix || !maintenanceIntervalHours) {
      return next(new AppError("Missing required params", 400));
    }
    const result = await CategoryService.createCategory(
      name,
      codePrefix,
      maintenanceIntervalHours
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

const getCategory = async (req, res, next) => {
  try {
    const result = await CategoryService.getCategory();
    return successResponse(res, 200, result, "Get Category successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

const updateCategory = async (req, res, next) => {
  try {
    const { id, name, codePrefix, maintenanceIntervalHours } = req.body;
    console.log(req.body);
    const result = await CategoryService.updateCategory(
      id,
      name,
      codePrefix,
      maintenanceIntervalHours
    );
    return successResponse(res, 200, result, "Update Category Sucessfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
const deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await CategoryService.deleteCategory(id);
    return successResponse(res, 200, result, "Delete Category Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

const createCategoryAttribute = async (req, res, next) => {
  const { CategoryID, AttributeID, IsRequired, DisplayOrder } = req.body;
  try {
    const result = await CategoryService.createCategoryAttribute(
      CategoryID,
      AttributeID,
      IsRequired,
      DisplayOrder
    );
    return successResponse(
      res,
      200,
      result,
      "Create CategoryAttribute Successfully"
    );
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

const getAttributeConfig = async (req, res, next) => {
  try {
    const { categoryId } = req.params;
    const data = await CategoryService.getAttributesByCategory(
      categoryId
    );
    return successResponse(
      res,
      200,
      data,
      "Get CategoryAttribute Successfully"
    );
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};

const saveAttributeConfig = async (req, res, next) => {
  try {
    const { categoryId } = req.params;
    const mappings = Array.isArray(req.body.mappings) ? req.body.mappings : [];

    await CategoryService.saveCategoryAttributes(categoryId, mappings);
    res.json({ success: true, message: "Đã lưu cấu hình thuộc tính." });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  CreateCategory,
  getCategory,
  updateCategory,
  deleteCategory,
  createCategoryAttribute,
  getAttributeConfig,
  saveAttributeConfig,
};
