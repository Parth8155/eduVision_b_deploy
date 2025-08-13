const path = require('path');

const allowedMimeTypes = [
  'image/jpeg',
  'image/jpg', 
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf'
];

const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];

const validateFiles = (req, res, next) => {
  try {
    // Check if files exist
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    // Validate each file
    for (const file of req.files) {
      // Check file size (10MB limit)
      if (file.size > 10 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          message: `File ${file.originalname} is too large. Maximum size is 10MB.`
        });
      }

      // Check MIME type
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return res.status(400).json({
          success: false,
          message: `File ${file.originalname} has invalid type. Allowed types: images and PDFs.`
        });
      }

      // Check file extension
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowedExtensions.includes(ext)) {
        return res.status(400).json({
          success: false,
          message: `File ${file.originalname} has invalid extension. Allowed: ${allowedExtensions.join(', ')}`
        });
      }
    }

    next();
  } catch (error) {
    console.error('File validation error:', error);
    res.status(500).json({
      success: false,
      message: 'File validation failed'
    });
  }
};

module.exports = { validateFiles };