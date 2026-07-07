const { getDb } = require('../db');

const ACTIONS = {
  LOGIN: 'login',
  LOGOUT: 'logout',
  LOGIN_FAILED: 'login_failed',
  USER_CREATED: 'user_created',
  USER_UPDATED: 'user_updated',
  USER_DELETED: 'user_deleted',
  USER_DEACTIVATED: 'user_deactivated',
  PASSWORD_RESET: 'password_reset',
  PTT_CALL_INITIATED: 'ptt_call_initiated',
  DEVICE_MUTED: 'device_muted',
  ADMIN_PANEL_ACCESSED: 'admin_panel_accessed'
};

async function logAction(action, userId, targetId, details, req) {
  try {
    const db = getDb();
    const auditLogs = db.collection('audit_logs');
    
    await auditLogs.insertOne({
      action,
      userId,
      targetId: targetId || null,
      details: details || {},
      ip: req ? req.ip : null,
      userAgent: req ? req.get('user-agent') : null,
      timestamp: new Date()
    });
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

async function getAuditLogs(filter = {}, limit = 100) {
  const db = getDb();
  return db.collection('audit_logs')
    .find(filter)
    .sort({ timestamp: -1 })
    .limit(Math.min(limit, 500)) // BE-#14: cap at 500 to prevent OOM on large collections
    .toArray();
}

// BE-#14: build audit-log filter from query params (since, before, limit, cursor)
function buildAuditLogFilter(query) {
  const filter = {};
  if (query.since) {
    const sinceDate = new Date(query.since);
    if (!isNaN(sinceDate.getTime())) {
      filter.timestamp = { ...filter.timestamp, $gte: sinceDate };
    }
  }
  if (query.before) {
    const beforeDate = new Date(query.before);
    if (!isNaN(beforeDate.getTime())) {
      filter.timestamp = { ...filter.timestamp, $lte: beforeDate };
    }
  }
  if (query.action) {
    filter.action = query.action;
  }
  if (query.userId) {
    filter.userId = query.userId;
  }
  return filter;
}

module.exports = { ACTIONS, logAction, getAuditLogs, buildAuditLogFilter };