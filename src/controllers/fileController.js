const Note = require("../models/Note");
const { sendError } = require("../utils/responseUtils");

const fileController = {
  // Serve PDF file from database binary data with authentication
  servePdfFile: async (req, res) => {
    try {
      const { noteId } = req.params;
      const userId = req.user._id;

      console.log(`📖 Serving PDF for note ${noteId} by user ${userId}`);

      // Find the note and verify ownership
      const note = await Note.findOne({ _id: noteId, userId });

      if (!note) {
        console.error(`Note ${noteId} not found for user ${userId}`);
        return sendError(res, "Note not found or access denied", 404);
      }

      let pdfData = null;
      let fileName = null;
      let fileSize = 0;
      let pdfSource = null;

      // Determine which PDF file to serve (prioritize OCR-processed PDF)
      if (note.ocrTextPDF && note.ocrTextPDF.data) {
        pdfData = note.ocrTextPDF.data;
        fileName = `${note.title}_ocr.pdf`;
        fileSize = note.ocrTextPDF.size || pdfData.length;
        pdfSource = "OCR-processed";
        console.log(`📄 Using OCR-processed PDF (${fileSize} bytes)`);
      } else if (note.originalFile && note.originalFile.data) {
        pdfData = note.originalFile.data;
        fileName = note.originalFile.originalName || `${note.title}.pdf`;
        fileSize = note.originalFile.size || pdfData.length;
        pdfSource = "Original";
        console.log(`📄 Using original PDF (${fileSize} bytes)`);
      } else {
        console.error(`No PDF data found for note ${noteId}`);
        return sendError(res, "No PDF file found for this note", 404);
      }

      // Validate PDF data
      if (!pdfData || !Buffer.isBuffer(pdfData)) {
        console.error(`Invalid PDF data for note ${noteId}: not a buffer`);
        return sendError(res, "Invalid PDF data format", 500);
      }

      // Enhanced PDF validation
      if (pdfData.length < 100) {
        console.error(`Invalid PDF data for note ${noteId}: too small (${pdfData.length} bytes)`);
        return sendError(res, "PDF file is too small or corrupted", 500);
      }

      // Check PDF header
      const header = pdfData.slice(0, 10).toString('ascii');
      if (!header.startsWith('%PDF-')) {
        console.error(`Invalid PDF data for note ${noteId}: invalid header '${header}'`);
        return sendError(res, "Invalid PDF file structure", 500);
      }

      // Check for basic PDF structure
      const pdfString = pdfData.toString('ascii', 0, Math.min(pdfData.length, 1024));
      const hasBasicStructure = /\/Type\s*\/Catalog/.test(pdfString) || 
                                /\/Root/.test(pdfString) ||
                                /startxref/.test(pdfData.toString('ascii', Math.max(0, pdfData.length - 1024)));
      
      if (!hasBasicStructure) {
        console.warn(`PDF for note ${noteId} may be corrupted: missing basic structure`);
        // Don't fail completely, just log warning
      }

      // Set appropriate headers for optimal PDF display
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", fileSize);
      res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("X-PDF-Source", pdfSource);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Range, Authorization");

      // Handle range requests for better PDF viewing
      const range = req.headers.range;
      if (range) {
        console.log(`📦 Handling range request: ${range}`);
        
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        // Validate range
        if (start >= fileSize || end >= fileSize || start > end) {
          res.status(416);
          res.setHeader("Content-Range", `bytes */${fileSize}`);
          return res.end();
        }

        const chunksize = end - start + 1;

        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
        res.setHeader("Content-Length", chunksize);

        // Send the requested byte range
        const chunk = pdfData.slice(start, end + 1);
        console.log(`📤 Sending range ${start}-${end} (${chunksize} bytes)`);
        res.end(chunk);
      } else {
        // Serve the entire file
        console.log(`📤 Sending complete PDF (${fileSize} bytes)`);
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
      
      // Provide more specific error messages
      if (error.message.includes('Cast to ObjectId')) {
        return sendError(res, "Invalid note ID format", 400);
      } else if (error.name === 'CastError') {
        return sendError(res, "Invalid note identifier", 400);
      } else {
        return sendError(res, `Failed to serve PDF file: ${error.message}`, 500);
      }
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
