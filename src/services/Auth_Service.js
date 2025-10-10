const db = require("../config/database");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const AppError = require("../utils/AppError");

// Tìm user theo email
async function findUserByEmail(email) {
  const [rows] = await db.execute("SELECT * FROM user WHERE email = ?", [
    email,
  ]);
  return rows.length > 0 ? rows[0] : null;
}

// Đăng ký
async function register({ fullname, email, phone, password }) {
  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    throw new AppError("Email already exists", 404);
  }

  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  await db.execute(
    "INSERT INTO user(fullname,email,phone,password) VALUES (?,?,?,?)",
    [fullname, email, phone, hashedPassword]
  );

  return { message: "Register successfully" };
}

// Đăng nhập
async function login({ email, password }) {
  const user = await findUserByEmail(email);
  if (!user) {
    // 404: Not Found
    throw new AppError("Email does not exist", 401);
  }

  const isPasswordValid = await bcrypt.compare(password, user.Password);
  if (!isPasswordValid) {
    // 401: Unauthorized
    throw new AppError("Invalid password", 401);
  }

  const token = jwt.sign(
    {
      id: user.UserID,
      email: user.Email,
      role: user.Role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
  return {
    token,
    user: {
      id: user.UserID,
      email: user.Email,
      fullname: user.FullName,
      role: user.Role,
    },
  };
}

module.exports = {
  findUserByEmail,
  register,
  login,
};
