const db = require("../config/database");
const AppError = require("../utils/AppError");
const { v4: uuidv4 } = require("uuid");
// Trả về null nếu là undefined / null / chuỗi rỗng
const toNull = (v) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? null
    : v;

// Giữ giá trị cũ cho cột NOT NULL nếu client không gửi hoặc gửi rỗng
const keepOldIfEmpty = (incoming, oldValue) =>
  incoming === undefined ||
  (typeof incoming === "string" && incoming.trim() === "")
    ? oldValue
    : incoming;

// Ép số nguyên dương (ít nhất 1), trả về null nếu incoming không hợp lệ và allowNull = true
const toPositiveIntOr = (v, fallback = 1) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
};
const getAssetHistory = async () => {
  const [rows] = await db.execute(`
      SELECT 
    ah.ID AS HistoryID,
    ah.AssetID,
    a.Name AS AssetName,
    ah.RequestID,
    rt.Name AS RequestTypeName,
    ah.EmployeeID,
    u_from.FullName AS FromEmployeeName,
    ah.SectionID,
    d_from.DepartmentName AS FromDepartmentName,
    ah.EmployeeReceiveID,
    u_to.FullName AS ToEmployeeName,
    ah.SectionReceiveID,
    d_to.DepartmentName AS ToDepartmentName,
    ah.Quantity,
    ah.Type,
    ah.ActionAt,
    ah.Note
FROM assethistory ah
LEFT JOIN asset a ON a.ID = ah.AssetID
LEFT JOIN request r ON r.RequestID = ah.RequestID
LEFT JOIN requesttype rt ON rt.RequestTypeID = r.RequestTypeID
LEFT JOIN user u_from ON u_from.UserID = ah.EmployeeID
LEFT JOIN user u_to ON u_to.UserID = ah.EmployeeReceiveID
LEFT JOIN department d_from ON d_from.DepartmentID = ah.SectionID
LEFT JOIN department d_to ON d_to.DepartmentID = ah.SectionReceiveID
ORDER BY ah.ActionAt DESC;

    `);
  return rows;
};

const getAssetService = async () => {
  const [result] = await db.execute("Select * from asset");
  return result;
};

