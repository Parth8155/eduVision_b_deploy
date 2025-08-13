const Note = require("../models/Note");
const User = require("../models/User");
const ocrService = require("../services/ocrService");
const { sendSuccess, sendError } = require("../utils/responseUtils");
const path = require("path");
const fs = require("fs").promises; // Use promises version for async/await

const uploadController = {
  // Upload single file (flexible field names)
  uploadSingle: async (req, res) => {
    try {
      console.log("Single upload controller called");
      console.log("req.file:", req.file);
      console.log("req.files:", req.files);

      // Check if we have a file (either in req.file or req.files)
      const file = req.file || (req.files && req.files[0]);

      if (!file) {
        return sendError(res, "No file uploaded", 400);
      }

      const fileInfo = {
        fieldName: file.fieldname,
        originalName: file.originalname,
        filename: file.filename,
        path: file.path,
        mimetype: file.mimetype,
        size: file.size,
      };

      sendSuccess(res, "File uploaded successfully", { file: fileInfo });
    } catch (error) {
      console.error("Upload error:", error);
      sendError(res, "Failed to upload file");
    }
  },

  // Upload multiple files (flexible field names)
  uploadMultiple: async (req, res) => {
    try {
      console.log("Multiple upload controller called");
      console.log("req.files:", req.files);

      if (!req.files || req.files.length === 0) {
        return sendError(res, "No files uploaded", 400);
      }

      const files = req.files.map((file) => ({
        fieldName: file.fieldname,
        originalName: file.originalname,
        filename: file.filename,
        path: file.path,
        mimetype: file.mimetype,
        size: file.size,
      }));

      sendSuccess(res, "Files uploaded successfully", { files });
    } catch (error) {
      console.error("Upload error:", error);
      sendError(res, "Failed to upload files");
    }
  },

  // Flexible upload - accepts any field name
  uploadFlexible: async (req, res) => {
    try {
      console.log("Flexible upload controller called");
      console.log("req.files:", req.files);

      if (!req.files || req.files.length === 0) {
        return sendError(res, "No files uploaded", 400);
      }

      const files = req.files.map((file) => ({
        fieldName: file.fieldname,
        originalName: file.originalname,
        filename: file.filename,
        path: file.path,
        mimetype: file.mimetype,
        size: file.size,
      }));

      const isSingle = files.length === 1;
      const responseData = isSingle ? { file: files[0] } : { files };
      const message = isSingle
        ? "File uploaded successfully"
        : "Files uploaded successfully";

      sendSuccess(res, message, responseData);
    } catch (error) {
      console.error("Upload error:", error);
      sendError(res, "Failed to upload files");
    }
  },

  // Combined upload and create note
  uploadAndCreateNote: async (req, res) => {
    try {
      console.log("Combined upload and create note called");
      console.log("User:", req.user ? req.user._id : "No user");
      console.log("req.files:", req.files);
      console.log("req.body:", req.body);

      // Check if user is authenticated
      if (!req.user) {
        return sendError(res, "Authentication required", 401);
      }

      // Check if files exist and are in array format
      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        console.log("No files found in request");
        return sendError(res, "No files uploaded", 400);
      }

      // Check user's upload limit
      const user = await User.findById(req.user._id);
      if (!user) {
        return sendError(res, "User not found", 404);
      }

      // Check if user has reached their upload limit
      if (user.usage.notesUploaded >= user.usage.notesLimit) {
        return sendError(
          res,
          `Upload limit reached. You can upload up to ${user.usage.notesLimit} notes on your ${user.subscription.plan} plan.`,
          403
        );
      }

      // Extract text fields from req.body, with fallback defaults
      const title = req.body.title || req.body.Title || "";
      const subject = req.body.subject || req.body.Subject || "";
      const folder = req.body.folder || req.body.Folder || "General";
      const tags = req.body.tags || req.body.Tags || "";

      console.log("Extracted fields:", { title, subject, folder, tags });

      // If no title/subject provided, generate from filename
      let finalTitle = title.trim();
      let finalSubject = subject.trim();

      if (!finalTitle) {
        // Generate title from first file name
        const firstFile = req.files[0];
        finalTitle = firstFile.originalname.replace(/\.[^/.]+$/, ""); // Remove extension
        console.log("Generated title from filename:", finalTitle);
      }

      if (!finalSubject) {
        // Generate subject from title or use "General"
        finalSubject = "General Notes";
        console.log("Generated subject:", finalSubject);
      }

      // Validate minimum requirements
      if (!finalTitle || finalTitle.length === 0) {
        return sendError(
          res,
          "Title is required or could not be generated from filename",
          400
        );
      }

      // Prepare file data with better error handling
      const files = req.files.map((file) => {
        if (!file.path || !file.filename) {
          throw new Error(`Invalid file data for ${file.originalname}`);
        }
        return {
          originalName: file.originalname,
          filename: file.filename,
          path: file.path,
          mimetype: file.mimetype,
          size: file.size,
        };
      });

      // Process tags
      const tagsArray = tags
        ? tags
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0)
        : [];

      // Create new note with user reference
      // For now, we'll use the first file as the main file
      const firstFile = files[0];

      // Read the original file as binary data
      const originalFileData = await fs.readFile(firstFile.path);

      const note = new Note({
        userId: req.user._id, // Associate note with authenticated user
        title: finalTitle,
        subject: finalSubject,
        folder: folder || "General",
        tags: tagsArray,
        // Store original file as binary data
        originalFile: {
          originalName: firstFile.originalName,
          mimetype: firstFile.mimetype,
          size: firstFile.size,
          data: originalFileData, // Store binary data directly
          uploadedAt: new Date(),
        },
        status: "processing",
        pages: files.length,
        // Initialize generated items counters
        generatedItems: {
          summaries: 0,
          mcqs: 0,
          questions: 0,
        },
      });

      await note.save();
      console.log("Note saved with ID:", note._id, "for user:", req.user._id);

      // Update user's usage statistics
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { "usage.notesUploaded": 1 },
        $addToSet: {
          subjects: {
            name: finalSubject,
            color: getSubjectColor(finalSubject),
          },
        },
      });

      // Update user's folders if new folder
      if (folder && folder !== "General") {
        await User.findByIdAndUpdate(req.user._id, {
          $addToSet: {
            folders: {
              name: folder,
              subject: finalSubject,
            },
          },
        });
      }

      // Start OCR processing (async) - pass note ID and first file path for processing
      processNoteFiles(note._id, firstFile.path).catch((error) => {
        console.error("Background processing error:", error);
      });

      sendSuccess(
        res,
        "Files uploaded and note created successfully",
        {
          note: {
            id: note._id,
            title: note.title,
            subject: note.subject,
            folder: note.folder,
            tags: note.tags,
            status: note.status,
            files: files.length,
            userId: note.userId,
            usage: {
              current: user.usage.notesUploaded + 1,
              limit: user.usage.notesLimit,
              remaining: user.usage.notesLimit - (user.usage.notesUploaded + 1),
            },
          },
        },
        201
      );
    } catch (error) {
      console.error("Upload and create error:", error);
      sendError(
        res,
        `Failed to upload files and create note: ${error.message}`
      );
    }
  },

  // Create note from uploaded files (JSON only)
  createNote: async (req, res) => {
    try {
      const { title, subject, folder, tags, files } = req.body;

      // Create new note
      const note = new Note({
        title,
        subject,
        folder: folder || "General",
        tags: tags || [],
        files: files || [],
        status: "processing",
        pages: files ? files.length : 0,
      });

      await note.save();

      // Start OCR processing (async)
      if (files && files.length > 0) {
        processNoteFiles(note._id, files);
      }

      sendSuccess(res, "Note created successfully", { note }, 201);
    } catch (error) {
      console.error("Create note error:", error);
      sendError(res, "Failed to create note");
    }
  },

  // Download searchable PDF - check ownership
  downloadSearchablePDF: async (req, res) => {
    try {
      const { noteId, filename } = req.params;

      // Find the note and verify ownership
      const note = await Note.findOne({
        _id: noteId,
        userId: req.user._id, // Only allow access to user's own notes
      });

      if (!note) {
        return sendError(res, "Note not found or access denied", 404);
      }

      // Find the searchable PDF in the note's searchablePDFs array
      const pdfInfo = note.searchablePDFs?.find(
        (pdf) => pdf.searchablePDFName === filename
      );
      if (!pdfInfo) {
        return sendError(res, "Searchable PDF not found", 404);
      }

      // Check if file exists
      if (!fs.existsSync(pdfInfo.searchablePDFPath)) {
        return sendError(res, "PDF file not found on disk", 404);
      }

      // Send the file
      res.download(pdfInfo.searchablePDFPath, filename, (err) => {
        if (err) {
          console.error("Download error:", err);
          sendError(res, "Error downloading PDF");
        }
      });
    } catch (error) {
      console.error("Download searchable PDF error:", error);
      sendError(res, "Failed to download searchable PDF");
    }
  },

  // Get searchable PDFs for a note - check ownership
  getSearchablePDFs: async (req, res) => {
    try {
      const { noteId } = req.params;

      const note = await Note.findOne({
        _id: noteId,
        userId: req.user._id,
      }).select("searchablePDFs title");

      if (!note) {
        return sendError(res, "Note not found or access denied", 404);
      }

      const pdfs =
        note.searchablePDFs?.map((pdf) => ({
          originalFile: pdf.originalFile,
          filename: pdf.searchablePDFName,
          downloadUrl: `/api/upload/searchable-pdf/${noteId}/${pdf.searchablePDFName}`,
        })) || [];

      sendSuccess(res, "Searchable PDFs retrieved successfully", {
        noteId,
        title: note.title,
        searchablePDFs: pdfs,
      });
    } catch (error) {
      console.error("Get searchable PDFs error:", error);
      sendError(res, "Failed to retrieve searchable PDFs");
    }
  },

  // Download overlay PDF - check ownership
  downloadOverlayPDF: async (req, res) => {
    try {
      const { noteId, filename } = req.params;

      // Find the note and verify ownership
      const note = await Note.findOne({
        _id: noteId,
        userId: req.user._id,
      });

      if (!note) {
        return sendError(res, "Note not found or access denied", 404);
      }

      // Find the overlay PDF in the note's overlayPDFs array
      const pdfInfo = note.overlayPDFs?.find(
        (pdf) => pdf.overlayPDFName === filename
      );
      if (!pdfInfo) {
        return sendError(res, "Overlay PDF not found", 404);
      }

      // Check if file exists
      if (!fs.existsSync(pdfInfo.overlayPDFPath)) {
        return sendError(res, "PDF file not found on disk", 404);
      }

      // Set headers for PDF download
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

      // Send the file
      const fileStream = fs.createReadStream(pdfInfo.overlayPDFPath);
      fileStream.pipe(res);
    } catch (error) {
      console.error("Download overlay PDF error:", error);
      sendError(res, "Failed to download overlay PDF");
    }
  },

  // Get overlay PDFs for a note - check ownership
  getOverlayPDFs: async (req, res) => {
    try {
      const { noteId } = req.params;

      const note = await Note.findOne({
        _id: noteId,
        userId: req.user._id,
      }).select("overlayPDFs title");

      if (!note) {
        return sendError(res, "Note not found or access denied", 404);
      }

      const pdfs =
        note.overlayPDFs?.map((pdf) => ({
          originalFile: pdf.originalFile,
          filename: pdf.overlayPDFName,
          confidence: pdf.confidence,
          pages: pdf.pages,
          viewUrl: `/api/upload/overlay-pdf/${noteId}/${pdf.overlayPDFName}`,
          downloadUrl: `/api/upload/overlay-pdf/${noteId}/${pdf.overlayPDFName}?download=true`,
        })) || [];

      sendSuccess(res, "Overlay PDFs retrieved successfully", {
        noteId,
        title: note.title,
        overlayPDFs: pdfs,
      });
    } catch (error) {
      console.error("Get overlay PDFs error:", error);
      sendError(res, "Failed to retrieve overlay PDFs");
    }
  },
};

