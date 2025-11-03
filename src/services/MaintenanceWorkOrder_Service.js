const db = require("../config/database");
const AppError = require("../utils/AppError");

const getWorkOrders = async (query = {}) => {
  const { status, asset, from, to, assignee } = query;
  const where = [];
  const params = [];
  if (status) { where.push("Status=?"); params.push(status); }
  if (asset) { where.push("AssetID=?"); params.push(asset); }
  if (assignee) { where.push("AssignedToUserID=?"); params.push(Number(assignee)); }
  if (from) { where.push("DueDate>=?"); params.push(from); }
  if (to) { where.push("DueDate<=?"); params.push(to); }

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
    [ScheduleID, AssetID, DueDate, PlannedStart, PlannedEnd, AssignedToUserID, CreatedByUserID, Notes]
  );
  return { AssetID, DueDate, ScheduleID, AssignedToUserID };
};

const startWorkOrder = async (workOrderId, PlannedStart = null) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[wo]] = await conn.execute(
      "SELECT * FROM maintenanceworkorder WHERE WorkOrderID=? FOR UPDATE",
      [workOrderId]
    );
    if (!wo) throw new AppError("WORK_ORDER_NOT_FOUND", 404);
    if (wo.Status !== "OPEN") throw new AppError("WORK_ORDER_NOT_OPEN", 409);

    await conn.execute(
      `UPDATE maintenanceworkorder
       SET Status='IN_PROGRESS', PlannedStart=COALESCE(?, NOW())
       WHERE WorkOrderID=?`,
      [PlannedStart, workOrderId]
    );

    // Ghi lịch sử xuất bảo trì (OUT)
    await conn.execute(
      `INSERT INTO assethistory
         (ID, AssetID, RequestID, EmployeeID, SectionID, EmployeeReceiveID, SectionReceiveID, Quantity, Type, ActionAt, Note)
       VALUES (UUID(), ?, NULL, NULL, NULL, NULL, NULL, 1, 'MAINTENANCE_OUT', NOW(), CONCAT('WO#', ?, ' start'))`,
      [wo.AssetID, workOrderId]
    );

    await conn.commit();
    return { WorkOrderID: workOrderId, Status: "IN_PROGRESS" };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

const completeWorkOrder = async (workOrderId, CompletedAt, ResultNotes = null, Cost = null, UpdateScheduleNext = true) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[wo]] = await conn.execute(
      "SELECT * FROM maintenanceworkorder WHERE WorkOrderID=? FOR UPDATE",
      [workOrderId]
    );
    if (!wo) throw new AppError("WORK_ORDER_NOT_FOUND", 404);
    if (wo.Status === "DONE" || wo.Status === "CANCELLED")
      throw new AppError("WORK_ORDER_FINALIZED", 409);

    // 1) Đánh dấu DONE
    await conn.execute(
      `UPDATE maintenanceworkorder
       SET Status='DONE', CompletedAt=?, ResultNotes=?, Cost=?
       WHERE WorkOrderID=?`,
      [CompletedAt, ResultNotes, Cost, workOrderId]
    );

    // 2) Log nhập bảo trì (IN)
    await conn.execute(
      `INSERT INTO assethistory
         (ID, AssetID, RequestID, EmployeeID, SectionID, EmployeeReceiveID, SectionReceiveID, Quantity, Type, ActionAt, Note)
       VALUES (UUID(), ?, NULL, NULL, NULL, NULL, NULL, 1, 'MAINTENANCE_IN', ?, CONCAT('WO#', ?, ' done'))`,
      [wo.AssetID, CompletedAt, workOrderId]
    );

    // 3) Cập nhật Schedule nếu có
    if (wo.ScheduleID && UpdateScheduleNext) {
      const [[ms]] = await conn.execute(
        "SELECT * FROM maintenanceschedule WHERE ScheduleID=? FOR UPDATE",
        [wo.ScheduleID]
      );
      if (ms) {
        await conn.execute(
          `UPDATE maintenanceschedule
           SET LastMaintenanceDate = DATE(?),
               NextMaintenanceDate = CASE
                 WHEN COALESCE(IntervalMonths,0) <= 0 THEN NULL
                 ELSE DATE_ADD(DATE(?), INTERVAL IntervalMonths MONTH)
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
    return { WorkOrderID: workOrderId, Status: "DONE" };
  } catch (e) {
    await conn.rollback();
    throw e;
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
