const mongoose = require("mongoose");

const StudyMaterialSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sourceNoteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Note",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["mcq", "summary", "practice", "flashcards"],
      required: true,
      index: true,
    },
    // New hierarchical organization fields
    branch: {
      type: String,
      required: false,
      index: true,
    },
    semester: {
      type: String,
      required: false,
      index: true,
    },
    subject: {
      type: String,
      required: true,
      index: true,
    },
    noteType: {
      type: String,
      required: false,
      index: true,
    },
    content: {
      // For MCQs: Array of question objects
      // For Summaries: Summary object with content, keyPoints, etc.
      // For Practice: Array of practice questions
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    metadata: {
      difficulty: {
        type: String,
        enum: ["easy", "medium", "hard"],
        default: "medium",
      },
      questionCount: {
        type: Number,
        default: 0,
      },
      estimatedTime: {
        type: String, // e.g., "15 min"
        default: "10 min",
      },
      tags: [String],
      format: String, // For summaries: "structured", "paragraphs", "bullet-points"
      language: {
        type: String,
        default: "en",
      },
    },
    generationSettings: {
      aiModel: {
        type: String,
        default: "deepseek/deepseek-r1:free",
      },
      prompt: String,
      parameters: {
        temperature: Number,
        maxTokens: Number,
        count: Number,
      },
    },
    stats: {
      views: {
        type: Number,
        default: 0,
      },
      lastAccessed: {
        type: Date,
        default: Date.now,
      },
      completionRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      averageScore: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      timesCompleted: {
        type: Number,
        default: 0,
      },
    },
    status: {
      type: String,
      enum: ["draft", "active", "archived"],
      default: "active",
    },
    isStarred: {
      type: Boolean,
      default: false,
    },
    shareSettings: {
      isPublic: {
        type: Boolean,
        default: false,
      },
      allowCopy: {
        type: Boolean,
        default: false,
      },
      sharedWith: [
        {
          userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
          },
          permission: {
            type: String,
            enum: ["view", "edit"],
            default: "view",
          },
        },
      ],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better performance
StudyMaterialSchema.index({ userId: 1, type: 1 });
StudyMaterialSchema.index({ userId: 1, branch: 1 });
StudyMaterialSchema.index({ userId: 1, semester: 1 });
StudyMaterialSchema.index({ userId: 1, subject: 1 });
StudyMaterialSchema.index({ userId: 1, noteType: 1 });
StudyMaterialSchema.index({ userId: 1, createdAt: -1 });
StudyMaterialSchema.index({ userId: 1, "stats.lastAccessed": -1 });
StudyMaterialSchema.index({ sourceNoteId: 1 });

// Virtual for source note details
StudyMaterialSchema.virtual("sourceNote", {
  ref: "Note",
  localField: "sourceNoteId",
  foreignField: "_id",
  justOne: true,
});

// Methods
StudyMaterialSchema.methods.updateStats = function (viewsIncrement = 0, scoreUpdate = null) {
  if (viewsIncrement > 0) {
    this.stats.views += viewsIncrement;
    this.stats.lastAccessed = new Date();
  }
  
  if (scoreUpdate !== null) {
    // Update average score
    const totalSessions = this.stats.timesCompleted + 1;
    const currentAverage = this.stats.averageScore || 0;
    const newAverage = ((currentAverage * this.stats.timesCompleted) + scoreUpdate) / totalSessions;
    
    this.stats.averageScore = Math.round(newAverage);
    this.stats.timesCompleted = totalSessions;
    
    // Update completion rate based on score
    if (scoreUpdate >= 70) {
      this.stats.completionRate = Math.min(this.stats.completionRate + 10, 100);
    }
  }
  
  return this.save();
};

StudyMaterialSchema.methods.toggleStar = function () {
  this.isStarred = !this.isStarred;
  return this.save();
};

// Static methods
StudyMaterialSchema.statics.getByUserAndType = function (userId, type, options = {}) {
  const query = { userId, status: { $ne: "archived" } };
  if (type && type !== "all") {
    query.type = type;
  }
  
  const sort = options.sortBy === "title" ? { title: options.sortOrder === "desc" ? -1 : 1 }
    : options.sortBy === "subject" ? { subject: options.sortOrder === "desc" ? -1 : 1 }
    : { createdAt: options.sortOrder === "desc" ? -1 : 1 };
  
  return this.find(query)
    .sort(sort)
    .populate("sourceNoteId", "title subject")
    .limit(options.limit || 50)
    .skip(options.offset || 0);
};

StudyMaterialSchema.statics.getStarred = function (userId) {
  return this.find({ userId, isStarred: true, status: { $ne: "archived" } })
    .sort({ "stats.lastAccessed": -1 })
    .populate("sourceNoteId", "title subject");
};

StudyMaterialSchema.statics.getRecent = function (userId, days = 7) {
  const dateThreshold = new Date();
  dateThreshold.setDate(dateThreshold.getDate() - days);
  
  return this.find({
    userId,
    status: { $ne: "archived" },
    "stats.lastAccessed": { $gte: dateThreshold },
  })
    .sort({ "stats.lastAccessed": -1 })
    .populate("sourceNoteId", "title subject");
};

StudyMaterialSchema.statics.getSubjectCounts = function (userId) {
  return this.aggregate([
    { $match: { userId: mongoose.Types.ObjectId(userId), status: { $ne: "archived" } } },
    { $group: { _id: "$subject", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
};

StudyMaterialSchema.statics.getTypeCounts = function (userId) {
  return this.aggregate([
    { $match: { userId: mongoose.Types.ObjectId(userId), status: { $ne: "archived" } } },
    { $group: { _id: "$type", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
};

module.exports = mongoose.model("StudyMaterial", StudyMaterialSchema);
