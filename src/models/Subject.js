const mongoose = require("mongoose");

const subjectSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    }
  },
  {
    timestamps: true,
  }
);

// Compound index to ensure unique subject names per user
subjectSchema.index({ userId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Subject", subjectSchema);
