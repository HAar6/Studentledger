const authRoutes = require("./routes/auth");
const studyRoutes = require("./routes/study");
const paymentRoutes = require("./routes/payment");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();

// 1. Security Headers (configured to allow Razorpay checkout and fonts)
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// 2. CORS Configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
  : ["http://localhost:5000", "http://127.0.0.1:5000"];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like same-origin static frontend, curl, mobile)
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
  })
);

// 3. Payload size protection
app.use(express.json({ limit: "2mb" }));

// 4. Rate Limiting Protection
// General API limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests from this IP, please try again after 15 minutes." },
});

// Strict auth limiter (prevents credential stuffing and brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many login/signup attempts. Please try again after 15 minutes." },
});

// Payment creation limiter (prevents order creation spam)
const paymentOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many payment order attempts. Please wait before trying again." },
});

app.use("/api", apiLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);
app.use("/api/create-order", paymentOrderLimiter);
app.use("/api/payment/create-order", paymentOrderLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/study", studyRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api", paymentRoutes);

// MongoDB Connection with timeout protection
mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
  })
  .then(() => {
    console.log("MongoDB Connected Successfully!");
  })
  .catch((error) => {
    console.error("MongoDB Connection Error:", error.message);
  });

// Serve static frontend files (dashboard, ledger, policies, payments)
// index: false ensures root '/' resolves to the dashboard sales landing page
app.use(express.static(path.join(__dirname, ".."), { index: false }));

// Default route opens dashboard.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "dashboard.html"));
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});