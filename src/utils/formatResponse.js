function successResponse(res, statusCode, data = null, message) {
  return res.status(statusCode).json({
    success: true,
    message: message || "success",
    data,
  });
}

function errResponse(res, message, statusCode, data) {
  return res.status(statusCode).json({
    success: false,
    message: message || "Internal Server Error",
    data: data || null,
  });
}

module.exports = {
  successResponse,
  errResponse,
};
