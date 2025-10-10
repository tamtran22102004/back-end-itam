const express = require("express");
const Auth_Controller = require("../controllers/Auth_Controller");
const authValidator = require("../validator/Auth_Validator");
const validate = require("../middleware/validate");
const router = express.Router();

router.post(
  "/register",
  authValidator.register,
  validate,
  Auth_Controller.RegisterUser
);

router.post("/login", authValidator.login, validate, Auth_Controller.LoginUser);

module.exports = router; //export default
