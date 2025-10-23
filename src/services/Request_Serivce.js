// services/Request_Service.js
const db = require("../config/database");
const AppError = require("../utils/AppError");

const ASSET_STATUS = {
  AVAILABLE: 1,
  ALLOCATED: 2,
  MAINTENANCE_OUT: 3,
  WARRANTY_OUT: 4,
  DISPOSED: 5,
};

const OPEN_STATES = ["PENDING", "APPROVING", "APPROVED", "IN_PROGRESS"];

const detailTableByCode = {
  ALLOCATION: "Request_Allocation",
  MAINTENANCE: "Request_Maintenance",
  WARRANTY: "Request_Warranty",
  DISPOSAL: "Request_Disposal",
};

// --- Helpers ---
const resolveRequestTypeId = async (conn, typeInput) => {
  if (typeInput != null && !isNaN(Number(typeInput))) return Number(typeInput);
  const code = String(typeInput || "").trim().toUpperCase();
  if (!code) throw new AppError("REQUEST_TYPE_REQUIRED", 400);
  const [[row]] = await conn.execute(
    "SELECT RequestTypeID, Code FROM `RequestType` WHERE UPPER(Code) = ?",
    [code]
  );
  if (!row) throw new AppError("REQUEST_TYPE_NOT_FOUND", 400);
  return row.RequestTypeID;
};

const lockAsset = async (conn, assetId) => {
  if (!assetId) throw new AppError("ASSET_ID_REQUIRED", 400);
  const [[asset]] = await conn.execute(
    `SELECT ID, Status, WarrantyStartDate, WarrantyEndDate
     FROM asset
     WHERE ID = ?
     FOR UPDATE`,
    [assetId]
  );
  if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);
  return asset;
};

const requesterExists = async (conn, requesterId) => {
  const [[u]] = await conn.execute(
    "SELECT UserID, DepartmentID FROM `user` WHERE UserID = ?",
    [requesterId]
  );
  if (!u) throw new AppError("REQUESTER_NOT_FOUND", 400);
  return u;
};

const hasOpenRequest = async (conn, assetId, excludeRequestId = null) => {
  // Kiểm tra bất kỳ request mở nào trên Asset (mọi loại)
  const [rows] = await conn.execute(
    `SELECT r.RequestID
     FROM Request r
     JOIN Request_Allocation ra ON ra.RequestID = r.RequestID AND ra.AssetID = ?
     WHERE r.CurrentState IN (${OPEN_STATES.map(()=>"?").join(",")})
     ${excludeRequestId ? "AND r.RequestID <> ?" : ""}
     UNION
     SELECT r.RequestID
     FROM Request r
     JOIN Request_Maintenance rm ON rm.RequestID = r.RequestID AND rm.AssetID = ?
     WHERE r.CurrentState IN (${OPEN_STATES.map(()=>"?").join(",")})
     ${excludeRequestId ? "AND r.RequestID <> ?" : ""}
     UNION
     SELECT r.RequestID
     FROM Request r
     JOIN Request_Warranty rw ON rw.RequestID = r.RequestID AND rw.AssetID = ?
     WHERE r.CurrentState IN (${OPEN_STATES.map(()=>"?").join(",")})
     ${excludeRequestId ? "AND r.RequestID <> ?" : ""}
     UNION
     SELECT r.RequestID
     FROM Request r
     JOIN Request_Disposal rd ON rd.RequestID = r.RequestID AND rd.AssetID = ?
     WHERE r.CurrentState IN (${OPEN_STATES.map(()=>"?").join(",")})
     ${excludeRequestId ? "AND r.RequestID <> ?" : ""}`,
    [
      assetId, ...OPEN_STATES, ...(excludeRequestId ? [excludeRequestId] : []),
      assetId, ...OPEN_STATES, ...(excludeRequestId ? [excludeRequestId] : []),
      assetId, ...OPEN_STATES, ...(excludeRequestId ? [excludeRequestId] : []),
      assetId, ...OPEN_STATES, ...(excludeRequestId ? [excludeRequestId] : []),
    ]
  );
  return rows.length > 0;
};

const nowInRange = (start, end) => {
  if (!start || !end) return false;
  const now = new Date();
  return now >= new Date(start) && now <= new Date(end);
};

