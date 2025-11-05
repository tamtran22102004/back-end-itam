// services/RequestDisposal_Service.js
const db = require("../config/database");
const AppError = require("../utils/AppError");
const { v4: uuidv4 } = require("uuid");

const ASSET_STATUS = {
  AVAILABLE: 1,
  ALLOCATED: 2,        // thiết bị cá nhân
  MAINTENANCE_OUT: 3,
  WARRANTY_OUT: 4,
  DISPOSED: 5,         // đã thanh lý
  IN_USE: 6,           // thiết bị dùng chung (số lượng)
};

// === Helper xác định trạng thái mới sau thanh lý ===
function determineAssetStatus(originalQty, remainQty, statusMap) {
  if (remainQty > 0) return statusMap.AVAILABLE;  // còn hàng
  if (originalQty === 1) return statusMap.DISPOSED; // cá nhân -> coi như đã thanh lý riêng
  return statusMap.IN_USE;  // hàng nhiều -> dùng chung (đã thanh lý hết)
}

const approveRequestDisposal = async (id, data) => {
  const StepID = Number(data.StepID || 0);
  const Action = String(data.Action || "").toUpperCase();
  const { ApproverUserID, DepartmentID, Comment } = data;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 🔒 Lock request
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

    // Log duyệt
    await conn.execute(
      `INSERT INTO approvalhistory
        (RequestID, StepID, ApproverUserID, DepartmentID, Action, ActionAt, Comment)
       VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
      [id, StepID || null, ApproverUserID, DepartmentID, Action, Comment || null]
    );

    // ❌ REJECTED
    if (Action === "REJECTED") {
      await conn.execute(
        `UPDATE request SET CurrentState='REJECTED', UpdatedAt=NOW() WHERE RequestID=?`,
        [id]
      );
      await conn.commit();
      return;
    }

    // ✅ APPROVED - STEP 1 → STEP 2
    if (Action === "APPROVED" && StepID === 1) {
      await conn.execute(
        `UPDATE request SET CurrentState='IN_PROGRESS_STEP_2', UpdatedAt=NOW() WHERE RequestID=?`,
        [id]
      );
      await conn.commit();
      return;
    }

    // ✅ APPROVED - STEP 2 (Manager duyệt thanh lý)
    if (Action === "APPROVED" && StepID === 2) {
      const [rows] = await conn.execute(
        `SELECT
            CAST(rd.AssetID AS CHAR(36)) AS AssetID,
            rd.Quantity,
            rd.Reason
         FROM request_disposal rd
         WHERE rd.RequestID = ?
         FOR UPDATE`,
        [id]
      );
      if (!rows.length) throw new AppError("DISPOSAL_NOT_FOUND", 404);
      const { AssetID, Quantity, Reason } = rows[0];

      // Lock asset
      const [[asset]] = await conn.execute(
        `SELECT Quantity, RemainQuantity,
                EmployeeID AS CurrEmployeeID,
                SectionID AS CurrSectionID
         FROM asset
         WHERE ID = ?
         FOR UPDATE`,
        [AssetID]
      );
      if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);

      // Người nhận (nếu có)
      let EmployeeReceiveID = reqRow.TargetUserID ?? null;
      let SectionReceiveID = reqRow.TargetDepartmentID ?? null;
      if (!EmployeeReceiveID)
        throw new AppError("TARGET_USER_NOT_SET_FOR_REQUEST", 400);
      if (SectionReceiveID == null) {
        const [[recvUser]] = await conn.execute(
          "SELECT DepartmentID FROM `user` WHERE UserID = ?",
          [EmployeeReceiveID]
        );
        SectionReceiveID = recvUser ? recvUser.DepartmentID ?? null : null;
      }

      // Ghi lịch sử
      const assetHistoryId = uuidv4();
      const note = `Thanh lý ${Quantity ?? 1} thiết bị${
        Reason ? ` - ${Reason}` : ""
      } cho User ${EmployeeReceiveID}`;
      await conn.execute(
        `INSERT INTO assethistory
          (ID, AssetID, RequestID, EmployeeID, SectionID,
           EmployeeReceiveID, SectionReceiveID, Quantity, Type, ActionAt, Note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DISPOSED', NOW(), ?)`,
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

      // ⚙️ Cập nhật RemainQuantity & Status
      const remain = Number(asset.RemainQuantity ?? 0) - Number(Quantity ?? 1);
      const newStatus = determineAssetStatus(
        Number(asset.Quantity ?? 1),
        remain,
        ASSET_STATUS
      );

      await conn.execute(
        `UPDATE asset
           SET RemainQuantity = ?,
               Status = ?,
               EmployeeID = NULL,
               SectionID = NULL
         WHERE ID = ?`,
        [remain, newStatus, AssetID]
      );

      // Cập nhật Request
      await conn.execute(
        `UPDATE request SET CurrentState='APPROVED', UpdatedAt=NOW() WHERE RequestID=?`,
        [id]
      );

      // Log xác nhận
      await conn.execute(
        `INSERT INTO approvalhistory
          (RequestID, ApproverUserID, DepartmentID, Action, ActionAt, Comment)
         VALUES (?, ?, ?, 'CONFIRMED', NOW(), 'Đã thanh lý và cập nhật tồn kho/trạng thái')`,
        [id, ApproverUserID, DepartmentID]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error("approveRequestDisposal error:", err);
    throw err instanceof AppError
      ? err
      : new AppError(err.message || "INTERNAL_ERROR", 500);
  } finally {
    conn.release();
  }
};


const getRequestDisposalDetail = async (id) => {
  const [[request]] = await db.execute(`SELECT * FROM request WHERE RequestID=?`, [id]);
  const [d] = await db.execute(`SELECT * FROM request_disposal WHERE RequestID=?`, [id]);
  const [history] = await db.execute(
    `SELECT * FROM approvalhistory WHERE RequestID=? ORDER BY ActionAt ASC`,
    [id]
  );
  return { request, disposal: d, approvalHistory: history };
};

// Lấy tất cả request loại DISPOSAL (theo Code)
const getAllRequestDisposalDetail = async () => {
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
       COALESCE(SUM(rd.Quantity), 0) AS TotalQuantity
     FROM request r
     JOIN requesttype rt ON rt.RequestTypeID = r.RequestTypeID AND UPPER(rt.Code)='DISPOSAL'
     LEFT JOIN request_disposal rd ON rd.RequestID = r.RequestID
     GROUP BY
       r.RequestID, r.RequesterUserID, r.TargetUserID, r.TargetDepartmentID,
       r.CurrentState, r.CreatedAt, r.UpdatedAt, r.Note
     ORDER BY r.CreatedAt DESC`
  );
  return { requests: rows };
};

module.exports = {
  approveRequestDisposal,
  getRequestDisposalDetail,
  getAllRequestDisposalDetail,
};