// Helper function to assign colors to subjects
function getSubjectColor(subject) {
  const colors = [
    "#3B82F6",
    "#EF4444",
    "#10B981",
    "#F59E0B",
    "#8B5CF6",
    "#EC4899",
    "#06B6D4",
    "#84CC16",
  ];

  let hash = 0;
  for (let i = 0; i < subject.length; i++) {
    hash = subject.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

// Updated async function to process files with binary storage and overlay PDF generation
async function processNoteFiles(noteId, filePath) {
  try {
    console.log(`Processing note ${noteId} with file: ${filePath}`);

    // Get the note from database
    const note = await Note.findById(noteId);
    if (!note) {
      throw new Error("Note not found");
    }

    // Extract text with automatic overlay PDF generation
    const result = await ocrService.extractTextWithOverlay(
      filePath,
      note.originalFile.mimetype,
      true
    );

    let ocrPDFData = null;

    // Handle different scenarios based on whether OCR was performed
    if (result.skippedOCR && result.originallySearchable) {
      // PDF already had searchable text - use original file as OCR PDF
      console.log("✅ PDF already searchable, using original file as OCR PDF");

      try {
        const originalPDFBuffer = await fs.readFile(filePath);
        ocrPDFData = {
          mimetype: "application/pdf",
          size: originalPDFBuffer.length,
          data: originalPDFBuffer,
          pages: result.pages || 1,
          createdAt: new Date(),
          isOriginal: true, // Flag to indicate this is the original file
        };

        console.log(
          `Original searchable PDF stored as OCR PDF. Size: ${originalPDFBuffer.length} bytes, Pages: ${result.pages}`
        );
      } catch (readError) {
        console.error(`Error reading original PDF: ${readError.message}`);
      }
    } else if (result.overlayPDFPath) {
      // OCR was performed and overlay PDF was generated
      try {
        const overlayPDFBuffer = await fs.readFile(result.overlayPDFPath);
        ocrPDFData = {
          mimetype: "application/pdf",
          size: overlayPDFBuffer.length,
          data: overlayPDFBuffer,
          pages: result.pages || 1,
          createdAt: new Date(),
          isOriginal: false, // Flag to indicate this is OCR-generated
        };

        console.log(
          `OCR overlay PDF read as binary data. Size: ${overlayPDFBuffer.length} bytes, Pages: ${result.pages}`
        );

        // Clean up the temporary overlay PDF file
        try {
          await fs.unlink(result.overlayPDFPath);
          console.log(
            `Cleaned up temporary overlay PDF: ${result.overlayPDFPath}`
          );
        } catch (cleanupError) {
          console.warn(
            `Failed to cleanup temporary file: ${cleanupError.message}`
          );
        }
      } catch (readError) {
        console.error(`Error reading overlay PDF: ${readError.message}`);
      }
    }

    // Update note with extracted text and processed data
    const updateData = {
      extractedText: result.text || "",
      confidence: Math.round(result.confidence || 0),
      status: "completed",
      accuracy: Math.round(result.confidence || 0),
      pages: result.pages || 1,
      // Add flags to track processing type
      skippedOCR: result.skippedOCR || false,
      originallySearchable: result.originallySearchable || false,
    };

    // If we have OCR PDF data, store it as binary
    if (ocrPDFData) {
      updateData.ocrTextPDF = ocrPDFData;
    }

    await Note.findByIdAndUpdate(noteId, updateData);

    // Clean up the original uploaded file after processing
    try {
      await fs.unlink(filePath);
      console.log(`Cleaned up original uploaded file: ${filePath}`);
    } catch (cleanupError) {
      console.warn(`Failed to cleanup original file: ${cleanupError.message}`);
    }

    const processingType = result.skippedOCR
      ? "already searchable"
      : "OCR processed";
    console.log(
      `Note ${noteId} processed successfully (${processingType}). OCR PDF ${
        ocrPDFData ? "stored as binary data" : "not generated"
      }.`
    );
  } catch (error) {
    console.error(`Error processing note ${noteId}:`, error);

    // Mark note as failed
    await Note.findByIdAndUpdate(noteId, {
      status: "failed",
    });

    // Try to clean up the file even on failure
    try {
      await fs.unlink(filePath);
    } catch (cleanupError) {
      console.warn(`Failed to cleanup file on error: ${cleanupError.message}`);
    }
  }
}

module.exports = uploadController;
