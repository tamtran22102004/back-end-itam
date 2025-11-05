const db = require("../config/database");
const AppError = require("../utils/AppError");

const getWorkOrders = async (query = {}) => {
  const { status, asset, from, to, assignee } = query;
  const where = [];
  const params = [];
  if (status) {
    where.push("Status=?");
    params.push(status);
  }
  if (asset) {
    where.push("AssetID=?");
    params.push(asset);
  }
  if (assignee) {
    where.push("AssignedToUserID=?");
    params.push(Number(assignee));
  }
  if (from) {
    where.push("DueDate>=?");
    params.push(from);
  }
  if (to) {
    where.push("DueDate<=?");
    params.push(to);
  }

  const sql = `
    SELECT * FROM maintenanceworkorder
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY DueDate ASC, WorkOrderID DESC
    LIMIT 500
  `;
  const [rows] = await db.execute(sql, params);
  return rows;
};

const createWorkOrder = async (payload) => {
  const {
    ScheduleID = null,
    AssetID,
    DueDate,
    PlannedStart = null,
    PlannedEnd = null,
    AssignedToUserID = null,
    Notes = null,
    CreatedByUserID = null,
  } = payload;

  await db.execute(
    `INSERT INTO maintenanceworkorder
      (ScheduleID, AssetID, DueDate, PlannedStart, PlannedEnd, AssignedToUserID, CreatedByUserID, Status, ResultNotes)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
    [
      ScheduleID,
      AssetID,
      DueDate,
      PlannedStart,
      PlannedEnd,
      AssignedToUserID,
      CreatedByUserID,
      Notes,
    ]
  );
  return { AssetID, DueDate, ScheduleID, AssignedToUserID };
};
// ===== Status map =====
const ASSET_STATUS = {
  AVAILABLE: 1,
  ALLOCATED: 2,
  MAINTENANCE_OUT: 3, // dùng trong assethistory.Type
  WARRANTY_OUT: 4,
  DISPOSED: 5,
  IN_USE: 6,
};

// ===== Helper: quyết định trạng thái sau khi thay đổi tồn kho =====
function determineAssetStatus(originalQty, remainQty) {
  const o = Number(originalQty ?? 1);
  const r = Number(remainQty ?? 0);
  if (r > 0) return ASSET_STATUS.AVAILABLE;
  if (o === 1) return ASSET_STATUS.MAINTENANCE_OUT;
  return ASSET_STATUS.IN_USE;
}

// ===== Helper: chuẩn hóa (UserID, DepartmentID) nhận tài sản =====
async function normalizeReceiver(conn, userId, departmentId) {
  if (!userId) throw new AppError("RECEIVER_USER_REQUIRED", 400);
  let deptId = departmentId ?? null;
  if (deptId == null) {
    const [[u]] = await conn.execute(
      "SELECT DepartmentID FROM `user` WHERE UserID=?",
      [userId]
    );
    deptId = u ? u.DepartmentID ?? null : null;
  }
  return { userId, deptId };
}

/**
 * BẮT ĐẦU WORK ORDER (OUT):
 * - Bắt buộc truyền receiver: { ReceiverUserID, ReceiverDepartmentID? }
 * - Giảm RemainQuantity theo wo.Quantity (mặc định 1)
 * - Gán asset.EmployeeID/SectionID = receiver
 * - Log assethistory: MAINTENANCE_OUT (Quantity = wo.Quantity)
 */
const startWorkOrder = async (
  workOrderId,
  { PlannedStart = null, ReceiverUserID, ReceiverDepartmentID = null } = {}
) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Lock WO
    const [[wo]] = await conn.execute(
      "SELECT * FROM maintenanceworkorder WHERE WorkOrderID=? FOR UPDATE",
      [workOrderId]
    );
    if (!wo) throw new AppError("WORK_ORDER_NOT_FOUND", 404);
    if (wo.Status !== "OPEN") throw new AppError("WORK_ORDER_NOT_OPEN", 409);

    const qty = Number(wo.Quantity ?? 1);

    // Lock asset
    const [[asset]] = await conn.execute(
      `SELECT Quantity, RemainQuantity,
              EmployeeID AS CurrEmployeeID,
              SectionID  AS CurrSectionID
       FROM asset WHERE ID=? FOR UPDATE`,
      [wo.AssetID]
    );
    if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);

    // Chuẩn hóa người nhận OUT
    const { userId: recvUID, deptId: recvDID } = await normalizeReceiver(
      conn,
      ReceiverUserID,
      ReceiverDepartmentID
    );

    // Giảm tồn kho (không cho âm)
    const remain = Math.max(0, Number(asset.RemainQuantity ?? 0) - qty);
    const newStatus = determineAssetStatus(Number(asset.Quantity ?? 1), remain);

    // Cập nhật WO
    await conn.execute(
      `UPDATE maintenanceworkorder
       SET Status='IN_PROGRESS', PlannedStart=COALESCE(?, NOW())
       WHERE WorkOrderID=?`,
      [PlannedStart, workOrderId]
    );

    // Cập nhật Asset: gán người/đơn vị nhận bảo trì
    await conn.execute(
      `UPDATE asset
         SET RemainQuantity=?, Status=?, EmployeeID=?, SectionID=?
       WHERE ID=?`,
      [remain, newStatus, recvUID, recvDID, wo.AssetID]
    );

    // Ghi lịch sử: MAINTENANCE_OUT (from = Curr*, to = receiver)
    await conn.execute(
      `INSERT INTO assethistory
         (ID, AssetID, RequestID, EmployeeID, SectionID,
          EmployeeReceiveID, SectionReceiveID, Quantity, Type, ActionAt, Note)
       VALUES (UUID(), ?, NULL, ?, ?, ?, ?, ?, 'MAINTENANCE_OUT', NOW(),
               CONCAT('WO#', ?, ' start'))`,
      [
        wo.AssetID,
        asset.CurrEmployeeID ?? null,
        asset.CurrSectionID ?? null,
        recvUID,
        recvDID,
        qty,
        workOrderId,
      ]
    );

    await conn.commit();
    return {
      WorkOrderID: workOrderId,
      Status: "IN_PROGRESS",
      RemainQuantity: remain,
      AssetStatus: newStatus,
    };
  } catch (e) {
    await conn.rollback();
    throw e instanceof AppError
      ? e
      : new AppError(e.message || "INTERNAL_ERROR", 500);
  } finally {
    conn.release();
  }
};

/**
 * HOÀN THÀNH WORK ORDER (IN):
 * - Bắt buộc truyền nơi nhận về: { ReturnUserID, ReturnDepartmentID? }
 * - Cộng RemainQuantity theo wo.Quantity (mặc định 1)
 * - Gán asset.EmployeeID/SectionID = nơi nhận về
 * - Log assethistory: MAINTENANCE_IN (Quantity = wo.Quantity, ActionAt = CompletedAt/NOW)
 * - Cập nhật schedule nếu có
 */
const completeWorkOrder = async (
  workOrderId,
  {
    CompletedAt = null,
    ResultNotes = null,
    Cost = null,
    UpdateScheduleNext = true,
    ReturnUserID,
    ReturnDepartmentID = null,
  } = {}
) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Lock WO
    const [[wo]] = await conn.execute(
      "SELECT * FROM maintenanceworkorder WHERE WorkOrderID=? FOR UPDATE",
      [workOrderId]
    );
    if (!wo) throw new AppError("WORK_ORDER_NOT_FOUND", 404);
    if (["DONE", "CANCELLED"].includes(wo.Status))
      throw new AppError("WORK_ORDER_FINALIZED", 409);

    const qty = Number(wo.Quantity ?? 1);

    // Lock asset
    const [[asset]] = await conn.execute(
      `SELECT Quantity, RemainQuantity
       FROM asset WHERE ID=? FOR UPDATE`,
      [wo.AssetID]
    );
    if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);

    // Chuẩn hóa nơi nhận về
    const { userId: retUID, deptId: retDID } = await normalizeReceiver(
      conn,
      ReturnUserID,
      ReturnDepartmentID
    );

    // Cộng tồn kho
    const remain = Number(asset.RemainQuantity ?? 0) + qty;
    const newStatus = determineAssetStatus(Number(asset.Quantity ?? 1), remain);

    // 1) Đánh dấu DONE
    await conn.execute(
      `UPDATE maintenanceworkorder
         SET Status='DONE',
             CompletedAt=COALESCE(?, NOW()),
             ResultNotes=?,
             Cost=?
       WHERE WorkOrderID=?`,
      [CompletedAt, ResultNotes, Cost, workOrderId]
    );

    // 2) Ghi lịch sử: MAINTENANCE_IN (to = nơi nhận về)
    await conn.execute(
      `INSERT INTO assethistory
         (ID, AssetID, RequestID, EmployeeID, SectionID,
          EmployeeReceiveID, SectionReceiveID, Quantity, Type, ActionAt, Note)
       VALUES (UUID(), ?, NULL, NULL, NULL, ?, ?, ?, 'MAINTENANCE_IN', COALESCE(?, NOW()),
               CONCAT('WO#', ?, ' done'))`,
      [wo.AssetID, retUID, retDID, qty, CompletedAt, workOrderId]
    );

    // 3) Cập nhật Asset: trả về & gán người/đơn vị nhận về
    await conn.execute(
      `UPDATE asset
         SET RemainQuantity=?, Status=?, EmployeeID=?, SectionID=?
       WHERE ID=?`,
      [remain, newStatus, retUID, retDID, wo.AssetID]
    );

    // 4) Cập nhật lịch bảo trì (nếu có)
    if (wo.ScheduleID && UpdateScheduleNext) {
      const [[ms]] = await conn.execute(
        "SELECT * FROM maintenanceschedule WHERE ScheduleID=? FOR UPDATE",
        [wo.ScheduleID]
      );
      if (ms) {
        await conn.execute(
          `UPDATE maintenanceschedule
             SET LastMaintenanceDate = DATE(COALESCE(?, NOW())),
                 NextMaintenanceDate = CASE
                   WHEN COALESCE(IntervalMonths,0) <= 0 THEN NULL
                   ELSE DATE_ADD(DATE(COALESCE(?, NOW())), INTERVAL IntervalMonths MONTH)
                 END,
                 Status = CASE
                   WHEN COALESCE(IntervalMonths,0) <= 0 THEN 'COMPLETED'
                   ELSE 'ACTIVE'
                 END
           WHERE ScheduleID=?`,
          [CompletedAt, CompletedAt, wo.ScheduleID]
        );
      }
    }

    await conn.commit();
    return {
      WorkOrderID: workOrderId,
      Status: "DONE",
      RemainQuantity: remain,
      AssetStatus: newStatus,
    };
  } catch (e) {
    await conn.rollback();
    throw e instanceof AppError
      ? e
      : new AppError(e.message || "INTERNAL_ERROR", 500);
  } finally {
    conn.release();
  }
};

const cancelWorkOrder = async (workOrderId, Reason = null) => {
  const [ret] = await db.execute(
    `UPDATE maintenanceworkorder
     SET Status='CANCELLED',
         ResultNotes=CONCAT(COALESCE(ResultNotes,''), ' | Cancel: ', ?)
     WHERE WorkOrderID=? AND Status IN ('OPEN','IN_PROGRESS')`,
    [Reason, workOrderId]
  );
  if (ret.affectedRows === 0) throw new AppError("CANNOT_CANCEL_WO", 409);
  return { WorkOrderID: workOrderId, Status: "CANCELLED" };
};

module.exports = {
  getWorkOrders,
  createWorkOrder,
  startWorkOrder,
  completeWorkOrder,
  cancelWorkOrder,
};
