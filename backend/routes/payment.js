const express = require("express");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const Payment = require("../models/Payment");
const User = require("../models/User");

const router = express.Router();

// Initialize Razorpay instance helper
function getRazorpayInstance() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    return null;
  }

  return new Razorpay({
    key_id,
    key_secret,
  });
}

// 1. GET PAYMENT CONFIG
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

// 2. CREATE ORDER (POST /api/create-order & POST /api/payment/create-order)
const createOrderHandler = async (req, res) => {
  try {
    const { amount, currency = "INR", receipt, plan = "monthly" } = req.body;

    // Determine amount in paise (minimum 100 paise)
    let amountInPaise;
    if (amount !== undefined && amount !== null && amount !== "") {
      const parsed = Number(amount);
      if (isNaN(parsed) || parsed < 100) {
        return res.status(400).json({
          success: false,
          error: "Invalid amount. Minimum amount is 100 paise (₹1.00).",
        });
      }
      amountInPaise = Math.round(parsed);
    } else {
      // Default to plan amount if amount not directly specified: 39 INR = 3900 paise, 299 INR = 29900 paise
      amountInPaise = plan === "annual" ? 29900 : 3900;
    }

    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;

    if (!key_id || !key_secret) {
      return res.status(401).json({
        success: false,
        error: "Razorpay credentials not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
      });
    }

    const razorpay = getRazorpayInstance();
    if (!razorpay) {
      return res.status(500).json({
        success: false,
        error: "Failed to initialize Razorpay SDK client.",
      });
    }

    const orderReceipt = receipt || `rcpt_${Date.now().toString().slice(-8)}`;
    const options = {
      amount: amountInPaise,
      currency: currency || "INR",
      receipt: orderReceipt,
      payment_capture: 1,
      notes: {
        product: "The Study Ledger License",
        plan: plan || "monthly",
      },
    };

    const order = await razorpay.orders.create(options);

    return res.status(200).json({
      success: true,
      order_id: order.id,
      orderId: order.id,
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: key_id,
      keyId: key_id,
      receipt: order.receipt,
      plan,
    });
  } catch (error) {
    console.error("Razorpay order creation error:", error);

    // Handle authentication / invalid credentials
    if (error.statusCode === 401 || (error.error && error.error.code === "BAD_REQUEST_ERROR" && error.error.description?.includes("key"))) {
      return res.status(401).json({
        success: false,
        error: "Razorpay authentication failed. Please check your API keys.",
        details: error.message || error.error?.description,
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to create Razorpay payment order: " + (error.error?.description || error.message),
    });
  }
};

router.post("/create-order", createOrderHandler);

// 3. VERIFY PAYMENT SIGNATURE (POST /api/verify-payment & POST /api/payment/verify-payment & POST /api/payment/verify-razorpay)
const verifyPaymentHandler = async (req, res) => {
  try {
    const order_id = req.body.razorpay_order_id || req.body.order_id;
    const payment_id = req.body.razorpay_payment_id || req.body.payment_id;
    const razorpay_signature = req.body.razorpay_signature || req.body.signature;

    const {
      plan = "monthly",
      customerName = "CA Student",
      customerEmail = "student@studyledger.com",
    } = req.body;

    // Validate required fields
    if (!order_id || !payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: "Missing required payment authorization fields. Both order_id, payment_id, and razorpay_signature are required.",
      });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return res.status(500).json({
        success: false,
        error: "Server configuration error: RAZORPAY_KEY_SECRET is missing.",
      });
    }

    // Step 3 HMAC-SHA256 Algorithm: HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
    const bodyToSign = `${order_id}|${payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(bodyToSign)
      .digest("hex");

    // Secure timing comparison with length guard
    const expectedBuffer = Buffer.from(expectedSignature, "utf-8");
    const receivedBuffer = Buffer.from(razorpay_signature, "utf-8");

    const isSignatureValid =
      expectedBuffer.length === receivedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, receivedBuffer);

    if (!isSignatureValid) {
      return res.status(400).json({
        success: false,
        status: "failure",
        error: "Payment verification failed. Cryptographic signature mismatch. Account was NOT credited.",
      });
    }

    // Payment successfully verified! Activate user license
    const amountInRupees = plan === "annual" ? 299 : 39;
    const durationDays = plan === "annual" ? 365 : 30;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const txnId = `SL-RZP-${payment_id}`;

    try {
      const paymentRecord = new Payment({
        transactionId: txnId,
        customerName,
        customerEmail: customerEmail.toLowerCase().trim(),
        plan,
        amount: amountInRupees,
        currency: "INR",
        paymentMethod: "Razorpay Standard Checkout",
        razorpayOrderId: order_id,
        razorpayPaymentId: payment_id,
        razorpaySignature: razorpay_signature,
        status: "completed",
        activatedAt: now,
        expiresAt,
      });
      await paymentRecord.save();

      if (customerEmail) {
        await User.findOneAndUpdate(
          { email: customerEmail.toLowerCase().trim() },
          {
            isSubscribed: true,
            subscriptionPlan: plan,
            subscriptionExpiresAt: expiresAt,
            subscriptionTxnId: txnId,
          }
        );
      }
    } catch (dbError) {
      console.warn("Database record write warning:", dbError.message);
    }

    return res.status(200).json({
      success: true,
      status: "success",
      message: "Payment successfully verified and software license activated!",
      payment_id,
      order_id,
      license: {
        transactionId: txnId,
        paymentId: payment_id,
        orderId: order_id,
        plan,
        amount: amountInRupees,
        customerName,
        customerEmail,
        status: "active",
        activatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Signature verification error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error during verification: " + error.message,
    });
  }
};

router.post("/verify-payment", verifyPaymentHandler);
router.post("/verify-razorpay", verifyPaymentHandler);

// 4. DIRECT UPI SUBMISSION FALLBACK (Optional manual backup)
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
    const cleanEmail = customerEmail.toLowerCase().trim();
    const amount = plan === "annual" ? 299 : 39;
    const durationDays = plan === "annual" ? 365 : 30;
    const txnId = "SL-UPI-" + Date.now().toString().slice(-6) + "-" + Math.floor(1000 + Math.random() * 9000);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Save payment record to MongoDB
    try {
      const paymentRecord = new Payment({
        transactionId: txnId,
        customerName,
        customerEmail: cleanEmail,
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

      // Update user subscription
      await User.findOneAndUpdate(
        { email: cleanEmail },
        {
          isSubscribed: true,
          subscriptionPlan: plan,
          subscriptionExpiresAt: expiresAt,
          subscriptionTxnId: txnId,
        }
      );
    } catch (dbErr) {
      console.warn("UPI record write warning:", dbErr.message);
    }

    return res.status(200).json({
      success: true,
      message: "UPI Payment verified successfully!",
      license: {
        transactionId: txnId,
        utr: cleanUtr,
        plan,
        amount,
        customerName,
        customerEmail: cleanEmail,
        status: "active",
        activatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// 5. CHECK LICENSE STATUS
router.get("/status/:email", async (req, res) => {
  try {
    const email = req.params.email.trim().toLowerCase();
    const user = await User.findOne({ email });
    let isSubscribed = false;
    let plan = "monthly";
    let expiresAt = null;
    let transactionId = null;

    if (user && user.isSubscribed) {
      const isExpired = user.subscriptionExpiresAt && new Date() > new Date(user.subscriptionExpiresAt);
      if (!isExpired) {
        isSubscribed = true;
        plan = user.subscriptionPlan || "monthly";
        expiresAt = user.subscriptionExpiresAt;
        transactionId = user.subscriptionTxnId;
      }
    }

    // Cross-check Payment collection for active payments
    if (!isSubscribed) {
      const payment = await Payment.findOne({
        customerEmail: email,
        status: "completed",
      }).sort({ createdAt: -1 });

      if (payment) {
        const paymentActive = !payment.expiresAt || new Date() <= new Date(payment.expiresAt);
        if (paymentActive) {
          isSubscribed = true;
          plan = payment.plan || plan;
          expiresAt = payment.expiresAt;
          transactionId = payment.transactionId;

          // Auto-heal User record
          if (user) {
            user.isSubscribed = true;
            user.subscriptionPlan = plan;
            user.subscriptionExpiresAt = expiresAt;
            user.subscriptionTxnId = transactionId;
            await user.save();
          }
        }
      }
    }

    return res.json({
      isSubscribed,
      plan: isSubscribed ? plan : null,
      expiresAt: isSubscribed ? expiresAt : null,
      transactionId: isSubscribed ? transactionId : null,
      license: isSubscribed ? {
        status: "active",
        plan,
        transactionId: transactionId || ("SL-" + Date.now()),
        expiresAt,
      } : null,
    });
  } catch (error) {
    return res.json({ isSubscribed: false, error: error.message });
  }
});

module.exports = router;
