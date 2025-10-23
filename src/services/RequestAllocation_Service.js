const db = require("../config/database");
const AppError = require("../utils/AppError");
const { v4: uuidv4 } = require("uuid");

const createRequestAllocation = async (data) => {
  const { RequesterUserID, AssetID, Quantity, Note } = data;

  const [requestResult] = await db.execute(
    `INSERT INTO Request (RequestTypeID, RequesterUserID, CurrentState, CreatedAt, UpdatedAt, Note)
       VALUES (1, ?, 'PENDING', NOW(), NOW(), ?)`,
    [RequesterUserID, Note]
  );
  const RequestID = requestResult.insertId;
  // 2. Ghi chi tiết cấp phát
  await db.execute(
    `INSERT INTO Request_Allocation (RequestID, AssetID, Quantity)
       VALUES (?, ?, ?)`,
    [RequestID, AssetID, Quantity]
  );

  // 3. Ghi nhật ký tạo yêu cầu
  await db.execute(
    `INSERT INTO ApprovalHistory (RequestID, ApproverUserID, DepartmentID, Action, ActionAt, Comment)
       VALUES (?, ?, 1, 'CREATED', NOW(), 'Người dùng tạo yêu cầu')`,
    [RequestID, RequesterUserID]
  );
  return { RequestID, RequesterUserID, AssetID, Quantity, Note };
};

const approveRequestAllocation = async (id, data) => {
  const ASSET_STATUS = {
    AVAILABLE: 1,
    ALLOCATED: 2,
    MAINTENANCE_OUT: 3,
    WARRANTY_OUT: 4,
    DISPOSED: 5,
  };
  const StepID = Number(data.StepID || 0);
  const Action = String(data.Action || "").toUpperCase();
  const { ApproverUserID, DepartmentID, Comment } = data;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 0) Kiểm tra request còn hiệu lực
    const [[reqRow]] = await conn.execute(
      "SELECT CurrentState FROM `Request` WHERE RequestID = ? FOR UPDATE",
      [id]
    );
    if (!reqRow) throw new Error("REQUEST_NOT_FOUND");
    if (["APPROVED", "REJECTED", "CANCELLED"].includes(reqRow.CurrentState)) {
      throw new AppError(`REQUEST_FINAL_${reqRow.CurrentState}`,409);
    }

    // 1) Log hành động hiện tại
    await conn.execute(
      `INSERT INTO \`ApprovalHistory\`
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

    // ============ REJECTED ============
    if (Action === "REJECTED") {
      await conn.execute(
        `UPDATE \`Request\` SET CurrentState='REJECTED', UpdatedAt=NOW() WHERE RequestID=?`,
        [id]
      );
      await conn.commit();
      return;
    }

    // ============ APPROVED ============
    // Bước 1 -> chuyển bước 2
    if (Action === "APPROVED" && StepID === 1) {
      await conn.execute(
        `UPDATE \`Request\` SET CurrentState='IN_PROGRESS_STEP_2', UpdatedAt=NOW() WHERE RequestID=?`,
        [id]
      );
      await conn.commit();
      return;
    }

    // Bước 2 (MANAGER) -> kiểm tra asset + cấp phát
    if (Action === "APPROVED" && StepID === 2) {
      // Lấy dữ liệu yêu cầu + khóa record liên quan
      const [rows] = await conn.execute(
        `SELECT
            CAST(ra.AssetID AS CHAR(36)) AS AssetID,
            ra.Quantity,
            r.RequesterUserID,
            u.DepartmentID AS UserDept
         FROM \`Request_Allocation\` ra
         JOIN \`Request\` r ON r.RequestID = ra.RequestID
         JOIN \`user\` u ON u.UserID = r.RequesterUserID
         WHERE ra.RequestID = ?
         FOR UPDATE`,
        [id]
      );
      if (!rows.length) throw new Error("ALLOC_NOT_FOUND");

      const { AssetID, Quantity, RequesterUserID, UserDept } = rows[0];
      const sectionId = UserDept ?? DepartmentID ?? null;

      // 🔒 Kiểm tra tình trạng tài sản (FOR UPDATE để tránh race)
      const [[asset]] = await conn.execute(
        "SELECT Status FROM `asset` WHERE ID = ? FOR UPDATE",
        [AssetID]
      );
      if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);

      // Chỉ cho cấp phát khi đang AVAILABLE
      if (Number(asset.Status) !== ASSET_STATUS.AVAILABLE) {
        throw new AppError("ASSET_NOT_AVAILABLE", 409);
      }

      // Ghi assethistory
      const assetHistoryId = uuidv4();
      const [ins] = await conn.execute(
        `INSERT INTO \`assethistory\`
          (ID, AssetID, RequestID, EmployeeID, SectionID, Quantity, Type, ActionAt, Note)
         VALUES (?, ?, ?, ?, ?, ?, 'ALLOCATED', NOW(), ?)`,
        [
          assetHistoryId,
          AssetID,
          id,
          RequesterUserID,
          sectionId,
          Quantity,
          "Cấp phát IT -> Sales",
        ]
      );
      if (ins.affectedRows !== 1) throw new AppError("INSERT_AH_FAILED", 500);

      // Cập nhật trạng thái asset => ALLOCATED + gán người/đơn vị
      await conn.execute(
        "UPDATE `asset` SET Status=?, EmployeeID=?, SectionID=? WHERE ID=?",
        [ASSET_STATUS.ALLOCATED, RequesterUserID, sectionId, AssetID]
      );

      // Cập nhật Request
      await conn.execute(
        `UPDATE \`Request\` SET CurrentState='APPROVED', UpdatedAt=NOW() WHERE RequestID=?`,
        [id]
      );

      // Log CONFIRMED
      await conn.execute(
        `INSERT INTO \`ApprovalHistory\`
          (RequestID, ApproverUserID, DepartmentID, Action, ActionAt, Comment)
         VALUES (?, ?, ?, 'CONFIRMED', NOW(), 'Đã cấp phát xong')`,
        [id, ApproverUserID, DepartmentID]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error("approveRequestAllocation error:", err);
    throw err;
  } finally {
    conn.release();
  }
};

const getRequestAllocationDetail = async (id) => {
  const [[request]] = await db.execute(
    `SELECT * FROM Request WHERE RequestID=?`,
    [id]
  );
  const [alloc] = await db.execute(
    `SELECT * FROM Request_Allocation WHERE RequestID=?`,
    [id]
  );
  const [history] = await db.execute(
    `SELECT * FROM ApprovalHistory WHERE RequestID=? ORDER BY ActionAt ASC`,
    [id]
  );
  return { request, allocation: alloc, approvalHistory: history };
};

const getAllRequestAllocationDetail = async () => {
  const [rows] = await db.execute(
    `SELECT
         r.RequestID,
         r.RequesterUserID,
         r.CurrentState,
         r.CreatedAt,
         r.UpdatedAt,
         r.Note,
         COALESCE(SUM(ra.Quantity), 0) AS TotalQuantity
       FROM \`Request\` r
       LEFT JOIN \`Request_Allocation\` ra ON ra.RequestID = r.RequestID
       WHERE r.RequestTypeID = 1
       GROUP BY r.RequestID, r.RequesterUserID, r.CurrentState, r.CreatedAt, r.UpdatedAt, r.Note
       ORDER BY r.CreatedAt DESC`
  );
  return { requests: rows };
};
module.exports = {
  createRequestAllocation,
  approveRequestAllocation,
  getRequestAllocationDetail,
  getAllRequestAllocationDetail,
};
