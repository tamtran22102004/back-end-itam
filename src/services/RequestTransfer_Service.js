// services/RequestTransfer_Service.js
const db = require("../config/database");
const AppError = require("../utils/AppError");
const { v4: uuidv4 } = require("uuid");

// === Trạng thái tài sản ===
const ASSET_STATUS = {
  AVAILABLE: 1,
  ALLOCATED: 2, // đang dùng (thiết bị cá nhân)
  MAINTENANCE_OUT: 3,
  WARRANTY_OUT: 4,
  DISPOSED: 5,
  IN_USE: 6, // dùng chung theo số lượng
};

// === Helper: xác định trạng thái sau khi CẬP NHẬT remainQty ===
function determineAssetStatus(originalQty, remainQty, statusMap) {
  // Còn hàng trong kho → AVAILABLE (đúng ý "sẵn sàng")
  if (remainQty > 0) return statusMap.AVAILABLE;

  // Không còn hàng trong kho
  if (originalQty === 1) return statusMap.ALLOCATED;
  return statusMap.IN_USE;
}

// ================== APPROVE TRANSFER (TRẢ VỀ KHO) ==================
const approveRequestTransfer = async (id, data) => {
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

    // Ghi log duyệt bước hiện tại (APPROVED / REJECTED)
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

    // Nếu từ chối → chỉ update trạng thái request
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

    // Bước 1: IT duyệt → sang bước 2
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

    // Bước 2: Manager duyệt → TRẢ THIẾT BỊ VỀ KHO
    if (Action === "APPROVED" && StepID === 2) {
      // Lấy chi tiết transfer cho RequestID này
      const [transRows] = await conn.execute(
        `SELECT CAST(rt.AssetID AS CHAR(36)) AS AssetID, rt.Quantity
         FROM request_transfer rt
         WHERE rt.RequestID = ?
         FOR UPDATE`,
        [id]
      );
      if (!transRows.length) throw new AppError("TRANSFER_NOT_FOUND", 404);

      for (const row of transRows) {
        const AssetID = row.AssetID;
        const qty = Number(row.Quantity ?? 1);
        if (!AssetID) throw new AppError("ASSET_ID_REQUIRED", 400);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new AppError("INVALID_QUANTITY", 400);
        }

        // 🔒 Lock asset để cập nhật
        const [[asset]] = await conn.execute(
          `SELECT Quantity, RemainQuantity,
                  EmployeeID, SectionID
           FROM asset
           WHERE ID = ?
           FOR UPDATE`,
          [AssetID]
        );
        if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);

        const originalQty = Number(asset.Quantity ?? 1);
        const currentRemain = Number(
          asset.RemainQuantity != null ? asset.RemainQuantity : 0
        );

        const usedQty = originalQty - currentRemain; // đang nằm ngoài kho
        if (qty > usedQty) {
          throw new AppError(
            `TRANSFER_QTY_EXCEED_IN_USE_FOR_ASSET_${AssetID}`,
            400
          );
        }

        const remain = currentRemain + qty;
        if (remain > originalQty) {
          throw new AppError(`REMAIN_EXCEED_TOTAL_FOR_ASSET_${AssetID}`, 400);
        }

        const newStatus = determineAssetStatus(
          originalQty,
          remain,
          ASSET_STATUS
        );

        // Ghi lịch sử: TRẢ VỀ KHO
        const assetHistoryId = uuidv4();
        const note = `Chuyển giao ${qty} thiết bị về kho (AVAILABLE)`;

        await conn.execute(
          `INSERT INTO assethistory
            (ID, AssetID, RequestID, EmployeeID, SectionID,
             EmployeeReceiveID, SectionReceiveID, Quantity,
             Type, ActionAt, Note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'TRANSFER_IN', NOW(), ?)`,
          [
            assetHistoryId,
            AssetID,
            id,
            asset.EmployeeID ?? null, // từ user cũ / đơn vị cũ
            asset.SectionID ?? null,
            null, // về kho (không gán cho user cụ thể)
            null,
            qty,
            note,
          ]
        );

        // Cập nhật asset: cộng RemainQuantity + set AVAILABLE + bỏ gán user
        await conn.execute(
          `UPDATE asset
             SET RemainQuantity = ?,
                 Status = ?,
                 EmployeeID = NULL,
                 SectionID = 5
           WHERE ID = ?`,
          [remain, newStatus, AssetID]
        );
      }

      // Cập nhật trạng thái phiếu
      await conn.execute(
        `UPDATE request
         SET CurrentState='APPROVED', UpdatedAt=NOW()
         WHERE RequestID=?`,
        [id]
      );

      // Log CONFIRMED sau khi xử lý xong
      await conn.execute(
        `INSERT INTO approvalhistory
          (RequestID, ApproverUserID, DepartmentID, Action, ActionAt, Comment)
         VALUES (?, ?, ?, 'CONFIRMED', NOW(), 'Đã chuyển giao thiết bị về kho, cập nhật trạng thái AVAILABLE')`,
        [id, ApproverUserID, DepartmentID]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error("approveRequestTransfer error:", err);
    throw err instanceof AppError
      ? err
      : new AppError(err.message || "INTERNAL_ERROR", 500);
  } finally {
    conn.release();
  }
};

// ========== Detail ==========
const getRequestTransferDetail = async (id) => {
  const [[request]] = await db.execute(
    `SELECT * FROM request WHERE RequestID=?`,
    [id]
  );
  const [transfer] = await db.execute(
    `SELECT * FROM request_transfer WHERE RequestID=?`,
    [id]
  );
  const [history] = await db.execute(
    `SELECT * FROM approvalhistory WHERE RequestID=? ORDER BY ActionAt ASC`,
    [id]
  );
  return { request, transfer, approvalHistory: history };
};

// ========== List ==========
const getAllRequestTransferDetail = async () => {
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
      COALESCE(SUM(rt.Quantity), 0) AS TotalQuantity
     FROM request r
     LEFT JOIN request_transfer rt ON rt.RequestID = r.RequestID
     WHERE r.RequestTypeID = 5          -- nhớ chỉnh đúng ID TRANSFER trong requesttype
     GROUP BY
       r.RequestID, r.RequesterUserID, r.TargetUserID, r.TargetDepartmentID,
       r.CurrentState, r.CreatedAt, r.UpdatedAt, r.Note
     ORDER BY r.CreatedAt DESC`
  );
  return { requests: rows };
};

module.exports = {
  approveRequestTransfer,
  getRequestTransferDetail,
  getAllRequestTransferDetail,
};
