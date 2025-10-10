const jwt = require("jsonwebtoken");

// src/middlewares/roleGuard.js

// Kiểm tra user.role có trong danh sách allowedRoles
function authorization(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user?.role) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Insufficient role" });
    }
    next();
  };
}

module.exports = authorization;
