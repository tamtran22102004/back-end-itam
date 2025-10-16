const db = require("../config/database");
const AppError = require("../utils/AppError");

const getItemMaster = async () => {
  const [result] = await db.execute("SELECT * FROM itemmaster");
  return result;
};

const createItemMaster = async (
  ID,
  CategoryID,
  ManufacturerID,
  Name,
  ManageType,
  Quantity
) => {
  const [result] = await db.execute(
    `INSERT INTO ItemMaster (ID, CategoryID, ManufacturerID, Name, ManageType, Quantity)
   VALUES (?, ?, ?, ?, ?, ?)`,
    [ID, CategoryID, ManufacturerID || null, Name, ManageType, Quantity ?? 0]
  );

  return { ID, CategoryID, ManufacturerID, Name, ManageType, Quantity };
};
const updateItemMaster = async (ID, CategoryID, ManufacturerID, Name, ManageType, Quantity) => {
  const [result] = await db.execute(
    `UPDATE itemmaster 
     SET ManufacturerID = ?, CategoryID = ?, Name = ?, ManageType = ?, Quantity = ? 
     WHERE ID = ?`,
    [ManufacturerID, CategoryID, Name, ManageType, Quantity, ID]
  );

  return result;
};

const deleteItemMaster = async (id) => {
  const [result] = await db.execute("DELETE FROM itemmaster WHERE id = ?", [
    id,
  ]);
  return result;
};

module.exports = { createItemMaster, getItemMaster,updateItemMaster,deleteItemMaster };