const createAssetService = async (data) => {
  const conn = await db.getConnection();
  const assetId = uuidv4();

  try {
    const {
      ManageCode, // NOT NULL
      CategoryID, // NOT NULL
      AssetCode,
      Name,
      ItemMasterID,
      VendorID,
      PurchaseDate,
      PurchasePrice,
      PurchaseId,
      WarrantyStartDate,
      WarrantyEndDate,
      WarrantyMonth,
      SerialNumber,
      EmployeeID,
      SectionID,
      Quantity,
      QRCode,
      Status,
    } = data;

    if (!ManageCode || !CategoryID) {
      throw new AppError("Thiếu ManageCode hoặc CategoryID", 400);
    }

    await conn.beginTransaction();

    // Lấy ManageType nếu có ItemMasterID; nếu không, coi như QUANTITY
    let manageType = "QUANTITY";
    if (toNull(ItemMasterID)) {
      const [imRows] = await conn.execute(
        "SELECT ManageType FROM itemmaster WHERE ID = ?",
        [ItemMasterID]
      );
      if (!imRows.length) throw new AppError("ItemMaster không tồn tại", 400);
      manageType = imRows[0].ManageType;
    }

    const realQuantity =
      manageType === "INDIVIDUAL" ? 1 : toPositiveIntOr(Quantity, 1);

    // 1) INSERT asset (null đúng chỗ nullable)
    await conn.execute(
      `INSERT INTO asset 
        (ID, ManageCode, AssetCode, Name, CategoryID, ItemMasterID, VendorID, 
         PurchaseDate, PurchasePrice, PurchaseId, WarrantyStartDate, WarrantyEndDate, 
         WarrantyMonth, SerialNumber, EmployeeID, SectionID, Quantity, QRCode, Status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        assetId,
        ManageCode, // NOT NULL
        toNull(AssetCode),
        toNull(Name),
        CategoryID, // NOT NULL
        toNull(ItemMasterID),
        toNull(VendorID),
        toNull(PurchaseDate),
        toNull(PurchasePrice),
        toNull(PurchaseId),
        toNull(WarrantyStartDate),
        toNull(WarrantyEndDate),
        toNull(WarrantyMonth),
        toNull(SerialNumber),
        toNull(EmployeeID),
        toNull(SectionID),
        realQuantity, // NOT NULL (>=1)
        toNull(QRCode),
        toNull(Status),
      ]
    );

    // 2) Copy cấu hình từ ItemMaster → AssetAttributeValue (nếu có ItemMasterID)
    if (toNull(ItemMasterID)) {
      await conn.execute(
        `INSERT INTO assetattributevalue (AttributeID, AssetID, Value)
         SELECT AttributeID, ?, Value 
         FROM itemmasterattributevalue 
         WHERE ItemMasterID = ?`,
        [assetId, ItemMasterID]
      );
    }

    // 3) Lịch sử nhập kho
    const historyId = uuidv4();
    await conn.execute(
      `INSERT INTO assethistory (ID, AssetID, Quantity, Type, ActionAt, Note)
       VALUES (?, ?, ?, 'AVAILABLE', NOW(), ?)`,
      [historyId, assetId, realQuantity, "Nhập kho tự động khi tạo thiết bị"]
    );

    // 4) KHÔNG đụng itemmaster.* — trigger lo
    await conn.commit();

    return {
      ID: assetId,
      ManageCode,
      AssetCode: toNull(AssetCode),
      Name: toNull(Name),
      CategoryID,
      ItemMasterID: toNull(ItemMasterID),
      VendorID: toNull(VendorID),
      PurchaseDate: toNull(PurchaseDate),
      PurchasePrice: toNull(PurchasePrice),
      PurchaseId: toNull(PurchaseId),
      WarrantyStartDate: toNull(WarrantyStartDate),
      WarrantyEndDate: toNull(WarrantyEndDate),
      WarrantyMonth: toNull(WarrantyMonth),
      SerialNumber: toNull(SerialNumber),
      EmployeeID: toNull(EmployeeID),
      SectionID: toNull(SectionID),
      Quantity: realQuantity,
      QRCode: toNull(QRCode),
      Status: toNull(Status),
    };
  } catch (error) {
    await conn.rollback();
    console.error("❌ createAssetService:", error);
    throw new AppError(error.message || "Không thể tạo Asset", 500);
  } finally {
    conn.release();
  }
};

const updateAssetService = async (id, data) => {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // Lấy full asset cũ để có giá trị fallback
    const [oldRows] = await conn.execute("SELECT * FROM asset WHERE ID = ?", [
      id,
    ]);
    if (!oldRows.length) throw new AppError("Asset không tồn tại", 404);
    const oldAsset = oldRows[0];

    // Destructure incoming
    const {
      ManageCode,
      AssetCode,
      Name,
      CategoryID,
      ItemMasterID,
      VendorID,
      PurchaseDate,
      PurchasePrice,
      PurchaseId,
      WarrantyStartDate,
      WarrantyEndDate,
      WarrantyMonth,
      SerialNumber,
      EmployeeID,
      SectionID,
      Quantity,
      QRCode,
      Status,
    } = data;

    // Xác định ItemMasterID mục tiêu (có thể null)
    const targetItemMasterID =
      ItemMasterID === undefined ? oldAsset.ItemMasterID : toNull(ItemMasterID);

    // Lấy ManageType nếu có ItemMasterID; nếu không, coi như QUANTITY
    let manageType = "QUANTITY";
    if (targetItemMasterID) {
      const [imRows] = await conn.execute(
        "SELECT ManageType FROM itemmaster WHERE ID = ?",
        [targetItemMasterID]
      );
      if (!imRows.length) throw new AppError("ItemMaster không tồn tại", 400);
      manageType = imRows[0].ManageType;
    }

    const realQuantity =
      manageType === "INDIVIDUAL"
        ? 1
        : toPositiveIntOr(
            Quantity ?? oldAsset.Quantity,
            oldAsset.Quantity || 1
          );

    // Build giá trị cập nhật:
    // - NOT NULL: giữ cũ nếu client không gửi / gửi rỗng
    // - NULLABLE: chuyển '' → NULL
    const newManageCode = keepOldIfEmpty(ManageCode, oldAsset.ManageCode); // NOT NULL
    const newCategoryID = keepOldIfEmpty(CategoryID, oldAsset.CategoryID); // NOT NULL

    const params = [
      newManageCode, // ManageCode (NOT NULL)
      toNull(AssetCode),
      toNull(Name),
      newCategoryID, // CategoryID (NOT NULL)
      targetItemMasterID, // NULL allowed
      toNull(VendorID),
      toNull(PurchaseDate),
      toNull(PurchasePrice),
      toNull(PurchaseId),
      toNull(WarrantyStartDate),
      toNull(WarrantyEndDate),
      toNull(WarrantyMonth),
      toNull(SerialNumber),
      toNull(EmployeeID),
      toNull(SectionID),
      realQuantity, // NOT NULL
      toNull(QRCode),
      toNull(Status),
      id,
    ];

    await conn.execute(
      `UPDATE asset SET 
        ManageCode = ?, 
        AssetCode = ?, 
        Name = ?, 
        CategoryID = ?, 
        ItemMasterID = ?, 
        VendorID = ?, 
        PurchaseDate = ?, 
        PurchasePrice = ?, 
        PurchaseId = ?, 
        WarrantyStartDate = ?, 
        WarrantyEndDate = ?, 
        WarrantyMonth = ?, 
        SerialNumber = ?, 
        EmployeeID = ?, 
        SectionID = ?, 
        Quantity = ?, 
        QRCode = ?, 
        Status = ?
       WHERE ID = ?`,
      params
    );

    // KHÔNG cập nhật itemmaster.* — trigger xử lý

    await conn.commit();

    return {
      id,
      ManageCode: newManageCode,
      AssetCode: toNull(AssetCode),
      Name: toNull(Name),
      CategoryID: newCategoryID,
      ItemMasterID: targetItemMasterID,
      VendorID: toNull(VendorID),
      PurchaseDate: toNull(PurchaseDate),
      PurchasePrice: toNull(PurchasePrice),
      PurchaseId: toNull(PurchaseId),
      WarrantyStartDate: toNull(WarrantyStartDate),
      WarrantyEndDate: toNull(WarrantyEndDate),
      WarrantyMonth: toNull(WarrantyMonth),
      SerialNumber: toNull(SerialNumber),
      EmployeeID: toNull(EmployeeID),
      SectionID: toNull(SectionID),
      Quantity: realQuantity,
      QRCode: toNull(QRCode),
      Status: toNull(Status),
    };
  } catch (error) {
    await conn.rollback();
    console.error("❌ updateAssetService:", error);
    throw new AppError(error.message || "Không thể cập nhật Asset", 500);
  } finally {
    conn.release();
  }
};

const deleteAssetService = async (id) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Lưu lại thông tin để trả về
    const [rows] = await conn.execute(
      "SELECT Quantity, ItemMasterID FROM asset WHERE ID = ?",
      [id]
    );
    if (!rows.length) throw new AppError("Asset không tồn tại", 404);
    const asset = rows[0];

    await conn.execute("DELETE FROM asset WHERE ID = ?", [id]);

    // ❌ KHÔNG cập nhật itemmaster.* nữa — triggers AFTER DELETE sẽ tự tính

    await conn.commit();
    return asset;
  } catch (error) {
    await conn.rollback();
    console.error("❌ Lỗi trong deleteAssetService:", error);
    throw new AppError(error.message || "Không thể xóa Asset", 500);
  } finally {
    conn.release();
  }
};

// services/assetConfig.service.js
const getAssetConfig = async () => {
  const [rows] = await db.execute(`
    (
        SELECT 
          a.ID         AS AssetID,
          a.Name       AS AssetName,
          a.ManageCode,
          a.AssetCode,
          a.Status,

          attr.ID               AS AttributeID,
          attr.Name             AS AttributeName,
          attr.MeasurementUnit  AS MeasurementUnit,

          v.ID   AS AssetAttributeValueID,
          CASE 
            WHEN TRIM(COALESCE(v.Value, '')) = '' THEN NULL
            ELSE v.Value
          END AS Value
        FROM asset a
        LEFT JOIN CategoryAttribute ca ON ca.CategoryID = a.CategoryID
        LEFT JOIN attribute attr       ON attr.ID = ca.AttributeID
        LEFT JOIN assetattributevalue v 
              ON v.AssetID = a.ID AND v.AttributeID = attr.ID
      )
      UNION
      (
        SELECT 
          a.ID         AS AssetID,
          a.Name       AS AssetName,
          a.ManageCode,
          a.AssetCode,
          a.Status,

          attr.ID               AS AttributeID,
          attr.Name             AS AttributeName,
          attr.MeasurementUnit  AS MeasurementUnit,

          v.ID   AS AssetAttributeValueID,
          v.Value
        FROM assetattributevalue v
        JOIN asset a       ON a.ID = v.AssetID
        JOIN attribute attr ON attr.ID = v.AttributeID
      )
      ORDER BY AssetName, AttributeName;

  `);

  const grouped = {};
  rows.forEach((r) => {
    if (!grouped[r.AssetID]) {
      grouped[r.AssetID] = {
        Asset: {
          ID: r.AssetID,
          Name: r.AssetName,
          ManageCode: r.ManageCode,
          AssetCode: r.AssetCode,
          Status: r.Status,
        },
        Attributes: [],
      };
    }
    // Có mapping attribute (attr.ID) thì luôn push, kể cả khi Value null
    if (r.AttributeID) {
      grouped[r.AssetID].Attributes.push({
        ID: r.AssetAttributeValueID || null,
        AttributeID: r.AttributeID,
        Name: r.AttributeName,
        Unit: r.MeasurementUnit,
        Value: r.Value, // null = "Chưa cấu hình"
      });
    }
  });

  return Object.values(grouped);
};

const createAssetConfig = async (AssetID, AttributeID, Value) => {
  const [result] = await db.execute(
    "INSERT INTO assetattributevalue (AssetID, AttributeID, Value) VALUES (?, ?, ?)",
    [AssetID, AttributeID, Value ?? null]
  );
  return AssetID, AttributeID, Value;
};

const updateAssetConfig = async (ID, Value) => {
  const [result] = await db.execute(
    "UPDATE assetattributevalue SET Value = ? WHERE ID = ?",
    [Value ?? null, ID]
  );
  return { ID, Value };
};

const deleteAssetConfig = async (ID) => {
  const [result] = await db.execute(
    "DELETE FROM assetattributevalue WHERE ID = ?",
    [ID]
  );
  return { ID };
};
const getAssetDetail = async (id) => {
  const [rows] = await db.execute(
    `
    SELECT 
      -- 🎯 Toàn bộ cột của asset
      a.ID AS AssetID,
      a.ManageCode,
      a.AssetCode,
      a.Name AS AssetName,
      a.CategoryID,
      c.Name AS CategoryName,
      a.ItemMasterID,
      im.Name AS ItemMasterName,
      a.VendorID,
      v.Name AS VendorName,
      a.PurchaseDate,
      a.PurchasePrice,
      a.PurchaseId,
      a.WarrantyStartDate,
      a.WarrantyEndDate,
      a.WarrantyMonth,
      a.SerialNumber,
      a.EmployeeID,
      u.FullName AS EmployeeName,
      a.SectionID,
d.DepartmentName AS DepartmentName,
      a.Quantity,
      a.QRCode,
      a.Status,

      -- 🔹 Thông tin thuộc tính kỹ thuật
      attr.ID AS AttributeID,
      attr.Name AS AttributeName,
      attr.MeasurementUnit AS Unit,
      val.ID AS AssetAttributeValueID,
      val.Value

    FROM asset a
    LEFT JOIN category c ON c.ID = a.CategoryID
    LEFT JOIN itemmaster im ON im.ID = a.ItemMasterID
    LEFT JOIN vendor v ON v.ID = a.VendorID
    LEFT JOIN user u ON u.UserID = a.EmployeeID
    LEFT JOIN department d ON d.DepartmentID = a.SectionID
    LEFT JOIN assetattributevalue val ON val.AssetID = a.ID
    LEFT JOIN attribute attr ON attr.ID = val.AttributeID
    WHERE a.ID = ?
    ORDER BY attr.Name ASC;
    `,
    [id]
  );

  if (!rows.length) return null;

  // ✅ Gom nhóm thông tin Asset
  const a = rows[0];
  const asset = {
    ID: a.AssetID,
    ManageCode: a.ManageCode,
    AssetCode: a.AssetCode,
    Name: a.AssetName,
    CategoryID: a.CategoryID,
    CategoryName: a.CategoryName,
    ItemMasterID: a.ItemMasterID,
    ItemMasterName: a.ItemMasterName,
    VendorID: a.VendorID,
    VendorName: a.VendorName,
    PurchaseDate: a.PurchaseDate,
    PurchasePrice: a.PurchasePrice,
    PurchaseId: a.PurchaseId,
    WarrantyStartDate: a.WarrantyStartDate,
    WarrantyEndDate: a.WarrantyEndDate,
    WarrantyMonth: a.WarrantyMonth,
    SerialNumber: a.SerialNumber,
    EmployeeID: a.EmployeeID,
    EmployeeName: a.EmployeeName,
    SectionID: a.SectionID,
    DepartmentName: a.DepartmentName,
    Quantity: a.Quantity,
    QRCode: a.QRCode,
    Status: a.Status,
  };

  // ✅ Gom danh sách attributes
  const attributes = rows
    .filter((r) => r.AttributeID) // bỏ dòng null
    .map((r) => ({
      ID: r.AssetAttributeValueID,
      AttributeID: r.AttributeID,
      Name: r.AttributeName,
      Unit: r.Unit,
      Value: r.Value,
    }));

  return { asset, attributes };
};

module.exports = {
  createAssetService,
  getAssetService,
  updateAssetService,
  deleteAssetService,
  getAssetConfig,
  createAssetConfig,
  updateAssetConfig,
  deleteAssetConfig,
  getAssetDetail,
  getAssetHistory
};
