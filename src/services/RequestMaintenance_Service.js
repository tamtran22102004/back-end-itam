// services/RequestMaintenance_Service.js
const db = require("../config/database");
const AppError = require("../utils/AppError");
const { v4: uuidv4 } = require("uuid");

const ASSET_STATUS = {
  AVAILABLE: 1,
  ALLOCATED: 2,
  MAINTENANCE_OUT: 3,
  WARRANTY_OUT: 4,
  DISPOSED: 5,
};

/**
 * Duyệt yêu cầu bảo trì (2 bước: IT -> MANAGER)
 * - REJECTED: set Request.REJECTED
 * - APPROVED step 1: chuyển IN_PROGRESS_STEP_2
 * - APPROVED step 2: ghi AssetHistory(MAINTENANCE_OUT), set asset.Status=MAINTENANCE_OUT, clear holder, set Request.APPROVED, log CONFIRMED
 */
const approveRequestMaintenance = async (id, data) => {
  const StepID = Number(data.StepID || 0);
  const Action = String(data.Action || "").toUpperCase();
  const { ApproverUserID, DepartmentID, Comment } = data;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 0) Kiểm tra request còn hiệu lực
    const [[reqRow]] = await conn.execute(
      "SELECT CurrentState FROM `request` WHERE RequestID = ? FOR UPDATE",
      [id]
    );
    if (!reqRow) throw new AppError("REQUEST_NOT_FOUND", 404);
    if (["APPROVED", "REJECTED", "CANCELLED"].includes(reqRow.CurrentState)) {
      throw new AppError(`REQUEST_FINAL_${reqRow.CurrentState}`, 409);
    }

    // 1) Log hành động hiện tại
    await conn.execute(
      `INSERT INTO approvalhistory
        (RequestID, StepID, ApproverUserID, DepartmentID, Action, ActionAt, Comment)
       VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
      [
        id,
        StepID || null,
        ApproverUserID,
        DepartmentID,
        Action,
        Comment || null,
      ]
    );

    // === REJECTED ===
    if (Action === "REJECTED") {
      await conn.execute(
        `UPDATE request SET CurrentState='REJECTED', UpdatedAt=NOW() WHERE RequestID=?`,
        [id]
      );
      await conn.commit();
      return;
    }

    // === APPROVED — Step 1: sang bước 2 ===
    if (Action === "APPROVED" && StepID === 1) {
      await conn.execute(
        `UPDATE request SET CurrentState='IN_PROGRESS_STEP_2', UpdatedAt=NOW() WHERE RequestID=?`,
        [id]
      );
      await conn.commit();
      return;
    }

    // === APPROVED — Step 2: đưa đi bảo trì ===
    if (Action === "APPROVED" && StepID === 2) {
      // Lấy dữ liệu bảo trì
      const [rows] = await conn.execute(
        `SELECT
            CAST(rm.AssetID AS CHAR(36)) AS AssetID,
            rm.Quantity,
            rm.IssueDescription,
            r.RequesterUserID,
            u.DepartmentID AS UserDept
         FROM request_maintenance rm
         JOIN request r ON r.RequestID = rm.RequestID
         JOIN user u ON u.UserID = r.RequesterUserID
         WHERE rm.RequestID = ?
         FOR UPDATE`,
        [id]
      );
      if (!rows.length) throw new AppError("MAINT_NOT_FOUND", 404);

      const { AssetID, Quantity, IssueDescription, RequesterUserID, UserDept } =
        rows[0];

      // Kiểm tra trạng thái asset
      const [[asset]] = await conn.execute(
        "SELECT Status FROM `asset` WHERE ID = ? FOR UPDATE",
        [AssetID]
      );
      if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);

      const st = Number(asset.Status);
      // Không cho đi bảo trì nếu đã disposed / đã maintenance_out / đang gửi bảo hành
      if (
        [
          ASSET_STATUS.DISPOSED,
          ASSET_STATUS.MAINTENANCE_OUT,
          ASSET_STATUS.WARRANTY_OUT,
        ].includes(st)
      ) {
        throw new AppError("ASSET_NOT_ELIGIBLE_FOR_MAINTENANCE", 409);
      }

      // Ghi AssetHistory: MAINTENANCE_OUT
      const assetHistoryId = uuidv4();
      const note = IssueDescription
        ? `Đưa đi bảo trì • ${IssueDescription}`
        : "Đưa đi bảo trì";

      const [ins] = await conn.execute(
        `INSERT INTO assethistory
          (ID, AssetID, RequestID, EmployeeID, SectionID, Quantity, Type, ActionAt, Note)
         VALUES (?, ?, ?, ?, ?, ?, 'MAINTENANCE_OUT', NOW(), ?)`,
        [
          assetHistoryId,
          AssetID,
          id,
          RequesterUserID, // ai yêu cầu (để truy vết)
          UserDept ?? DepartmentID, // phòng ban của người yêu cầu
          Quantity ?? 1,
          note,
        ]
      );
      if (ins.affectedRows !== 1) {
        throw new AppError("INSERT_AH_FAILED", 500);
      }

      // Cập nhật asset: chuyển trạng thái + clear holder
      await conn.execute(
        "UPDATE `asset` SET Status=?, EmployeeID=NULL, SectionID=NULL WHERE ID=?",
        [ASSET_STATUS.MAINTENANCE_OUT, AssetID]
      );

      // Cập nhật Request: APPROVED
      await conn.execute(
        `UPDATE request SET CurrentState='APPROVED', UpdatedAt=NOW() WHERE RequestID=?`,
        [id]
      );

      // Log CONFIRMED
      await conn.execute(
        `INSERT INTO approvalhistory
          (RequestID, ApproverUserID, DepartmentID, Action, ActionAt, Comment)
         VALUES (?, ?, ?, 'CONFIRMED', NOW(), 'Đã đưa đi bảo trì')`,
        [id, ApproverUserID, DepartmentID]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error("approveRequestMaintenance error:", err);
    throw err;
  } finally {
    conn.release();
  }
};

// Detail 1 request maintenance
const getRequestMaintenanceDetail = async (id) => {
  const [[request]] = await db.execute(
    "SELECT * FROM `request` WHERE RequestID=?",
    [id]
  );
  const [maint] = await db.execute(
    "SELECT * FROM `request_maintenance` WHERE RequestID=?",
    [id]
  );
  const [history] = await db.execute(
    "SELECT * FROM `approvalhistory` WHERE RequestID=? ORDER BY ActionAt ASC",
    [id]
  );
  return { request, maintenance: maint, approvalHistory: history };
};

// List tất cả request maintenance (tổng Quantity)
const getAllRequestMaintenanceDetail = async () => {
  const [rows] = await db.execute(
    `SELECT
  r.RequestID,
  r.RequesterUserID,
  r.CurrentState,
  r.CreatedAt,
  r.UpdatedAt,
  r.Note,
  COALESCE(SUM(rm.Quantity), 0) AS TotalQuantity
FROM request r
JOIN request_maintenance rm ON rm.RequestID = r.RequestID
GROUP BY 
  r.RequestID, 
  r.RequesterUserID, 
  r.CurrentState, 
  r.CreatedAt, 
  r.UpdatedAt, 
  r.Note
ORDER BY r.CreatedAt DESC;
`
  );
  return { requests: rows };
};

module.exports = {
  approveRequestMaintenance,
  getRequestMaintenanceDetail,
  getAllRequestMaintenanceDetail,
};
