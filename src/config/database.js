const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Use the exact same case as your existing database
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/eduVision';
    
    const conn = await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    console.log(`Database Name: ${conn.connection.name}`);
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

module.exports = connectDB;