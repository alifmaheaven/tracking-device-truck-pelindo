const { MongoClient } = require('mongodb');

let dbInstance = null;

async function connectDB() {
  if (dbInstance) return dbInstance;

  const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017';
  const MONGO_DB = process.env.MONGO_DB || 'pelindo_maps';
  
  try {
    // BE-#12: explicit timeouts + pool size for flaky 2G backhaul.
    //   Previous no-options connect could hang indefinitely on network blips
    //   and had no connection limit, risking OOM under load.
    const client = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
      maxPoolSize: 20,
    });
    await client.connect();
    console.log('Connected to MongoDB for Users & Sessions');
    
    dbInstance = client.db(MONGO_DB);
    
    // Create necessary indexes
    await dbInstance.collection('users').createIndex({ username: 1 }, { unique: true });
    
    // TTL index for sessions (expire after 24 hours)
    // expiresAt field must be a Date object
    await dbInstance.collection('sessions').createIndex(
      { expiresAt: 1 }, 
      { expireAfterSeconds: 0 }
    );
    
    // Audit logs index for faster querying
    await dbInstance.collection('audit_logs').createIndex({ timestamp: -1 });
    await dbInstance.collection('audit_logs').createIndex({ action: 1 });
    await dbInstance.collection('audit_logs').createIndex({ userId: 1 });
    
    return dbInstance;
  } catch (error) {
    console.error('Failed to connect to MongoDB', error);
    process.exit(1);
  }
}

function getDb() {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call connectDB first.');
  }
  return dbInstance;
}

module.exports = { connectDB, getDb };