const validateByType = (code, asset, payload) => {
  const { Quantity, IssueDescription, Reason, WarrantyProvider } = payload;
  // Khi đã chỉ định AssetID, Quantity phải = 1
  if (Quantity != null && Number(Quantity) !== 1) {
    throw new AppError("QUANTITY_MUST_BE_1_FOR_ASSET", 400);
  }

  switch (code) {
    case "ALLOCATION": {
      if (Number(asset.Status) !== ASSET_STATUS.AVAILABLE) {
        throw new AppError("ASSET_NOT_AVAILABLE", 409);
      }
      return;
    }
    case "MAINTENANCE": {
      const st = Number(asset.Status);
      if ([ASSET_STATUS.DISPOSED, ASSET_STATUS.MAINTENANCE_OUT, ASSET_STATUS.WARRANTY_OUT].includes(st)) {
        throw new AppError("ASSET_NOT_ALLOWED_FOR_MAINTENANCE", 409);
      }
      // Nếu còn trong bảo hành => bắt dùng WARRANTY
      if (nowInRange(asset.WarrantyStartDate, asset.WarrantyEndDate)) {
        throw new AppError("ASSET_UNDER_WARRANTY_USE_WARRANTY_REQUEST", 409);
      }
      if (!IssueDescription || String(IssueDescription).trim().length < 5) {
        throw new AppError("ISSUE_DESCRIPTION_REQUIRED", 400);
      }
      return;
    }
    case "WARRANTY": {
      const st = Number(asset.Status);
      if ([ASSET_STATUS.DISPOSED, ASSET_STATUS.WARRANTY_OUT].includes(st)) {
        throw new AppError("ASSET_NOT_ALLOWED_FOR_WARRANTY", 409);
      }
      if (!nowInRange(asset.WarrantyStartDate, asset.WarrantyEndDate)) {
        throw new AppError("WARRANTY_EXPIRED_OR_NOT_ACTIVE", 409);
      }
      if (!WarrantyProvider || !String(WarrantyProvider).trim()) {
        throw new AppError("WARRANTY_PROVIDER_REQUIRED", 400);
      }
      return;
    }
    case "DISPOSAL": {
      const st = Number(asset.Status);
      if (st === ASSET_STATUS.DISPOSED) {
        throw new AppError("ASSET_ALREADY_DISPOSED", 409);
      }
      if ([ASSET_STATUS.ALLOCATED, ASSET_STATUS.MAINTENANCE_OUT, ASSET_STATUS.WARRANTY_OUT].includes(st)) {
        throw new AppError("ASSET_MUST_BE_AVAILABLE_BEFORE_DISPOSAL", 409);
      }
      if (!Reason || String(Reason).trim().length < 3) {
        throw new AppError("DISPOSAL_REASON_REQUIRED", 400);
      }
      return;
    }
    default:
      throw new AppError("UNSUPPORTED_REQUEST_TYPE", 400);
  }
};

// --- Main ---
const createRequest = async (data) => {
  const {
    RequesterUserID,
    Note,
    type, typeCode, RequestTypeID,
    AssetID,
    Quantity,
    IssueDescription,
    Reason,
    WarrantyProvider,
  } = data;

  if (!RequesterUserID) throw new AppError("REQUESTER_REQUIRED", 400);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1) Người yêu cầu tồn tại
    const requester = await requesterExists(conn, RequesterUserID);

    // 2) Xác định loại + ID
    const code = String(typeCode || type || "").trim().toUpperCase();
    const reqTypeId = await resolveRequestTypeId(conn, RequestTypeID ?? code);

    // 3) Khóa tài sản và lấy dữ liệu cần thiết
    const asset = await lockAsset(conn, AssetID);

    // 4) Không cho tạo khi có request mở bất kỳ trên Asset (siết chặt nhất)
    const openAny = await hasOpenRequest(conn, AssetID);
    if (openAny) throw new AppError("ASSET_ALREADY_HAS_OPEN_REQUEST", 409);

    // 5) Validate rule theo loại
    validateByType(code, asset, { Quantity, IssueDescription, Reason, WarrantyProvider });

    // 6) Tạo Request
    const [r] = await conn.execute(
      `INSERT INTO Request
       (RequestTypeID, RequesterUserID, CurrentState, CreatedAt, UpdatedAt, Note)
       VALUES (?, ?, 'PENDING', NOW(), NOW(), ?)`,
      [reqTypeId, RequesterUserID, Note || null]
    );
    const RequestID = r.insertId;

    // 7) Ghi chi tiết theo loại
    switch (code) {
      case "ALLOCATION":
        await conn.execute(
          `INSERT INTO Request_Allocation (RequestID, AssetID, Quantity)
           VALUES (?, ?, 1)`,
          [RequestID, AssetID]
        );
        break;
      case "MAINTENANCE":
        await conn.execute(
          `INSERT INTO Request_Maintenance (RequestID, AssetID, IssueDescription, Quantity)
           VALUES (?, ?, ?, 1)`,
          [RequestID, AssetID, IssueDescription.trim()]
        );
        break;
      case "DISPOSAL":
        await conn.execute(
          `INSERT INTO Request_Disposal (RequestID, AssetID, Reason, Quantity)
           VALUES (?, ?, ?, 1)`,
          [RequestID, AssetID, Reason.trim()]
        );
        break;
      case "WARRANTY":
        await conn.execute(
          `INSERT INTO Request_Warranty (RequestID, AssetID, WarrantyProvider, Quantity)
           VALUES (?, ?, ?, 1)`,
          [RequestID, AssetID, WarrantyProvider.trim()]
        );
        break;
      default:
        throw new AppError("UNSUPPORTED_REQUEST_TYPE", 400);
    }

    // 8) Log CREATED
    await conn.execute(
      `INSERT INTO ApprovalHistory
       (RequestID, ApproverUserID, DepartmentID, Action, ActionAt, Comment)
       VALUES (?, ?, ?, 'CREATED', NOW(), 'Người dùng tạo yêu cầu')`,
      [RequestID, RequesterUserID, requester?.DepartmentID ?? null]
    );

    await conn.commit();
    return {
      RequestID,
      RequestTypeID: reqTypeId,
      Code: code,
      RequesterUserID,
      CurrentState: "PENDING",
      Note: Note || null,
    };
  } catch (err) {
    await conn.rollback();
    throw err instanceof AppError ? err : new AppError(err.message || "INTERNAL_ERROR", 500);
  } finally {
    conn.release();
  }
};

module.exports = { createRequest };
