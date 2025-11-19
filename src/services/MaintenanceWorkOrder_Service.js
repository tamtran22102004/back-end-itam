const db = require("../config/database");
const AppError = require("../utils/AppError");

// ===== Asset status map (giữ nguyên như cũ) =====
const ASSET_STATUS = {
  AVAILABLE: 1,
  ALLOCATED: 2,
  MAINTENANCE_OUT: 3,
  WARRANTY_OUT: 4,
  DISPOSED: 5,
  IN_USE: 6,
};

function determineAssetStatus(originalQty, remainQty) {
  const o = Number(originalQty ?? 1);
  const r = Number(remainQty ?? 0);
  if (r > 0) return ASSET_STATUS.AVAILABLE;
  if (o === 1) return ASSET_STATUS.MAINTENANCE_OUT;
  return ASSET_STATUS.IN_USE;
}

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

/* ============================================================
   GET WORK ORDERS
   GET /api/maintenance/workorders?status=&asset=&assignee=&scheduleAssetId=&from=&to=
============================================================ */
const getWorkOrders = async (query = {}) => {
  const { status, asset, assignee, scheduleAssetId, from, to } = query;

  const where = [];
  const params = [];

  if (status) {
    where.push("w.Status = ?");
    params.push(status);
  }
  if (asset) {
    where.push("w.AssetID = ?");
    params.push(asset);
  }
  if (assignee) {
    where.push("w.AssignedToUserID = ?");
    params.push(Number(assignee));
  }
  if (scheduleAssetId) {
    where.push("w.ScheduleAssetID = ?");
    params.push(Number(scheduleAssetId));
  }
  if (from) {
    where.push("w.DueDate >= ?");
    params.push(from);
  }
  if (to) {
    where.push("w.DueDate <= ?");
    params.push(to);
  }

  const sql = `
    SELECT
      w.*,
      sa.ScheduleID
    FROM maintenanceworkorder w
    LEFT JOIN maintenancescheduleasset sa
      ON sa.ID = w.ScheduleAssetID
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY w.DueDate ASC, w.WorkOrderID DESC
    LIMIT 500
  `;

  const [rows] = await db.execute(sql, params);
  return rows;
};

/* ============================================================
   CREATE WORK ORDER – dùng ScheduleAssetID (KHÔNG còn ScheduleID)
============================================================ */
const createWorkOrder = async (payload) => {
  const {
    ScheduleAssetID,
    AssetID,
    DueDate,
    PlannedStart = null,
    PlannedEnd = null,
    AssignedToUserID = null,
    CreatedByUserID = null,
    Notes = null, // map vào ResultNotes ban đầu (nội dung yêu cầu)
  } = payload;

  if (!ScheduleAssetID) throw new AppError("ScheduleAssetID_REQUIRED", 400);
  if (!AssetID) throw new AppError("AssetID_REQUIRED", 400);
  if (!DueDate) throw new AppError("DueDate_REQUIRED", 400);

  const [rs] = await db.execute(
    `
      INSERT INTO maintenanceworkorder
      (
        ScheduleAssetID,
        AssetID,
        DueDate,
        PlannedStart,
        PlannedEnd,
        AssignedToUserID,
        CreatedByUserID,
        Status,
        ResultNotes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
    `,
    [
      ScheduleAssetID,
      AssetID,
      DueDate,
      PlannedStart,
      PlannedEnd,
      AssignedToUserID,
      CreatedByUserID,
      Notes,
    ]
  );

  return {
    WorkOrderID: rs.insertId,
    ScheduleAssetID,
    AssetID,
    DueDate,
  };
};

