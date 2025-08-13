const mongoose = require("mongoose");

const noteSchema = new mongoose.Schema(
  {
    // Add user reference
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    folder: {
      type: String,
      default: "General",
    },
    type: {
      type: String,
      enum: ["notes", "summary", "mcq", "practice"],
      default: "notes",
    },

    // 🟢 Store original file as binary
    originalFile: {
      originalName: String,
      mimetype: String,
      size: Number,
      data: Buffer, // PDF binary content
      uploadedAt: {
        type: Date,
        default: Date.now,
      },
    },

    // 🟢 Store OCR processed PDF as binary
    ocrTextPDF: {
      mimetype: String,
      size: Number,
      data: Buffer, // OCRed PDF binary
      pages: Number,
      isOriginal: {
        type: Boolean,
        default: false, // true if this is the original file (already searchable)
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },

    extractedText: {
      type: String,
      default: "",
    },
    confidence: {
      type: Number,
      min: 0,
      max: 100,
    },
    status: {
      type: String,
      enum: ["uploading", "processing", "completed", "failed"],
      default: "uploading",
    },

    // OCR optimization flags
    skippedOCR: {
      type: Boolean,
      default: false, // true if OCR was skipped because PDF already had text
    },
    originallySearchable: {
      type: Boolean,
      default: false, // true if the original PDF already contained searchable text
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    pages: {
      type: Number,
      default: 0,
    },
    accuracy: {
      type: Number,
      min: 0,
      max: 100,
    },
    starred: {
      type: Boolean,
      default: false,
    },
    views: {
      type: Number,
      default: 0,
    },
    downloads: {
      type: Number,
      default: 0,
    },
    lastAccessed: {
      type: Date,
      default: Date.now,
    },
    lastEdited: {
      type: Date,
    },
    lastAccessMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    uploadDate: {
      type: Date,
      default: Date.now,
    },
    thumbnail: {
      type: String,
      default: "/placeholder.svg?height=120&width=160",
    },
    generatedItems: {
      summaries: {
        type: Number,
        default: 0,
      },
      mcqs: {
        type: Number,
        default: 0,
      },
      questions: {
        type: Number,
        default: 0,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Index for better search performance - include userId
noteSchema.index({ userId: 1, title: "text", subject: "text", tags: "text" });
noteSchema.index({ userId: 1, subject: 1 });
noteSchema.index({ userId: 1, folder: 1 });
noteSchema.index({ userId: 1, uploadDate: -1 });

// Method to set OCR text PDF as binary
noteSchema.methods.setOCRTextPDF = function (ocrData) {
  this.ocrTextPDF = {
    mimetype: ocrData.mimetype || "application/pdf",
    size: ocrData.size || ocrData.data.length,
    data: ocrData.data, // Buffer containing PDF binary data
    pages: ocrData.pages || 0,
    createdAt: new Date(),
  };
  this.status = "completed";
  return this.save();
};

// Method to check if files exist as binary data
noteSchema.methods.hasFiles = function () {
  return {
    originalFile: !!(this.originalFile && this.originalFile.data),
    ocrTextPDF: !!(this.ocrTextPDF && this.ocrTextPDF.data),
  };
};

// Method to get file info without binary data
noteSchema.methods.getFileInfo = function () {
  return {
    originalFile: this.originalFile
      ? {
          originalName: this.originalFile.originalName,
          mimetype: this.originalFile.mimetype,
          size: this.originalFile.size,
          uploadedAt: this.originalFile.uploadedAt,
        }
      : null,
    ocrTextPDF: this.ocrTextPDF
      ? {
          mimetype: this.ocrTextPDF.mimetype,
          size: this.ocrTextPDF.size,
          pages: this.ocrTextPDF.pages,
          createdAt: this.ocrTextPDF.createdAt,
        }
      : null,
  };
};

module.exports = mongoose.model("Note", noteSchema);
