const db = require("../config/database");
const { v4: uuidv4 } = require("uuid");

const findVendorName = async (name) => {
  const [rows] = await db.execute("SELECT * FROM Vendor WHERE Name = ?", [
    name,
  ]);
  return rows.length > 0 ? rows[0] : null;
};

const getVendorService = async () => {
  const [result] = await db.execute("SELECT * FROM Vendor");
  return result;
};
const createVendorService = async (Name) => {
  const id = uuidv4();
  const existingName = await findVendorName(Name);
  if (existingName) {
    throw new AppError("Tên nhà cung cấp đã được tạo", 404);
  }
  const [result]=await db.execute("INSERT INTO Vendor (ID,Name) VALUES (?,?)",[id,Name])
  return [id,Name];
};
module.exports = { getVendorService, createVendorService};
