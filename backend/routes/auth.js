const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Payment = require("../models/Payment");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Helper to determine active subscription from User and Payment records
async function resolveUserSubscription(user, cleanEmail) {
  let isSubscribed = Boolean(user && user.isSubscribed);
  let subscriptionPlan = (user && user.subscriptionPlan) || null;
  let subscriptionExpiresAt = (user && user.subscriptionExpiresAt) || null;
  let subscriptionTxnId = (user && user.subscriptionTxnId) || null;

  // Check if current user record subscription is expired
  if (isSubscribed && subscriptionExpiresAt && new Date() > new Date(subscriptionExpiresAt)) {
    isSubscribed = false;
  }

  // Cross-reference Payment collection for completed, unexpired payments
  try {
    const payment = await Payment.findOne({
      customerEmail: cleanEmail,
      status: "completed",
    }).sort({ createdAt: -1 });

    if (payment) {
      const paymentActive = !payment.expiresAt || new Date() <= new Date(payment.expiresAt);
      if (paymentActive) {
        isSubscribed = true;
        subscriptionPlan = payment.plan || subscriptionPlan || "monthly";
        subscriptionExpiresAt = payment.expiresAt || subscriptionExpiresAt;
        subscriptionTxnId = payment.transactionId || subscriptionTxnId;

        // Auto-heal User record in database if desynchronized
        if (user && (!user.isSubscribed || user.subscriptionPlan !== subscriptionPlan || user.subscriptionTxnId !== subscriptionTxnId)) {
          user.isSubscribed = true;
          user.subscriptionPlan = subscriptionPlan;
          user.subscriptionExpiresAt = subscriptionExpiresAt;
          user.subscriptionTxnId = subscriptionTxnId;
          await user.save();
        }
      }
    }
  } catch (err) {
    console.error("Error cross-referencing Payment collection:", err.message);
  }

  return {
    isSubscribed,
    subscriptionPlan,
    subscriptionExpiresAt,
    subscriptionTxnId,
    license: isSubscribed
      ? {
          status: "active",
          plan: subscriptionPlan || "monthly",
          transactionId: subscriptionTxnId || ("SL-" + Date.now()),
          activatedAt: (user && user.updatedAt) || new Date().toISOString(),
          expiresAt: subscriptionExpiresAt,
        }
      : null,
  };
}

// SIGNUP
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check all fields
    if (!name || !email || !password) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await User.findOne({ email: cleanEmail });

    if (existingUser) {
      return res.status(400).json({
        message: "User already exists",
      });
    }

    // Check if payment was made for this email before signup
    let isSubscribed = false;
    let subscriptionPlan = null;
    let subscriptionExpiresAt = null;
    let subscriptionTxnId = null;

    try {
      const priorPayment = await Payment.findOne({
        customerEmail: cleanEmail,
        status: "completed",
      }).sort({ createdAt: -1 });

      if (priorPayment && (!priorPayment.expiresAt || new Date() <= new Date(priorPayment.expiresAt))) {
        isSubscribed = true;
        subscriptionPlan = priorPayment.plan;
        subscriptionExpiresAt = priorPayment.expiresAt;
        subscriptionTxnId = priorPayment.transactionId;
      }
    } catch (e) {
      console.warn("Could not check prior payment:", e.message);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await User.create({
      name: name.trim(),
      email: cleanEmail,
      password: hashedPassword,
      isSubscribed,
      subscriptionPlan,
      subscriptionExpiresAt,
      subscriptionTxnId,
    });

    // Create JWT token
    const token = jwt.sign(
      {
        userId: user._id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    res.status(201).json({
      message: "User created successfully",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isSubscribed,
        subscriptionPlan,
        subscriptionExpiresAt,
        subscriptionTxnId,
      },
      license: isSubscribed
        ? {
            status: "active",
            plan: subscriptionPlan,
            transactionId: subscriptionTxnId,
            expiresAt: subscriptionExpiresAt,
          }
        : null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Server error",
    });
  }
});

// LOGIN
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Find user (case-insensitive search)
    let user = await User.findOne({ email: cleanEmail });

    if (!user) {
      // Fallback exact regex match
      user = await User.findOne({
        email: { $regex: new RegExp(`^${cleanEmail}$`, "i") },
      });
    }

    if (!user) {
      return res.status(400).json({
        message: "Invalid email or password",
      });
    }

    // Compare password
    const isPasswordCorrect = await bcrypt.compare(
      password,
      user.password
    );

    if (!isPasswordCorrect) {
      return res.status(400).json({
        message: "Invalid email or password",
      });
    }

    // Resolve active subscription & sync with Payment collection
    const subInfo = await resolveUserSubscription(user, cleanEmail);

    // Create token
    const token = jwt.sign(
      {
        userId: user._id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isSubscribed: subInfo.isSubscribed,
        subscriptionPlan: subInfo.subscriptionPlan,
        subscriptionExpiresAt: subInfo.subscriptionExpiresAt,
        subscriptionTxnId: subInfo.subscriptionTxnId,
      },
      license: subInfo.license,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Server error",
    });
  }
});

// GET CURRENT USER PROFILE & LICENSE
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const cleanEmail = user.email.toLowerCase().trim();
    const subInfo = await resolveUserSubscription(user, cleanEmail);

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isSubscribed: subInfo.isSubscribed,
        subscriptionPlan: subInfo.subscriptionPlan,
        subscriptionExpiresAt: subInfo.subscriptionExpiresAt,
        subscriptionTxnId: subInfo.subscriptionTxnId,
      },
      license: subInfo.license,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;