const { verifyAccessToken, getTokenFromHeader } = require('../utils/jwt');
const User = require('../models/User');

const authenticate = async (req, res, next) => {
  try {
    const token = getTokenFromHeader(req.headers.authorization);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid access token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Access token expired'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions'
      });
    }
    next();
  };
};

module.exports = { authenticate, authorize };