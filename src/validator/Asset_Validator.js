const { body, param } = require("express-validator");
const db = require("../config/database");
const AppError = require("../utils/AppError");

/**
 * ✅ Kiểm tra giá trị unique trong DB
 */
const checkUnique = async (field, value, excludeId = null) => {
  if (!value) return; // bỏ qua nếu không có giá trị
  const sql = excludeId
    ? `SELECT ID FROM Asset WHERE ${field} = ? AND ID != ? LIMIT 1`
    : `SELECT ID FROM Asset WHERE ${field} = ? LIMIT 1`;

  const [rows] = excludeId
    ? await db.execute(sql, [value, excludeId])
    : await db.execute(sql, [value]);

  if (rows.length > 0) {
    throw new AppError(`${field} "${value}" đã tồn tại`, 400);
  }
};

/**
 * 🟢 Validator cho CREATE
 */
const createAssetValidator = [
  body("ManageCode")
    .notEmpty()
    .withMessage("Mã quản lý nội bộ là bắt buộc")
    .isLength({ max: 50 })
    .withMessage("Mã nội bộ không quá 50 ký tự")
    .custom(async (value) => {
      await checkUnique("ManageCode", value);
      return true;
    }),

  body("AssetCode")
    .optional({ nullable: true })
    .isLength({ max: 50 })
    .withMessage("Mã tài sản kế toán không quá 50 ký tự")
    .custom(async (value) => {
      await checkUnique("AssetCode", value);
      return true;
    }),

  body("PurchaseId")
    .optional({ nullable: true })
    .isLength({ max: 100 })
    .withMessage("Mã phiếu mua không quá 100 ký tự")
    .custom(async (value) => {
      await checkUnique("PurchaseId", value);
      return true;
    }),

  body("Name").notEmpty().withMessage("Tên thiết bị là bắt buộc"),

  body("CategoryID")
    .notEmpty()
    .withMessage("Danh mục là bắt buộc")
    .isString()
    .withMessage("CategoryID phải là chuỗi"),

  body("ItemMasterID")
    .optional({ nullable: true })
    .isString()
    .withMessage("ItemMasterID phải là chuỗi"),

  body("VendorID")
    .optional({ nullable: true })
    .isString()
    .withMessage("VendorID phải là chuỗi"),

  body("Quantity")
    .isInt({ min: 1 })
    .withMessage("Số lượng phải là số nguyên dương"),

  body("Status")
    .isInt({ min: 1, max: 6 })
    .withMessage("Trạng thái không hợp lệ"),

  body("PurchasePrice")
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage("Giá mua phải >= 0"),

  body("WarrantyMonth")
    .optional({ nullable: true })
    .isInt({ min: 0 })
    .withMessage("Số tháng bảo hành phải >= 0"),
];

/**
 * 🟡 Validator cho UPDATE
 */
const updateAssetValidator = [
  param("id").notEmpty().withMessage("Thiếu ID Asset trong URL"),
  body("ManageCode")
    .notEmpty()
    .withMessage("Mã quản lý nội bộ là bắt buộc")
    .custom(async (value, { req }) => {
      await checkUnique("ManageCode", value, req.params.id);
      return true;
    }),
  body("AssetCode")
    .optional({ nullable: true })
    .custom(async (value, { req }) => {
      await checkUnique("AssetCode", value, req.params.id);
      return true;
    }),
  body("PurchaseId")
    .optional({ nullable: true })
    .custom(async (value, { req }) => {
      await checkUnique("PurchaseId", value, req.params.id);
      return true;
    }),
  body("Name").notEmpty().withMessage("Tên thiết bị là bắt buộc"),
  body("Quantity")
    .isInt({ min: 1 })
    .withMessage("Số lượng phải là số nguyên dương"),
  body("Status")
    .isInt({ min: 1, max: 6 })
    .withMessage("Trạng thái không hợp lệ"),
];

const AssetValidator = {createAssetValidator,updateAssetValidator}
module.exports = AssetValidator;

