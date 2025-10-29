const db = require("../config/database");
const AppError = require("../utils/AppError");
const { v4: uuidv4 } = require("uuid");

const getSchedules = async (query = {}) => {
  const { status, assignee, from, to, asset } = query;
  const where = [];
  const params = [];
  if (status) { where.push("Status = ?"); params.push(status); }
  if (assignee) { where.push("AssignedToUserID = ?"); params.push(Number(assignee)); }
  if (asset) { where.push("AssetID = ?"); params.push(asset); }
  if (from) { where.push("NextMaintenanceDate >= ?"); params.push(from); }
  if (to) { where.push("NextMaintenanceDate <= ?"); params.push(to); }

  const sql = `
    SELECT * FROM MaintenanceSchedule
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY NextMaintenanceDate ASC, Priority DESC
    LIMIT 500
  `;
  const [rows] = await db.execute(sql, params);
  return rows;
};

const createSchedule = async (payload) => {
  const {
    AssetID,
    IntervalMonths = null,
    NextMaintenanceDate,
    AssignedToUserID = null,
    ReminderDaysBefore = 7,
    WindowStart = null,
    WindowEnd = null,
    EstimatedHours = null,
    Priority = "MEDIUM",
    Notes = null,
    AutoCreateWorkOrder = true,
    CreatedByUserID = null,
  } = payload;

  await db.execute(
    `INSERT INTO MaintenanceSchedule
      (AssetID, IntervalMonths, NextMaintenanceDate, LastMaintenanceDate, Status,
       CreatedByUserID, AssignedToUserID, ReminderDaysBefore, WindowStart, WindowEnd,
       EstimatedHours, Priority, Notes, AutoCreateWorkOrder)
     VALUES (?, ?, ?, NULL, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      AssetID,
      IntervalMonths,
      NextMaintenanceDate,
      CreatedByUserID,
      AssignedToUserID,
      ReminderDaysBefore,
      WindowStart,
      WindowEnd,
      EstimatedHours,
      Priority,
      Notes,
      !!AutoCreateWorkOrder,
    ]
  );
  return { AssetID, NextMaintenanceDate, IntervalMonths, AssignedToUserID, AutoCreateWorkOrder };
};

const updateSchedule = async (id, updates = {}) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[ms]] = await conn.execute(
      "SELECT * FROM MaintenanceSchedule WHERE ScheduleID=? FOR UPDATE",
      [id]
    );
    if (!ms) throw new AppError("SCHEDULE_NOT_FOUND", 404);

    if (updates.Cancel === true) {
      if (ms.Status !== "CANCELLED") {
        await conn.execute("UPDATE MaintenanceSchedule SET Status='CANCELLED' WHERE ScheduleID=?", [id]);
      }
      await conn.commit();
      return { ScheduleID: id, Status: "CANCELLED" };
    }

    const sets = [];
    const params = [];
    const add = (f, v) => { sets.push(`${f}=?`); params.push(v); };

    const {
      IntervalMonths,
      NextMaintenanceDate,
      AssignedToUserID,
      ReminderDaysBefore,
      WindowStart,
      WindowEnd,
      EstimatedHours,
      Priority,
      Notes,
      AutoCreateWorkOrder,
      Status, // (optional) allow manual status change (except to CANCELLED use Cancel flag)
    } = updates;

    if (IntervalMonths !== undefined) add("IntervalMonths", IntervalMonths ?? null);
    if (NextMaintenanceDate !== undefined) add("NextMaintenanceDate", NextMaintenanceDate);
    if (AssignedToUserID !== undefined) add("AssignedToUserID", AssignedToUserID ?? null);
    if (ReminderDaysBefore !== undefined) add("ReminderDaysBefore", ReminderDaysBefore);
    if (WindowStart !== undefined) add("WindowStart", WindowStart ?? null);
    if (WindowEnd !== undefined) add("WindowEnd", WindowEnd ?? null);
    if (EstimatedHours !== undefined) add("EstimatedHours", EstimatedHours ?? null);
    if (Priority !== undefined) add("Priority", Priority);
    if (Notes !== undefined) add("Notes", Notes ?? null);
    if (AutoCreateWorkOrder !== undefined) add("AutoCreateWorkOrder", !!AutoCreateWorkOrder);
    if (Status !== undefined && Status !== "CANCELLED") add("Status", Status);

    if (!sets.length) {
      await conn.rollback();
      return { ScheduleID: id, message: "No change" };
    }
    params.push(id);

    await conn.execute(`UPDATE MaintenanceSchedule SET ${sets.join(", ")} WHERE ScheduleID=?`, params);
    await conn.commit();
    return { ScheduleID: id, updated: true };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

const generateWOForCurrentCycle = async (scheduleId, userId = null) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[ms]] = await conn.execute(
      "SELECT * FROM MaintenanceSchedule WHERE ScheduleID=? FOR UPDATE",
      [scheduleId]
    );
    if (!ms) throw new AppError("SCHEDULE_NOT_FOUND", 404);
    if (ms.Status === "CANCELLED") throw new AppError("SCHEDULE_CANCELLED", 409);
    if (!ms.NextMaintenanceDate) throw new AppError("SCHEDULE_HAS_NO_NEXT_DATE", 409);

    // Yêu cầu: tạo UNIQUE KEY uq_mwo_sched_due (ScheduleID, DueDate) cho idempotent
    await conn.execute(
      `INSERT INTO MaintenanceWorkOrder
         (ScheduleID, AssetID, DueDate, AssignedToUserID, CreatedByUserID, Status)
       VALUES (?, ?, ?, ?, ?, 'OPEN')
       ON DUPLICATE KEY UPDATE WorkOrderID=WorkOrderID`,
      [ms.ScheduleID, ms.AssetID, ms.NextMaintenanceDate, ms.AssignedToUserID, userId]
    );

    await conn.commit();
    return { ScheduleID: scheduleId, DueDate: ms.NextMaintenanceDate, created: true };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = {
  getSchedules,
  createSchedule,
  updateSchedule,
  generateWOForCurrentCycle,
};
