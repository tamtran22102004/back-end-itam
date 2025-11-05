// validators/asset.validator.js
const { body, param } = require("express-validator");
const db = require("../config/database");
const AppError = require("../utils/AppError");

/** Helpers ngắn gọn */
const checkUnique = async (field, value, excludeId = null) => {
  if (!value) return;
  const sql = excludeId
    ? `SELECT ID FROM asset WHERE ${field}=? AND ID<>? LIMIT 1`
    : `SELECT ID FROM asset WHERE ${field}=? LIMIT 1`;
  const [rows] = excludeId
    ? await db.execute(sql, [value, excludeId])
    : await db.execute(sql, [value]);
  if (rows.length) throw new AppError(`${field} "${value}" đã tồn tại`, 400);
};

const exists = async (sql, args, msg) => {
  const [rows] = await db.execute(sql, args);
  if (!rows.length) throw new AppError(msg, 400);
  return rows[0];
};

const isYMD = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** CREATE */
const createAssetValidator = [
  body("ManageCode")
    .notEmpty()
    .withMessage("Mã quản lý nội bộ là bắt buộc")
    .isLength({ max: 50 })
    .withMessage("Mã nội bộ không quá 50 ký tự")
    .custom(async (v) => {
      await checkUnique("ManageCode", v);
      return true;
    }),

  body("AssetCode")
    .optional({ nullable: true })
    .isLength({ max: 50 })
    .withMessage("Mã tài sản kế toán không quá 50 ký tự")
    .custom(async (v) => {
      await checkUnique("AssetCode", v);
      return true;
    }),

  body("PurchaseId")
    .optional({ nullable: true })
    .isLength({ max: 100 })
    .withMessage("Mã phiếu mua không quá 100 ký tự")
    .custom(async (v) => {
      await checkUnique("PurchaseId", v);
      return true;
    }),

  // ✅ thêm unique SerialNumber & QRCode
  body("SerialNumber")
    .optional({ nullable: true })
    .custom(async (v) => {
      await checkUnique("SerialNumber", v);
      return true;
    }),
  body("QRCode")
    .optional({ nullable: true })
    .custom(async (v) => {
      await checkUnique("QRCode", v);
      return true;
    }),

  body("Name").notEmpty().withMessage("Tên thiết bị là bắt buộc"),

  body("CategoryID")
    .notEmpty()
    .withMessage("Danh mục là bắt buộc")
    .custom(async (catId) => {
      await exists(
        "SELECT 1 FROM category WHERE ID=? LIMIT 1",
        [catId],
        "CategoryID không tồn tại"
      );
      return true;
    }),

  // Lưu ManageType & Category của IM vào req để dùng tiếp bên dưới
  body("ItemMasterID")
    .optional({ nullable: true })
    .custom(async (imId, { req }) => {
      if (!imId) {
        req._manageType = "QUANTITY";
        return true;
      }
      const im = await exists(
        "SELECT ManageType, CategoryID FROM itemmaster WHERE ID=? LIMIT 1",
        [imId],
        "ItemMaster không tồn tại"
      );
      req._manageType = im.ManageType || "QUANTITY";
      req._imCategoryID = String(im.CategoryID);
      return true;
    }),

  // Category phải khớp category của ItemMaster (nếu có)
  body("CategoryID").custom((catId, { req }) => {
    if (req._imCategoryID && String(catId) !== req._imCategoryID) {
      throw new AppError("CategoryID phải khớp Category của ItemMaster", 400);
    }
    return true;
  }),

  body("VendorID")
    .optional({ nullable: true })
    .custom(async (vId) => {
      if (!vId) return true;
      await exists(
        "SELECT 1 FROM vendor WHERE ID=? LIMIT 1",
        [vId],
        "VendorID không tồn tại"
      );
      return true;
    }),

  body("Quantity")
    .isInt({ min: 1 })
    .withMessage("Số lượng phải là số nguyên dương")
    .custom((q, { req }) => {
      if ((req._manageType || "QUANTITY") === "INDIVIDUAL" && Number(q) !== 1) {
        throw new AppError("INDIVIDUAL yêu cầu Quantity = 1", 400);
      }
      return true;
    }),

  // Chỉ INDIVIDUAL mới cho set Employee/Section
  body("EmployeeID")
    .optional({ nullable: true })
    .custom(async (uId, { req }) => {
      if (!uId) return true;
      if ((req._manageType || "QUANTITY") !== "INDIVIDUAL")
        throw new AppError("Chỉ INDIVIDUAL mới được gán nhân viên", 400);
      await exists(
        "SELECT 1 FROM user WHERE UserID=? LIMIT 1",
        [uId],
        "EmployeeID không tồn tại"
      );
      return true;
    }),
  body("SectionID")
    .optional({ nullable: true })
    .custom(async (dId, { req }) => {
      if (!dId) return true;
      if ((req._manageType || "QUANTITY") !== "INDIVIDUAL")
        throw new AppError("Chỉ INDIVIDUAL mới được gán phòng ban", 400);
      await exists(
        "SELECT 1 FROM department WHERE DepartmentID=? LIMIT 1",
        [dId],
        "SectionID không tồn tại"
      );
      return true;
    }),

  body("Status")
    .isInt({ min: 1, max: 6 })
    .withMessage("Trạng thái không hợp lệ"),

  body("PurchasePrice")
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage("Giá mua phải ≥ 0"),

  body("WarrantyMonth")
    .optional({ nullable: true })
    .isInt({ min: 0 })
    .withMessage("Số tháng bảo hành phải ≥ 0"),

  // Ngày: YYYY-MM-DD + End ≥ Start
  body("PurchaseDate")
    .optional({ nullable: true })
    .custom(
      (v) =>
        !v ||
        isYMD(v) ||
        (() => {
          throw new AppError("PurchaseDate phải YYYY-MM-DD", 400);
        })()
    ),
  body("WarrantyStartDate")
    .optional({ nullable: true })
    .custom(
      (v) =>
        !v ||
        isYMD(v) ||
        (() => {
          throw new AppError("WarrantyStartDate phải YYYY-MM-DD", 400);
        })()
    ),
  body("WarrantyEndDate")
    .optional({ nullable: true })
    .custom((end, { req }) => {
      const start = req.body.WarrantyStartDate;
      if (end && !isYMD(end))
        throw new AppError("WarrantyEndDate phải YYYY-MM-DD", 400);
      if (start && end && new Date(start) > new Date(end))
        throw new AppError("WarrantyEndDate phải ≥ WarrantyStartDate", 400);
      return true;
    }),
];

