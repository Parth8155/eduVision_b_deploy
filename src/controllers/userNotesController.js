const UserNote = require("../models/UserNote");
const Note = require("../models/Note");

// Get all user notes for a specific note and page
const getNotesForPage = async (req, res) => {
  try {
    const { noteId, pageNumber } = req.params;
    const userId = req.user.id;

    // Validate that the user has access to this note
    const note = await Note.findOne({ _id: noteId, userId });
    if (!note) {
      return res.status(404).json({
        success: false,
        message: "Note not found or access denied",
      });
    }

    const userNotes = await UserNote.find({
      userId,
      noteId,
      pageNumber: parseInt(pageNumber),
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      notes: userNotes.map((note) => note.toSafeObject()),
    });
  } catch (error) {
    console.error("Get notes for page error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve notes",
    });
  }
};

// Get all user notes for a specific note
const getAllNotesForNote = async (req, res) => {
  try {
    const { noteId } = req.params;
    const userId = req.user.id;

    // Validate that the user has access to this note
    const note = await Note.findOne({ _id: noteId, userId });
    if (!note) {
      return res.status(404).json({
        success: false,
        message: "Note not found or access denied",
      });
    }

    const userNotes = await UserNote.find({
      userId,
      noteId,
    }).sort({ pageNumber: 1, createdAt: -1 });

    res.json({
      success: true,
      notes: userNotes.map((note) => note.toSafeObject()),
    });
  } catch (error) {
    console.error("Get all notes for note error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve notes",
    });
  }
};

// Create a new user note
const createNote = async (req, res) => {
  try {
    const {
      noteId,
      pageNumber,
      title,
      content,
      color,
      tags,
      position,
      selectedText,
    } = req.body;
    const userId = req.user.id;

    // Validate that the user has access to this note
    const note = await Note.findOne({ _id: noteId, userId });
    if (!note) {
      return res.status(404).json({
        success: false,
        message: "Note not found or access denied",
      });
    }

    // Validate required fields
    if (!title || !content || !pageNumber) {
      return res.status(400).json({
        success: false,
        message: "Title, content, and page number are required",
      });
    }

    const userNote = new UserNote({
      userId,
      noteId,
      pageNumber,
      title: title.trim(),
      content: content.trim(),
      color: color || "#fbbf24",
      tags: tags || [],
      position: position || { x: 0, y: 0 },
      selectedText: selectedText || undefined,
    });

    await userNote.save();

    res.status(201).json({
      success: true,
      message: "Note created successfully",
      note: userNote.toSafeObject(),
    });
  } catch (error) {
    console.error("Create note error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create note",
    });
  }
};

// Update a user note
const updateNote = async (req, res) => {
  try {
    const { noteId } = req.params;
    const userId = req.user.id;
    const { title, content, color, tags, position } = req.body;

    const userNote = await UserNote.findOne({ _id: noteId, userId });
    if (!userNote) {
      return res.status(404).json({
        success: false,
        message: "User note not found",
      });
    }

    // Update fields if provided
    if (title !== undefined) userNote.title = title.trim();
    if (content !== undefined) userNote.content = content.trim();
    if (color !== undefined) userNote.color = color;
    if (tags !== undefined) userNote.tags = tags;
    if (position !== undefined) userNote.position = position;

    await userNote.save();

    res.json({
      success: true,
      message: "Note updated successfully",
      note: userNote.toSafeObject(),
    });
  } catch (error) {
    console.error("Update note error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update note",
    });
  }
};

// Delete a user note
const deleteNote = async (req, res) => {
  try {
    const { noteId } = req.params;
    const userId = req.user.id;

    const userNote = await UserNote.findOneAndDelete({ _id: noteId, userId });
    if (!userNote) {
      return res.status(404).json({
        success: false,
        message: "User note not found",
      });
    }

    res.json({
      success: true,
      message: "Note deleted successfully",
    });
  } catch (error) {
    console.error("Delete note error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete note",
    });
  }
};

// Search user notes
const searchNotes = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { query } = req.query;
    const userId = req.user.id;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Search query must be at least 2 characters long",
      });
    }

    // Validate that the user has access to this note
    const note = await Note.findOne({ _id: noteId, userId });
    if (!note) {
      return res.status(404).json({
        success: false,
        message: "Note not found or access denied",
      });
    }

    const searchRegex = new RegExp(query.trim(), "i");

    const userNotes = await UserNote.find({
      userId,
      noteId,
      $or: [
        { title: { $regex: searchRegex } },
        { content: { $regex: searchRegex } },
        { selectedText: { $regex: searchRegex } },
      ],
    }).sort({ pageNumber: 1, createdAt: -1 });

    res.json({
      success: true,
      notes: userNotes.map((note) => note.toSafeObject()),
      query: query.trim(),
    });
  } catch (error) {
    console.error("Search notes error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to search notes",
    });
  }
};

module.exports = {
  getNotesForPage,
  getAllNotesForNote,
  createNote,
  updateNote,
  deleteNote,
  searchNotes,
};
