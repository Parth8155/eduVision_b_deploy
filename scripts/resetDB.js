const { MongoClient } = require('mongodb');

async function resetDatabase() {
  const client = new MongoClient('mongodb://localhost:27017');
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    // Drop both databases to avoid conflicts
    const adminDB = client.db().admin();
    const databases = await adminDB.listDatabases();
    
    for (const db of databases.databases) {
      if (db.name.toLowerCase().includes('eduvision')) {
        await client.db(db.name).dropDatabase();
        console.log(`Dropped database: ${db.name}`);
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

resetDatabase();