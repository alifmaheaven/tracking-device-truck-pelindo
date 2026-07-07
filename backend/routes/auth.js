const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getDb } = require('../db');
const { ACTIONS, logAction } = require('../utils/auditLog');
const { authMiddleware } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Rate limiter specifically for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login requests per windowMs
  message: { success: false, message: 'Terlalu banyak percobaan login dari IP ini. Silakan coba lagi setelah 15 menit.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Maximum failed attempts before lockout
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password, captchaCode } = req.body;
  // SECURITY (M02 H3): force-string type check to defeat Mongo NoSQL operator injection
  //   (e.g. {"username":{"$ne":null}}). Without this, findOne({username: {$ne: null}}) would
  //   return the first user in the collection.
  const safeUsername = typeof username === 'string' ? username : null;
  const safeCaptchaCode = typeof captchaCode === 'string' ? captchaCode : null;
  const expectedCaptcha = req.signedCookies.captcha_text;

  // Validate request body
  if (!safeUsername || typeof password !== 'string' || !safeCaptchaCode) {
    return res.status(400).json({ success: false, message: 'Harap isi semua field' });
  }

  // Verify Captcha
  if (!expectedCaptcha || safeCaptchaCode.toLowerCase() !== expectedCaptcha.toLowerCase()) {
    return res.status(400).json({ success: false, message: 'Kode captcha tidak valid' });
  }

  try {
    const db = getDb();
    const users = db.collection('users');
    const user = await users.findOne({ username: safeUsername });

    // Anti-enumeration: if user not found, give generic error
    if (!user) {
      await logAction(ACTIONS.LOGIN_FAILED, null, null, { username, reason: 'user_not_found' }, req);
      return res.status(401).json({ success: false, message: 'Username atau password salah' });
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await logAction(ACTIONS.LOGIN_FAILED, user._id, null, { username, reason: 'account_locked' }, req);
      const waitTime = Math.ceil((user.lockedUntil - new Date()) / 60000);
      return res.status(423).json({ 
        success: false, 
        message: `Akun terkunci karena terlalu banyak percobaan gagal. Coba lagi dalam ${waitTime} menit.` 
      });
    }
    
    // Check if account is active
    if (!user.isActive) {
      await logAction(ACTIONS.LOGIN_FAILED, user._id, null, { username, reason: 'account_inactive' }, req);
      return res.status(403).json({ success: false, message: 'Akun telah dinonaktifkan. Hubungi admin.' });
    }

    // Verify Password
    const match = await bcrypt.compare(password, user.passwordHash);
    
    if (!match) {
      // BE-#1: atomic $inc to prevent lockout bypass via race condition.
      //   Previous read-modify-write pattern allowed two concurrent wrong-password
      //   POSTs to both read the same failedAttempts=4, both write 5, and lockout
      //   never triggers. Now $inc is atomic — each failed attempt is counted exactly once.
      const updateResult = await users.findOneAndUpdate(
        { _id: user._id },
        { $inc: { failedAttempts: 1 } },
        { returnDocument: 'after' }
      );

      if (!updateResult) {
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
      }

      const currentFailedAttempts = updateResult.failedAttempts || 0;

      // Conditionally set lockedUntil after the atomic increment
      if (currentFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        await users.updateOne(
          { _id: user._id },
          { $set: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) } }
        );
      }

      await logAction(ACTIONS.LOGIN_FAILED, user._id, null, { username, reason: 'wrong_password', attempts: currentFailedAttempts }, req);
      return res.status(401).json({ success: false, message: 'Username atau password salah' });
    }

    // Login Success
    const token = crypto.randomUUID(); // Secure random token
    
    // Create session in DB (valid for 24 hours)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.collection('sessions').insertOne({
      token,
      userId: user._id,
      createdAt: new Date(),
      expiresAt,
      userAgent: req.get('user-agent'),
      ip: req.ip
    });

    // Reset failed attempts & update last login
    await users.updateOne(
      { _id: user._id },
      { 
        $set: { failedAttempts: 0, lockedUntil: null, lastLogin: new Date() } 
      }
    );

    // Set cookie
    res.cookie('auth_token', token, { 
      maxAge: 24 * 60 * 60 * 1000, 
      httpOnly: true, 
      signed: true,
      sameSite: 'none',
      secure: true
    });

    // Clear captcha cookie
    res.clearCookie('captcha_text');
    
    await logAction(ACTIONS.LOGIN, user._id, null, { username }, req);

    res.json({ 
      success: true, 
      user: {
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        role: user.role
      } 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
  }
});

router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const token = req.signedCookies.auth_token;
    
    // Delete session from DB
    if (token) {
      await getDb().collection('sessions').deleteOne({ token });
    }
    
    await logAction(ACTIONS.LOGOUT, req.user.id, null, { username: req.user.username }, req);
    
    // Clear cookie
    res.clearCookie('auth_token');
    res.json({ success: true, message: 'Logout berhasil' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat logout' });
  }
});

router.get('/me', authMiddleware, (req, res) => {
  res.json(req.user);
});

module.exports = router;