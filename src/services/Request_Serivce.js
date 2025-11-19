// services/Request_Service.js
const db = require("../config/database");
const AppError = require("../utils/AppError");

// Trạng thái mở của Request
const OPEN_STATES = ["PENDING", "IN_PROGRESS_STEP_1", "IN_PROGRESS_STEP_2"];

// 🔹 ID phòng Kho (phải trùng với trong DB và FE)
const WAREHOUSE_DEPT_ID = 5;

// ================= Helpers =================

const resolveRequestTypeId = async (conn, typeInput) => {
  // Nếu là số thì dùng luôn
  if (typeInput != null && !isNaN(Number(typeInput))) return Number(typeInput);

  const code = String(typeInput || "")
    .trim()
    .toUpperCase();
  if (!code) throw new AppError("REQUEST_TYPE_REQUIRED", 400);

  const [[row]] = await conn.execute(
    "SELECT RequestTypeID, Code FROM requesttype WHERE UPPER(Code) = ?",
    [code]
  );
  if (!row) throw new AppError("REQUEST_TYPE_NOT_FOUND", 400);
  return row.RequestTypeID;
};

const lockAsset = async (conn, assetId) => {
  if (!assetId) throw new AppError("ASSET_ID_REQUIRED", 400);
  const [[asset]] = await conn.execute(
    `
    SELECT ID, Status, WarrantyStartDate, WarrantyEndDate
    FROM asset
    WHERE ID = ?
    FOR UPDATE
    `,
    [assetId]
  );
  if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);
  return asset;
};

const requesterExists = async (conn, requesterId) => {
  const [[u]] = await conn.execute(
    "SELECT UserID, DepartmentID FROM user WHERE UserID = ?",
    [requesterId]
  );
  if (!u) throw new AppError("REQUESTER_NOT_FOUND", 400);
  return u;
};

const hasOpenRequest = async (conn, assetId, excludeRequestId = null) => {
  const inStates = OPEN_STATES.map(() => "?").join(",");
  const args = [];

  const withExclude = excludeRequestId ? " AND r.RequestID <> ?" : "";

  const sql = `
    SELECT r.RequestID
    FROM request r
    JOIN request_allocation ra ON ra.RequestID = r.RequestID AND ra.AssetID = ?
    WHERE r.CurrentState IN (${inStates})${withExclude}
    UNION
    SELECT r.RequestID
    FROM request r
    JOIN request_maintenance rm ON rm.RequestID = r.RequestID AND rm.AssetID = ?
    WHERE r.CurrentState IN (${inStates})${withExclude}
    UNION
    SELECT r.RequestID
    FROM request r
    JOIN request_warranty rw ON rw.RequestID = r.RequestID AND rw.AssetID = ?
    WHERE r.CurrentState IN (${inStates})${withExclude}
    UNION
    SELECT r.RequestID
    FROM request r
    JOIN request_disposal rd ON rd.RequestID = r.RequestID AND rd.AssetID = ?
    WHERE r.CurrentState IN (${inStates})${withExclude}
    UNION
    SELECT r.RequestID
    FROM request r
    JOIN request_transfer rt ON rt.RequestID = r.RequestID AND rt.AssetID = ?
    WHERE r.CurrentState IN (${inStates})${withExclude}
  `;

  // allocation
  args.push(assetId, ...OPEN_STATES);
  if (excludeRequestId) args.push(excludeRequestId);
  // maintenance
  args.push(assetId, ...OPEN_STATES);
  if (excludeRequestId) args.push(excludeRequestId);
  // warranty
  args.push(assetId, ...OPEN_STATES);
  if (excludeRequestId) args.push(excludeRequestId);
  // disposal
  args.push(assetId, ...OPEN_STATES);
  if (excludeRequestId) args.push(excludeRequestId);
  // transfer
  args.push(assetId, ...OPEN_STATES);
  if (excludeRequestId) args.push(excludeRequestId);

  const [rows] = await conn.execute(sql, args);
  return rows.length > 0;
};

// Giữ helper cũ: dùng cho các case bắt buộc phải có TargetUser
const resolveTarget = async (conn, TargetUserID, TargetDepartmentID) => {
  if (!TargetUserID) throw new AppError("TARGET_USER_REQUIRED", 400);

  const [[u]] = await conn.execute(
    "SELECT UserID, DepartmentID FROM `user` WHERE UserID = ?",
    [TargetUserID]
  );
  if (!u) throw new AppError("TARGET_USER_NOT_FOUND", 400);

  const deptId = TargetDepartmentID ?? u.DepartmentID ?? null;
  if (deptId == null) throw new AppError("TARGET_DEPARTMENT_REQUIRED", 400);

  return { targetUserId: Number(u.UserID), targetDeptId: Number(deptId) };
};

