const db = require("../config/database");
const AppError = require("../utils/AppError");
const { v4: uuidv4 } = require("uuid");

const getItemMaster = async () => {
  const [result] = await db.execute("SELECT * FROM itemmaster");
  return result;
};

const createItemMaster = async (data) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const {
      ID,
      CategoryID,
      ManufacturerID,
      Name,
      ManageType,
      Quantity,
      Attributes = [],
    } = data;

    // 1️⃣ Insert ItemMaster
    await conn.execute(
      `INSERT INTO ItemMaster (ID, CategoryID, ManufacturerID, Name, ManageType, Quantity)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ID, CategoryID, ManufacturerID || null, Name, ManageType, Quantity ?? 0]
    );

    // 2️⃣ Insert Attribute values (nếu có)
    for (const attr of Attributes) {
      if (attr.AttributeID && attr.Value !== undefined && attr.Value !== null) {
        await conn.execute(
          `INSERT INTO ItemMasterAttributeValue (AttributeID, ItemMasterID, Value)
           VALUES (?, ?, ?)`,
          [attr.AttributeID, ID, attr.Value]
        );
      }
    }

    await conn.commit();

    return {
      ID,
      CategoryID,
      ManufacturerID,
      Name,
      ManageType,
      Quantity,
      Attributes, // trả lại đúng những gì frontend gửi
    };
  } catch (error) {
    await conn.rollback();
    console.error("❌ Lỗi trong createItemMasterService:", error);
    throw new AppError("Không thể tạo ItemMaster", 500);
  } finally {
    conn.release();
  }
};

const updateItemMaster = async (id, data) => {
  const conn = await db.getConnection();

  try {
    const {
      CategoryID,
      ManufacturerID,
      Name,
      ManageType,
      Quantity = 0,
      Attributes = [],
    } = data;

    await conn.beginTransaction();

    // 1️⃣ Cập nhật ItemMaster chính
    await conn.execute(
      `UPDATE ItemMaster 
       SET ManufacturerID = ?, CategoryID = ?, Name = ?, ManageType = ?, Quantity = ? 
       WHERE ID = ?`,
      [ManufacturerID, CategoryID, Name, ManageType, Quantity, id]
    );

    // 2️⃣ Xóa thuộc tính cũ (đảm bảo không bị trùng)
    await conn.execute(`DELETE FROM ItemMasterAttributeValue WHERE ItemMasterID = ?`, [id]);

    // 3️⃣ Thêm lại thuộc tính mới (nếu có)
    for (const attr of Attributes) {
      await conn.execute(
        `INSERT INTO ItemMasterAttributeValue (AttributeID, ItemMasterID, Value)
         VALUES (?, ?, ?)`,
        [attr.AttributeID, id, attr.Value || ""]
      );
    }

    await conn.commit();
    return { success: true, message: "Cập nhật ItemMaster thành công" };
  } catch (error) {
    await conn.rollback();
    console.error("❌ Lỗi trong updateItemMasterService:", error);
    throw new AppError(error.message || "Không thể cập nhật ItemMaster", 500);
  } finally {
    conn.release();
  }
};


const deleteItemMaster = async (id) => {
  const [result] = await db.execute("DELETE FROM itemmaster WHERE id = ?", [
    id,
  ]);
  return result;
};

const getAssetService = async () => {
  const [result] = await db.execute("Select * from Asset");
  return result;
};

const createAssetService = async (data) => {
  const conn = await db.getConnection();
  const assetId = uuidv4();

  try {
    const {
      ManageCode,
      AssetCode,
      Name,
      CategoryID,
      ItemMasterID,
      VendorID=null,
      PurchaseDate = null,
      PurchasePrice = null,
      PurchaseId = null,
      WarrantyStartDate = null,
      WarrantyEndDate = null,
      WarrantyMonth = null,
      SerialNumber = null,
      EmployeeID = null,
      SectionID = null,
      Quantity = 1,
      QRCode = null,
      Status = 1,
    } = data;

    await conn.beginTransaction();

    // 1️⃣ Thêm mới Asset
    await conn.execute(
      `INSERT INTO Asset 
        (ID, ManageCode, AssetCode, Name, CategoryID, ItemMasterID, VendorID, 
         PurchaseDate, PurchasePrice, PurchaseId, WarrantyStartDate, WarrantyEndDate, 
         WarrantyMonth, SerialNumber, EmployeeID, SectionID, Quantity, QRCode, Status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        assetId,
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
      ]
    );

    // 2️⃣ Copy cấu hình từ ItemMaster → AssetAttributeValue
    await conn.execute(
      `INSERT INTO AssetAttributeValue (AttributeID, AssetID, Value)
       SELECT AttributeID, ?, Value FROM ItemMasterAttributeValue WHERE ItemMasterID = ?`,
      [assetId, ItemMasterID]
    );

    // 3️⃣ Tạo log lịch sử nhập kho
    const historyId = uuidv4();
    await conn.execute(
      `INSERT INTO AssetHistory (ID, AssetID, Quantity, Type, ActionAt, Note)
       VALUES (?, ?, ?, 'AVAILABLE', NOW(), ?)`,
      [historyId, assetId, Quantity, "Nhập kho tự động khi tạo thiết bị"]
    );

    // 4️⃣ Cập nhật số lượng ItemMaster
    if (ItemMasterID) {
      await conn.execute(
        "UPDATE ItemMaster SET Quantity = Quantity + ? WHERE ID = ?",
        [Quantity, ItemMasterID]
      );
    }

    await conn.commit();

    return {
      ID: assetId,
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
    };
  } catch (error) {
    await conn.rollback();
    console.error("❌ Lỗi trong createAssetService:", error);
    throw new AppError("Không thể tạo Asset", 500);
  } finally {
    conn.release();
  }
};

