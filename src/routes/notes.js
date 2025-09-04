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

// Validation middleware for creating folders
const validateFolder = [
  body("name")
    .notEmpty()
    .withMessage("Folder name is required")
    .isLength({ min: 1, max: 100 })
    .withMessage("Folder name must be between 1 and 100 characters")
    .trim(),
  body("subject")
    .notEmpty()
    .withMessage("Subject is required for folder creation")
    .isLength({ min: 1, max: 100 })
    .withMessage("Subject name must be between 1 and 100 characters")
    .trim()
];

// Add authentication to all note routes
router.use(authenticate);

// Get user's notes with filters
router.get("/", notesController.getUserNotes);
router.get("/subjects", notesController.getUserSubjects);
router.get("/folders", notesController.getUserFolders);

// Create new subject
router.post("/subjects", validateSubject, notesController.createSubject);
// Create new folder
router.post("/folders", validateFolder, notesController.createFolder);

router.get("/:id", notesController.getNoteById);
router.put("/:id", notesController.updateNote);
router.delete("/:id", notesController.deleteNote);
router.post("/:id/access", notesController.trackNoteAccess);

module.exports = router;