/** UPDATE */
const updateAssetValidator = [
  param("id").notEmpty().withMessage("Thiếu ID Asset trong URL"),

  body("ManageCode")
    .notEmpty()
    .withMessage("Mã quản lý nội bộ là bắt buộc")
    .custom(async (v, { req }) => {
      await checkUnique("ManageCode", v, req.params.id);
      return true;
    }),

  body("AssetCode")
    .optional({ nullable: true })
    .custom(async (v, { req }) => {
      await checkUnique("AssetCode", v, req.params.id);
      return true;
    }),

  body("PurchaseId")
    .optional({ nullable: true })
    .custom(async (v, { req }) => {
      await checkUnique("PurchaseId", v, req.params.id);
      return true;
    }),

  body("SerialNumber")
    .optional({ nullable: true })
    .custom(async (v, { req }) => {
      await checkUnique("SerialNumber", v, req.params.id);
      return true;
    }),

  body("QRCode")
    .optional({ nullable: true })
    .custom(async (v, { req }) => {
      await checkUnique("QRCode", v, req.params.id);
      return true;
    }),

  body("Name").notEmpty().withMessage("Tên thiết bị là bắt buộc"),

  // Load manageType (từ body.ItemMasterID nếu có; nếu không thì từ asset cũ)
  body("ItemMasterID")
    .optional({ nullable: true })
    .custom(async (imId, { req }) => {
      if (imId) {
        const im = await exists(
          "SELECT ManageType, CategoryID FROM itemmaster WHERE ID=? LIMIT 1",
          [imId],
          "ItemMaster không tồn tại"
        );
        req._manageType = im.ManageType || "QUANTITY";
        req._imCategoryID = String(im.CategoryID);
      } else {
        const old = await exists(
          "SELECT ItemMasterID, Quantity, RemainQuantity, CategoryID FROM asset WHERE ID=? LIMIT 1",
          [req.params.id],
          "Asset không tồn tại"
        );
        req._allocated = (old.Quantity || 0) - (old.RemainQuantity || 0);
        if (old.ItemMasterID) {
          const im = await exists(
            "SELECT ManageType, CategoryID FROM itemmaster WHERE ID=? LIMIT 1",
            [old.ItemMasterID],
            "ItemMaster không tồn tại"
          );
          req._manageType = im.ManageType || "QUANTITY";
          req._imCategoryID = String(im.CategoryID);
        } else {
          req._manageType = "QUANTITY";
          req._imCategoryID = String(old.CategoryID);
        }
      }
      return true;
    }),

  // Category sync với ItemMaster
  body("CategoryID")
    .notEmpty()
    .withMessage("Danh mục là bắt buộc")
    .custom(async (catId, { req }) => {
      await exists(
        "SELECT 1 FROM category WHERE ID=? LIMIT 1",
        [catId],
        "CategoryID không tồn tại"
      );
      if (req._imCategoryID && String(catId) !== req._imCategoryID) {
        throw new AppError("CategoryID phải khớp Category của ItemMaster", 400);
      }
      return true;
    }),

  body("Quantity")
    .isInt({ min: 1 })
    .withMessage("Số lượng phải là số nguyên dương")
    .custom(async (q, { req }) => {
      // nếu chưa có _allocated (trường hợp ItemMasterID có trong body), lấy nhanh
      if (typeof req._allocated === "undefined") {
        const old = await exists(
          "SELECT Quantity, RemainQuantity FROM asset WHERE ID=? LIMIT 1",
          [req.params.id],
          "Asset không tồn tại"
        );
        req._allocated = (old.Quantity || 0) - (old.RemainQuantity || 0);
      }
      if ((req._manageType || "QUANTITY") === "INDIVIDUAL") {
        if (Number(q) !== 1)
          throw new AppError("INDIVIDUAL yêu cầu Quantity = 1", 400);
      } else {
        if (Number(q) < Number(req._allocated || 0)) {
          throw new AppError(
            `Quantity mới (${q}) < số đang cấp phát (${req._allocated})`,
            400
          );
        }
      }
      return true;
    }),

  // Chỉ INDIVIDUAL cho phép set
  body("EmployeeID")
    .optional({ nullable: true })
    .custom(async (uId, { req }) => {
      if (!uId) return true;
      if ((req._manageType || "QUANTITY") !== "INDIVIDUAL")
        throw new AppError("Chỉ INDIVIDUAL mới được gán nhân viên", 400);
      await exists(
        "SELECT 1 FROM user WHERE UserID=? LIMIT 1",
        [uId],
        "EmployeeID không tồn tại"
      );
      return true;
    }),
  body("SectionID")
    .optional({ nullable: true })
    .custom(async (dId, { req }) => {
      if (!dId) return true;
      if ((req._manageType || "QUANTITY") !== "INDIVIDUAL")
        throw new AppError("Chỉ INDIVIDUAL mới được gán phòng ban", 400);
      await exists(
        "SELECT 1 FROM department WHERE DepartmentID=? LIMIT 1",
        [dId],
        "SectionID không tồn tại"
      );
      return true;
    }),

  body("Status")
    .isInt({ min: 1, max: 6 })
    .withMessage("Trạng thái không hợp lệ"),

  body("PurchasePrice")
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage("Giá mua phải ≥ 0"),

  body("WarrantyMonth")
    .optional({ nullable: true })
    .isInt({ min: 0 })
    .withMessage("Số tháng bảo hành phải ≥ 0"),

  body("PurchaseDate")
    .optional({ nullable: true })
    .custom(
      (v) =>
        !v ||
        isYMD(v) ||
        (() => {
          throw new AppError("PurchaseDate phải YYYY-MM-DD", 400);
        })()
    ),
  body("WarrantyStartDate")
    .optional({ nullable: true })
    .custom(
      (v) =>
        !v ||
        isYMD(v) ||
        (() => {
          throw new AppError("WarrantyStartDate phải YYYY-MM-DD", 400);
        })()
    ),
  body("WarrantyEndDate")
    .optional({ nullable: true })
    .custom((end, { req }) => {
      const start = req.body.WarrantyStartDate;
      if (end && !isYMD(end))
        throw new AppError("WarrantyEndDate phải YYYY-MM-DD", 400);
      if (start && end && new Date(start) > new Date(end))
        throw new AppError("WarrantyEndDate phải ≥ WarrantyStartDate", 400);
      return true;
    }),
];

const AssetValidator = { createAssetValidator, updateAssetValidator };
module.exports = AssetValidator;
