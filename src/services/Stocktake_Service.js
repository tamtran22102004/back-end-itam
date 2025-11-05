// services/stocktake.service.js
const db = require("../config/database");
const AppError = require("../utils/AppError");

// ===== constants =====
const ASSET_STATUS = {
  AVAILABLE: 1,
  ALLOCATED: 2,
  MAINTENANCE_OUT: 3,
  WARRANTY_OUT: 4,
  DISPOSED: 5,
  IN_USE: 6, // dùng cho luồng khác (allocation); closeSession hiện vẫn set DISPOSED khi >1 & hết hàng
};

// ===== helpers =====
async function ensureSessionOpen(conn, sessionId) {
  const [rows] = await conn.execute(
    "SELECT SessionID, Status FROM stocktakesession WHERE SessionID = ?",
    [sessionId]
  );
  if (!rows.length) throw new AppError("Phiên kiểm kê không tồn tại", 404);
  if (String(rows[0].Status).toUpperCase() !== "OPEN")
    throw new AppError("Phiên kiểm kê đã đóng", 400);
  return rows[0];
}

async function findAssetByQrOrId(qrOrAssetId) {
  // Cho phép truyền AssetID (UUID) hoặc QRCode hoặc ManageCode
  const [rows] = await db.execute(
    `SELECT * FROM asset WHERE ID = ? OR QRCode = ? OR ManageCode = ? LIMIT 1`,
    [qrOrAssetId, qrOrAssetId, qrOrAssetId]
  );
  return rows[0] || null;
}

// Đảm bảo bảng line có cột MissingQty (INT NOT NULL DEFAULT 0)
async function ensureMissingQtyColumn(conn) {
  try {
    await conn.execute(
      "ALTER TABLE stocktakeitemline ADD COLUMN MissingQty INT NOT NULL DEFAULT 0"
    );
  } catch (e) {
    // Nếu đã có cột thì bỏ qua
    if (
      e?.code === "ER_DUP_FIELDNAME" ||
      /Duplicate column|exists/i.test(e?.message || "")
    ) {
      // ok
    } else {
      // Một số hệ hỗ trợ IF NOT EXISTS
      try {
        await conn.execute(
          "ALTER TABLE stocktakeitemline ADD COLUMN IF NOT EXISTS MissingQty INT NOT NULL DEFAULT 0"
        );
      } catch (e2) {
        if (
          !(
            e2?.code === "ER_DUP_FIELDNAME" ||
            /Duplicate column|exists/i.test(e2?.message || "")
          )
        ) {
          throw e; // ném lỗi gốc nếu không phải do trùng cột
        }
      }
    }
  }
}

// ===== core services =====
async function createSession({
  DepartmentID = null,
  CreatedBy = null,
  Note = "",
}) {
  const [result] = await db.execute(
    `INSERT INTO stocktakesession
       (DepartmentID, CreatedBy, Note, Status, StartedAt)
     VALUES (?, ?, ?, 'OPEN', NOW())`,
    [DepartmentID || null, CreatedBy || null, Note || ""]
  );
  return { SessionID: result.insertId };
}

