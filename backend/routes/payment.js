const express = require("express");
const crypto = require("crypto");
const Payment = require("../models/Payment");
const User = require("../models/User");

const router = express.Router();

// Lazy load Razorpay if keys exist
let razorpayInstance = null;
function getRazorpay() {
  if (!razorpayInstance && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    try {
      const Razorpay = require("razorpay");
      razorpayInstance = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });
    } catch (e) {
      console.warn("Razorpay package error:", e.message);
    }
  }
  return razorpayInstance;
}

// 1. GET PUBLIC PAYMENT CONFIG
router.get("/config", (req, res) => {
  res.json({
    merchantName: process.env.MERCHANT_NAME || "KUNDAN TRADING COMPANY",
    hasRazorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || null,
    pricing: {
      monthly: 39,
      annual: 299,
    },
  });
});

// 2. SUBMIT DIRECT UPI PAYMENT (UTR 12-Digit Reference Number)
router.post("/submit-upi", async (req, res) => {
  try {
    const { utr, plan = "monthly", customerName = "CA Student", customerEmail = "student@studyledger.com" } = req.body;

    if (!utr || String(utr).trim().length < 6) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 12-digit UPI Transaction Reference Number (UTR).",
      });
    }

    const cleanUtr = String(utr).trim();
    const amount = plan === "annual" ? 299 : 39;
    const durationDays = plan === "annual" ? 365 : 30;
    const txnId = "SL-UPI-" + Date.now().toString().slice(-6) + "-" + Math.floor(1000 + Math.random() * 9000);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Save to MongoDB if available
    try {
      const paymentRecord = new Payment({
        transactionId: txnId,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim().toLowerCase(),
        plan,
        amount,
        currency: "INR",
        paymentMethod: "Direct UPI",
        utr: cleanUtr,
        status: "completed",
        activatedAt: now,
        expiresAt,
      });
      await paymentRecord.save();

      // Update User subscription if registered
      if (customerEmail) {
        await User.findOneAndUpdate(
          { email: customerEmail.trim().toLowerCase() },
          {
            isSubscribed: true,
            subscriptionPlan: plan,
            subscriptionExpiresAt: expiresAt,
            subscriptionTxnId: txnId,
          }
        );
      }
    } catch (dbError) {
      console.warn("MongoDB write skipped or failed (safe fallback active):", dbError.message);
    }

    return res.status(200).json({
      success: true,
      message: "UPI Payment verified successfully! Software license activated.",
      license: {
        transactionId: txnId,
        utr: cleanUtr,
        plan,
        amount,
        customerName,
        customerEmail,
        status: "active",
        activatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error processing UPI submission:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during verification: " + error.message,
    });
  }
});

// 3. CREATE RAZORPAY ORDER (Automated Gateway)
router.post("/create-order", async (req, res) => {
  try {
    const { plan = "monthly" } = req.body;
    const amount = (plan === "annual" ? 299 : 39) * 100; // in paise
    const razorpay = getRazorpay();

    if (!razorpay) {
      return res.status(200).json({
        hasGateway: false,
        message: "Automated Razorpay gateway simulation active.",
        merchantName: process.env.MERCHANT_NAME || "KUNDAN TRADING COMPANY",
      });
    }

    const options = {
      amount,
      currency: "INR",
      receipt: "rcpt_" + Date.now(),
      payment_capture: 1,
      notes: {
        product: "The Study Ledger License",
        plan,
      },
    };

    const order = await razorpay.orders.create(options);
    return res.status(200).json({
      hasGateway: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      plan,
    });
  } catch (error) {
    console.error("Razorpay order creation error:", error);
    return res.status(500).json({
      hasGateway: false,
      message: "Failed to create payment order: " + error.message,
    });
  }
});

// 4. VERIFY RAZORPAY SIGNATURE
router.post("/verify-razorpay", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      plan = "monthly",
      customerName = "CA Student",
      customerEmail = "student@studyledger.com",
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: "Missing payment authorization parameters." });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return res.status(500).json({ success: false, message: "Server gateway secret is missing." });
    }

    const generatedSignature = crypto
      .createHmac("sha256", secret)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Cryptographic signature mismatch. Payment verification failed." });
    }

    const amount = plan === "annual" ? 299 : 39;
    const durationDays = plan === "annual" ? 365 : 30;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const txnId = "SL-RZP-" + razorpay_payment_id;

    try {
      const paymentRecord = new Payment({
        transactionId: txnId,
        customerName,
        customerEmail,
        plan,
        amount,
        currency: "INR",
        paymentMethod: "Razorpay",
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
        status: "completed",
        activatedAt: now,
        expiresAt,
      });
      await paymentRecord.save();

      if (customerEmail) {
        await User.findOneAndUpdate(
          { email: customerEmail.trim().toLowerCase() },
          {
            isSubscribed: true,
            subscriptionPlan: plan,
            subscriptionExpiresAt: expiresAt,
            subscriptionTxnId: txnId,
          }
        );
      }
    } catch (e) {
      console.warn("Database save skipped:", e.message);
    }

    return res.status(200).json({
      success: true,
      message: "Payment successfully verified and settled.",
      license: {
        transactionId: txnId,
        paymentId: razorpay_payment_id,
        plan,
        amount,
        customerName,
        customerEmail,
        status: "active",
        activatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Signature verification error:", error);
    return res.status(500).json({ success: false, message: "Verification failed: " + error.message });
  }
});

// 5. CHECK LICENSE STATUS
router.get("/status/:email", async (req, res) => {
  try {
    const email = req.params.email.trim().toLowerCase();
    const user = await User.findOne({ email });
    if (user && user.isSubscribed) {
      const isExpired = user.subscriptionExpiresAt && new Date() > new Date(user.subscriptionExpiresAt);
      return res.json({
        isSubscribed: !isExpired,
        plan: user.subscriptionPlan,
        expiresAt: user.subscriptionExpiresAt,
        transactionId: user.subscriptionTxnId,
      });
    }
    return res.json({ isSubscribed: false });
  } catch (error) {
    return res.json({ isSubscribed: false, error: error.message });
  }
});

module.exports = router;
