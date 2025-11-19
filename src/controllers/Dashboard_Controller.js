// controllers/Dashboard_Controller.js
const Dashboard_Service = require("../services/Dashboard_Service");
const AppError = require("../utils/AppError");
const { successResponse } = require("../utils/formatResponse");

// Hàm đọc filter từ query string và chuẩn hóa
const parseFilters = (query) => {
  const filters = {};

  if (query.from) filters.from = query.from;          // 'YYYY-MM-DD'
  if (query.to) filters.to = query.to;                // 'YYYY-MM-DD'
  if (query.dept) filters.dept = Number(query.dept);  // DepartmentID
  if (query.cat) filters.cat = String(query.cat);     // CategoryID (varchar)

  if (query.warrantyDays !== undefined) {
    filters.warrantyDays = Number(query.warrantyDays);
  }

  if (query.limit !== undefined) {
    filters.limit = Number(query.limit);
  }

  return filters;
};

/* ============================================================
   GET /api/dashboard/summary
   Trả về KPI tổng quan: tổng TS, giá trị, sử dụng, bảo trì, kiểm kê, phê duyệt
============================================================ */
const getSummary = async (req, res, next) => {
  try {
    const filters = parseFilters(req.query);
    const result = await Dashboard_Service.getSummary(filters);

    return successResponse(
      res,
      200,
      result,
      "Lấy thông tin tổng quan dashboard thành công"
    );
  } catch (error) {
    console.error("Dashboard getSummary error:", error);
    next(
      error instanceof AppError
        ? error
        : new AppError("Internal Server Error", 500)
    );
  }
};

/* ============================================================
   GET /api/dashboard/series
   Trả về các series cho biểu đồ:
   - valueByDept: giá trị theo phòng ban
   - countByCategory: số lượng theo danh mục
   - assetStatus: trạng thái tài sản
   - maintenanceByMonth: WO bảo trì theo tháng
============================================================ */
const getSeries = async (req, res, next) => {
  try {
    const filters = parseFilters(req.query);
    const result = await Dashboard_Service.getSeries(filters);

    return successResponse(
      res,
      200,
      result,
      "Lấy dữ liệu biểu đồ dashboard thành công"
    );
  } catch (error) {
    console.error("Dashboard getSeries error:", error);
    next(
      error instanceof AppError
        ? error
        : new AppError("Internal Server Error", 500)
    );
  }
};

/* ============================================================
   GET /api/dashboard/alerts?limit=&warrantyDays=
   Trả về các bảng cảnh báo:
   - expiringWarranty: hết / sắp hết bảo hành
   - overdueMaintenance: bảo trì quá hạn
   - stocktakeMissing: mất/thiếu trong kiểm kê gần nhất
   - approvalSlaBreach: yêu cầu phê duyệt trễ SLA
============================================================ */
const getAlerts = async (req, res, next) => {
  try {
    const filters = parseFilters(req.query);
    const result = await Dashboard_Service.getAlerts(filters);

    return successResponse(
      res,
      200,
      result,
      "Lấy danh sách cảnh báo dashboard thành công"
    );
  } catch (error) {
    console.error("Dashboard getAlerts error:", error);
    next(
      error instanceof AppError
        ? error
        : new AppError("Internal Server Error", 500)
    );
  }
};

module.exports = {
  getSummary,
  getSeries,
  getAlerts,
};
