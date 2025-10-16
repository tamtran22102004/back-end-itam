const { validationResult } = require("express-validator");
const AppError = require("../utils/AppError");

const validate = (req, res, next) => {
  const errors = validationResult(req);
  console.log(errors);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map((err) => err.msg).join(", ");
    return next(new AppError( errorMessages, 400, errors.array()));
    
  }
  next();
};
module.exports = validate;
