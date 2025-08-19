const { body, validationResult } = require("express-validator");

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map((error) => error.msg);

    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errorMessages,
      fields: errors.array().reduce((acc, error) => {
        acc[error.param] = error.msg;
        return acc;
      }, {}),
    });
  }
  next();
};

const validateRegistration = [
  body("firstName")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("First name must be between 2 and 50 characters")
    .matches(/^[a-zA-Z\s\-']+$/)
    .withMessage(
      "First name can only contain letters, spaces, hyphens, and apostrophes"
    ),

  body("lastName")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("Last name must be between 2 and 50 characters")
    .matches(/^[a-zA-Z\s\-']+$/)
    .withMessage(
      "Last name can only contain letters, spaces, hyphens, and apostrophes"
    ),

  body("email")
    .trim()
    .isEmail()
    .withMessage("Please enter a valid email address")
    .normalizeEmail()
    .isLength({ max: 255 })
    .withMessage("Email address is too long"),

  body("password")
    .isLength({ min: 6, max: 128 })
    .withMessage("Password must be between 6 and 128 characters")
    .matches(/(?=.*[a-z])/)
    .withMessage("Password must contain at least one lowercase letter")
    .matches(/(?=.*[A-Z])/)
    .withMessage("Password must contain at least one uppercase letter")
    .matches(/(?=.*\d)/)
    .withMessage("Password must contain at least one number"),

  handleValidationErrors,
];

const validateLogin = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("Please enter a valid email address")
    .normalizeEmail(),

  body("password").notEmpty().withMessage("Password is required"),

  handleValidationErrors,
];

// Sanitize input data
const sanitizeInput = (req, res, next) => {
  // Trim all string fields
  for (const key in req.body) {
    if (typeof req.body[key] === "string") {
      req.body[key] = req.body[key].trim();
    }
  }

  // Convert email to lowercase
  if (req.body.email) {
    req.body.email = req.body.email.toLowerCase();
  }

  next();
};

// Rate limiting validation
const validateRateLimit = (maxAttempts = 10, windowMs = 15 * 60 * 1000) => {
  const attempts = new Map();

  return (req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old attempts
    for (const [ip, data] of attempts.entries()) {
      if (data.timestamp < windowStart) {
        attempts.delete(ip);
      }
    }

    // Check current attempts
    const clientAttempts = attempts.get(clientIp);
    if (clientAttempts && clientAttempts.count >= maxAttempts) {
      return res.status(429).json({
        success: false,
        message: "Too many attempts. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
        retryAfter: Math.ceil(
          (clientAttempts.timestamp + windowMs - now) / 1000
        ),
      });
    }

    // Record attempt
    if (clientAttempts) {
      clientAttempts.count += 1;
    } else {
      attempts.set(clientIp, { count: 1, timestamp: now });
    }

    next();
  };
};

const validateNote = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("Title is required")
    .isLength({ min: 1, max: 200 })
    .withMessage("Title must be between 1 and 200 characters"),

  body("subject")
    .trim()
    .notEmpty()
    .withMessage("Subject is required")
    .isLength({ min: 1, max: 100 })
    .withMessage("Subject must be between 1 and 100 characters"),

  body("folder")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Folder name must be less than 100 characters"),

  body("tags").optional().isArray().withMessage("Tags must be an array"),

  body("tags.*")
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage("Each tag must be less than 50 characters"),
];

const validatePasswordReset = [
  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Please provide a valid email address"),

  handleValidationErrors,
];

module.exports = {
  validateRegistration,
  validateLogin,
  validateNote,
  validatePasswordReset,
  handleValidationErrors,
  sanitizeInput,
  validateRateLimit,
};