const updateAssetService = async (id, data) => {
  const conn = await db.getConnection();

  try {
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

    await conn.beginTransaction();

    // 1️⃣ Lấy Asset cũ
    const [rows] = await conn.execute(
      "SELECT Quantity, ItemMasterID FROM Asset WHERE ID = ?",
      [id]
    );
    if (rows.length === 0) throw new AppError("Asset không tồn tại", 404);
    const oldAsset = rows[0];

    // 2️⃣ Cập nhật Asset đầy đủ
    await conn.execute(
      `UPDATE Asset SET 
        ManageCode = ?, AssetCode = ?, Name = ?, CategoryID = ?, ItemMasterID = ?, VendorID = ?, 
        PurchaseDate = ?, PurchasePrice = ?, PurchaseId = ?, WarrantyStartDate = ?, WarrantyEndDate = ?, 
        WarrantyMonth = ?, SerialNumber = ?, EmployeeID = ?, SectionID = ?, Quantity = ?, QRCode = ?, Status = ?
       WHERE ID = ?`,
      [
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
        id,
      ]
    );

    // 3️⃣ Nếu thay đổi Quantity → cập nhật ItemMaster
    const diff = Quantity - oldAsset.Quantity;
    if (diff !== 0 && ItemMasterID) {
      await conn.execute(
        "UPDATE ItemMaster SET Quantity = Quantity + ? WHERE ID = ?",
        [diff, ItemMasterID]
      );
    }

    await conn.commit();
    return {
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
      id,
    };
  } catch (error) {
    await conn.rollback();
    console.error("❌ Lỗi trong updateAssetService:", error);
    throw new AppError(error.message || "Không thể cập nhật Asset", 500);
  } finally {
    conn.release();
  }
};
const deleteAssetService = async (id) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      "SELECT Quantity, ItemMasterID FROM Asset WHERE ID = ?",
      [id]
    );
    if (rows.length === 0) throw new AppError("Asset không tồn tại", 404);
    const asset = rows[0];

    await conn.execute("DELETE FROM Asset WHERE ID = ?", [id]);
    if (asset.ItemMasterID) {
      await conn.execute(
        "UPDATE ItemMaster SET Quantity = Quantity - ? WHERE ID = ?",
        [asset.Quantity, asset.ItemMasterID]
      );
    }

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
const getItemMasterAttributeService= async(id)=>{
  const itemId =id;
  const [rows] = await db.execute(
      `SELECT 
         imav.AttributeID, 
         imav.Value,
         a.Name AS AttributeName,
         a.MeasurementUnit
       FROM ItemMasterAttributeValue imav
       JOIN Attribute a ON a.ID = imav.AttributeID
       WHERE imav.ItemMasterID = ?`,
      [itemId]
    );
    return rows;
}

module.exports = {
  createItemMaster,
  getItemMaster,
  updateItemMaster,
  deleteItemMaster,
  createAssetService,
  getAssetService,
  updateAssetService,
  deleteAssetService,
  getItemMasterAttributeService
};
