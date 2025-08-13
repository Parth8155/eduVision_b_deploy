const express = require("express");
const router = express.Router();
const fileController = require("../controllers/fileController");
const { authenticate } = require("../middleware/auth");

// Add authentication to all file routes
router.use(authenticate);

// Serve PDF file directly from database
router.get("/pdf/:noteId", fileController.servePdfFile);

// Get PDF file info
router.get("/pdf/:noteId/info", fileController.getPdfFileInfo);

module.exports = router;
