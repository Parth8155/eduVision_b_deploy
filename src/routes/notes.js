const express = require("express");
const router = express.Router();
const notesController = require("../controllers/notesController");
const { authenticate } = require("../middleware/auth");

// Add authentication to all note routes
router.use(authenticate);

// Get user's notes with filters
router.get("/", notesController.getUserNotes);
router.get("/subjects", notesController.getUserSubjects);
router.get("/folders", notesController.getUserFolders);
router.get("/:id", notesController.getNoteById);
router.put("/:id", notesController.updateNote);
router.delete("/:id", notesController.deleteNote);
router.post("/:id/access", notesController.trackNoteAccess);

module.exports = router;
