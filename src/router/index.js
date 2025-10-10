const express = require("express");
const router = express.Router();

const Auth_Router = require("./Auth_Router");
const Category_Router = require("./Category_Router");
const Attribute_Router = require("./Attribute_Router")


router.use("/", Auth_Router);
router.use("/category", Category_Router);
router.use("/attribute", Attribute_Router)

module.exports = router;
