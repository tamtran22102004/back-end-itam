class AppError extends Error {
  constructor(message, statusCode, data) {
    super(message); // gọi constructor của Error để set this.message
    this.statusCode = statusCode;
    this.data = data;
  }
}

module.exports = AppError;
