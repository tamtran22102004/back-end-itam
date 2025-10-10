const {body}= require("express-validator");

const createCategory = [
  body("name")
    .notEmpty()
    .withMessage("Category name is required")
    .isLength({ max: 255 })
    .withMessage("Category name must be at most 255 characters"),

  body("codePrefix")
    .notEmpty()
    .withMessage("Code prefix is required")
    .isLength({ max: 20 })
    .withMessage("Code prefix must be at most 20 characters"),

  body("maintenanceIntervalHours")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Maintenance interval must be a positive integer"),
];
const createAttribute = [
  body("name")
    .trim()
    .notEmpty().withMessage("Tên thuộc tính không được để trống")
    .isLength({ min: 2, max: 100 }).withMessage("Tên thuộc tính phải từ 2–100 ký tự"),
  body("measurementUnit")
    .optional({ checkFalsy: true })
    .notEmpty().withMessage("Đơn vị đo không được để trống nếu có")
    .isLength({ max: 50 }).withMessage("Đơn vị đo tối đa 50 ký tự"),
];
const categoryValidator = { createCategory, createAttribute };
module.exports = categoryValidator;