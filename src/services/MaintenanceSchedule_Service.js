const db = require("../config/database");
const AppError = require("../utils/AppError");

// ==============================
// GET LIST
// ==============================
const getSchedules = async () => {
  const [rows] = await db.execute(`
    SELECT s.*, 
      COUNT(sa.ID) AS AssetCount,
      SUM(sa.Status='ACTIVE') AS ActiveAssets
    FROM maintenanceschedule s
    LEFT JOIN maintenancescheduleasset sa ON sa.ScheduleID = s.ScheduleID
    GROUP BY s.ScheduleID
    ORDER BY s.CreatedAt DESC
    LIMIT 300
  `);

  return rows;
};

// ==============================
// CREATE SCHEDULE (multi-assets)
// ==============================
const createSchedule = async (payload) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const {
      Title,
      IntervalMonths,
      NextMaintenanceDate,
      Priority = "MEDIUM",
      Notes = null,
      AutoCreateWorkOrder = true,
      CreatedByUserID,
      Assets = [] // list asset configs
    } = payload;

    // 1. Insert header
    const [r1] = await conn.execute(
      `INSERT INTO maintenanceschedule
        (Title, IntervalMonths, NextMaintenanceDate, Priority, Notes, AutoCreateWorkOrder, CreatedByUserID)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        Title,
        IntervalMonths,
        NextMaintenanceDate,
        Priority,
        Notes,
        !!AutoCreateWorkOrder,
        CreatedByUserID
      ]
    );

    const scheduleId = r1.insertId;

    // 2. Insert asset rows
    for (const item of Assets) {
      await conn.execute(
        `INSERT INTO maintenancescheduleasset
          (ScheduleID, AssetID, AssignedToUserID, NextMaintenanceDate,
           ReminderDaysBefore, WindowStart, WindowEnd, EstimatedHours)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scheduleId,
          item.AssetID,
          item.AssignedToUserID ?? null,
          NextMaintenanceDate,
          item.ReminderDaysBefore ?? 7,
          item.WindowStart ?? null,
          item.WindowEnd ?? null,
          item.EstimatedHours ?? null
        ]
      );
    }

    await conn.commit();
    return { ScheduleID: scheduleId };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ==============================
// UPDATE SCHEDULE HEADER
// ==============================
const updateSchedule = async (scheduleId, updates = {}) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[sched]] = await conn.execute(
      "SELECT * FROM maintenanceschedule WHERE ScheduleID=? FOR UPDATE",
      [scheduleId]
    );
    if (!sched) throw new AppError("SCHEDULE_NOT_FOUND", 404);

    if (updates.Cancel === true) {
      await conn.execute(
        "UPDATE maintenanceschedule SET Status='CANCELLED' WHERE ScheduleID=?",
        [scheduleId]
      );
      await conn.commit();
      return { ScheduleID: scheduleId, Status: "CANCELLED" };
    }

    const fields = [];
    const params = [];

    const allow = [
      "Title",
      "IntervalMonths",
      "NextMaintenanceDate",
      "Priority",
      "Notes",
      "AutoCreateWorkOrder",
      "Status"
    ];

    for (const key of allow) {
      if (updates[key] !== undefined) {
        fields.push(`${key}=?`);
        params.push(updates[key]);
      }
    }

    if (fields.length) {
      params.push(scheduleId);
      await conn.execute(
        `UPDATE maintenanceschedule SET ${fields.join(", ")}
         WHERE ScheduleID=?`,
        params
      );
    }

    await conn.commit();
    return { ScheduleID: scheduleId, updated: true };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ==============================
// UPDATE A SINGLE ASSET INSIDE SCHEDULE
// ==============================
const updateScheduleAsset = async (id, updates = {}) => {
  const fields = [];
  const params = [];

  const allow = [
    "AssignedToUserID",
    "NextMaintenanceDate",
    "ReminderDaysBefore",
    "WindowStart",
    "WindowEnd",
    "EstimatedHours",
    "Status"
  ];

  for (const key of allow) {
    if (updates[key] !== undefined) {
      fields.push(`${key}=?`);
      params.push(updates[key]);
    }
  }

  params.push(id);

  await db.execute(
    `UPDATE maintenancescheduleasset SET ${fields.join(", ")} WHERE ID=?`,
    params
  );

  return { ID: id, updated: true };
};

// ==============================
// GENERATE WORK ORDERS FOR ALL ASSETS IN A SCHEDULE
// ==============================
const generateWOForSchedule = async (scheduleId, createdByUserId) => {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // Lấy danh sách asset thuộc ScheduleID
    const [assets] = await conn.execute(
      "SELECT * FROM maintenancescheduleasset WHERE ScheduleID=? AND Status='ACTIVE'",
      [scheduleId]
    );

    for (const item of assets) {
      await conn.execute(
        `
          INSERT INTO maintenanceworkorder
          (
            ScheduleAssetID,
            AssetID,
            DueDate,
            AssignedToUserID,
            CreatedByUserID,
            Status
          )
          VALUES (?, ?, ?, ?, ?, 'OPEN')
        `,
        [
          item.ID,                   // ScheduleAssetID
          item.AssetID,              // AssetID
          item.NextMaintenanceDate,  // DueDate
          item.AssignedToUserID,     // AssignedToUserID
          createdByUserId            // CreatedByUserID
        ]
      );
    }

    await conn.commit();

    return {
      ScheduleID: scheduleId,
      WOCreated: assets.length,
    };

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
  updateScheduleAsset,
  generateWOForSchedule,
};
