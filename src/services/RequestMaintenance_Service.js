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

const approveRequestMaintenance = async (id, data) => {
  const StepID = Number(data.StepID || 0);
  const Action = String(data.Action || "").toUpperCase();
  const { ApproverUserID, DepartmentID, Comment } = data;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[reqRow]] = await conn.execute(
      `SELECT CurrentState, TargetUserID, TargetDepartmentID, RequesterUserID
       FROM request
       WHERE RequestID = ?
       FOR UPDATE`,
      [id]
    );
    if (!reqRow) throw new AppError("REQUEST_NOT_FOUND", 404);
    if (["APPROVED", "REJECTED", "CANCELLED"].includes(reqRow.CurrentState)) {
      throw new AppError(`REQUEST_FINAL_${reqRow.CurrentState}`, 409);
    }

    await conn.execute(
      `INSERT INTO approvalhistory
        (RequestID, StepID, ApproverUserID, DepartmentID, Action, ActionAt, Comment)
       VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
      [id, StepID || null, ApproverUserID, DepartmentID, Action, Comment || null]
    );

    if (Action === "REJECTED") {
      await conn.execute(
        `UPDATE request SET CurrentState='REJECTED', UpdatedAt=NOW() WHERE RequestID=?`,
        [id]
      );
      await conn.commit();
      return;
    }

    if (Action === "APPROVED" && StepID === 1) {
      await conn.execute(
        `UPDATE request SET CurrentState='IN_PROGRESS_STEP_2', UpdatedAt=NOW() WHERE RequestID=?`,
        [id]
      );
      await conn.commit();
      return;
    }

    if (Action === "APPROVED" && StepID === 2) {
      const [rows] = await conn.execute(
        `SELECT CAST(rm.AssetID AS CHAR(36)) AS AssetID, rm.Quantity, rm.IssueDescription
         FROM request_maintenance rm
         WHERE rm.RequestID = ?
         FOR UPDATE`,
        [id]
      );
      if (!rows.length) throw new AppError("MAINT_NOT_FOUND", 404);
      const { AssetID, Quantity } = rows[0];

      const [[asset]] = await conn.execute(
        `SELECT Status,
                EmployeeID AS CurrEmployeeID,
                SectionID  AS CurrSectionID
         FROM asset
         WHERE ID = ?
         FOR UPDATE`,
        [AssetID]
      );
      if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);
      if ([ASSET_STATUS.DISPOSED, ASSET_STATUS.MAINTENANCE_OUT, ASSET_STATUS.WARRANTY_OUT].includes(Number(asset.Status))) {
        throw new AppError("ASSET_NOT_ALLOWED_FOR_MAINTENANCE", 409);
      }

      const EmployeeReceiveID = reqRow.TargetUserID ?? null;
      let SectionReceiveID    = reqRow.TargetDepartmentID ?? null;
      if (SectionReceiveID == null && EmployeeReceiveID != null) {
        const [[recvUser]] = await conn.execute(
          "SELECT DepartmentID FROM `user` WHERE UserID = ?",
          [EmployeeReceiveID]
        );
        SectionReceiveID = recvUser ? (recvUser.DepartmentID ?? null) : null;
      }

      const assetHistoryId = uuidv4();
      const note = `Bảo trì - giao nhận tại bộ phận ${SectionReceiveID ?? "?"}`;
      const [ins] = await conn.execute(
        `INSERT INTO assethistory
          (ID, AssetID, RequestID, EmployeeID, SectionID,
           EmployeeReceiveID, SectionReceiveID, Quantity, Type, ActionAt, Note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MAINTENANCE_OUT', NOW(), ?)`,
        [
          assetHistoryId,
          AssetID,
          id,
          asset.CurrEmployeeID ?? null,
          asset.CurrSectionID ?? null,
          EmployeeReceiveID,
          SectionReceiveID ?? null,
          Quantity ?? 1,
          note,
        ]
      );
      if (ins.affectedRows !== 1) throw new AppError("INSERT_AH_FAILED", 500);

      // Khi đưa đi bảo trì: set trạng thái OUT, không gán user; có thể gán Section theo nơi nhận
      await conn.execute(
        "UPDATE asset SET Status=?, EmployeeID=NULL, SectionID=? WHERE ID=?",
        [ASSET_STATUS.MAINTENANCE_OUT, SectionReceiveID ?? null, AssetID]
      );

      await conn.execute(
        `UPDATE request SET CurrentState='APPROVED', UpdatedAt=NOW() WHERE RequestID=?`,
        [id]
      );

      await conn.execute(
        `INSERT INTO approvalhistory
          (RequestID, ApproverUserID, DepartmentID, Action, ActionAt, Comment)
         VALUES (?, ?, ?, 'CONFIRMED', NOW(), 'Đã xuất bảo trì')`,
        [id, ApproverUserID, DepartmentID]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error("approveRequestMaintenance error:", err);
    throw err instanceof AppError ? err : new AppError(err.message || "INTERNAL_ERROR", 500);
  } finally {
    conn.release();
  }
};

const getRequestMaintenanceDetail = async (id) => {
  const [[request]] = await db.execute(
    `SELECT * FROM request WHERE RequestID=?`,
    [id]
  );
  const [maint] = await db.execute(
    `SELECT * FROM request_maintenance WHERE RequestID=?`,
    [id]
  );
  const [history] = await db.execute(
    `SELECT * FROM approvalhistory WHERE RequestID=? ORDER BY ActionAt ASC`,
    [id]
  );
  return { request, maintenance: maint, approvalHistory: history };
};

const getAllRequestMaintenanceDetail = async () => {
  const [rows] = await db.execute(
    `SELECT
      r.RequestID,
      r.RequesterUserID,
      r.TargetUserID,
      r.TargetDepartmentID,
      r.CurrentState,
      r.CreatedAt,
      r.UpdatedAt,
      r.Note,
      COALESCE(SUM(rm.Quantity), 0) AS TotalQuantity
     FROM request r
     JOIN requesttype rt ON rt.RequestTypeID = r.RequestTypeID AND UPPER(rt.Code)='MAINTENANCE'
     LEFT JOIN request_maintenance rm ON rm.RequestID = r.RequestID
     GROUP BY 
       r.RequestID, r.RequesterUserID, r.TargetUserID, r.TargetDepartmentID,
       r.CurrentState, r.CreatedAt, r.UpdatedAt, r.Note
     ORDER BY r.CreatedAt DESC;`
  );
  return { requests: rows };
};

module.exports = {
  approveRequestMaintenance,
  getRequestMaintenanceDetail,
  getAllRequestMaintenanceDetail,
};
