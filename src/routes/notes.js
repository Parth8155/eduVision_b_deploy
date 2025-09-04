const express = require("express");
const router = express.Router();
const { body } = require("express-validator");
const notesController = require("../controllers/notesController");
const { authenticate } = require("../middleware/auth");

// Validation middleware for creating subjects
const validateSubject = [
  body("name")
    .notEmpty()
    .withMessage("Subject name is required")
    .isLength({ min: 1, max: 100 })
    .withMessage("Subject name must be between 1 and 100 characters")
    .trim()
];

// Add authentication to all note routes
router.use(authenticate);

// Get user's notes with filters
router.get("/", notesController.getUserNotes);
router.get("/subjects", notesController.getUserSubjects);

// Create new subject
router.post("/subjects", validateSubject, notesController.createSubject);

router.get("/:id", notesController.getNoteById);
router.put("/:id", notesController.updateNote);
router.delete("/:id", notesController.deleteNote);
router.post("/:id/access", notesController.trackNoteAccess);

module.exports = router;
