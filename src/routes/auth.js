const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { authenticate } = require("../middleware/auth");
const {
  validateRegistration,
  validateLogin,
  sanitizeInput,
  validateRateLimit,
} = require("../middleware/validation");

// Rate limiting for auth routes
const authRateLimit = validateRateLimit(5, 15 * 60 * 1000); // 5 attempts per 15 minutes

// Public routes
router.post(
  "/register",
  authRateLimit,
  sanitizeInput,
  validateRegistration,
  authController.register
);

router.post(
  "/login",
  authRateLimit,
  sanitizeInput,
  validateLogin,
  authController.login
);

router.post("/refresh-token", authController.refreshToken);

// Forgot password routes
router.post(
  "/forgot-password",
  authRateLimit,
  sanitizeInput,
  authController.forgotPassword
);

router.post(
  "/reset-password",
  authRateLimit,
  sanitizeInput,
  authController.resetPassword
);

// Protected routes
router.post("/logout", authenticate, authController.logout);
router.get("/profile", authenticate, authController.getProfile);
router.get("/stats", authenticate, authController.getStats);

module.exports = router;
