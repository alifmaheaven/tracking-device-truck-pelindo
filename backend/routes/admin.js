const express = require('express');
const bcrypt = require('bcrypt');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
const { ACTIONS, logAction, getAuditLogs, buildAuditLogFilter } = require('../utils/auditLog');
const { authMiddleware } = require('../middleware/auth');
const { requireAdmin, ROLES } = require('../middleware/roles');

const router = express.Router();

// Semua rute di file ini membutuhkan auth dan role admin
router.use(authMiddleware);
router.use(requireAdmin);

// Get all users
router.get('/users', async (req, res) => {
  try {
    const db = getDb();
    const users = await db.collection('users')
      .find({})
      .project({ passwordHash: 0 }) // jangan kirim password hash
      .toArray();
    
    res.json(users);
  } catch (error) {
    console.error('Fetch users error:', error);
    res.status(500).json({ error: 'Gagal mengambil data user' });
  }
});

// Create new user
router.post('/users', async (req, res) => {
  const { username, password, displayName, role } = req.body;

  if (!username || !password || !displayName || !role) {
    return res.status(400).json({ error: 'Semua field wajib diisi' });
  }

  // BE-#13: input validation — length caps + regex to prevent control chars abuse
  //   and giant payloads (10MB displayName was accepted before).
  if (typeof username !== 'string' || username.length < 3 || username.length > 32) {
    return res.status(400).json({ error: 'Username harus 3-32 karakter' });
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username hanya boleh huruf, angka, titik, garis bawah, dan strip' });
  }
  if (typeof displayName !== 'string' || displayName.length < 1 || displayName.length > 100) {
    return res.status(400).json({ error: 'Display name maksimal 100 karakter' });
  }

  // Validasi Role
  if (!Object.values(ROLES).includes(role)) {
    return res.status(400).json({ error: 'Role tidak valid' });
  }

  // Password Complexity minimal 8 karakter + minimal 1 upper, 1 lower, 1 digit
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password minimal 8 karakter' });
  }
  if (password.length > 128) {
    return res.status(400).json({ error: 'Password maksimal 128 karakter' });
  }
  // H5: enforce a real password policy. Without this, "aaaaaaaa" passes.
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return res.status(400).json({ error: 'Password harus mengandung huruf besar, huruf kecil, dan angka' });
  }

  try {
    const db = getDb();
    
    // Cek apakah username sudah ada
    const existing = await db.collection('users').findOne({ username });
    if (existing) {
      return res.status(400).json({ error: 'Username sudah digunakan' });
    }
    
    const hash = await bcrypt.hash(password, 12);
    
    const newUser = {
      username,
      passwordHash: hash,
      displayName,
      role,
      isActive: true,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLogin: null
    };
    
    const result = await db.collection('users').insertOne(newUser);
    
    await logAction(ACTIONS.USER_CREATED, req.user.id, result.insertedId, { 
      newUsername: username, 
      role 
    }, req);
    
    res.status(201).json({ success: true, message: 'User berhasil dibuat' });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Gagal membuat user' });
  }
});

// Update user (kecuali password)
router.put('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { displayName, role, isActive } = req.body;
  
  if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'ID tidak valid' });
  
  try {
    const db = getDb();
    const objId = new ObjectId(id);
    
    const targetUser = await db.collection('users').findOne({ _id: objId });
    if (!targetUser) return res.status(404).json({ error: 'User tidak ditemukan' });
    
    // Admin tidak bisa mengubah rolenya sendiri menjadi bukan admin
    if (req.user.id.toString() === id && role !== ROLES.ADMIN) {
      return res.status(400).json({ error: 'Tidak bisa menghapus role admin dari diri sendiri' });
    }
    
    // Admin tidak bisa menonaktifkan dirinya sendiri
    if (req.user.id.toString() === id && isActive === false) {
      return res.status(400).json({ error: 'Tidak bisa menonaktifkan diri sendiri' });
    }
    
    const updateData = {
      displayName: displayName || targetUser.displayName,
      role: role || targetUser.role,
      isActive: isActive !== undefined ? isActive : targetUser.isActive,
      updatedAt: new Date()
    };
    
    // Jika dinonaktifkan (deactivated), hapus semua sesinya agar langsung logout
    if (isActive === false && targetUser.isActive === true) {
      await db.collection('sessions').deleteMany({ userId: objId });
      await logAction(ACTIONS.USER_DEACTIVATED, req.user.id, objId, { targetUsername: targetUser.username }, req);
    }
    
    await db.collection('users').updateOne(
      { _id: objId },
      { $set: updateData }
    );
    
    await logAction(ACTIONS.USER_UPDATED, req.user.id, objId, { 
      targetUsername: targetUser.username,
      updates: updateData 
    }, req);
    
    res.json({ success: true, message: 'User berhasil diperbarui' });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Gagal memperbarui user' });
  }
});

// Reset Password User
router.post('/users/:id/reset-password', async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;
  
  if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'ID tidak valid' });
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password minimal 8 karakter' });
  }
  // H5: same complexity rule on password reset
  if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return res.status(400).json({ error: 'Password harus mengandung huruf besar, huruf kecil, dan angka' });
  }
  
  try {
    const db = getDb();
    const objId = new ObjectId(id);
    
    const targetUser = await db.collection('users').findOne({ _id: objId });
    if (!targetUser) return res.status(404).json({ error: 'User tidak ditemukan' });
    
    const hash = await bcrypt.hash(newPassword, 12);
    
    // Hapus sesi user agar harus login ulang dengan pass baru
    await db.collection('sessions').deleteMany({ userId: objId });
    
    // Update DB, reset locked stat
    await db.collection('users').updateOne(
      { _id: objId },
      { 
        $set: { 
          passwordHash: hash,
          failedAttempts: 0,
          lockedUntil: null,
          updatedAt: new Date()
        } 
      }
    );
    
    await logAction(ACTIONS.PASSWORD_RESET, req.user.id, objId, { targetUsername: targetUser.username }, req);
    
    res.json({ success: true, message: 'Password berhasil direset' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Gagal mereset password' });
  }
});

// Delete user
router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  
  if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'ID tidak valid' });
  
  // Tidak bisa delete diri sendiri
  if (req.user.id.toString() === id) {
    return res.status(400).json({ error: 'Tidak bisa menghapus akun diri sendiri' });
  }
  
  try {
    const db = getDb();
    const objId = new ObjectId(id);
    
    const targetUser = await db.collection('users').findOne({ _id: objId });
    if (!targetUser) return res.status(404).json({ error: 'User tidak ditemukan' });
    
    // Delete session lalu delete user
    await db.collection('sessions').deleteMany({ userId: objId });
    await db.collection('users').deleteOne({ _id: objId });
    
    await logAction(ACTIONS.USER_DELETED, req.user.id, null, { deletedUsername: targetUser.username }, req);
    
    res.json({ success: true, message: 'User berhasil dihapus' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Gagal menghapus user' });
  }
});

// Get audit logs
router.get('/audit-logs', async (req, res) => {
  // BE-#14: remove self-log to prevent recursive noise (every admin panel access
  //   logged itself). Use query params for pagination: ?since&before&limit&action&userId
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const filter = buildAuditLogFilter(req.query);
    const logs = await getAuditLogs(filter, limit);
    res.json(logs);
  } catch (error) {
    console.error('Fetch logs error:', error);
    res.status(500).json({ error: 'Gagal mengambil data log' });
  }
});

module.exports = router;