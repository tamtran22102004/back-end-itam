const express = require("express");
const { body } = require("express-validator");

const register = [
  body("fullname").notEmpty().withMessage("Fullname is required"),

  body("email").isEmail().withMessage("Invalid email format"),

  body("phone").isMobilePhone().withMessage("Invalid phone number"),

  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),
];

const login = [
  body("email").isEmail().withMessage("Invalid email format"),

  body("password").notEmpty().withMessage("Password is required"),
];

const authValidator = { register, login };
module.exports = authValidator;
