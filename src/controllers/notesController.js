const Note = require("../models/Note");
const User = require("../models/User");
const Subject = require("../models/Subject");
const { validationResult } = require("express-validator");
const { sendSuccess, sendError } = require("../utils/responseUtils");

const notesController = {
  // Get user's notes with pagination and filters
  getUserNotes: async (req, res) => {
    try {
      const userId = req.user._id;
      const {
        page = 1,
        limit = 10,
        subject,
        status,
        search,
        sortBy = "uploadDate",
        sortOrder = "desc",
      } = req.query;

      // Build filter object
      const filter = { userId };

      if (subject) filter.subject = subject;
      if (status) filter.status = status;
      if (search) {
        filter.$or = [
          { title: { $regex: search, $options: "i" } },
          { tags: { $regex: search, $options: "i" } },
          { extractedText: { $regex: search, $options: "i" } },
        ];
      }

      // Build sort object
      const sort = {};
      sort[sortBy] = sortOrder === "desc" ? -1 : 1;

      // Execute query with pagination
      const notes = await Note.find(filter)
        .sort(sort)
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .select("-extractedText -originalFile.data -ocrTextPDF.data") // Exclude large fields for list view
        .exec();

      // Get total count for pagination
      const total = await Note.countDocuments(filter);

      sendSuccess(res, "Notes retrieved successfully", {
        notes,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalNotes: total,
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      console.error("Get user notes error:", error);
      sendError(res, "Failed to retrieve notes");
    }
  },

  // Get user's subjects with note counts
  getUserSubjects: async (req, res) => {
    try {
      const userId = req.user._id;

      // Get subjects from both Subject collection and existing Notes
      const subjectCollection = await Subject.find({ userId }).select('name createdAt').sort({ createdAt: -1 });
      
      const noteSubjects = await Note.aggregate([
        { $match: { userId: userId } },
        {
          $group: {
            _id: "$subject",
            count: { $sum: 1 },
            lastUpdated: { $max: "$updatedAt" },
          },
        },
        { $sort: { "_id": 1 } },
      ]);

      // Merge results, prioritizing subjects with notes
      const subjectsMap = new Map();
      
      // Add subjects with notes
      noteSubjects.forEach(subject => {
        if (subject._id) { // Only if subject is not null/undefined
          subjectsMap.set(subject._id, {
            name: subject._id,
            count: subject.count,
            lastUpdated: subject.lastUpdated,
            hasNotes: true
          });
        }
      });

      // Add subjects from collection that don't have notes yet
      subjectCollection.forEach(subject => {
        if (!subjectsMap.has(subject.name)) {
          subjectsMap.set(subject.name, {
            name: subject.name,
            count: 0,
            lastUpdated: subject.createdAt,
            hasNotes: false
          });
        }
      });

      const subjects = Array.from(subjectsMap.values());

      sendSuccess(res, "Subjects retrieved successfully", { subjects });
    } catch (error) {
      console.error("Get user subjects error:", error);
      sendError(res, "Failed to retrieve subjects");
    }
  },

  // Create a new subject
  createSubject: async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, errors.array()[0].msg, 400);
      }

      const userId = req.user._id;
      const { name } = req.body;
      const subjectName = name.trim();

      // Check if subject already exists for this user
      const existingSubject = await Subject.findOne({ 
        userId: userId, 
        name: { $regex: new RegExp(`^${subjectName}$`, 'i') } 
      });

      if (existingSubject) {
        return sendError(res, "Subject already exists", 400);
      }

      // Create new subject in Subject collection
      const newSubject = new Subject({
        userId: userId,
        name: subjectName
      });

      const savedSubject = await newSubject.save();

      sendSuccess(res, "Subject created successfully", { 
        subject: {
          _id: savedSubject._id,
          name: savedSubject.name,
          createdAt: savedSubject.createdAt
        }
      });
    } catch (error) {
      console.error("Create subject error:", error);
      
      // Handle duplicate key error
      if (error.code === 11000) {
        return sendError(res, "Subject already exists", 400);
      }
      
      sendError(res, "Failed to create subject");
    }
  },

  // Get specific note by ID (user ownership check)
  getNoteById: async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user._id;

      // Exclude binary data from the response to avoid large payloads
      const note = await Note.findOne({ _id: id, userId }).select(
        "-originalFile.data -ocrTextPDF.data"
      );

      if (!note) {
        return sendError(res, "Note not found or access denied", 404);
      }

      // Update view count and last accessed
      await Note.findByIdAndUpdate(id, {
        $inc: { views: 1 },
        lastAccessed: new Date(),
      });

      sendSuccess(res, "Note retrieved successfully", { note });
    } catch (error) {
      console.error("Get note by ID error:", error);
      sendError(res, "Failed to retrieve note");
    }
  },

  // Update note (user ownership check)
  updateNote: async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user._id;
      const updates = req.body;

      // Remove fields that shouldn't be updated directly
      delete updates.userId;
      delete updates.files;
      delete updates.extractedText;

      const note = await Note.findOneAndUpdate(
        { _id: id, userId },
        { ...updates, updatedAt: new Date() },
        { new: true, runValidators: true }
      );

      if (!note) {
        return sendError(res, "Note not found or access denied", 404);
      }

      sendSuccess(res, "Note updated successfully", { note });
    } catch (error) {
      console.error("Update note error:", error);
      sendError(res, "Failed to update note");
    }
  },

  // Delete note (user ownership check)
  deleteNote: async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user._id;

      const note = await Note.findOne({ _id: id, userId });

      if (!note) {
        return sendError(res, "Note not found or access denied", 404);
      }

      // Delete associated files (implement file cleanup logic here)
      // TODO: Clean up uploaded files and generated PDFs

      await Note.findByIdAndDelete(id);

      // Update user's usage count
      await User.findByIdAndUpdate(userId, {
        $inc: { "usage.notesUploaded": -1 },
      });

      sendSuccess(res, "Note deleted successfully");
    } catch (error) {
      console.error("Delete note error:", error);
      sendError(res, "Failed to delete note");
    }
  },

  // Track note access (for analytics and recent activity)
  trackNoteAccess: async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user._id;
      const { action = "view", metadata = {} } = req.body;

      const note = await Note.findOne({ _id: id, userId });

      if (!note) {
        return sendError(res, "Note not found or access denied", 404);
      }

      // Update access tracking fields (without incrementing views)
      const updateFields = {
        lastAccessed: new Date(),
      };

      // Track different types of access
      if (action === "edit") {
        updateFields.lastEdited = new Date();
      } else if (action === "download") {
        updateFields.$inc = { downloads: 1 };
      }

      // Store metadata if provided (e.g., viewing time, page number, etc.)
      if (Object.keys(metadata).length > 0) {
        updateFields.lastAccessMetadata = metadata;
      }

      await Note.findByIdAndUpdate(id, updateFields);

      sendSuccess(res, "Access tracked successfully", {
        noteId: id,
        action,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error("Track note access error:", error);
      sendError(res, "Failed to track access");
    }
  },
};

module.exports = notesController;
