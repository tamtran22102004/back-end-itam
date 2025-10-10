const Auth_Service = require("../services/Auth_Service");
const AppError = require("../utils/AppError");
const wrap = require("../utils/Wrap");
const { successResponse } = require("../utils/formatResponse");

const RegisterUser = wrap(async (req, res, next) => {
  try {
    const { fullname, email, phone, password } = req.body;

    // Kiểm tra param cơ bản
    if (!fullname || !email || !phone || !password) {
      return next(new AppError("Missing required params", 400));
    }

    const result = await Auth_Service.register({
      fullname,
      email,
      phone,
      password,
    });

    return successResponse(res, 200, result, "Register successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
});

const LoginUser = wrap(async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(new AppError("Missing required params", 400));
    }

    const result = await Auth_Service.login({ email, password });
    return successResponse(res, 200, result, "Login successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
});

module.exports = {
  RegisterUser,
  LoginUser,
};
