const express = require("express");
const StudyData = require("../models/StudyData");
const authMiddleware = require("../middleware/authMiddleware");
const requireSubscription = require("../middleware/requireSubscription");

const router = express.Router();

// GET logged-in user's study data (requires active subscription)
router.get("/", authMiddleware, requireSubscription, async (req, res) => {
  try {
    let studyData = await StudyData.findOne({
      userId: req.userId,
    });

    // If user has no data yet
    if (!studyData) {
      studyData = await StudyData.create({
        userId: req.userId,
        data: {},
      });
    }

    res.status(200).json({
      data: studyData.data,
    });
  } catch (error) {
    console.error("Error loading study data:", error);

    res.status(500).json({
      message: "Error loading study data",
    });
  }
});

// SAVE / UPDATE logged-in user's study data (requires active subscription)
router.put("/", authMiddleware, requireSubscription, async (req, res) => {
  try {
    const { data } = req.body;

    if (!data) {
      return res.status(400).json({
        message: "Study data is required",
      });
    }

    const studyData = await StudyData.findOneAndUpdate(
      {
        userId: req.userId,
      },
      {
        data,
      },
      {
        new: true,
        upsert: true,
      }
    );

    res.status(200).json({
      message: "Study data saved successfully",
      data: studyData.data,
    });
  } catch (error) {
    console.error("Error saving study data:", error);

    res.status(500).json({
      message: "Error saving study data",
    });
  }
});

module.exports = router;