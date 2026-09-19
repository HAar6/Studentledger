const User = require("../models/User");
const Payment = require("../models/Payment");

const requireSubscription = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    let isSubscribed = Boolean(user.isSubscribed);
    if (isSubscribed && user.subscriptionExpiresAt && new Date() > new Date(user.subscriptionExpiresAt)) {
      isSubscribed = false;
    }

    // Cross-check Payment collection as auto-heal fallback
    if (!isSubscribed) {
      const payment = await Payment.findOne({
        customerEmail: user.email.toLowerCase().trim(),
        status: "completed",
      }).sort({ createdAt: -1 });

      if (payment && (!payment.expiresAt || new Date() <= new Date(payment.expiresAt))) {
        isSubscribed = true;
        user.isSubscribed = true;
        user.subscriptionPlan = payment.plan;
        user.subscriptionExpiresAt = payment.expiresAt;
        user.subscriptionTxnId = payment.transactionId;
        await user.save();
      }
    }

    if (!isSubscribed) {
      return res.status(403).json({
        success: false,
        error: "SubscriptionRequired",
        message: "Active software license required to access Study Ledger cloud sync.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(500).json({ message: "Subscription check error: " + error.message });
  }
};

module.exports = requireSubscription;
