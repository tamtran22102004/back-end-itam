//cors
const allowedOrigins = [
  "http://localhost:5173",
  "https://front-end-itam.vercel.app",
];

const corsConfig = {
  origin: function (origin, callback) {
    // Nếu không có origin (ví dụ: Postman, local) hoặc nằm trong danh sách cho phép
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

module.exports = corsConfig;