async function seedSession({
  SessionID,
  assetIds = [],
  foundLocationId = null,
  defaultFound = true,
}) {
  if (!assetIds?.length) return { inserted: 0 };

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await ensureSessionOpen(conn, SessionID);

    // Bảng line có cột MissingQty
    await conn.execute(
      `CREATE TABLE IF NOT EXISTS stocktakeitemline (
        LineID BIGINT PRIMARY KEY AUTO_INCREMENT,
        SessionID BIGINT NOT NULL,
        AssetID CHAR(36) NOT NULL,
        Found BOOLEAN NOT NULL,
        FoundLocationID INT NULL,
        MissingQty INT NOT NULL DEFAULT 0,
        Remarks TEXT NULL,
        CheckedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_session_asset (SessionID, AssetID)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    await ensureMissingQtyColumn(conn);

    const placeholders = assetIds.map(() => "(?, ?, ?, ?, ?, NOW())").join(",");
    const params = assetIds.flatMap((aid) => [
      SessionID,
      aid,
      defaultFound ? 1 : 0,
      foundLocationId || null,
      0, // MissingQty mặc định
    ]);

    // INSERT IGNORE để bỏ qua trùng (SessionID, AssetID)
    const [result] = await conn.execute(
      `INSERT IGNORE INTO stocktakeitemline
       (SessionID, AssetID, Found, FoundLocationID, MissingQty, CheckedAt)
       VALUES ${placeholders}`,
      params
    );

    await conn.commit();
    return { inserted: result.affectedRows };
  } catch (e) {
    await conn.rollback();
    throw e instanceof AppError
      ? e
      : new AppError("Seed phiên kiểm kê thất bại", 500);
  } finally {
    conn.release();
  }
}

async function scanAsset({
  SessionID,
  qrOrAssetId,
  foundLocationId = null,
  defaultFound = true,
  remarks = "",
  missingQty, // optional khi scan MISSING
}) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await ensureSessionOpen(conn, SessionID);
    await ensureMissingQtyColumn(conn);

    const asset = await findAssetByQrOrId(qrOrAssetId);
    if (!asset) throw new AppError("Không tìm thấy Asset để scan", 404);

    const isFound = !!defaultFound;
    const missingQtyVal = isFound ? 0 : Math.max(1, Number(missingQty ?? 1));

    // Upsert (SessionID, AssetID)
    await conn.execute(
      `INSERT INTO stocktakeitemline
        (SessionID, AssetID, Found, FoundLocationID, MissingQty, Remarks, CheckedAt)
       VALUES (?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
        Found = VALUES(Found),
        FoundLocationID = VALUES(FoundLocationID),
        MissingQty = VALUES(MissingQty),
        Remarks = VALUES(Remarks),
        CheckedAt = VALUES(CheckedAt)`,
      [
        SessionID,
        asset.ID,
        isFound ? 1 : 0,
        isFound ? (foundLocationId || null) : null,
        missingQtyVal,
        remarks || "",
      ]
    );

    await conn.commit();
    return { AssetID: asset.ID };
  } catch (e) {
    await conn.rollback();
    throw e instanceof AppError ? e : new AppError("Scan asset thất bại", 500);
  } finally {
    conn.release();
  }
}

async function updateLine({
  SessionID,
  LineID,
  Found,
  FoundLocationID = null,
  Remarks = "",
  MissingQty, // NEW
}) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await ensureSessionOpen(conn, SessionID);
    await ensureMissingQtyColumn(conn);

    const isFound = Number(!!Found) === 1;
    const missingQtyVal = isFound ? 0 : Math.max(1, Number(MissingQty ?? 1));
    const locValue = isFound ? (FoundLocationID || null) : null;

    const [rows] = await conn.execute(
      `UPDATE stocktakeitemline
       SET Found = ?,
           FoundLocationID = ?,
           MissingQty = ?,
           Remarks = ?,
           CheckedAt = NOW()
       WHERE LineID = ? AND SessionID = ?`,
      [
        isFound ? 1 : 0,
        locValue,
        missingQtyVal,
        Remarks || "",
        LineID,
        SessionID,
      ]
    );

    if (!rows.affectedRows)
      throw new AppError("Không tìm thấy dòng kiểm kê để cập nhật", 404);

    await conn.commit();
    return { updated: rows.affectedRows };
  } catch (e) {
    await conn.rollback();
    throw e instanceof AppError
      ? e
      : new AppError("Cập nhật dòng kiểm kê thất bại", 500);
  } finally {
    conn.release();
  }
}

/**
 * ĐÓNG PHIÊN KIỂM KÊ:
 * - Log assethistory:
 *   + STOCKTAKE_FOUND (Quantity=1)
 *   + STOCKTAKE_MISSING (Quantity=MissingQty)
 * - Update asset:
 *   + Found=true  -> cập nhật mốc kiểm kê
 *   + Found=false:
 *       * Quantity=1  -> DISPOSED + RemainQuantity=0
 *       * Quantity>1  -> trừ RemainQuantity, nếu hết hàng -> DISPOSED, còn >0 -> AVAILABLE
 */
async function closeSession({ SessionID }) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await ensureSessionOpen(conn, SessionID);

    // Lấy các dòng + MissingQty
    const [lines] = await conn.execute(
      `SELECT l.LineID,
              CAST(l.AssetID AS CHAR(36)) AS AssetID,
              l.Found,
              COALESCE(l.MissingQty, 0) AS MissingQty,
              l.FoundLocationID,
              l.Remarks
       FROM stocktakeitemline l
       WHERE l.SessionID = ?
       ORDER BY l.LineID ASC`,
      [SessionID]
    );

    const now = new Date();

    for (const r of lines) {
      const isFound = Number(r.Found) === 1;
      const missingQtyReq = Math.max(0, Number(r.MissingQty || 0));

      // Khóa asset
      const [[asset]] = await conn.execute(
        `SELECT
           CAST(ID AS CHAR(36)) AS ID,
           Quantity,
           RemainQuantity,
           Status,
           EmployeeID AS CurEmp,
           SectionID  AS CurDept
         FROM asset
         WHERE ID = ?
         FOR UPDATE`,
        [r.AssetID]
      );
      if (!asset) continue;

      const qtyTotal = Number(asset.Quantity || 0);
      const qtyRemain =
        asset.RemainQuantity == null
          ? qtyTotal
          : Math.max(0, Number(asset.RemainQuantity));

      // Ghi lịch sử
      const notePrefix = `[STOCKTAKE ${SessionID}] `;
      const noteSuffix =
        (isFound
          ? `FOUND${r.FoundLocationID ? ` @Loc:${r.FoundLocationID}` : ""}`
          : `MISSING x${missingQtyReq}`) + (r.Remarks ? ` - ${r.Remarks}` : "");

      const histType = isFound ? "STOCKTAKE_FOUND" : "STOCKTAKE_MISSING";
      const histQty = isFound ? 1 : (missingQtyReq || 1);

      await conn.execute(
        `INSERT INTO assethistory
           (ID, AssetID, RequestID,
            EmployeeID, SectionID, EmployeeReceiveID, SectionReceiveID,
            Quantity, Type, ActionAt, Note)
         VALUES (UUID(), ?, NULL,
                 ?, ?, NULL, NULL,
                 ?, ?, ?, ?)`,
        [
          r.AssetID,
          asset.CurEmp ?? null,
          asset.CurDept ?? null,
          histQty,
          histType,
          now,
          notePrefix + noteSuffix,
        ]
      );

      // Cập nhật Asset theo kết quả
      if (isFound) {
        await conn.execute(
          `UPDATE asset
             SET LastStocktakeSessionID = ?,
                 LastStocktakeAt = ?,
                 FoundLastStocktake = 1
           WHERE ID = ?`,
          [SessionID, now, r.AssetID]
        );
      } else {
        if (qtyTotal <= 1) {
          // Thiết bị cá nhân bị mất -> hủy
          await conn.execute(
            `UPDATE asset
               SET LastStocktakeSessionID = ?,
                   LastStocktakeAt = ?,
                   FoundLastStocktake = 0,
                   RemainQuantity = 0,
                   Status = ?
             WHERE ID = ?`,
            [SessionID, now, ASSET_STATUS.DISPOSED, r.AssetID]
          );
        } else {
          // Hàng số lượng: trừ Remain
          const deduct = Math.min(missingQtyReq, qtyRemain);
          const newRemain = Math.max(0, qtyRemain - deduct);
          const newStatus =
            newRemain === 0 ? ASSET_STATUS.DISPOSED : ASSET_STATUS.AVAILABLE;

          await conn.execute(
            `UPDATE asset
               SET LastStocktakeSessionID = ?,
                   LastStocktakeAt = ?,
                   FoundLastStocktake = 0,
                   RemainQuantity = ?,
                   Status = ?
             WHERE ID = ?`,
            [SessionID, now, newRemain, newStatus, r.AssetID]
          );
        }
      }
    }

    // Đóng phiên
    await conn.execute(
      `UPDATE stocktakesession
         SET Status = 'CLOSED', EndedAt = ?
       WHERE SessionID = ?`,
      [now, SessionID]
    );

    await conn.commit();
    return { closed: true, lines: lines.length };
  } catch (e) {
    await conn.rollback();
    throw e instanceof AppError
      ? e
      : new AppError(e.message || "Đóng phiên thất bại", 500);
  } finally {
    conn.release();
  }
}

// Danh sách / chi tiết / lines
async function getSessions() {
  const [rows] = await db.execute(
    `SELECT s.*, d.DepartmentName, u.FullName AS CreatedByName
     FROM stocktakesession s
     LEFT JOIN department d ON d.DepartmentID = s.DepartmentID
     LEFT JOIN user u ON u.UserID = s.CreatedBy
     ORDER BY s.SessionID DESC`
  );
  return rows;
}

async function getSession(SessionID) {
  const [rows] = await db.execute(
    `SELECT s.*, d.DepartmentName, u.FullName AS CreatedByName
     FROM stocktakesession s
     LEFT JOIN department d ON d.DepartmentID = s.DepartmentID
     LEFT JOIN user u ON u.UserID = s.CreatedBy
     WHERE s.SessionID = ?`,
    [SessionID]
  );
  if (!rows.length) throw new AppError("Không tìm thấy phiên kiểm kê", 404);
  return rows[0];
}

async function getLines(SessionID) {
  const [rows] = await db.execute(
    `SELECT l.*,
            a.Name AS AssetName,
            a.ManageCode,
            a.SerialNumber,
            a.Quantity,
            a.RemainQuantity,
            a.LastStocktakeSessionID,
            a.LastStocktakeAt,
            a.FoundLastStocktake
     FROM stocktakeitemline l
     JOIN asset a ON a.ID = l.AssetID
     WHERE l.SessionID = ?
     ORDER BY l.LineID DESC`,
    [SessionID]
  );
  return rows;
}

// Thống kê cơ bản (giữ nguyên)
async function getStatistics({ from, to }) {
  const [[{ totalReady = 0 } = {}]] = await db.execute(
    `SELECT COUNT(*) AS totalReady FROM asset WHERE Status = 1`
  );
  const [[{ purchased = 0 } = {}]] = await db.execute(
    `SELECT COUNT(*) AS purchased
       FROM asset
      WHERE PurchaseDate IS NOT NULL
        AND PurchaseDate BETWEEN ? AND ?`,
    [from, to]
  );
  const [[{ repairing = 0 } = {}]] = await db.execute(
    `SELECT COUNT(*) AS repairing FROM asset WHERE Status = 4`
  );
  return { purchased, repairing, ready: totalReady };
}

module.exports = {
  createSession,
  seedSession,
  scanAsset,
  updateLine,
  closeSession,
  getSessions,
  getSession,
  getLines,
  getStatistics,
};
