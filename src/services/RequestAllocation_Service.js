// services/RequestAllocation_Service.js
const db = require("../config/database");
const AppError = require("../utils/AppError");
const { v4: uuidv4 } = require("uuid");

// === Helper: xác định trạng thái tài sản sau cấp phát ===
function determineAssetStatus(originalQty, remainQty, statusMap) {
  // Còn hàng
  if (remainQty > 0) return statusMap.AVAILABLE;

  // Hết hàng
  if (originalQty === 1) return statusMap.ALLOCATED; // thiết bị cá nhân
  return statusMap.IN_USE; // tài sản theo số lượng, đã cấp hết
}

const approveRequestAllocation = async (id, data) => {
  const ASSET_STATUS = {
    AVAILABLE: 1,
    ALLOCATED: 2, // đang dùng (thiết bị cá nhân)
    MAINTENANCE_OUT: 3,
    WARRANTY_OUT: 4,
    DISPOSED: 5,
    IN_USE: 6, // dùng chung theo số lượng
  };

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

    // Ghi log duyệt (APPROVED / REJECTED cho bước hiện tại)
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

    // Nếu từ chối: chỉ update trạng thái request
    if (Action === "REJECTED") {
      await conn.execute(
        `UPDATE request 
         SET CurrentState='REJECTED', UpdatedAt=NOW() 
         WHERE RequestID=?`,
        [id]
      );
      await conn.commit();
      return;
    }

    // Bước 1: IT duyệt -> chuyển sang bước 2
    if (Action === "APPROVED" && StepID === 1) {
      await conn.execute(
        `UPDATE request 
         SET CurrentState='IN_PROGRESS_STEP_2', UpdatedAt=NOW() 
         WHERE RequestID=?`,
        [id]
      );
      await conn.commit();
      return;
    }

    // Bước 2: Manager duyệt -> cấp phát thật sự
    if (Action === "APPROVED" && StepID === 2) {
      // Lấy tất cả dòng request_allocation cho RequestID này
      const [allocRows] = await conn.execute(
        `SELECT CAST(ra.AssetID AS CHAR(36)) AS AssetID, ra.Quantity
         FROM request_allocation ra
         WHERE ra.RequestID = ?
         FOR UPDATE`,
        [id]
      );
      if (!allocRows.length) throw new AppError("ALLOC_NOT_FOUND", 404);

      // Xác định người nhận & phòng nhận (dùng chung cho toàn phiếu)
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

      // 🔁 Xử lý từng asset trong phiếu
      for (const row of allocRows) {
        const AssetID = row.AssetID;
        const qty = Number(row.Quantity ?? 1);

        // Khóa asset để cập nhật
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

        const originalQty = Number(asset.Quantity ?? 1);
        const currentRemain = Number(
          asset.RemainQuantity != null ? asset.RemainQuantity : originalQty
        );
        const remain = currentRemain - qty;
        if (remain < 0) {
          throw new AppError(
            `NOT_ENOUGH_STOCK_FOR_ASSET_${AssetID}`,
            400
          );
        }

        const newStatus = determineAssetStatus(
          originalQty,
          remain,
          ASSET_STATUS
        );

        // Ghi asset history cho từng asset
        const assetHistoryId = uuidv4();
        const note = `Cấp phát ${qty} thiết bị cho User ${EmployeeReceiveID}`;

        await conn.execute(
          `INSERT INTO assethistory
            (ID, AssetID, RequestID, EmployeeID, SectionID,
             EmployeeReceiveID, SectionReceiveID, Quantity, Type, ActionAt, Note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ALLOCATED', NOW(), ?)`,
          [
            assetHistoryId,
            AssetID,
            id,
            asset.CurrEmployeeID ?? null,
            asset.CurrSectionID ?? null,
            EmployeeReceiveID,
            SectionReceiveID ?? null,
            qty,
            note,
          ]
        );

        // Cập nhật tồn kho & trạng thái asset
        await conn.execute(
          `UPDATE asset
             SET RemainQuantity = ?,
                 Status = ?,
                 EmployeeID = ?,
                 SectionID = ?
           WHERE ID = ?`,
          [
            remain,
            newStatus,
            EmployeeReceiveID,
            SectionReceiveID ?? null,
            AssetID,
          ]
        );
      }

      // Cập nhật trạng thái phiếu
      await conn.execute(
        `UPDATE request 
         SET CurrentState='APPROVED', UpdatedAt=NOW() 
         WHERE RequestID=?`,
        [id]
      );

      // Log CONFIRMED sau khi đã xử lý tồn kho cho tất cả asset
      await conn.execute(
        `INSERT INTO approvalhistory
          (RequestID, ApproverUserID, DepartmentID, Action, ActionAt, Comment)
         VALUES (?, ?, ?, 'CONFIRMED', NOW(), 'Đã cấp phát và cập nhật tồn kho/trạng thái cho tất cả tài sản')`,
        [id, ApproverUserID, DepartmentID]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error("approveRequestAllocation error:", err);
    throw err instanceof AppError
      ? err
      : new AppError(err.message || "INTERNAL_ERROR", 500);
  } finally {
    conn.release();
  }
};

// === Lấy chi tiết 1 phiếu cấp phát ===
// (phần này vẫn OK cho multi-asset vì trả mảng allocation)
const getRequestAllocationDetail = async (id) => {
  const [[request]] = await db.execute(
    `SELECT * FROM request WHERE RequestID=?`,
    [id]
  );
  const [alloc] = await db.execute(
    `SELECT * FROM request_allocation WHERE RequestID=?`,
    [id]
  );
  const [history] = await db.execute(
    `SELECT * FROM approvalhistory WHERE RequestID=? ORDER BY ActionAt ASC`,
    [id]
  );
  return { request, allocation: alloc, approvalHistory: history };
};

// === Danh sách phiếu cấp phát (gộp số lượng theo phiếu) ===
const getAllRequestAllocationDetail = async () => {
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
      COALESCE(SUM(ra.Quantity), 0) AS TotalQuantity
     FROM request r
     LEFT JOIN request_allocation ra ON ra.RequestID = r.RequestID
     WHERE r.RequestTypeID = 1
     GROUP BY 
       r.RequestID, r.RequesterUserID, r.TargetUserID, r.TargetDepartmentID,
       r.CurrentState, r.CreatedAt, r.UpdatedAt, r.Note
     ORDER BY r.CreatedAt DESC;`
  );
  return { requests: rows };
};

module.exports = {
  approveRequestAllocation,
  getRequestAllocationDetail,
  getAllRequestAllocationDetail,
};
