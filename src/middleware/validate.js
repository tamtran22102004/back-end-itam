const { validationResult } = require("express-validator");
const AppError = require("../utils/AppError");

const validate = (req, res, next) => {
  const errors = validationResult(req);
  console.log(errors);
  if (!errors.isEmpty()) {
    // Chỉ quăng lỗi cho errorHandler xử lý
    return next(new AppError("Validation Error", 400, errors.array()));
    
  }
  next();
};
module.exports = validate;
