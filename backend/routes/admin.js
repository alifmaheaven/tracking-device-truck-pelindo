const express = require('express');
const bcrypt = require('bcrypt');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
const { ACTIONS, logAction, getAuditLogs } = require('../utils/auditLog');
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
  
  // Validasi Role
  if (!Object.values(ROLES).includes(role)) {
    return res.status(400).json({ error: 'Role tidak valid' });
  }
  
  // Password Complexity minimal 8 karakter (tambahan validasi bisa dilakukan disini)
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password minimal 8 karakter' });
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
  try {
    await logAction(ACTIONS.ADMIN_PANEL_ACCESSED, req.user.id, null, { section: 'audit-logs' }, req);
    const logs = await getAuditLogs({}, 100);
    res.json(logs);
  } catch (error) {
    console.error('Fetch logs error:', error);
    res.status(500).json({ error: 'Gagal mengambil data log' });
  }
});

module.exports = router;