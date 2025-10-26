const express = require("express");
const router = express.Router();

const Auth_Router = require("./Auth_Router");
const Category_Router = require("./Category_Router");
const Attribute_Router = require("./Attribute_Router")
const Item_Router = require("./Item_Router")
const Vendor_Router = require("./Vendor_Router")
const Asset_Router = require("./Asset_Router")
const RequestAllocation_Router = require("./RequestAllocation_Router")
const Request_Router = require("./Request_Router");
const requestMaintenance_Router = require("./RequestMaintenance_Router");
router.use("/", Auth_Router);
router.use("/category", Category_Router);
router.use("/attribute", Attribute_Router)
router.use("/items",Item_Router)
router.use("/vendor",Vendor_Router)
router.use("/asset",Asset_Router)
router.use("/request", Request_Router);
router.use("/requestallocation", RequestAllocation_Router);
router.use("/requestmaintenance", requestMaintenance_Router);
module.exports = router;
