const jwt = require("jsonwebtoken");
const AppError = require("../utils/AppError");
const authen = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";

    // Tách "Bearer <token>"
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return res.status(401).json({ message: "Invalid authorization format" });
    }

    const token = parts[1]; // Lấy token đúng

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
    };

    next();
  } catch (err) {
    return next(new AppError("Unauthorized", 401));
  }
};

module.exports = authen;
