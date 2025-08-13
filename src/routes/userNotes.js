const express = require("express");
const router = express.Router();
const userNotesController = require("../controllers/userNotesController");
const { authenticate } = require("../middleware/auth");

// Add authentication to all user note routes
router.use(authenticate);

// User notes routes
router.get("/:noteId/page/:pageNumber", userNotesController.getNotesForPage);
router.get("/:noteId", userNotesController.getAllNotesForNote);
router.get("/:noteId/search", userNotesController.searchNotes);
router.post("/", userNotesController.createNote);
router.put("/:noteId", userNotesController.updateNote);
router.delete("/:noteId", userNotesController.deleteNote);

module.exports = router;
