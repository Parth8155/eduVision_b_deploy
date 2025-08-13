const mongoose = require("mongoose");

const userNoteSchema = new mongoose.Schema(
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
    pageNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxLength: 200,
    },
    content: {
      type: String,
      required: true,
      maxLength: 2000,
    },
    color: {
      type: String,
      default: "#fbbf24",
      validate: {
        validator: function (v) {
          return /^#[0-9A-F]{6}$/i.test(v);
        },
        message: "Color must be a valid hex color code",
      },
    },
    tags: [
      {
        type: String,
        trim: true,
        maxLength: 50,
      },
    ],
    position: {
      x: {
        type: Number,
        default: 0,
      },
      y: {
        type: Number,
        default: 0,
      },
    },
    selectedText: {
      type: String,
      maxLength: 500,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient querying
userNoteSchema.index({ userId: 1, noteId: 1, pageNumber: 1 });
userNoteSchema.index({ userId: 1, noteId: 1 });
userNoteSchema.index({ createdAt: -1 });

// Instance method to format response
userNoteSchema.methods.toSafeObject = function () {
  return {
    _id: this._id,
    userId: this.userId,
    noteId: this.noteId,
    pageNumber: this.pageNumber,
    title: this.title,
    content: this.content,
    color: this.color,
    tags: this.tags,
    position: this.position,
    selectedText: this.selectedText,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model("UserNote", userNoteSchema);
