const User = require("../models/User");
const { generateTokens, verifyRefreshToken } = require("../utils/jwt");
const crypto = require("crypto");
const EmailService = require("../services/emailService");

const emailService = new EmailService();

const authController = {
  // Register new user
  register: async (req, res) => {
    try {
      const { firstName, lastName, email, password } = req.body;


      // Validation checks
      const errors = [];

      // Check required fields
      if (!firstName || !firstName.trim()) {
        errors.push("First name is required");
      }
      if (!lastName || !lastName.trim()) {
        errors.push("Last name is required");
      }
      if (!email || !email.trim()) {
        errors.push("Email is required");
      }
      if (!password) {
        errors.push("Password is required");
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (email && !emailRegex.test(email.trim())) {
        errors.push("Please enter a valid email address");
      }

      // Validate password strength
      if (password) {
        if (password.length < 6) {
          errors.push("Password must be at least 6 characters long");
        }
        if (password.length > 128) {
          errors.push("Password must be less than 128 characters");
        }
        if (!/(?=.*[a-z])/.test(password)) {
          errors.push("Password must contain at least one lowercase letter");
        }
        if (!/(?=.*[A-Z])/.test(password)) {
          errors.push("Password must contain at least one uppercase letter");
        }
        if (!/(?=.*\d)/.test(password)) {
          errors.push("Password must contain at least one number");
        }
      }

      // Validate name length
      if (firstName && firstName.trim().length > 50) {
        errors.push("First name must be less than 50 characters");
      }
      if (lastName && lastName.trim().length > 50) {
        errors.push("Last name must be less than 50 characters");
      }

      // Validate name characters (only letters, spaces, hyphens, apostrophes)
      const nameRegex = /^[a-zA-Z\s\-']+$/;
      if (firstName && firstName.trim() && !nameRegex.test(firstName.trim())) {
        errors.push(
          "First name can only contain letters, spaces, hyphens, and apostrophes"
        );
      }
      if (lastName && lastName.trim() && !nameRegex.test(lastName.trim())) {
        errors.push(
          "Last name can only contain letters, spaces, hyphens, and apostrophes"
        );
      }

      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors,
        });
      }

      // Check if user already exists
      const existingUser = await User.findByEmail(email.trim().toLowerCase());
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message:
            "An account with this email address already exists. Please try logging in instead.",
          code: "USER_EXISTS",
        });
      }

      // Create new user
      const user = new User({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.toLowerCase().trim(),
        password,
        subscription: {
          plan: "free",
          status: "active",
          startDate: new Date(),
        },
        usage: {
          notesUploaded: 0,
          notesLimit: 10, // Free plan limit
          questionsGenerated: 0,
          summariesGenerated: 0,
        },
      });

      await user.save();

      // Generate tokens
      const { accessToken, refreshToken } = generateTokens({
        userId: user._id,
        email: user.email,
        role: user.role,
      });

      // Save refresh token to user
      user.refreshTokens.push({
        token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        userAgent: req.headers["user-agent"],
        ipAddress: req.ip,
      });
      await user.save();

      // Set refresh token as httpOnly cookie
      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });


      res.status(201).json({
        success: true,
        message: "Account created successfully! Welcome to StudyAI.",
        data: {
          user: user.getPublicProfile(),
          accessToken,
        },
      });
    } catch (error) {
      console.error("Registration error:", error);

      // Handle specific MongoDB errors
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        const fieldMessages = {
          email: "An account with this email address already exists",
        };
        return res.status(409).json({
          success: false,
          message: fieldMessages[field] || "This information is already in use",
          code: "DUPLICATE_ENTRY",
        });
      }

      if (error.name === "ValidationError") {
        const messages = Object.values(error.errors).map((err) => err.message);
        return res.status(400).json({
          success: false,
          message: "Please check your information and try again",
          errors: messages,
        });
      }

      res.status(500).json({
        success: false,
        message:
          "We encountered an issue creating your account. Please try again in a moment.",
        code: "SERVER_ERROR",
      });
    }
  },

  // Login user
  login: async (req, res) => {
    try {
      const { email, password, rememberMe } = req.body;


      // Validation checks
      const errors = [];

      if (!email || !email.trim()) {
        errors.push("Email is required");
      }
      if (!password) {
        errors.push("Password is required");
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (email && !emailRegex.test(email.trim())) {
        errors.push("Please enter a valid email address");
      }

      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Please check your login information",
          errors: errors,
        });
      }

      // Find user with password field
      const user = await User.findByEmail(email.trim().toLowerCase()).select(
        "+password"
      );
      if (!user) {
        return res.status(401).json({
          success: false,
          message:
            "No account found with this email address. Please check your email or sign up for a new account.",
          code: "USER_NOT_FOUND",
        });
      }

      // Check if account is active
      if (user.status === "suspended") {
        return res.status(403).json({
          success: false,
          message:
            "Your account has been suspended. Please contact support for assistance.",
          code: "ACCOUNT_SUSPENDED",
        });
      }

      if (user.status === "deleted") {
        return res.status(410).json({
          success: false,
          message:
            "This account has been deleted. Please create a new account.",
          code: "ACCOUNT_DELETED",
        });
      }

      // Check password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message:
            "Incorrect password. Please try again or reset your password.",
          code: "INVALID_PASSWORD",
        });
      }

      // Generate tokens
      const { accessToken, refreshToken } = generateTokens({
        userId: user._id,
        email: user.email,
        role: user.role,
      });

      // Clean up old refresh tokens (keep only last 5)
      user.refreshTokens = user.refreshTokens
        .filter((rt) => rt.expiresAt > new Date())
        .slice(-4);

      // Add new refresh token
      user.refreshTokens.push({
        token: refreshToken,
        expiresAt: new Date(
          Date.now() + (rememberMe ? 30 : 7) * 24 * 60 * 60 * 1000
        ),
        userAgent: req.headers["user-agent"],
        ipAddress: req.ip,
      });

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      // Set refresh token as httpOnly cookie
      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: (rememberMe ? 30 : 7) * 24 * 60 * 60 * 1000,
      });


      res.json({
        success: true,
        message: `Welcome back, ${user.firstName}!`,
        data: {
          user: user.getPublicProfile(),
          accessToken,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({
        success: false,
        message:
          "We encountered an issue signing you in. Please try again in a moment.",
        code: "SERVER_ERROR",
      });
    }
  },

  // Refresh access token
  refreshToken: async (req, res) => {
    try {
      const { refreshToken } = req.cookies;

      if (!refreshToken) {
        return res.status(401).json({
          success: false,
          message: "Refresh token required",
        });
      }

      // Verify refresh token
      const decoded = verifyRefreshToken(refreshToken);

      // Find user and check if refresh token exists
      const user = await User.findById(decoded.userId);
      const tokenExists = user.refreshTokens.some(
        (rt) => rt.token === refreshToken && rt.expiresAt > new Date()
      );

      if (!user || !tokenExists) {
        return res.status(401).json({
          success: false,
          message: "Invalid refresh token",
        });
      }

      // Generate new access token
      const { accessToken } = generateTokens({
        userId: user._id,
        email: user.email,
        role: user.role,
      });

      res.json({
        success: true,
        message: "Token refreshed successfully",
        data: {
          accessToken,
          user: user.getPublicProfile(),
        },
      });
    } catch (error) {
      console.error("Token refresh error:", error);
      res.status(401).json({
        success: false,
        message: "Token refresh failed",
      });
    }
  },

  // Logout user
  logout: async (req, res) => {
    try {
      const { refreshToken } = req.cookies;

      if (refreshToken && req.user) {
        // Remove refresh token from user's stored tokens
        await User.findByIdAndUpdate(req.user._id, {
          $pull: { refreshTokens: { token: refreshToken } },
        });
      }

      // Clear refresh token cookie
      res.clearCookie("refreshToken");

      res.json({
        success: true,
        message: "Logout successful",
      });
    } catch (error) {
      console.error("Logout error:", error);
      res.status(500).json({
        success: false,
        message: "Logout failed",
      });
    }
  },

  // Get current user profile
  getProfile: async (req, res) => {
    try {
      res.json({
        success: true,
        data: {
          user: req.user.getPublicProfile(),
        },
      });
    } catch (error) {
      console.error("Get profile error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get profile",
      });
    }
  },

  // Get user statistics
  getStats: async (req, res) => {
    try {
      const user = await User.findById(req.user._id);

      res.json({
        success: true,
        data: {
          usage: user.usage,
          subscription: user.subscription,
          joinedDate: user.createdAt,
          lastLogin: user.lastLogin,
        },
      });
    } catch (error) {
      console.error("Get stats error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get user statistics",
      });
    }
  },

  // Forgot password - send reset email
  forgotPassword: async (req, res) => {
    try {
      const { email } = req.body;


      // Validation
      if (!email || !email.trim()) {
        return res.status(400).json({
          success: false,
          message: "Email is required",
        });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({
          success: false,
          message: "Please enter a valid email address",
        });
      }

      // Find user
      const user = await User.findByEmail(email.trim().toLowerCase());

      // Always return success message for security (don't reveal if email exists)
      const successMessage =
        "If an account with that email exists, we've sent a password reset link to it.";

      if (!user) {
        return res.json({
          success: true,
          message: successMessage,
        });
      }

      // Check if user account is active
      if (user.status === "suspended" || user.status === "deleted") {
        return res.json({
          success: true,
          message: successMessage,
        });
      }

      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString("hex");

      // Hash token and save to user
      const hashedToken = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex");
      user.passwordResetToken = hashedToken;
      user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await user.save();

      // Send email
      try {
        await emailService.sendPasswordResetEmail(
          user.email,
          resetToken,
          user.firstName
        );
      } catch (emailError) {
        console.error("Failed to send password reset email:", emailError);
        // Clear the reset token if email fails
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save();

        return res.status(500).json({
          success: false,
          message: "Failed to send reset email. Please try again later.",
        });
      }

      res.json({
        success: true,
        message: successMessage,
      });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({
        success: false,
        message: "An error occurred. Please try again later.",
      });
    }
  },

  // Reset password with token
  resetPassword: async (req, res) => {
    try {
      const { token, password } = req.body;


      // Validation
      const errors = [];

      if (!token) {
        errors.push("Reset token is required");
      }

      if (!password) {
        errors.push("Password is required");
      } else {
        // Validate password strength
        if (password.length < 6) {
          errors.push("Password must be at least 6 characters long");
        }
        if (password.length > 128) {
          errors.push("Password must be less than 128 characters");
        }
        if (!/(?=.*[a-z])/.test(password)) {
          errors.push("Password must contain at least one lowercase letter");
        }
        if (!/(?=.*[A-Z])/.test(password)) {
          errors.push("Password must contain at least one uppercase letter");
        }
        if (!/(?=.*\d)/.test(password)) {
          errors.push("Password must contain at least one number");
        }
      }

      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors,
        });
      }

      // Hash the provided token
      const hashedToken = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");

      // Find user with valid reset token
      const user = await User.findOne({
        passwordResetToken: hashedToken,
        passwordResetExpires: { $gt: Date.now() },
      }).select("+password");

      if (!user) {
        return res.status(400).json({
          success: false,
          message:
            "Password reset token is invalid or has expired. Please request a new password reset.",
        });
      }

      // Update password
      user.password = password;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;

      // Invalidate all refresh tokens for security
      user.refreshTokens = [];

      await user.save();


      // Send confirmation email
      try {
        await emailService.sendPasswordChangedNotification(
          user.email,
          user.firstName
        );
      } catch (emailError) {
        console.error(
          "Failed to send password changed notification:",
          emailError
        );
        // Don't fail the password reset if notification fails
      }

      res.json({
        success: true,
        message:
          "Password has been reset successfully. You can now log in with your new password.",
      });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({
        success: false,
        message:
          "An error occurred while resetting your password. Please try again.",
      });
    }
  },
};

module.exports = authController;
