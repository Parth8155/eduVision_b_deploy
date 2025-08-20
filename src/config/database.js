const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb+srv://parthmaheriya76:iRQ1JWmA7qjlIN02@eduvision-database.z6hlxdb.mongodb.net/eduvision';
    
    const conn = await mongoose.connect(mongoURI);
    
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    console.log(`Database Name: ${conn.connection.name}`);
  } catch (error) {
    console.error('Database connection error:', error);
  }
};

module.exports = connectDB;