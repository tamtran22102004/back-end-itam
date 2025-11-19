// services/RequestMaintenance_Service.js
const db = require("../config/database");
const AppError = require("../utils/AppError");
const { v4: uuidv4 } = require("uuid");

const ASSET_STATUS = {
  AVAILABLE: 1,
  ALLOCATED: 2,      // cá nhân
  MAINTENANCE_OUT: 4,// đang bảo trì
  WARRANTY_OUT: 3,
  DISPOSED: 5,
  IN_USE: 6,         // dùng chung / đang nằm ngoài
};

// Helper: xác định trạng thái mới sau khi đưa đi bảo trì (OUT)
function determineStatusAfterMaintenanceOut(originalQty, remainQty, statusMap) {
  // Còn hàng trong kho → vẫn AVAILABLE
  if (remainQty > 0) return statusMap.AVAILABLE;

  // Hết hàng trong kho
  if (originalQty === 1) {
    // Trường hợp asset chỉ có 1 cái → đang đi bảo trì
    return statusMap.MAINTENANCE_OUT;
  }

  // Hàng nhiều cái nhưng đã gửi hết đi (đều nằm ngoài) → coi là IN_USE
  return statusMap.IN_USE;
}

const approveRequestMaintenance = async (id, data) => {
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

    // ✅ Bước 1 -> 2
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

    // ✅ Bước 2: Duyệt chính thức (Manager) – xử lý N tài sản
    if (Action === "APPROVED" && StepID === 2) {
      // Lấy toàn bộ dòng request_maintenance của phiếu này
      const [rows] = await conn.execute(
        `SELECT 
            CAST(rm.AssetID AS CHAR(36)) AS AssetID, 
            rm.Quantity, 
            rm.IssueDescription
         FROM request_maintenance rm
         WHERE rm.RequestID = ?
         FOR UPDATE`,
        [id]
      );
      if (!rows.length) throw new AppError("MAINT_NOT_FOUND", 404);

      // Nơi nhận bảo trì (vendor / bộ phận kỹ thuật…)
      let EmployeeReceiveID = reqRow.TargetUserID ?? null;
      let SectionReceiveID = reqRow.TargetDepartmentID ?? null;
      if (SectionReceiveID == null && EmployeeReceiveID != null) {
        const [[recvUser]] = await conn.execute(
          "SELECT DepartmentID FROM `user` WHERE UserID = ?",
          [EmployeeReceiveID]
        );
        SectionReceiveID = recvUser ? recvUser.DepartmentID ?? null : null;
      }

      // 🔁 Xử lý từng tài sản trong phiếu
      for (const row of rows) {
        const AssetID = row.AssetID;
        const qty = Number(row.Quantity ?? 1);
        const IssueDescription = row.IssueDescription || "";

        if (!AssetID) throw new AppError("ASSET_ID_REQUIRED", 400);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new AppError("INVALID_QUANTITY", 400);
        }

        // Lock asset
        const [[asset]] = await conn.execute(
          `SELECT Quantity, RemainQuantity,
                  EmployeeID AS CurrEmployeeID,
                  SectionID  AS CurrSectionID,
                  Status
           FROM asset
           WHERE ID = ?
           FOR UPDATE`,
          [AssetID]
        );
        if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);

        // Ngăn bảo trì khi đã disposed / đang bảo trì / đang bảo hành
        if (
          [
            ASSET_STATUS.DISPOSED,
            ASSET_STATUS.MAINTENANCE_OUT,
            ASSET_STATUS.WARRANTY_OUT,
          ].includes(Number(asset.Status))
        ) {
          throw new AppError("ASSET_NOT_ALLOWED_FOR_MAINTENANCE", 409);
        }

        const originalQty = Number(asset.Quantity ?? 1);
        const currentRemain = Number(
          asset.RemainQuantity != null ? asset.RemainQuantity : originalQty
        );

        // Không được xuất nhiều hơn số còn trong kho
        if (qty > currentRemain) {
          throw new AppError(
            `MAINT_QTY_EXCEED_STOCK_FOR_ASSET_${AssetID}`,
            400
          );
        }

        const remain = currentRemain - qty;

        const newStatus = determineStatusAfterMaintenanceOut(
          originalQty,
          remain,
          ASSET_STATUS
        );

        // Lịch sử: 1 asset -> 1 dòng history
        const assetHistoryId = uuidv4();
        const note = `Xuất bảo trì ${qty} thiết bị${
          IssueDescription ? ` - ${IssueDescription}` : ""
        }`;

        await conn.execute(
          `INSERT INTO assethistory
            (ID, AssetID, RequestID, EmployeeID, SectionID,
             EmployeeReceiveID, SectionReceiveID, Quantity, Type, ActionAt, Note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MAINTENANCE_OUT', NOW(), ?)`,
          [
            assetHistoryId,
            AssetID,
            id,
            asset.CurrEmployeeID ?? null,   // từ ai / bộ phận nào
            asset.CurrSectionID ?? null,
            EmployeeReceiveID,              // nơi nhận bảo trì
            SectionReceiveID ?? null,
            qty,
            note,
          ]
        );

        // ⚙️ Cập nhật asset:
        // - Nếu vẫn còn hàng trong kho → giữ nguyên Employee/Section cũ
        // - Nếu đã hết hàng → gán sang bên nhận bảo trì
        if (remain > 0) {
          await conn.execute(
            `UPDATE asset
               SET RemainQuantity = ?,
                   Status = ?
             WHERE ID = ?`,
            [remain, newStatus, AssetID]
          );
        } else {
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
      }

      // Update Request
      await conn.execute(
        `UPDATE request 
         SET CurrentState='APPROVED', UpdatedAt=NOW() 
         WHERE RequestID=?`,
        [id]
      );

      // Log CONFIRMED (sau khi xử lý xong tất cả asset)
      await conn.execute(
        `INSERT INTO approvalhistory
          (RequestID, ApproverUserID, DepartmentID, Action, ActionAt, Comment)
         VALUES (?, ?, ?, 'CONFIRMED', NOW(), 'Đã xuất bảo trì và cập nhật tồn kho/trạng thái cho tất cả tài sản')`,
        [id, ApproverUserID, DepartmentID]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error("approveRequestMaintenance error:", err);
    throw err instanceof AppError
      ? err
      : new AppError(err.message || "INTERNAL_ERROR", 500);
  } finally {
    conn.release();
  }
};

const getRequestMaintenanceDetail = async (id) => {
  const [[request]] = await db.execute(
    `SELECT * FROM request WHERE RequestID=?`,
    [id]
  );
  // maintenance là MẢNG các asset giống allocation
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
     JOIN requesttype rt 
       ON rt.RequestTypeID = r.RequestTypeID 
      AND UPPER(rt.Code)='MAINTENANCE'
     LEFT JOIN request_maintenance rm 
       ON rm.RequestID = r.RequestID
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
