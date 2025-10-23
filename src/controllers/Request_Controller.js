// controllers/Request_Controller.js
const AppError = require("../utils/AppError");
const { successResponse } = require("../utils/formatResponse");
const Request_Service = require("../services/Request_Serivce");

const CreateRequest = async (req, res, next) => {
  try {
    const result = await Request_Service.createRequest(req.body);
    return successResponse(res, 200, result, "Create Request Successfully");
  } catch (error) {
    next(error instanceof AppError ? error : new AppError("Internal Server Error", 500));
  }
};

module.exports = { CreateRequest };
