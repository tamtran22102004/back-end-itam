const AppError = require("../utils/AppError");
const { validationResult } = require("express-validator");
const { successResponse } = require("../utils/formatResponse");
const RequestDisposal_Service = require("../services/RequestDisposal_Service");

const approveRequestDisposal = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await RequestDisposal_Service.approveRequestDisposal(
            id,
            req.body
        );
        return successResponse(res, 200, result, "Approve Request Successfully");
    }
    catch (error) {
        next(   
        error instanceof AppError
            ? error
            : new AppError(error.message || "Internal Server Error", 500)
        );
    }
};
const getRequestDisposalDetail = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await RequestDisposal_Service.getRequestDisposalDetail(id);
        return successResponse(
            res,
            200,
            result,
            "Get Request Disposal Detail Successfully"
        );
    } catch (error) {
        next(
        error instanceof AppError
            ? error
            : new AppError(error.message || "Internal Server Error", 500)
        );
    }
};
const getAllRequestDisposalDetail = async (req, res, next) => {
    try {
        const result = await RequestDisposal_Service.getAllRequestDisposalDetail();
        return successResponse(
            res,
            200,
            result,
            "Get All Request Disposal Detail Successfully"
        );
    }
    catch (error) {
        next(
        error instanceof AppError
            ? error
            : new AppError(error.message || "Internal Server Error", 500)
        );
    }
};

module.exports = {
    approveRequestDisposal,
    getRequestDisposalDetail,
    getAllRequestDisposalDetail
};
