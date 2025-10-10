const { errResponse } = require("../utils/formatResponse");

function errorHandler(err, req, res, next) {
  switch (err.constructor.name) {
    case "AppError":
      errResponse(res, err.message, err.statusCode,err.data);
      break;

    default:
      errResponse(res, "Internal Server Error", 500);
  }
}

module.exports = errorHandler;
