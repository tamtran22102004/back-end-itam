const path = require("path");
const dotenv = require("dotenv");

// Xác định môi trường (default = development)
const env = process.env.NODE_ENV || "development";

// Load file .env tương ứng
dotenv.config({
  path: path.resolve(process.cwd(), `.env.${env}`),
});

const config = {
  app: {
    ENVIROMENT: process.env.ENVIROMENT,
    port: process.env.PORT,
  },
  db: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    pass: process.env.DB_PASS,
    name: process.env.DB_NAME,
  },
  jwt: {
    secret: process.env.JWT_SECRET || "testjwtkey",
    expiresIn: "1h",
  },
};

module.exports = config;
