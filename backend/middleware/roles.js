const ROLES = {
  ADMIN: 'admin',       // full access
  OPERATOR: 'operator', // PTT, map, history
  VIEWER: 'viewer'      // map & history only (read-only)
};

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === role || req.user.role === ROLES.ADMIN) return next();
    res.status(403).json({ error: 'Forbidden: insufficient role' });
  };
}

function requireOperatorOrAbove(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if ([ROLES.OPERATOR, ROLES.ADMIN].includes(req.user.role)) return next();
  res.status(403).json({ error: 'Forbidden: Operators or Admins only' });
}

function requireAdmin(req, res, next) {
  return requireRole(ROLES.ADMIN)(req, res, next);
}

module.exports = { ROLES, requireRole, requireOperatorOrAbove, requireAdmin };