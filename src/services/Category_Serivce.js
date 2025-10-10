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

const createCategoryAttribute = async (
  CategoryID,
  AttributeID,
  IsRequired,
  DisplayOrder
) => {
  const [result] = await db.execute(
    `INSERT INTO CategoryAttribute (CategoryID, AttributeID, IsRequired, DisplayOrder)
    VALUES (?, ?, ?, ?)ON DUPLICATE KEY UPDATE
       IsRequired = VALUES(IsRequired),
       DisplayOrder = VALUES(DisplayOrder);`,
    [CategoryID, AttributeID, IsRequired ? 1 : 0, DisplayOrder || 0]
  );
  return [CategoryID, AttributeID, IsRequired, DisplayOrder];
};

module.exports = {
  createCategory,
  getCategory,
  updateCategory,
  deleteCategory,
  createCategoryAttribute,
};
