const db = require("../config/database"); // mysql2/promise pool
const AppError = require("../utils/AppError");

/* ============================================================
   Helper: build filter cho bảng asset (a)
============================================================ */
const buildAssetFilter = ({ from, to, dept, cat }) => {
  let where = "WHERE 1=1";
  const params = [];

  if (cat) {
    where += " AND a.CategoryID = ?";
    params.push(cat);
  }

  if (dept) {
    where += " AND a.SectionID = ?";
    params.push(dept);
  }

  if (from) {
    where += " AND (a.PurchaseDate IS NULL OR a.PurchaseDate >= ?)";
    params.push(from);
  }

  if (to) {
    where += " AND (a.PurchaseDate IS NULL OR a.PurchaseDate <= ?)";
    params.push(to);
  }

  return { where, params };
};

/* ============================================================
   Helper: build filter cho WorkOrder (wo) + join asset (a)
============================================================ */
const buildWorkOrderFilter = ({ from, to, dept, cat }) => {
  let where = "WHERE 1=1";
  const params = [];

  if (from) {
    where += " AND wo.DueDate >= ?";
    params.push(from);
  }
  if (to) {
    where += " AND wo.DueDate <= ?";
    params.push(to);
  }
  if (dept) {
    where += " AND a.SectionID = ?";
    params.push(dept);
  }
  if (cat) {
    where += " AND a.CategoryID = ?";
    params.push(cat);
  }

  return { where, params };
};

/* ============================================================
   Helper: build filter cho stocktakesession (s)
============================================================ */
const buildStocktakeFilter = ({ from, to, dept }) => {
  let where = "WHERE 1=1";
  const params = [];

  if (from) {
    where += " AND s.StartedAt >= ?";
    params.push(from + " 00:00:00");
  }
  if (to) {
    where += " AND s.StartedAt <= ?";
    params.push(to + " 23:59:59");
  }
  if (dept) {
    where += " AND s.DepartmentID = ?";
    params.push(dept);
  }

  return { where, params };
};

/* ============================================================
   Helper: build filter cho request (r)
============================================================ */
const buildRequestFilter = ({ from, to }) => {
  let where = "WHERE 1=1";
  const params = [];

  if (from) {
    where += " AND r.CreatedAt >= ?";
    params.push(from + " 00:00:00");
  }
  if (to) {
    where += " AND r.CreatedAt <= ?";
    params.push(to + " 23:59:59");
  }

  return { where, params };
};

