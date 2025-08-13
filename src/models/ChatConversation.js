const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["user", "assistant", "system"],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  // For storing references to note content that was used in the response
  noteReferences: [
    {
      noteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Note",
      },
      pageNumber: Number,
      excerpt: String,
    },
  ],
});

const chatConversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    noteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Note",
      required: true,
    },
    title: {
      type: String,
      default: "New Conversation",
    },
    messages: [messageSchema],
    isActive: {
      type: Boolean,
      default: true,
    },
    // Cached note content to avoid repeated database lookups
    noteContext: {
      title: String,
      subject: String,
      description: String,
      extractedText: String, // Processed and formatted note content
      lastUpdated: {
        type: Date,
        default: Date.now,
      },
    },
    // Settings for the conversation
    settings: {
      model: {
        type: String,
        default: "deepseek/deepseek-r1:free",
      },
      temperature: {
        type: Number,
        default: 0.7,
        min: 0,
        max: 2,
      },
      maxTokens: {
        type: Number,
        default: 1000,
      },
      // Context window - how many previous messages to include
      contextWindow: {
        type: Number,
        default: 10,
      },
    },
    // Metadata
    metadata: {
      totalMessages: {
        type: Number,
        default: 0,
      },
      totalTokensUsed: {
        type: Number,
        default: 0,
      },
      lastActivity: {
        type: Date,
        default: Date.now,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
chatConversationSchema.index({ userId: 1, noteId: 1 });
chatConversationSchema.index({ userId: 1, "metadata.lastActivity": -1 });

// Update metadata before saving
chatConversationSchema.pre("save", function (next) {
  this.metadata.totalMessages = this.messages.length;
  this.metadata.lastActivity = new Date();
  next();
});

// Instance methods
chatConversationSchema.methods.addMessage = function (
  role,
  content,
  noteReferences = []
) {
  this.messages.push({
    role,
    content,
    noteReferences,
  });
  return this.save();
};

chatConversationSchema.methods.getRecentMessages = function (limit = null) {
  const contextLimit = limit || this.settings.contextWindow;
  return this.messages.slice(-contextLimit);
};

chatConversationSchema.methods.updateTitle = function (title) {
  this.title = title;
  return this.save();
};

// Static methods
chatConversationSchema.statics.findByUserAndNote = function (userId, noteId) {
  return this.findOne({ userId, noteId, isActive: true });
};

chatConversationSchema.statics.findUserConversations = function (
  userId,
  limit = 20
) {
  return this.find({ userId, isActive: true })
    .sort({ "metadata.lastActivity": -1 })
    .limit(limit)
    .populate("noteId", "title subject")
    .select("title metadata.lastActivity noteId");
};

module.exports = mongoose.model("ChatConversation", chatConversationSchema);
