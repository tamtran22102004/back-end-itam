const vendorService = require("../services/Vendor_Service");
const {successResponse} = require("../utils/formatResponse");
const AppError = require("../utils/AppError");

const getVendor = async (req, res, next) => {
  try {
    const result = await vendorService.getVendorService();
    return successResponse(res, 200, result, "Get Vendor Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
const createVendor = async (req, res, next) => {
  try {
    const { Name } = req.body;
    const result = await vendorService.createVendorService(Name);
    return successResponse(res, 200, result, "Create Vendor Successfully");
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(error.message || "Internal Server Error", 500)
    );
  }
};
module.exports = { getVendor, createVendor };
