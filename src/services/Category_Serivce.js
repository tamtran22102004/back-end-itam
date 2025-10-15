const db = require("../config/database");
const AppError = require("../utils/AppError");
const { v4: uuidv4 } = require("uuid");

const findcodePrefix = async (codePrefix) => {
  const [rows] = await db.execute(
    "SELECT * FROM category WHERE codeprefix = ?",
    [codePrefix]
  );
  return rows.length > 0 ? rows[0] : null;
};
const findcategoryName = async (name) => {
  const [rows] = await db.execute("SELECT * FROM category WHERE name = ?", [
    name,
  ]);
  return rows.length > 0 ? rows[0] : null;
};
const createCategory = async (name, codePrefix, maintenanceIntervalHours) => {
  const id = uuidv4();
  const existingCategory = await findcodePrefix(codePrefix);
  const existingName = await findcategoryName(name);
  if (existingCategory) {
    throw new AppError("Mã danh mục đã được tạo", 404);
  }
  if (existingName) {
    throw new AppError("Tên danh mục đã được tạo", 404);
  }
  const [result] = await db.execute(
    "INSERT INTO category (id, name, codeprefix, maintenanceintervalhours) VALUES (?, ?, ?, ?)",
    [id, name, codePrefix, maintenanceIntervalHours]
  );
  return { id, name, codePrefix, maintenanceIntervalHours };
};

const getCategory = async () => {
  const [result] = await db.execute("SELECT * FROM category");
  return result;
};

const updateCategory = async (
  id,
  name,
  codePrefix,
  maintenanceIntervalHours
) => {
  const [result] = await db.execute(
    "UPDATE category SET name = ?, codePrefix = ?, MaintenanceIntervalHours=? WHERE id = ?",
    [name, codePrefix, maintenanceIntervalHours, id]
  );
};

const deleteCategory = async (id) => {
  const [result] = await db.execute("DELETE FROM category WHERE id = ?", [id]);
  return result;
};

const getAttributesByCategory = async (categoryId) => {
  const [rows] = await db.execute(
    `SELECT 
       a.ID AS AttributeID,
       a.Name AS AttributeName,
       a.MeasurementUnit,
       COALESCE(ca.IsRequired, 0) AS IsRequired,
       COALESCE(ca.DisplayOrder, 0) AS DisplayOrder
     FROM attribute a
     LEFT JOIN categoryattribute ca
       ON ca.AttributeID = a.ID AND ca.CategoryID = ?
     ORDER BY 
       CASE WHEN COALESCE(ca.DisplayOrder, 0) = 0 THEN 999999 ELSE ca.DisplayOrder END ASC, 
       a.ID ASC`,
    [categoryId]
  );

  return rows.map((r) => ({
    AttributeID: r.AttributeID,
    AttributeName: r.AttributeName,
    MeasurementUnit: r.MeasurementUnit,
    IsRequired: !!r.IsRequired,
    DisplayOrder: Number(r.DisplayOrder) || 0,
  }));
};

const saveCategoryAttributes = async (categoryId, mappings) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const picked = mappings.filter((m) => Number(m.IsRequired) === 1);

    if (picked.length) {
      const values = picked.map((m) => [
        categoryId,
        Number(m.AttributeID),
        1,
        Number(m.DisplayOrder) || 0,
      ]);

      await conn.query(
        `INSERT INTO categoryattribute (CategoryID, AttributeID, IsRequired, DisplayOrder)
         VALUES ?
         ON DUPLICATE KEY UPDATE 
           IsRequired = VALUES(IsRequired),
           DisplayOrder = VALUES(DisplayOrder)`,
        [values]
      );

      const ids = picked.map((m) => Number(m.AttributeID));
      await conn.query(
        `DELETE FROM categoryattribute 
         WHERE CategoryID = ? AND AttributeID NOT IN (${ids
           .map(() => "?")
           .join(",")})`,
        [categoryId, ...ids]
      );
    } else {
      await conn.query(`DELETE FROM categoryattribute WHERE CategoryID = ?`, [
        categoryId,
      ]);
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = {
  createCategory,
  getCategory,
  updateCategory,
  deleteCategory,
  getAttributesByCategory,
  saveCategoryAttributes,
};
