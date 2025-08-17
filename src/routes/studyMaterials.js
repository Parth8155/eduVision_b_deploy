const express = require("express");
const { body, param, query } = require("express-validator");
const studyMaterialController = require("../controllers/studyMaterialController");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// Validation middleware
const validateCreateStudyMaterial = [
  body("sourceNoteId").isMongoId().withMessage("Invalid source note ID"),
  body("type")
    .isIn(["mcq", "summary", "practice", "flashcards"])
    .withMessage("Invalid study material type"),
  body("generationOptions")
    .optional()
    .isObject()
    .withMessage("Generation options must be an object"),
  body("generationOptions.difficulty")
    .optional()
    .isIn(["easy", "medium", "hard"])
    .withMessage("Invalid difficulty level"),
  body("generationOptions.count")
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage("Count must be between 1 and 50"),
  body("generationOptions.length")
    .optional()
    .isIn(["short", "medium", "long"])
    .withMessage("Invalid summary length"),
  body("generationOptions.format")
    .optional()
    .isIn(["structured", "paragraphs", "bullet-points"])
    .withMessage("Invalid summary format"),
];

const validateUpdateStudyMaterial = [
  body("title")
    .optional()
    .isString()
    .isLength({ min: 1, max: 200 })
    .withMessage("Title must be between 1 and 200 characters"),
  body("folder")
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage("Folder name too long"),
  body("isStarred")
    .optional()
    .isBoolean()
    .withMessage("isStarred must be a boolean"),
  body("metadata")
    .optional()
    .isObject()
    .withMessage("Metadata must be an object"),
];

const validateRecordSession = [
  body("score")
    .isInt({ min: 0, max: 100 })
    .withMessage("Score must be between 0 and 100"),
  body("timeSpent")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Time spent must be non-negative"),
];

const validateId = [
  param("id").isMongoId().withMessage("Invalid study material ID"),
];

const validateQuery = [
  query("type")
    .optional()
    .isIn(["all", "mcq", "summary", "practice", "flashcards"])
    .withMessage("Invalid type filter"),
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be positive"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100"),
  query("sortBy")
    .optional()
    .isIn(["title", "subject", "createdAt", "stats.lastAccessed", "stats.views"])
    .withMessage("Invalid sort field"),
  query("sortOrder")
    .optional()
    .isIn(["asc", "desc"])
    .withMessage("Invalid sort order"),
  query("starred")
    .optional()
    .isBoolean()
    .withMessage("Starred filter must be boolean"),
  query("recent")
    .optional()
    .isBoolean()
    .withMessage("Recent filter must be boolean"),
];

// Apply auth middleware to all routes
router.use(authenticate);

// Create new study material
router.post(
  "/generate",
  validateCreateStudyMaterial,
  studyMaterialController.createStudyMaterial
);

// Get user's study materials with filtering and pagination
router.get(
  "/",
  validateQuery,
  studyMaterialController.getUserStudyMaterials
);

// Get study material statistics
router.get(
  "/stats",
  studyMaterialController.getStudyMaterialStats
);

// Get single study material by ID
router.get(
  "/:id",
  validateId,
  studyMaterialController.getStudyMaterialById
);

// Update study material
router.put(
  "/:id",
  validateId,
  validateUpdateStudyMaterial,
  studyMaterialController.updateStudyMaterial
);

// Toggle star status
router.patch(
  "/:id/star",
  validateId,
  studyMaterialController.toggleStar
);

// Record study session
router.post(
  "/:id/session",
  validateId,
  validateRecordSession,
  studyMaterialController.recordStudySession
);

// Delete study material (soft delete)
router.delete(
  "/:id",
  validateId,
  studyMaterialController.deleteStudyMaterial
);

// Health check endpoint
router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Study materials service is healthy",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
