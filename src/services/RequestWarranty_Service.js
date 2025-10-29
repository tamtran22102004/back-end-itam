// services/RequestWarranty_Service.js
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

const approveRequestWarranty = async (id, data) => {
  const StepID = Number(data.StepID || 0);
  const Action = String(data.Action || "").toUpperCase();
  const { ApproverUserID, DepartmentID, Comment } = data;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 0) Khóa request + lấy target
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

    // 1) Log hành động hiện tại
    await conn.execute(
      `INSERT INTO approvalhistory
        (RequestID, StepID, ApproverUserID, DepartmentID, Action, ActionAt, Comment)
       VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
      [id, StepID || null, ApproverUserID, DepartmentID, Action, Comment || null]
    );

    // ============ REJECTED ============
    if (Action === "REJECTED") {
      await conn.execute(
        `UPDATE request SET CurrentState='REJECTED', UpdatedAt=NOW() WHERE RequestID=?`,
        [id]
      );
      await conn.commit();
      return;
    }

    // ============ APPROVED ============
    // Bước 1 -> chuyển bước 2
    if (Action === "APPROVED" && StepID === 1) {
      await conn.execute(
        `UPDATE request SET CurrentState='IN_PROGRESS_STEP_2', UpdatedAt=NOW() WHERE RequestID=?`,
        [id]
      );
      await conn.commit();
      return;
    }

    // Bước 2 (MANAGER) -> kiểm tra asset + đưa đi bảo hành
    if (Action === "APPROVED" && StepID === 2) {
      // Lấy chi tiết warranty + khóa
      const [rows] = await conn.execute(
        `SELECT
            CAST(rw.AssetID AS CHAR(36)) AS AssetID,
            rw.Quantity,
            rw.WarrantyProvider
         FROM request_warranty rw
         WHERE rw.RequestID = ?
         FOR UPDATE`,
        [id]
      );
      if (!rows.length) throw new AppError("WARRANTY_NOT_FOUND", 404);
      const { AssetID, Quantity, WarrantyProvider } = rows[0];

      // Khóa asset hiện tại
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
      // Không cho gửi BH nếu đã DISPOSED hoặc đã WARRANTY_OUT
      if ([ASSET_STATUS.DISPOSED, ASSET_STATUS.WARRANTY_OUT].includes(Number(asset.Status))) {
        throw new AppError("ASSET_NOT_ALLOWED_FOR_WARRANTY", 409);
      }

      // Lấy người/đơn vị nhận từ request (đã chuẩn hóa ở create)
      let EmployeeReceiveID = reqRow.TargetUserID ?? null;
      let SectionReceiveID  = reqRow.TargetDepartmentID ?? null;
      if (!EmployeeReceiveID) throw new AppError("TARGET_USER_NOT_SET_FOR_REQUEST", 400);

      if (SectionReceiveID == null) {
        const [[recvUser]] = await conn.execute(
          "SELECT DepartmentID FROM `user` WHERE UserID = ?",
          [EmployeeReceiveID]
        );
        SectionReceiveID = recvUser ? (recvUser.DepartmentID ?? null) : null;
      }

      // Ghi assethistory: xuất đi bảo hành
      const assetHistoryId = uuidv4();
      const note =
        `Gửi bảo hành${WarrantyProvider ? ` (${WarrantyProvider})` : ""} cho User ${EmployeeReceiveID}`;
      const [ins] = await conn.execute(
        `INSERT INTO assethistory
          (ID, AssetID, RequestID, EmployeeID, SectionID,
           EmployeeReceiveID, SectionReceiveID, Quantity, Type, ActionAt, Note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'WARRANTY_OUT', NOW(), ?)`,
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

      // Cập nhật asset => WARRANTY_OUT + gán theo nơi nhận (đúng nhu cầu "mọi loại có người nhận")
      await conn.execute(
        "UPDATE asset SET Status=?, EmployeeID=?, SectionID=? WHERE ID=?",
        [ASSET_STATUS.WARRANTY_OUT, EmployeeReceiveID, SectionReceiveID ?? null, AssetID]
      );

      // Cập nhật Request
      await conn.execute(
        `UPDATE request SET CurrentState='APPROVED', UpdatedAt=NOW() WHERE RequestID=?`,
        [id]
      );

      // Log CONFIRMED
      await conn.execute(
        `INSERT INTO approvalhistory
          (RequestID, ApproverUserID, DepartmentID, Action, ActionAt, Comment)
         VALUES (?, ?, ?, 'CONFIRMED', NOW(), 'Đã gửi bảo hành')`,
        [id, ApproverUserID, DepartmentID]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error("approveRequestWarranty error:", err);
    throw err instanceof AppError ? err : new AppError(err.message || "INTERNAL_ERROR", 500);
  } finally {
    conn.release();
  }
};

const getRequestWarrantyDetail = async (id) => {
  const [[request]] = await db.execute(
    `SELECT * FROM request WHERE RequestID=?`,
    [id]
  );
  const [w] = await db.execute(
    `SELECT * FROM request_warranty WHERE RequestID=?`,
    [id]
  );
  const [history] = await db.execute(
    `SELECT * FROM approvalhistory WHERE RequestID=? ORDER BY ActionAt ASC`,
    [id]
  );
  return { request, warranty: w, approvalHistory: history };
};

// Lấy tất cả request loại WARRANTY (join theo Code để không lệ thuộc ID số)
const getAllRequestWarrantyDetail = async () => {
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
       COALESCE(SUM(rw.Quantity), 0) AS TotalQuantity
     FROM request r
     JOIN requesttype rt ON rt.RequestTypeID = r.RequestTypeID AND UPPER(rt.Code)='WARRANTY'
     LEFT JOIN request_warranty rw ON rw.RequestID = r.RequestID
     GROUP BY
       r.RequestID, r.RequesterUserID, r.TargetUserID, r.TargetDepartmentID,
       r.CurrentState, r.CreatedAt, r.UpdatedAt, r.Note
     ORDER BY r.CreatedAt DESC`
  );
  return { requests: rows };
};

module.exports = {
  approveRequestWarranty,
  getRequestWarrantyDetail,
  getAllRequestWarrantyDetail,
};
