// services/RequestWarranty_Service.js
const db = require("../config/database");
const AppError = require("../utils/AppError");
const { v4: uuidv4 } = require("uuid");

const ASSET_STATUS = {
  AVAILABLE: 1,
  ALLOCATED: 2,
  MAINTENANCE_OUT: 4,
  WARRANTY_OUT: 3,
  DISPOSED: 5,
  IN_USE: 6, // hàng dùng chung (hết hàng)
};

// === Helper: xác định trạng thái mới ===
function determineAssetStatus(originalQty, remainQty, statusMap) {
  // Còn tồn trong kho
  if (remainQty > 0) return statusMap.AVAILABLE;

  // Hết tồn → toàn bộ đang đi bảo hành
  return statusMap.WARRANTY_OUT;
}

const approveRequestWarranty = async (id, data) => {
  const StepID = Number(data.StepID || 0);
  const Action = String(data.Action || "").toUpperCase();
  const { ApproverUserID, DepartmentID, Comment } = data;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 🔒 Khóa request
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

    // Ghi log bước hiện tại
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

    // ❌ REJECTED
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

    // ✅ APPROVED STEP 1 → STEP 2
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

    // ✅ APPROVED STEP 2 (MANAGER) – xử lý N tài sản
    if (Action === "APPROVED" && StepID === 2) {
      // Lấy toàn bộ chi tiết warranty của phiếu
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

      // Lấy người/đơn vị nhận (bên bảo hành)
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

      // 🔁 Loop từng dòng request_warranty (multi-asset)
      for (const row of rows) {
        const AssetID = row.AssetID;
        const qty = Number(row.Quantity ?? 1);
        const WarrantyProvider = row.WarrantyProvider || "";

        // Khóa asset
        const [[asset]] = await conn.execute(
          `SELECT Quantity, RemainQuantity,
                  EmployeeID AS CurrEmployeeID,
                  SectionID  AS CurrSectionID,
                  Status,
                  WarrantyEndDate
           FROM asset
           WHERE ID = ?
           FOR UPDATE`,
          [AssetID]
        );
        if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);

        // Không cho gửi bảo hành nếu đã disposed / đang bảo trì / đang warranty_out
        if (
          [
            ASSET_STATUS.DISPOSED,
            ASSET_STATUS.MAINTENANCE_OUT,
            ASSET_STATUS.WARRANTY_OUT,
          ].includes(Number(asset.Status))
        ) {
          throw new AppError("ASSET_NOT_ALLOWED_FOR_WARRANTY", 409);
        }

        // Check còn hạn bảo hành
        if (!asset.WarrantyEndDate) {
          throw new AppError("ASSET_NO_WARRANTY_INFO", 400);
        }
        const today = new Date();
        const end = new Date(asset.WarrantyEndDate);
        if (end < today) {
          throw new AppError("ASSET_OUT_OF_WARRANTY", 400);
        }

        const originalQty = Number(asset.Quantity ?? 1);
        const currentRemain = Number(
          asset.RemainQuantity != null ? asset.RemainQuantity : originalQty
        );
        const remain = currentRemain - qty;

        if (remain < 0) {
          throw new AppError(`NOT_ENOUGH_STOCK_FOR_ASSET_${AssetID}`, 400);
        }

        const newStatus = determineAssetStatus(
          originalQty,
          remain,
          ASSET_STATUS
        );

        // Ghi assethistory
        const assetHistoryId = uuidv4();
        const note = `Gửi bảo hành${
          WarrantyProvider ? ` (${WarrantyProvider})` : ""
        } cho User ${EmployeeReceiveID} - Số lượng: ${qty}`;

        await conn.execute(
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
            qty,
            note,
          ]
        );

        // ⚙️ Cập nhật RemainQuantity + Status
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

      // Update request
      await conn.execute(
        `UPDATE request 
         SET CurrentState='APPROVED', UpdatedAt=NOW() 
         WHERE RequestID=?`,
        [id]
      );

      // Log CONFIRMED tổng
      await conn.execute(
        `INSERT INTO approvalhistory
          (RequestID, ApproverUserID, DepartmentID, Action, ActionAt, Comment)
         VALUES (?, ?, ?, 'CONFIRMED', NOW(), 'Đã gửi bảo hành và cập nhật tồn kho/trạng thái cho tất cả tài sản trong phiếu')`,
        [id, ApproverUserID, DepartmentID]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error("approveRequestWarranty error:", err);
    throw err instanceof AppError
      ? err
      : new AppError(err.message || "INTERNAL_ERROR", 500);
  } finally {
    conn.release();
  }
};

const getRequestWarrantyDetail = async (id) => {
  const [[request]] = await db.execute(
    `SELECT * FROM request WHERE RequestID=?`,
    [id]
  );
  // warranty là MẢNG các dòng (multi-asset)
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
     JOIN requesttype rt 
       ON rt.RequestTypeID = r.RequestTypeID 
      AND UPPER(rt.Code)='WARRANTY'
     LEFT JOIN request_warranty rw 
       ON rw.RequestID = r.RequestID
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
