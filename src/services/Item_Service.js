const db = require("../config/database");
const AppError = require("../utils/AppError");
const { v4: uuidv4 } = require("uuid");

const checkItemQuantity = async (itemmasterid) => {
  const [rows] = await db.execute(
      "SELECT * FROM asset WHERE ItemMasterID = ?",
      [itemmasterid]
    );
    return rows;
}
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
      `INSERT INTO itemmaster (ID, CategoryID, ManufacturerID, Name, ManageType, Quantity)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ID, CategoryID, ManufacturerID || null, Name, ManageType, Quantity ?? 0]
    );

    // 2️⃣ Insert Attribute values (nếu có)
    for (const attr of Attributes) {
      if (attr.AttributeID && attr.Value !== undefined && attr.Value !== null) {
        await conn.execute(
          `INSERT INTO itemmasterattributevalue (AttributeID, ItemMasterID, Value)
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
      Attributes = [],
    } = data;

    await conn.beginTransaction();

    // 1️⃣ Cập nhật ItemMaster chính
    await conn.execute(
      `UPDATE itemmaster 
       SET ManufacturerID = ?, CategoryID = ?, Name = ?, ManageType = ? 
       WHERE ID = ?`,
      [ManufacturerID, CategoryID, Name, ManageType, id]
    );

    // 2️⃣ Xóa thuộc tính cũ (đảm bảo không bị trùng)
    await conn.execute(
      `DELETE FROM itemmasterattributevalue WHERE ItemMasterID = ?`,
      [id]
    );

    // 3️⃣ Thêm lại thuộc tính mới (nếu có)
    for (const attr of Attributes) {
      await conn.execute(
        `INSERT INTO itemmasterattributevalue (AttributeID, ItemMasterID, Value)
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

const getItemMasterAttributeService = async (id) => {
  const itemId = id;
  const [rows] = await db.execute(
    `SELECT 
         imav.AttributeID, 
         imav.Value,
         a.Name AS AttributeName,
         a.MeasurementUnit
       FROM itemmasterattributevalue imav
       JOIN attribute a ON a.ID = imav.AttributeID
       WHERE imav.ItemMasterID = ?`,
    [itemId]
  );
  return rows;
};

module.exports = {
  checkItemQuantity,
  createItemMaster,
  getItemMaster,
  updateItemMaster,
  deleteItemMaster,
  getItemMasterAttributeService,
};
