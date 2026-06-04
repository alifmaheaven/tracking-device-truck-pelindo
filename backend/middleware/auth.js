const { getDb } = require('../db');

async function authMiddleware(req, res, next) {
  const token = req.signedCookies.auth_token;
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  try {
    const db = getDb();
    const session = await db.collection('sessions').findOne({ token });
    
    if (!session || session.expiresAt < new Date()) {
      res.clearCookie('auth_token');
      return res.status(401).json({ error: 'Unauthorized: Session expired or invalid' });
    }
    
    const user = await db.collection('users').findOne({ _id: session.userId });
    if (!user || !user.isActive) {
      res.clearCookie('auth_token');
      return res.status(401).json({ error: 'Unauthorized: User not found or inactive' });
    }
    
    // Attach user to request object
    req.user = {
      id: user._id,
      username: user.username,
      displayName: user.displayName,
      role: user.role
    };
    
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
}

module.exports = { authMiddleware };