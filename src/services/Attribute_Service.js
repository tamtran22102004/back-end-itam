const db = require("../config/database");
const AppError = require("../utils/AppError");

const createAttribute = async (name, measurementUnit) => {
  const result = await db.execute(
    "INSERT INTO attribute (name, measurementunit) VALUES ( ?, ?)",
    [name, measurementUnit]
  );
  return { name, measurementUnit };
};

const getAttribute = async () => {
  const [rows] = await db.execute("SELECT * FROM attribute");
  return rows;
};
const updateAttribute = async (id, name, measurementUnit) => {
  const [result] = await db.execute(
    "UPDATE attribute SET name = ?, measurementunit = ? WHERE id = ?",
    [name, measurementUnit, id]
  );
};
const deleteAttribute = async (id) => {
  const [result] = await db.execute("DELETE FROM attribute WHERE id = ?", [id]);
};

module.exports = {
  createAttribute,
  getAttribute,
  updateAttribute,
  deleteAttribute,
};
