const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const path = require("path");
require("dotenv").config();

const connectDB = require("./config/database");
const notesRoutes = require("./routes/notes");
const uploadRoutes = require("./routes/upload");
const authRoutes = require("./routes/auth");
const fileRoutes = require("./routes/files");
const chatRoutes = require("./routes/chat");
const userNotesRoutes = require("./routes/userNotes");
const annotationsRoutes = require("./routes/annotations");

const app = express();

// Connect to MongoDB
connectDB();

// Security middleware
app.use(helmet());

// CORS configuration - Updated to handle multiple origins
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:8080",
      "http://localhost:3000",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
      "http://127.0.0.1:8080",
      "http://127.0.0.1:3000",
    ];

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log("Blocked by CORS:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Trust proxy (for rate limiting and IP detection)
app.set("trust proxy", 1);

// Serve static files
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/notes", notesRoutes);
app.use("/api/user-notes", userNotesRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/annotations", annotationsRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "OK",
    message: "Server is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Sample route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to eduVision Backend API!",
    endpoints: {
      auth: "/api/auth",
      notes: "/api/notes",
      userNotes: "/api/user-notes",
      upload: "/api/upload",
      chat: "/api/chat",
      health: "/api/health",
    },
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Server error:", error);

  // CORS error
  if (error.message === "Not allowed by CORS") {
    return res.status(403).json({
      success: false,
      message: "CORS policy violation",
      origin: req.headers.origin,
    });
  }

  res.status(error.status || 500).json({
    success: false,
    message: error.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && {
      stack: error.stack,
      url: req.url,
      method: req.method,
    }),
  });
});

// 404 handler
app.use("*", (req, res) => {
  console.log("404 - Route not found:", req.method, req.originalUrl);
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl,
    method: req.method,
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(
    `eduVision Backend Server is running on http://localhost:${port}`
  );
  console.log(`Health check: http://localhost:${port}/api/health`);
  console.log(`Auth endpoints: http://localhost:${port}/api/auth`);
});

module.exports = app;
