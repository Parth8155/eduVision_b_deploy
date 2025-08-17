// Backend routes for annotations
// Add this to your backend routes in eduVision_b/src/routes/annotations.js

const express = require('express');
const router = express.Router();
const annotationsController = require('../controllers/annotationsController');
const auth = require('../middleware/auth');

// Save annotations for a note
router.put('/:noteId', auth.authenticate, annotationsController.saveAnnotations);

// Load annotations for a note
router.get('/:noteId', auth.authenticate, annotationsController.loadAnnotations);

module.exports = router;
