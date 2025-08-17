const express = require("express");
const { body, param, query } = require("express-validator");
const chatController = require("../controllers/chatController");
const { authenticate } = require("../middleware/auth");
const rateLimit = require("express-rate-limit");

const router = express.Router();

// Rate limiting for chat endpoints
const chatRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: {
    success: false,
    message: "Too many chat requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const messageRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 messages per minute
  message: {
    success: false,
    message: "Too many messages. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation middleware
const validateNoteId = [
  param("noteId").isMongoId().withMessage("Invalid note ID"),
];

const validateConversationId = [
  param("conversationId").isMongoId().withMessage("Invalid conversation ID"),
];

const validateMessage = [
  body("noteId").isMongoId().withMessage("Invalid note ID"),
  body("message")
    .trim()
    .isLength({ min: 1, max: 2000 })
    .withMessage("Message must be between 1 and 2000 characters"),
  body("context")
    .optional()
    .isObject()
    .withMessage("Context must be an object"),
];

const validateSettings = [
  body("temperature")
    .optional()
    .isFloat({ min: 0, max: 2 })
    .withMessage("Temperature must be between 0 and 2"),
  body("maxTokens")
    .optional()
    .isInt({ min: 50, max: 4000 })
    .withMessage("Max tokens must be between 50 and 4000"),
  body("contextWindow")
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage("Context window must be between 1 and 50"),
];

const validateQuestionGeneration = [
  body("questionType")
    .optional()
    .isIn(["multiple-choice", "short-answer", "essay", "mixed"])
    .withMessage("Invalid question type"),
  body("difficulty")
    .optional()
    .isIn(["easy", "medium", "hard"])
    .withMessage("Invalid difficulty level"),
  body("count")
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage("Question count must be between 1 and 20"),
];

// Apply auth middleware to all routes
router.use(authenticate);

// Apply general rate limiting
router.use(chatRateLimit);

// Get or create conversation for a note
router.get(
  "/conversation/:noteId",
  validateNoteId,
  chatController.getOrCreateConversation
);

// Get all conversations for a specific note
router.get(
  "/conversations/note/:noteId",
  validateNoteId,
  chatController.getConversationsForNote
);

// Create a new conversation for a note
router.post(
  "/conversation/new",
  [body("noteId").isMongoId().withMessage("Invalid note ID")],
  chatController.createNewConversation
);

// Send message in conversation
router.post(
  "/message",
  messageRateLimit,
  validateMessage,
  chatController.sendMessage
);

// Get conversation history
router.get(
  "/history/:conversationId",
  validateConversationId,
  [
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("Limit must be between 1 and 100"),
    query("offset")
      .optional()
      .isInt({ min: 0 })
      .withMessage("Offset must be non-negative"),
  ],
  chatController.getConversationHistory
);

// Get user's conversations
router.get(
  "/conversations",
  [
    query("limit")
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage("Limit must be between 1 and 50"),
  ],
  chatController.getUserConversations
);

// Update conversation settings
router.put(
  "/settings/:conversationId",
  validateConversationId,
  validateSettings,
  chatController.updateConversationSettings
);

// Delete conversation
router.delete(
  "/conversation/:conversationId",
  validateConversationId,
  chatController.deleteConversation
);

// Generate study questions
router.post(
  "/study-questions/:noteId",
  validateNoteId,
  validateQuestionGeneration,
  chatController.generateStudyQuestions
);

// Generate summary
router.post(
  "/generate-summary/:noteId",
  validateNoteId,
  [
    body("length")
      .optional()
      .isIn(["short", "medium", "long"])
      .withMessage("Invalid summary length"),
    body("format")
      .optional()
      .isIn(["structured", "paragraphs", "bullet-points"])
      .withMessage("Invalid summary format"),
  ],
  chatController.generateSummary
);

// Get conversation starters
router.get(
  "/conversation-starters/:noteId",
  validateNoteId,
  chatController.getConversationStarters
);

// Health check endpoint
router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Chat service is healthy",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
