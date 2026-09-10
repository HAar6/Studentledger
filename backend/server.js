const authRoutes = require("./routes/auth");
const studyRoutes = require("./routes/study");
const paymentRoutes = require("./routes/payment");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const dotenv = require("dotenv");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/study", studyRoutes);
app.use("/api/payment", paymentRoutes);

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

const path = require("path");

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