// ================= Main: createRequest (MULTI-ASSET) =================

const createRequest = async (data) => {
  const {
    RequesterUserID,
    Note,
    type,
    typeCode,
    RequestTypeID,

    // global detail fields (áp dụng chung nếu item không override)
    IssueDescription,
    Reason,
    WarrantyProvider,

    TargetUserID,
    TargetDepartmentID,

    Items,
    items, // allow both

    // 🔹 thêm mode cho TRANSFER
    TransferMode,
    transferMode,
  } = data;

  if (!RequesterUserID) throw new AppError("REQUESTER_REQUIRED", 400);

  const itemRows = Array.isArray(Items)
    ? Items
    : Array.isArray(items)
    ? items
    : [];
  if (!itemRows.length) throw new AppError("ITEMS_REQUIRED", 400);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Check requester
    const requester = await requesterExists(conn, RequesterUserID);

    // 2. Resolve request type (ID + code)
    const code = String(typeCode || type || "")
      .trim()
      .toUpperCase();
    if (!code) throw new AppError("REQUEST_TYPE_CODE_REQUIRED", 400);

    const reqTypeId = await resolveRequestTypeId(conn, RequestTypeID ?? code);

    // 3. Resolve target user / department (linh động cho TRANSFER)
    let mode = String(TransferMode || transferMode || "")
      .trim()
      .toUpperCase();

    // fallback: nếu không gửi mode nhưng gửi Dept = kho và không có TargetUser → hiểu là chuyển về kho
    if (code === "TRANSFER" && !mode) {
      if (!TargetUserID && Number(TargetDepartmentID) === WAREHOUSE_DEPT_ID) {
        mode = "WAREHOUSE";
      } else {
        mode = "USER";
      }
    }

    let targetUserId = null;
    let targetDeptId = null;

    if (code === "TRANSFER" && mode === "WAREHOUSE") {
      // 🔹 Chuyển giao về kho: không cần User, Dept bắt buộc là kho
      const dept = TargetDepartmentID;
      if (dept == null) throw new AppError("TARGET_DEPARTMENT_REQUIRED", 400);

      if (Number(dept) !== WAREHOUSE_DEPT_ID) {
        throw new AppError("TRANSFER_WAREHOUSE_DEPT_INVALID", 400);
      }

      targetDeptId = WAREHOUSE_DEPT_ID;
      targetUserId = null; // về kho nên không gán user
    } else {
      // 🔹 Các case còn lại: dùng logic cũ, bắt buộc có TargetUser
      const { targetUserId: tu, targetDeptId: td } = await resolveTarget(
        conn,
        TargetUserID,
        TargetDepartmentID
      );
      targetUserId = tu;
      targetDeptId = td;

      // Không cho các loại khác dùng phòng kho
      if (code !== "TRANSFER" && targetDeptId === WAREHOUSE_DEPT_ID) {
        throw new AppError(
          "WAREHOUSE_DEPT_NOT_ALLOWED_FOR_THIS_TYPE",
          400
        );
      }

      // TRANSFER mà vẫn target kho → hiểu là cấu hình sai mode
      if (code === "TRANSFER" && targetDeptId === WAREHOUSE_DEPT_ID) {
        throw new AppError(
          "TRANSFER_USER_MODE_CANNOT_TARGET_WAREHOUSE",
          400
        );
      }
    }

    // 4. Validate từng asset trong Items
    for (const row of itemRows) {
      const assetId = row.AssetID || row.assetId || row.id;
      if (!assetId) throw new AppError("ASSET_ID_REQUIRED", 400);

      const qtyRaw = row.Quantity ?? row.quantity ?? 1;
      const qty = Number(qtyRaw);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new AppError("INVALID_QUANTITY", 400);
      }

      // lock asset + check open request
      await lockAsset(conn, assetId);
      const hasOpen = await hasOpenRequest(conn, assetId);
      if (hasOpen) {
        throw new AppError(`ASSET_HAS_OPEN_REQUEST_${assetId}`, 400);
      }
    }

    // 5. Insert 1 bản ghi Request
    const [r] = await conn.execute(
      `
      INSERT INTO request
      (RequestTypeID, RequesterUserID, TargetUserID, TargetDepartmentID,
       CurrentState, CreatedAt, UpdatedAt, Note)
      VALUES (?, ?, ?, ?, 'PENDING', NOW(), NOW(), ?)
      `,
      [reqTypeId, RequesterUserID, targetUserId, targetDeptId, Note || null]
    );
    const RequestID = r.insertId;

    // 6. Insert chi tiết từng loại
    switch (code) {
      case "ALLOCATION": {
        const sql = `
          INSERT INTO request_allocation (RequestID, AssetID, Quantity)
          VALUES (?, ?, ?)
        `;
        for (const row of itemRows) {
          const assetId = row.AssetID || row.assetId || row.id;
          const qty = Number(row.Quantity ?? row.quantity ?? 1);
          await conn.execute(sql, [RequestID, assetId, qty]);
        }
        break;
      }
      case "MAINTENANCE": {
        const sql = `
          INSERT INTO request_maintenance
          (RequestID, AssetID, IssueDescription, Quantity)
          VALUES (?, ?, ?, ?)
        `;
        for (const row of itemRows) {
          const assetId = row.AssetID || row.assetId || row.id;
          const qty = Number(row.Quantity ?? row.quantity ?? 1);
          const issue = (
            row.IssueDescription ??
            row.issueDescription ??
            IssueDescription ??
            ""
          ).toString();
          await conn.execute(sql, [RequestID, assetId, issue || null, qty]);
        }
        break;
      }
      case "DISPOSAL": {
        const sql = `
          INSERT INTO request_disposal
          (RequestID, AssetID, Reason, Quantity)
          VALUES (?, ?, ?, ?)
        `;
        for (const row of itemRows) {
          const assetId = row.AssetID || row.assetId || row.id;
          const qty = Number(row.Quantity ?? row.quantity ?? 1);
          const reason = (row.Reason ?? row.reason ?? Reason ?? "").toString();
          await conn.execute(sql, [RequestID, assetId, reason || null, qty]);
        }
        break;
      }
      case "WARRANTY": {
        const sql = `
          INSERT INTO request_warranty
          (RequestID, AssetID, WarrantyProvider, Quantity)
          VALUES (?, ?, ?, ?)
        `;
        for (const row of itemRows) {
          const assetId = row.AssetID || row.assetId || row.id;
          const qty = Number(row.Quantity ?? row.quantity ?? 1);
          const provider = (
            row.WarrantyProvider ??
            row.warrantyProvider ??
            WarrantyProvider ??
            ""
          ).toString();
          await conn.execute(sql, [RequestID, assetId, provider || null, qty]);
        }
        break;
      }
      case "TRANSFER": {
        const sql = `
          INSERT INTO request_transfer
          (RequestID, AssetID, Reason, Quantity)
          VALUES (?, ?, ?, ?)
        `;
        for (const row of itemRows) {
          const assetId = row.AssetID || row.assetId || row.id;
          const qty = Number(row.Quantity ?? row.quantity ?? 1);
          const reason = (row.Reason ?? row.reason ?? Reason ?? "").toString();
          await conn.execute(sql, [RequestID, assetId, reason || null, qty]);
        }
        break;
      }
      default:
        throw new AppError("UNSUPPORTED_REQUEST_TYPE", 400);
    }

    // 7. Log CREATED vào approvalhistory
    await conn.execute(
      `
      INSERT INTO approvalhistory
      (RequestID, ApproverUserID, DepartmentID, Action, ActionAt, Comment)
      VALUES (?, ?, ?, 'CREATED', NOW(), 'Người dùng tạo yêu cầu')
      `,
      [RequestID, RequesterUserID, requester?.DepartmentID ?? null]
    );

    await conn.commit();

    return {
      RequestID,
      RequestTypeID: reqTypeId,
      Code: code,
      RequesterUserID,
      TargetUserID: targetUserId,
      TargetDepartmentID: targetDeptId,
      CurrentState: "PENDING",
      Note: Note || null,
      // optional: trả thêm mode cho FE debug nếu cần
      TransferMode: mode,
    };
  } catch (err) {
    await conn.rollback();
    throw err instanceof AppError
      ? err
      : new AppError(err.message || "INTERNAL_ERROR", 500);
  } finally {
    conn.release();
  }
};

module.exports = {
  createRequest,
};
