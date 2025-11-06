require("dotenv").config();
const config = require("./config/env");
const cors = require("cors");
const express = require("express");
const errorHandler = require("./middleware/errorhandle");
const pool = require("./config/database");
const corsConfig = require("./config/cors");
const router = require("./router/index");

const app = express();

app.use(cors(corsConfig));
app.options("*", cors(corsConfig));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ mount router tại /api (chỉ 1 lần)
app.use("/api", router);

app.use(errorHandler);

(async () => {
  try {
    const conn = await pool.getConnection();
    console.log("✅ Database connected successfully!");
    conn.release();

    app.listen(config.app.port, () => {
      console.log(`🚀 Server running on port ${config.app.port}`);
    });
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
    process.exit(1);
  }
})();
