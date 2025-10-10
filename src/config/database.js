const mysql = require("mysql2/promise");
const config = require("./env");

const pool = mysql.createPool({
  host: config.db.host,
  user: config.db.user,
  password: config.db.pass,
  database: config.db.name,
  port: config.db.port,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;
