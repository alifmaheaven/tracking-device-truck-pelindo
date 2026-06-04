const bcrypt = require('bcrypt');
const { getDb } = require('./db');

async function seedAdmin() {
  const db = getDb();
  const adminExists = await db.collection('users').findOne({ username: 'admin' });
  
  if (!adminExists) {
    console.log('No admin user found. Creating default admin...');
    const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'Admin@2026!';
    const hash = await bcrypt.hash(defaultPassword, 12);
    
    await db.collection('users').insertOne({
      username: 'admin',
      passwordHash: hash,
      displayName: 'Administrator',
      role: 'admin',
      isActive: true,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLogin: null,
    });
    console.log(`Default admin created. Username: admin. Password: ${defaultPassword}`);
    console.log('IMPORTANT: Change this password immediately after login!');
  } else {
    console.log('Admin user already exists. Skipping seed.');
  }
}

module.exports = { seedAdmin };