/* ============================================================
   START WORK ORDER (MAINTENANCE_OUT)
   PATCH /api/maintenance/workorders/:id/start
============================================================ */
const startWorkOrder = async (
  workOrderId,
  { PlannedStart = null, ReceiverUserID, ReceiverDepartmentID = null } = {}
) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[wo]] = await conn.execute(
      "SELECT * FROM maintenanceworkorder WHERE WorkOrderID=? FOR UPDATE",
      [workOrderId]
    );
    if (!wo) throw new AppError("WORK_ORDER_NOT_FOUND", 404);
    if (wo.Status !== "OPEN")
      throw new AppError("WORK_ORDER_NOT_OPEN", 409);

    const qty = Number(wo.Quantity ?? 1);

    const [[asset]] = await conn.execute(
      `
        SELECT Quantity, RemainQuantity,
               EmployeeID AS CurrEmployeeID,
               SectionID  AS CurrSectionID
        FROM asset
        WHERE ID=? FOR UPDATE
      `,
      [wo.AssetID]
    );
    if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);

    const { userId: recvUID, deptId: recvDID } = await normalizeReceiver(
      conn,
      ReceiverUserID,
      ReceiverDepartmentID
    );

    const remain = Math.max(0, Number(asset.RemainQuantity ?? 0) - qty);
    const newStatus = determineAssetStatus(
      Number(asset.Quantity ?? 1),
      remain
    );

    await conn.execute(
      `
        UPDATE maintenanceworkorder
        SET Status='IN_PROGRESS',
            PlannedStart=COALESCE(?, NOW())
        WHERE WorkOrderID=?
      `,
      [PlannedStart, workOrderId]
    );

    await conn.execute(
      `
        UPDATE asset
        SET RemainQuantity=?,
            Status=?,
            EmployeeID=?,
            SectionID=?
        WHERE ID=?
      `,
      [remain, newStatus, recvUID, recvDID, wo.AssetID]
    );

    await conn.execute(
      `
        INSERT INTO assethistory
        (
          ID, AssetID, RequestID,
          EmployeeID, SectionID,
          EmployeeReceiveID, SectionReceiveID,
          Quantity, Type, ActionAt, Note
        )
        VALUES
        (
          UUID(), ?, NULL,
          ?, ?, ?, ?, ?, 'MAINTENANCE_OUT',
          NOW(), CONCAT('WO#', ?, ' start')
        )
      `,
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

/* ============================================================
   COMPLETE WORK ORDER (MAINTENANCE_IN + cập nhật lịch tài sản)
   PATCH /api/maintenance/workorders/:id/complete
============================================================ */
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

    const [[wo]] = await conn.execute(
      "SELECT * FROM maintenanceworkorder WHERE WorkOrderID=? FOR UPDATE",
      [workOrderId]
    );
    if (!wo) throw new AppError("WORK_ORDER_NOT_FOUND", 404);
    if (["DONE", "CANCELLED"].includes(wo.Status))
      throw new AppError("WORK_ORDER_FINALIZED", 409);

    const qty = Number(wo.Quantity ?? 1);

    const [[asset]] = await conn.execute(
      `
        SELECT Quantity, RemainQuantity
        FROM asset
        WHERE ID=? FOR UPDATE
      `,
      [wo.AssetID]
    );
    if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);

    const { userId: retUID, deptId: retDID } = await normalizeReceiver(
      conn,
      ReturnUserID,
      ReturnDepartmentID
    );

    const remain = Number(asset.RemainQuantity ?? 0) + qty;
    const newStatus = determineAssetStatus(
      Number(asset.Quantity ?? 1),
      remain
    );

    await conn.execute(
      `
        UPDATE maintenanceworkorder
        SET Status='DONE',
            CompletedAt = COALESCE(?, NOW()),
            ResultNotes = ?,
            Cost = ?
        WHERE WorkOrderID=?
      `,
      [CompletedAt, ResultNotes, Cost, workOrderId]
    );

    await conn.execute(
      `
        INSERT INTO assethistory
        (
          ID, AssetID, RequestID,
          EmployeeID, SectionID,
          EmployeeReceiveID, SectionReceiveID,
          Quantity, Type, ActionAt, Note
        )
        VALUES
        (
          UUID(), ?, NULL,
          NULL, NULL,
          ?, ?, ?, 'MAINTENANCE_IN',
          COALESCE(?, NOW()),
          CONCAT('WO#', ?, ' done')
        )
      `,
      [wo.AssetID, retUID, retDID, qty, CompletedAt, workOrderId]
    );

    await conn.execute(
      `
        UPDATE asset
        SET RemainQuantity=?,
            Status=?,
            EmployeeID=?,
            SectionID=?
        WHERE ID=?
      `,
      [remain, newStatus, retUID, retDID, wo.AssetID]
    );

    // === Cập nhật lịch bảo trì cho asset nếu có ScheduleAssetID ===
    if (wo.ScheduleAssetID && UpdateScheduleNext) {
      const [[sa]] = await conn.execute(
        `
          SELECT sa.ID, sa.ScheduleID, s.IntervalMonths
          FROM maintenancescheduleasset sa
          JOIN maintenanceschedule s
            ON s.ScheduleID = sa.ScheduleID
          WHERE sa.ID = ?
          FOR UPDATE
        `,
        [wo.ScheduleAssetID]
      );

      if (sa) {
        const completedDateExpr = "DATE(COALESCE(?, NOW()))";
        const interval = Number(sa.IntervalMonths ?? 0);

        await conn.execute(
          `
            UPDATE maintenancescheduleasset
            SET LastMaintenanceDate = ${completedDateExpr},
                NextMaintenanceDate = CASE
                  WHEN ? <= 0 THEN NULL
                  ELSE DATE_ADD(${completedDateExpr}, INTERVAL ? MONTH)
                END,
                Status = CASE
                  WHEN ? <= 0 THEN 'COMPLETED'
                  ELSE 'ACTIVE'
                END
            WHERE ID = ?
          `,
          [
            CompletedAt,
            interval,
            CompletedAt,
            interval,
            interval,
            sa.ID,
          ]
        );

        // Optional: cập nhật NextMaintenanceDate của header = min(NextMaintenanceDate) của các asset cùng Schedule
        await conn.execute(
          `
            UPDATE maintenanceschedule
            SET NextMaintenanceDate = (
              SELECT MIN(NextMaintenanceDate)
              FROM maintenancescheduleasset
              WHERE ScheduleID = ?
            )
            WHERE ScheduleID = ?
          `,
          [sa.ScheduleID, sa.ScheduleID]
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

/* ============================================================
   CANCEL WORK ORDER
============================================================ */
const cancelWorkOrder = async (workOrderId, Reason = null) => {
  const [ret] = await db.execute(
    `
      UPDATE maintenanceworkorder
      SET Status='CANCELLED',
          ResultNotes = CONCAT(COALESCE(ResultNotes, ''), ' | Cancel: ', ?)
      WHERE WorkOrderID=? AND Status IN ('OPEN','IN_PROGRESS')
    `,
    [Reason, workOrderId]
  );
  if (ret.affectedRows === 0)
    throw new AppError("CANNOT_CANCEL_WO", 409);
  return { WorkOrderID: workOrderId, Status: "CANCELLED" };
};

module.exports = {
  getWorkOrders,
  createWorkOrder,
  startWorkOrder,
  completeWorkOrder,
  cancelWorkOrder,
};
