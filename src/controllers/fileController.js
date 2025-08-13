const Note = require("../models/Note");
const { sendError } = require("../utils/responseUtils");

const fileController = {
  // Serve PDF file from database binary data with authentication
  servePdfFile: async (req, res) => {
    try {
      const { noteId } = req.params;
      const userId = req.user._id;

      // Find the note and verify ownership
      const note = await Note.findOne({ _id: noteId, userId });

      if (!note) {
        return sendError(res, "Note not found or access denied", 404);
      }

      let pdfData = null;
      let fileName = null;
      let fileSize = 0;

      // Determine which PDF file to serve (prioritize OCR-processed PDF)
      if (note.ocrTextPDF && note.ocrTextPDF.data) {
        pdfData = note.ocrTextPDF.data;
        fileName = `${note.title}_ocr.pdf`;
        fileSize = note.ocrTextPDF.size || pdfData.length;
        console.log(
          `Serving OCR PDF for note ${noteId}: ${fileName} (${fileSize} bytes)`
        );
      } else if (note.originalFile && note.originalFile.data) {
        pdfData = note.originalFile.data;
        fileName = note.originalFile.originalName || `${note.title}.pdf`;
        fileSize = note.originalFile.size || pdfData.length;
        console.log(
          `Serving original PDF for note ${noteId}: ${fileName} (${fileSize} bytes)`
        );
      } else {
        console.error(`No PDF data found for note ${noteId}`);
        return sendError(res, "No PDF file found for this note", 404);
      }

      // Ensure we have valid PDF data
      if (!pdfData || !Buffer.isBuffer(pdfData)) {
        console.error(`Invalid PDF data for note ${noteId}`);
        return sendError(res, "Invalid PDF data", 500);
      }

      // Set appropriate headers for optimal PDF text layer support
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", fileSize);
      res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
      res.setHeader("Cache-Control", "private, max-age=3600"); // Cache for 1 hour
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Accept-Ranges", "bytes");
      // Additional headers for PDF text layer support
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("X-PDF-Text-Layer", "enabled"); // Custom header to indicate OCR support
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Range, Authorization");

      // Handle range requests for better PDF viewing
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;

        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
        res.setHeader("Content-Length", chunksize);

        // Send the requested byte range
        const chunk = pdfData.slice(start, end + 1);
        res.end(chunk);
      } else {
        // Serve the entire file
        res.end(pdfData);
      }

      // Track file access asynchronously
      Note.findByIdAndUpdate(noteId, {
        $inc: { views: 1 },
        lastAccessed: new Date(),
      }).catch((error) => {
        console.error("Error updating file access stats:", error);
      });
    } catch (error) {
      console.error("Error serving PDF file:", error);
      sendError(res, "Failed to serve PDF file");
    }
  },

  // Get PDF file info without serving the actual file
  getPdfFileInfo: async (req, res) => {
    try {
      const { noteId } = req.params;
      const userId = req.user._id;

      const note = await Note.findOne({ _id: noteId, userId }).select(
        "-originalFile.data -ocrTextPDF.data"
      );

      if (!note) {
        return sendError(res, "Note not found or access denied", 404);
      }

      let fileInfo = null;

      if (note.ocrTextPDF && note.ocrTextPDF.size) {
        fileInfo = {
          type: "ocr",
          filename: `${note.title}_ocr.pdf`,
          size: note.ocrTextPDF.size,
          pages: note.ocrTextPDF.pages,
          url: `/api/files/pdf/${noteId}`,
          createdAt: note.ocrTextPDF.createdAt,
        };
      } else if (note.originalFile && note.originalFile.size) {
        fileInfo = {
          type: "original",
          filename: note.originalFile.originalName,
          size: note.originalFile.size,
          pages: note.pages || 0,
          url: `/api/files/pdf/${noteId}`,
          uploadedAt: note.originalFile.uploadedAt,
        };
      }

      if (!fileInfo) {
        return sendError(res, "No PDF file found for this note", 404);
      }

      res.json({
        success: true,
        data: { fileInfo },
      });
    } catch (error) {
      console.error("Error getting PDF file info:", error);
      sendError(res, "Failed to get PDF file info");
    }
  },
};

module.exports = fileController;
