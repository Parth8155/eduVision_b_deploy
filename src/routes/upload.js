const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const upload = require('../middleware/upload');
const { authenticate } = require('../middleware/auth'); // Add authentication middleware
const { validateFiles } = require('../middleware/fileValidation');
const { validateNote, handleValidationErrors } = require('../middleware/validation');

// Error handler for upload routes
const handleUploadError = (err, req, res, next) => {
  console.error('Upload error details:', {
    message: err.message,
    code: err.code,
    field: err.field ? `"${err.field}"` : 'none',
    fieldLength: err.field ? err.field.length : 0
  });

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      message: `Unexpected field name: "${err.field}". Please check for extra spaces or use the /any endpoint.`,
      expectedFields: ['file', 'files'],
      receivedField: err.field,
      hint: 'Make sure there are no trailing spaces in your field name'
    });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      message: 'File too large. Maximum size is 10MB.'
    });
  }

  res.status(400).json({
    success: false,
    message: 'Upload error',
    error: err.message
  });
};

// Add authentication to all upload routes
router.use(authenticate);

// Upload single file - expects field name 'file'
router.post('/single', upload.single('file'), validateFiles, uploadController.uploadSingle);

// Upload multiple files - expects field name 'files'
router.post('/multiple', upload.array('files', 10), validateFiles, uploadController.uploadMultiple);

// Upload with any field names (most flexible)
router.post('/any', upload.any(), validateFiles, uploadController.uploadFlexible);

// Combined upload and create note - expects field name 'files'
router.post('/upload-and-create', 
  upload.array('files', 10), 
  validateFiles, 
  uploadController.uploadAndCreateNote
);

// Debug endpoint to see what's being sent
router.post('/debug', upload.any(), (req, res) => {
  const debugInfo = {
    success: true,
    message: 'Debug information',
    data: {
      user: req.user ? { id: req.user._id, email: req.user.email } : null,
      totalFiles: req.files ? req.files.length : 0,
      files: req.files ? req.files.map(file => ({
        fieldname: file.fieldname,
        fieldnameLength: file.fieldname.length,
        fieldnameBytes: Buffer.from(file.fieldname).toString('hex'),
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      })) : [],
      body: req.body
    }
  };
  
  res.json(debugInfo);
});

// Download routes - also need authentication
router.get('/searchable-pdf/:noteId/:filename', uploadController.downloadSearchablePDF);
router.get('/searchable-pdfs/:noteId', uploadController.getSearchablePDFs);
router.get('/overlay-pdf/:noteId/:filename', uploadController.downloadOverlayPDF);
router.get('/overlay-pdfs/:noteId', uploadController.getOverlayPDFs);

// Apply error handler
router.use(handleUploadError);

module.exports = router;