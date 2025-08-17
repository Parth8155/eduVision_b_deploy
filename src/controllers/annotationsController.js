// Backend controller for handling PDF annotations
// Add this to your backend API routes in eduVision_b/src/controllers/annotationsController.js

const Note = require('../models/Note');

const annotationsController = {
  // Save annotations for a note
  async saveAnnotations(req, res) {
    try {
      const { noteId } = req.params;
      const { annotations } = req.body;
      const userId = req.user.userId;

      // Find the note and verify ownership
      const note = await Note.findOne({ _id: noteId, user: userId });
      if (!note) {
        return res.status(404).json({ 
          success: false, 
          message: 'Note not found' 
        });
      }

      // Update note with annotations
      note.annotations = annotations;
      note.lastModified = new Date();
      await note.save();

      res.json({ 
        success: true, 
        message: 'Annotations saved successfully',
        annotations: note.annotations 
      });
    } catch (error) {
      console.error('Save annotations error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to save annotations' 
      });
    }
  },

  // Load annotations for a note
  async loadAnnotations(req, res) {
    try {
      const { noteId } = req.params;
      const userId = req.user.userId;

      // Find the note and verify ownership
      const note = await Note.findOne({ _id: noteId, user: userId });
      if (!note) {
        return res.status(404).json({ 
          success: false, 
          message: 'Note not found' 
        });
      }

      const annotations = note.annotations || {
        highlights: [],
        drawings: [],
        numberMarkers: [],
        lastModified: null
      };

      res.json({ 
        success: true, 
        annotations 
      });
    } catch (error) {
      console.error('Load annotations error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to load annotations' 
      });
    }
  }
};

module.exports = annotationsController;