/* ============================================================
   SUMMARY
============================================================ */
const getSummary = async (filters = {}) => {
  const conn = await db.getConnection();
  try {
    const { where: assetWhere, params: assetParams } =
      buildAssetFilter(filters);
    const { where: woWhere, params: woParams } = buildWorkOrderFilter(filters);
    const { where: stWhere, params: stParams } = buildStocktakeFilter(filters);
    const { where: reqWhere, params: reqParams } = buildRequestFilter(filters);

    const { from, to, dept, cat } = filters;

    // 1. Tổng quan tài sản + utilization + tổng quantity
    const [assetRows] = await conn.execute(
      `
      SELECT
        COUNT(*) AS assets,
        SUM(COALESCE(a.Quantity, 1)) AS totalQty,
        SUM(COALESCE(a.PurchasePrice, 0)) AS purchaseValue,
        COUNT(DISTINCT a.SectionID) AS departments,
        COUNT(DISTINCT a.CategoryID) AS categories,
        SUM(CASE WHEN a.Status = 2 THEN 1 ELSE 0 END) AS inUse
      FROM asset a
      ${assetWhere}
      `,
      assetParams
    );
    const assetStat = assetRows[0] || {};
    const totalAssets = Number(assetStat.assets || 0);
    const totalQty = Number(assetStat.totalQty || 0);
    const inUse = Number(assetStat.inUse || 0);

    // 2. Bảo trì (WorkOrder)
    const [woRows] = await conn.execute(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN wo.Status = 'DONE' THEN 1 ELSE 0 END) AS done,
        SUM(
          CASE 
            WHEN wo.Status <> 'CANCELLED'
             AND wo.Status <> 'DONE'
             AND wo.DueDate < CURDATE()
            THEN 1 ELSE 0
          END
        ) AS overdue
      FROM maintenanceworkorder wo
      JOIN asset a ON wo.AssetID = a.ID
      ${woWhere}
      `,
      woParams
    );
    const woStat = woRows[0] || {};

    // 3. Số phiên kiểm kê (stocktakesession)
    const [stRows] = await conn.execute(
      `
      SELECT COUNT(*) AS sessions
      FROM stocktakesession s
      ${stWhere}
      `,
      stParams
    );
    const stStat = stRows[0] || {};

    // 3b. Tài sản mất / thiếu – từ assethistory (Type = 'STOCKTAKE_MISSING')
    let missingWhere = "WHERE h.Type = 'STOCKTAKE_MISSING'";
    const missingParams = [];

    if (from) {
      missingWhere += " AND h.ActionAt >= ?";
      missingParams.push(from + " 00:00:00");
    }
    if (to) {
      missingWhere += " AND h.ActionAt <= ?";
      missingParams.push(to + " 23:59:59");
    }
    if (dept) {
      missingWhere += " AND a.SectionID = ?";
      missingParams.push(dept);
    }
    if (cat) {
      missingWhere += " AND a.CategoryID = ?";
      missingParams.push(cat);
    }

    const [missingRows] = await conn.execute(
      `
      SELECT
        SUM(COALESCE(h.Quantity, 1)) AS missingQty,
        COUNT(DISTINCT h.AssetID) AS missingAssets,
        SUM(
          COALESCE(
            COALESCE(a.PurchasePrice, 0) * COALESCE(h.Quantity, 1)
              / NULLIF(COALESCE(a.Quantity, 1), 0),
            0
          )
        ) AS missingValue
      FROM assethistory h
      JOIN asset a ON h.AssetID = a.ID
      ${missingWhere}
      `,
      missingParams
    );
    const missingStat = missingRows[0] || {};
    const missingQty = Number(missingStat.missingQty || 0);
    const missingAssets = Number(missingStat.missingAssets || 0);
    const missingValue = Number(missingStat.missingValue || 0);
    const missingRate = totalQty > 0 ? missingQty / totalQty : 0;

    // 3c. Dòng vào/ra (AVAILABLE vs DISPOSED + STOCKTAKE_MISSING)
    let moveWhere = "WHERE 1=1";
    const moveParams = [];

    if (from) {
      moveWhere += " AND h.ActionAt >= ?";
      moveParams.push(from + " 00:00:00");
    }
    if (to) {
      moveWhere += " AND h.ActionAt <= ?";
      moveParams.push(to + " 23:59:59");
    }
    if (dept) {
      moveWhere += " AND a.SectionID = ?";
      moveParams.push(dept);
    }
    if (cat) {
      moveWhere += " AND a.CategoryID = ?";
      moveParams.push(cat);
    }

    const [moveRows] = await conn.execute(
      `
      SELECT
        SUM(
          CASE WHEN h.Type = 'AVAILABLE'
               THEN COALESCE(h.Quantity, 1) ELSE 0 END
        ) AS inQty,
        SUM(
          CASE WHEN h.Type IN ('DISPOSED', 'STOCKTAKE_MISSING')
               THEN COALESCE(h.Quantity, 1) ELSE 0 END
        ) AS outQty,
        SUM(
          CASE WHEN h.Type = 'AVAILABLE'
               THEN COALESCE(
                 COALESCE(a.PurchasePrice, 0) * COALESCE(h.Quantity, 1)
                   / NULLIF(COALESCE(a.Quantity, 1), 0),
                 0
               )
               ELSE 0 END
        ) AS inValue,
        SUM(
          CASE WHEN h.Type IN ('DISPOSED', 'STOCKTAKE_MISSING')
               THEN COALESCE(
                 COALESCE(a.PurchasePrice, 0) * COALESCE(h.Quantity, 1)
                   / NULLIF(COALESCE(a.Quantity, 1), 0),
                 0
               )
               ELSE 0 END
        ) AS outValue
      FROM assethistory h
      JOIN asset a ON h.AssetID = a.ID
      ${moveWhere}
      `,
      moveParams
    );
    const mv = moveRows[0] || {};
    const inQty = Number(mv.inQty || 0);
    const outQty = Number(mv.outQty || 0);
    const inValue = Number(mv.inValue || 0);
    const outValue = Number(mv.outValue || 0);

    // 4. Yêu cầu phê duyệt
    const [reqRows] = await conn.execute(
      `
      SELECT
        SUM(CASE WHEN r.CurrentState = 'PENDING' THEN 1 ELSE 0 END) AS pending,
        SUM(
          CASE 
            WHEN r.CurrentState = 'PENDING'
             AND DATEDIFF(NOW(), r.CreatedAt) > 3
            THEN 1 ELSE 0
          END
        ) AS breach
      FROM request r
      ${reqWhere}
      `,
      reqParams
    );
    const reqStat = reqRows[0] || {};

    return {
      totals: {
        assets: totalAssets,
        totalQty,
        purchaseValue: Number(assetStat.purchaseValue || 0),
        departments: Number(assetStat.departments || 0),
        categories: Number(assetStat.categories || 0),
      },
      utilization: totalAssets > 0 ? inUse / totalAssets : 0,
      maintenance: {
        total: Number(woStat.total || 0),
        done: Number(woStat.done || 0),
        overdue: Number(woStat.overdue || 0),
      },
      stocktake: {
        sessions: Number(stStat.sessions || 0),
        missingCount: missingQty, // KPI đang dùng
        missingQty,
        missingAssets,
        missingRate,
        missingValue,
      },
      movement: {
        inQty,
        outQty,
        netQty: inQty - outQty,
        inValue,
        outValue,
        netValue: inValue - outValue,
      },
      approval: {
        pending: Number(reqStat.pending || 0),
        breach: Number(reqStat.breach || 0),
      },
    };
  } catch (err) {
    throw new AppError(err.message || "Lỗi lấy summary dashboard", 500);
  } finally {
    conn.release();
  }
};

/* ============================================================
   SERIES cho biểu đồ
============================================================ */
const getSeries = async (filters = {}) => {
  const conn = await db.getConnection();
  try {
    const { where: assetWhere, params: assetParams } =
      buildAssetFilter(filters);
    const { where: woWhere, params: woParams } = buildWorkOrderFilter(filters);
    const { from, to, dept, cat } = filters;

    // 1. Giá trị tài sản theo phòng ban
    const [valueByDeptRows] = await conn.execute(
      `
      SELECT
        COALESCE(d.DepartmentName, 'Chưa gán phòng') AS deptName,
        SUM(COALESCE(a.PurchasePrice, 0)) AS totalValue
      FROM asset a
      LEFT JOIN department d ON a.SectionID = d.DepartmentID
      ${assetWhere}
      GROUP BY d.DepartmentID, d.DepartmentName
      ORDER BY totalValue DESC
      `,
      assetParams
    );

    // 2. Số lượng tài sản theo asset (top 20)
    const [quantityByAssetRows] = await conn.execute(
      `
      SELECT
        a.ID AS AssetID,
        a.Name AS assetName,
        SUM(COALESCE(a.Quantity, 1)) AS totalQty
      FROM asset a
      ${assetWhere}
      GROUP BY a.ID, a.Name
      ORDER BY totalQty DESC
      LIMIT 20
      `,
      assetParams
    );

    // 3. Trạng thái tài sản
    const [assetStatusRows] = await conn.execute(
      `
      SELECT
        a.Status AS statusCode,
        COUNT(*) AS count
      FROM asset a
      ${assetWhere}
      GROUP BY a.Status
      ORDER BY count DESC
      `,
      assetParams
    );

    const assetStatus = assetStatusRows.map((r) => {
      let statusName = "Không xác định";
      switch (r.statusCode) {
        case 1:
          statusName = "Sẵn sàng";
          break;
        case 2:
          statusName = "Đang sử dụng";
          break;
        case 3:
          statusName = "Bảo hành";
          break;
        case 4:
          statusName = "Sửa chữa";
          break;
        case 5:
          statusName = "Hủy";
          break;
        case 6:
          statusName = "Thanh lý";
          break;
        default:
          statusName = `Trạng thái ${r.statusCode ?? "N/A"}`;
      }
      return {
        statusCode: r.statusCode,
        statusName,
        count: Number(r.count || 0),
      };
    });

    // 4. Bảo trì theo tháng
    const [maintenanceRows] = await conn.execute(
      `
      SELECT
        DATE_FORMAT(wo.DueDate, '%Y-%m') AS monthLabel,
        COUNT(*) AS created,
        SUM(CASE WHEN wo.Status = 'DONE' THEN 1 ELSE 0 END) AS done,
        SUM(
          CASE 
            WHEN wo.Status <> 'CANCELLED'
             AND wo.Status <> 'DONE'
             AND wo.DueDate < CURDATE()
            THEN 1 ELSE 0
          END
        ) AS overdue
      FROM maintenanceworkorder wo
      JOIN asset a ON wo.AssetID = a.ID
      ${woWhere}
      GROUP BY DATE_FORMAT(wo.DueDate, '%Y-%m')
      ORDER BY monthLabel
      `,
      woParams
    );

    // 5. Tài sản bị mất theo AssetHistory (top 20)
    let missingWhere = "WHERE h.Type = 'STOCKTAKE_MISSING'";
    const missingParams = [];

    if (from) {
      missingWhere += " AND h.ActionAt >= ?";
      missingParams.push(from + " 00:00:00");
    }
    if (to) {
      missingWhere += " AND h.ActionAt <= ?";
      missingParams.push(to + " 23:59:59");
    }
    if (dept) {
      missingWhere += " AND a.SectionID = ?";
      missingParams.push(dept);
    }
    if (cat) {
      missingWhere += " AND a.CategoryID = ?";
      missingParams.push(cat);
    }

    const [missingByAssetRows] = await conn.execute(
      `
      SELECT
        a.ID AS AssetID,
        a.Name AS assetName,
        SUM(COALESCE(h.Quantity, 1)) AS missingQty
      FROM assethistory h
      JOIN asset a ON h.AssetID = a.ID
      ${missingWhere}
      GROUP BY a.ID, a.Name
      ORDER BY missingQty DESC
      LIMIT 20
      `,
      missingParams
    );

    return {
      valueByDept: valueByDeptRows.map((r) => ({
        deptName: r.deptName,
        totalValue: Number(r.totalValue || 0),
      })),
      quantityByAsset: quantityByAssetRows.map((r) => ({
        assetId: r.AssetID,
        assetName: r.assetName,
        totalQty: Number(r.totalQty || 0),
      })),
      assetStatus,
      maintenanceByMonth: maintenanceRows.map((r) => ({
        monthLabel: r.monthLabel,
        created: Number(r.created || 0),
        done: Number(r.done || 0),
        overdue: Number(r.overdue || 0),
      })),
      missingByAsset: missingByAssetRows.map((r) => ({
        assetId: r.AssetID,
        assetName: r.assetName,
        missingQty: Number(r.missingQty || 0),
      })),
    };
  } catch (err) {
    throw new AppError(err.message || "Lỗi lấy series dashboard", 500);
  } finally {
    conn.release();
  }
};

/* ============================================================
   ALERTS
============================================================ */
const getAlerts = async (filters = {}) => {
  const conn = await db.getConnection();
  try {
    const from = filters.from || null; // 'YYYY-MM-DD'
    const to = filters.to || null; // 'YYYY-MM-DD'
    const dept = filters.dept || null; // DepartmentID (int)
    const cat = filters.cat || null; // CategoryID (varchar)

    const wd = Number(filters.warrantyDays);
    const warrantyDays = Number.isFinite(wd) && wd >= 0 ? wd : 30;

    const lm = Number(filters.limit);
    const limit = Number.isFinite(lm) && lm > 0 && lm <= 500 ? lm : 50;

    /* ---------- 1. Hết / sắp hết bảo hành ---------- */
    let w1 =
      "WHERE a.WarrantyEndDate IS NOT NULL " +
      "AND DATEDIFF(a.WarrantyEndDate, CURDATE()) <= ?";
    const p1 = [warrantyDays];

    if (cat) {
      w1 += " AND a.CategoryID = ?";
      p1.push(cat);
    }
    if (dept) {
      w1 += " AND a.SectionID = ?";
      p1.push(dept);
    }
    if (from) {
      w1 += " AND (a.PurchaseDate IS NULL OR a.PurchaseDate >= ?)";
      p1.push(from);
    }
    if (to) {
      w1 += " AND (a.PurchaseDate IS NULL OR a.PurchaseDate <= ?)";
      p1.push(to);
    }

    const [expiringRows] = await conn.execute(
      `
      SELECT
        a.ID AS AssetID,
        a.Name,
        a.ManageCode,
        d.DepartmentName AS Dept,
        a.WarrantyEndDate,
        DATEDIFF(a.WarrantyEndDate, CURDATE()) AS DaysLeft
      FROM asset a
      LEFT JOIN department d ON a.SectionID = d.DepartmentID
      ${w1}
      ORDER BY a.WarrantyEndDate ASC
      LIMIT ${limit}
      `,
      p1
    );

    /* ---------- 2. Bảo trì quá hạn ---------- */
    let w2 =
      "WHERE wo.Status <> 'DONE' " +
      "AND wo.Status <> 'CANCELLED' " +
      "AND wo.DueDate < CURDATE()";
    const p2 = [];

    if (from) {
      w2 += " AND wo.DueDate >= ?";
      p2.push(from);
    }
    if (to) {
      w2 += " AND wo.DueDate <= ?";
      p2.push(to);
    }
    if (dept) {
      w2 += " AND a.SectionID = ?";
      p2.push(dept);
    }
    if (cat) {
      w2 += " AND a.CategoryID = ?";
      p2.push(cat);
    }

    const [overdueMaintRows] = await conn.execute(
      `
      SELECT
        wo.WorkOrderID,
        a.ID AS AssetID,
        a.Name,
        d.DepartmentName AS Dept,
        wo.DueDate AS PlannedDate,
        DATEDIFF(CURDATE(), wo.DueDate) AS DaysOverdue
      FROM maintenanceworkorder wo
      JOIN asset a ON wo.AssetID = a.ID
      LEFT JOIN department d ON a.SectionID = d.DepartmentID
      ${w2}
      ORDER BY wo.DueDate ASC
      LIMIT ${limit}
      `,
      p2
    );

    /* ---------- 3. Mất / thiếu trong kiểm kê (assethistory) ---------- */
    let w3 = "WHERE h.Type = 'STOCKTAKE_MISSING'";
    const p3 = [];

    if (from) {
      w3 += " AND h.ActionAt >= ?";
      p3.push(from + " 00:00:00");
    }
    if (to) {
      w3 += " AND h.ActionAt <= ?";
      p3.push(to + " 23:59:59");
    }
    if (dept) {
      w3 += " AND a.SectionID = ?";
      p3.push(dept);
    }
    if (cat) {
      w3 += " AND a.CategoryID = ?";
      p3.push(cat);
    }

    const [missingRows] = await conn.execute(
      `
      SELECT
        a.ID AS AssetID,
        a.Name,
        d.DepartmentName AS Dept,
        h.RequestID AS SessionID,
        h.ActionAt AS LastSeenAt,
        'MISSING' AS Status,
        COALESCE(h.Quantity, 1) AS MissingQty,
        COALESCE(
          COALESCE(a.PurchasePrice, 0) * COALESCE(h.Quantity, 1)
            / NULLIF(COALESCE(a.Quantity, 1), 0),
          0
        ) AS ValueLoss
      FROM assethistory h
      JOIN asset a ON h.AssetID = a.ID
      LEFT JOIN department d ON a.SectionID = d.DepartmentID
      ${w3}
      ORDER BY h.ActionAt DESC
      LIMIT ${limit}
      `,
      p3
    );

    /* ---------- 4. Yêu cầu phê duyệt trễ SLA ---------- */
    const slaDays = 3;
    let w4 =
      "WHERE r.CurrentState = 'PENDING' " +
      "AND DATEDIFF(NOW(), r.CreatedAt) > ?";
    const p4 = [slaDays];

    if (from) {
      w4 += " AND r.CreatedAt >= ?";
      p4.push(from + " 00:00:00");
    }
    if (to) {
      w4 += " AND r.CreatedAt <= ?";
      p4.push(to + " 23:59:59");
    }

    const [approvalRows] = await conn.execute(
      `
      SELECT
        r.RequestID,
        rt.Name AS Type,
        r.CurrentState,
        DATEDIFF(NOW(), r.CreatedAt) AS DaysWaiting
      FROM request r
      JOIN requesttype rt ON r.RequestTypeID = rt.RequestTypeID
      ${w4}
      ORDER BY r.CreatedAt ASC
      LIMIT ${limit}
      `,
      p4
    );

    return {
      expiringWarranty: expiringRows,
      overdueMaintenance: overdueMaintRows,
      stocktakeMissing: missingRows,
      approvalSlaBreach: approvalRows,
    };
  } catch (err) {
    console.error("Dashboard getAlerts error:", err);
    throw new AppError(err.message || "Lỗi lấy alert dashboard", 500);
  } finally {
    conn.release();
  }
};

module.exports = {
  getSummary,
  getSeries,
  getAlerts,
};
