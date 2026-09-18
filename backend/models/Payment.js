const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    customerName: {
      type: String,
      trim: true,
      default: "CA Student",
    },
    customerEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "student@studyledger.com",
    },
    plan: {
      type: String,
      enum: ["monthly", "annual"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "INR",
    },
    paymentMethod: {
      type: String,
      enum: ["Direct UPI", "Razorpay", "Razorpay Standard Checkout", "Card", "NetBanking"],
      required: true,
    },
    utr: {
      type: String,
      trim: true,
    },
    razorpayOrderId: {
      type: String,
    },
    razorpayPaymentId: {
      type: String,
    },
    razorpaySignature: {
      type: String,
    },
    status: {
      type: String,
      enum: ["completed", "pending", "failed"],
      default: "completed",
    },
    activatedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Payment", paymentSchema);
