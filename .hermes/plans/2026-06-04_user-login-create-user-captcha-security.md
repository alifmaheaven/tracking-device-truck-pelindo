# Plan: User Login, Create User & Captcha — Secure Authentication System

## Goal

Menambahkan sistem **User Login** dan **Create User** yang aman ke dashboard Pelindo Maps Device, mengintegrasikan dengan **captcha backend (svg-captcha) yang sudah ada** di `server.js`. Sistem harus tanpa celah keamanan — mencakup brute-force protection, secure token management, password hashing, dan input validation.

## Current Context / Assumptions

### Yang Sudah Ada (Existing)
- **Backend**: Express + WebSocket hybrid di `deploy_pelindo/backend/server.js`
- **Captcha Backend**: `svg-captcha` + signed cookies (`/api/captcha`, `/api/verify`, `/api/auth-check`)
- **Captcha Frontend**: Canvas-based captcha di `deploy_pelindo/frontend/src/auth.js` (client-side only, TIDAK aman)
- **Auth State**: `sessionStorage.ptt_auth_passed` (client-side, bisa di-bypass)
- **Session Store**: In-memory `authSessions = new Set()` (hilang saat restart)
- **Token**: `Math.random().toString(36)` (TIDAK cryptographically secure)
- **MongoDB**: Sudah ada di docker-compose (dipakai N8N), bisa dipakai untuk user store
- **N8N Proxy**: `/api/proxy/n8n` sudah cek auth token

### Celah Keamanan yang Harus Ditutup
1. **Frontend captcha client-side** — jawaban captcha ada di memory JS, bisa di-inspect
2. **Token generation** — `Math.random()` tidak cryptographically secure
3. **No rate limiting** — captcha verify bisa di-brute-force
4. **No password system** — siapa saja yang solve captcha bisa masuk
5. **Session in-memory** — restart server = semua session hilang
6. **No CSRF protection** — form submission vulnerable
7. **sessionStorage bypass** — set `ptt_auth_passed=true` di console = bypass auth
8. **N8N proxy SSRF** — `/api/proxy/n8n` accepts any URL, bisa dipakai untuk SSRF

## Proposed Approach

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND (Vite SPA)                     │
│                                                             │
│  1. Login Page (username + password + captcha SVG)          │
│  2. Dashboard (setelah authenticated)                       │
│  3. Admin Panel — Create/Manage Users (admin only)          │
│                                                             │
│  Auth token disimpan di httpOnly secure cookie              │
│  (BUKAN sessionStorage/localStorage)                        │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────────────┐
│                   BACKEND (Express + WS)                    │
│                                                             │
│  POST /api/auth/login      — login (username+pass+captcha)  │
│  POST /api/auth/logout     — logout (clear cookie+session)  │
│  GET  /api/auth/me         — get current user info          │
│  GET  /api/captcha         — generate SVG captcha (EXISTING)│
│  POST /api/verify-captcha  — verify captcha only            │
│                                                             │
│  POST /api/admin/users         — create user (admin only)   │
│  GET  /api/admin/users         — list users (admin only)    │
│  PUT  /api/admin/users/:id     — update user (admin only)   │
│  DELETE /api/admin/users/:id   — delete user (admin only)   │
│                                                             │
│  Middleware: authMiddleware, adminMiddleware, rateLimiter    │
│  Security: helmet, bcrypt, crypto.randomUUID, CSRF token    │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                    MongoDB (Existing)                       │
│                                                             │
│  Collection: users                                          │
│    { username, passwordHash, role, displayName,             │
│      createdAt, updatedAt, lastLogin, failedAttempts,       │
│      lockedUntil, isActive }                                │
│                                                             │
│  Collection: sessions                                       │
│    { token, userId, createdAt, expiresAt, userAgent, ip }   │
└─────────────────────────────────────────────────────────────┘
```

### Security Layers (Defense in Depth)

```
Layer 1: Rate Limiting        — express-rate-limit (per IP)
Layer 2: Captcha              — svg-captcha backend (existing, diperkuat)
Layer 3: Input Validation     — express-validator / manual sanitize
Layer 4: Password Hashing     — bcrypt (cost factor 12)
Layer 5: Secure Token         — crypto.randomUUID() + HMAC signature
Layer 6: Session Store        — MongoDB-backed (persistent)
Layer 7: Account Lockout      — 5 failed attempts = lock 15 menit
Layer 8: HTTP Security        — helmet headers, CORS strict origin
Layer 9: Cookie Security      — httpOnly, secure, sameSite, signed
Layer 10: SSRF Prevention     — N8N proxy URL whitelist
Layer 11: Admin Authorization — role-based access control
```

## Step-by-Step Plan

---

### Phase 1: Backend — Database & User Model

**File**: `deploy_pelindo/backend/db.js` (NEW)

1. Install MongoDB driver:
   ```
   npm install mongodb bcrypt express-rate-limit helmet
   ```

2. Buat koneksi MongoDB singleton:
   ```javascript
   // db.js
   const { MongoClient } = require('mongodb');
   const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017';
   const DB_NAME = process.env.MONGO_DB || 'pelindo_maps';
   
   let db = null;
   async function getDb() {
     if (!db) {
       const client = await MongoClient.connect(MONGO_URI);
       db = client.db(DB_NAME);
       // Ensure indexes
       await db.collection('users').createIndex({ username: 1 }, { unique: true });
       await db.collection('sessions').createIndex({ token: 1 }, { unique: true });
       await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
     }
     return db;
   }
   module.exports = { getDb };
   ```

3. TTL index pada `sessions.expiresAt` → MongoDB otomatis hapus session expired.

---

### Phase 2: Backend — Auth Routes

**File**: `deploy_pelindo/backend/routes/auth.js` (NEW)

#### 2.1 POST /api/auth/login

```
Input:  { username, password, captchaCode }
Flow:
  1. Validate input (non-empty, max length, no special injection chars)
  2. Verify captcha code against signed cookie → gagal = reject
  3. Lookup user by username (case-insensitive)
  4. Check account lockout (failedAttempts >= 5 && lockedUntil > now)
     → locked = return 423 "Akun terkunci, coba lagi dalam X menit"
  5. bcrypt.compare(password, user.passwordHash)
     → gagal = increment failedAttempts, set lockedUntil jika >= 5
     → return 401 "Username atau password salah" (generic message)
  6. Generate session token: crypto.randomUUID()
  7. Store session di MongoDB: { token, userId, createdAt, expiresAt: +24h, ip, userAgent }
  8. Set cookie 'auth_token' (signed, httpOnly, secure, sameSite: 'strict', maxAge: 24h)
  9. Clear captcha cookie
  10. Update user.lastLogin, reset failedAttempts = 0
  11. Return { success: true, user: { username, displayName, role } }
```

#### 2.2 POST /api/auth/logout

```
Flow:
  1. Read auth_token from signed cookie
  2. Delete session from MongoDB
  3. Clear auth_token cookie
  4. Return { success: true }
```

#### 2.3 GET /api/auth/me

```
Flow:
  1. authMiddleware checks token
  2. Return { username, displayName, role }
```

---

### Phase 3: Backend — Middleware Security

**File**: `deploy_pelindo/backend/middleware/auth.js` (NEW)

#### 3.1 authMiddleware

```javascript
async function authMiddleware(req, res, next) {
  const token = req.signedCookies.auth_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  
  const db = await getDb();
  const session = await db.collection('sessions').findOne({ 
    token, 
    expiresAt: { $gt: new Date() } 
  });
  
  if (!session) {
    res.clearCookie('auth_token');
    return res.status(401).json({ error: 'Session expired' });
  }
  
  const user = await db.collection('users').findOne({ _id: session.userId });
  if (!user || !user.isActive) {
    return res.status(403).json({ error: 'Account disabled' });
  }
  
  req.user = user;
  req.sessionToken = token;
  next();
}
```

#### 3.2 adminMiddleware

```javascript
function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
```

#### 3.3 Rate Limiter

```javascript
const rateLimit = require('express-rate-limit');

// Login: max 5 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Captcha: max 30 per 15 minutes
const captchaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Terlalu banyak request captcha.' },
});

// General API: max 100 per 15 minutes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
```

---

### Phase 4: Backend — Admin User Management

**File**: `deploy_pelindo/backend/routes/admin.js` (NEW)

#### 4.1 POST /api/admin/users (Create User)

```
Input:  { username, password, displayName, role: 'operator'|'admin' }
Validation:
  - username: 3-30 chars, alphanumeric + underscore only, lowercase
  - password: min 8 chars, must contain uppercase + lowercase + number
  - displayName: 2-50 chars, trimmed
  - role: must be 'operator' or 'admin'
Flow:
  1. authMiddleware + adminMiddleware
  2. Validate all inputs
  3. Check username unique (case-insensitive)
  4. Hash password: bcrypt.hash(password, 12)
  5. Insert user document
  6. Return created user (tanpa passwordHash)
```

#### 4.2 GET /api/admin/users (List Users)

```
Flow:
  1. authMiddleware + adminMiddleware
  2. Return all users (project out passwordHash)
```

#### 4.3 PUT /api/admin/users/:id (Update User)

```
Input:  { displayName?, password?, role?, isActive? }
Flow:
  1. authMiddleware + adminMiddleware
  2. Prevent admin from deactivating own account
  3. If password provided, hash with bcrypt
  4. Update user document
  5. If isActive=false, delete all sessions for that user
```

#### 4.4 DELETE /api/admin/users/:id (Delete User)

```
Flow:
  1. authMiddleware + adminMiddleware  
  2. Prevent admin from deleting own account
  3. Delete all sessions for that user
  4. Delete user document (atau soft-delete via isActive=false)
```

---

### Phase 5: Backend — Hardening server.js

**File**: `deploy_pelindo/backend/server.js` (MODIFY)

Changes:
1. **Add helmet** for security headers
2. **Fix CORS** — strict origin instead of `origin: true`
3. **Fix token generation** — replace `Math.random()` with `crypto.randomUUID()`
4. **Fix N8N proxy SSRF** — whitelist allowed URL patterns:
   ```javascript
   const ALLOWED_N8N_HOSTS = [
     'n8n-teluk-lamong.freeat.me',
     '10.118.62.60:5678',
     'localhost:5678'
   ];
   
   app.get('/api/proxy/n8n', authMiddleware, async (req, res) => {
     const targetUrl = new URL(req.query.url);
     if (!ALLOWED_N8N_HOSTS.includes(targetUrl.host)) {
       return res.status(403).json({ error: 'Forbidden: URL not allowed' });
     }
     // ... proxy logic
   });
   ```
5. **Move captcha routes** — apply `captchaLimiter`
6. **Remove old in-memory authSessions** — replaced by MongoDB sessions
7. **Add seed admin** — on first boot, create default admin if no users exist
8. **Cookie secret** — move to env var, not hardcoded

---

### Phase 6: Backend — Seed Admin User

**File**: `deploy_pelindo/backend/seed.js` (NEW)

```javascript
// Runs on server startup
async function seedAdmin() {
  const db = await getDb();
  const adminExists = await db.collection('users').findOne({ role: 'admin' });
  if (!adminExists) {
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash(process.env.ADMIN_DEFAULT_PASSWORD || 'Admin@2026!', 12);
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
    console.log('Default admin created. Username: admin. Change password immediately!');
  }
}
```

---

### Phase 7: Frontend — Login Page

**File**: `deploy_pelindo/frontend/src/auth.js` (REWRITE)

#### 7.1 Flow Baru

```
Page Load
  → GET /api/auth/me
    → 200: user authenticated → initApp()
    → 401: show login overlay
      → GET /api/captcha → render SVG captcha in overlay
      → User fills username + password + captcha
      → POST /api/auth/login { username, password, captchaCode }
        → 200: success → initApp()
        → 400: captcha salah → refresh captcha, show error
        → 401: credentials salah → refresh captcha, show error
        → 423: account locked → show lockout message
        → 429: rate limited → show rate limit message
```

#### 7.2 Login UI Updates

**File**: `deploy_pelindo/frontend/index.html` (MODIFY)

Update captcha overlay menjadi login form:
```html
<div id="captchaOverlay" class="captcha-overlay active">
  <div class="captcha-card">
    <img src="assets/logo.png" alt="Logo" style="height: 40px;">
    <h2>Login Dashboard</h2>
    <p>Masukkan kredensial untuk mengakses dashboard monitoring.</p>
    
    <div class="form-group">
      <label><i class="fa-solid fa-user"></i> Username</label>
      <input type="text" id="loginUsername" autocomplete="username" maxlength="30">
    </div>
    
    <div class="form-group">
      <label><i class="fa-solid fa-lock"></i> Password</label>
      <input type="password" id="loginPassword" autocomplete="current-password" maxlength="128">
    </div>
    
    <div id="captchaImage" class="captcha-image-container" title="Klik untuk refresh">
      <!-- SVG dari backend -->
    </div>
    
    <div class="form-group">
      <label><i class="fa-solid fa-shield-halved"></i> Kode Captcha</label>
      <input type="text" id="captchaInput" maxlength="4" autocomplete="off">
    </div>
    
    <button id="captchaSubmit" class="captcha-submit">
      <span>Login</span>
      <i class="fa-solid fa-arrow-right-to-bracket"></i>
    </button>
    <div id="captchaError" class="captcha-error"></div>
  </div>
</div>
```

#### 7.3 Logout

Tambahkan tombol logout di sidebar header:
```html
<button id="logoutBtn" title="Logout">
  <i class="fa-solid fa-right-from-bracket"></i>
</button>
```

Handler:
```javascript
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  location.reload();
});
```

---

### Phase 8: Frontend — Admin Panel (Create/Manage Users)

**File**: `deploy_pelindo/frontend/src/admin.js` (NEW)

Hanya ditampilkan jika `user.role === 'admin'`.

#### 8.1 UI

- Modal/overlay "User Management"
- Tabel user list (username, displayName, role, lastLogin, isActive)
- Button "Tambah User" → form create user
- Per-row actions: Edit, Reset Password, Activate/Deactivate, Delete
- Password requirements indicator (min 8 chars, uppercase, lowercase, number)

#### 8.2 API Calls

Semua via `fetch()` dengan `credentials: 'include'` (cookie-based auth).

---

### Phase 9: Frontend — Remove Client-Side Captcha

**File**: `deploy_pelindo/frontend/src/auth.js` (already covered in Phase 7)

**Hapus sepenuhnya**:
- `generateCaptcha()` canvas function
- `currentCaptchaText` variable
- `sessionStorage.ptt_auth_passed` check dan set
- Client-side captcha comparison logic

**Ganti dengan**:
- Backend SVG captcha fetch (`GET /api/captcha` → render SVG)
- Backend verification (`POST /api/auth/login` includes captcha code)

---

### Phase 10: Docker & Environment

**File**: `deploy_pelindo/backend/.env` (MODIFY)

```env
### Phase 10: Role-Based Access Control

**File**: `backend/middleware/roles.js` (NEW)

```javascript
// Role hierarchy: admin > operator > viewer
const ROLES = {
  ADMIN: 'admin',       // full access
  OPERATOR: 'operator', // PTT, map, history
  VIEWER: 'viewer'      // map & history only (read-only)
};

const PERMISSIONS = {
  'admin': ['*'],
  'operator': [
    'view:map', 'view:history', 'view:devices',
    'ptt:call', 'ptt:talk', 'ptt:mute', 'ppt:unmute',
    'admin:panel:view'
  ],
  'viewer': [
    'view:map', 'view:history', 'view:devices'
  ]
};

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === role || req.user.role === 'admin') return next();
    res.status(403).json({ error: 'Forbidden: insufficient role' });
  };
}

function requireOperatorOrAbove(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (['operator', 'admin'].includes(req.user.role)) return next();
  res.status(403).json({ error: 'Forbidden' });
}
```

**File**: `backend/middleware/auth.js` (ADD auth check for WebSocket PTT)

PTT calls harus cek user role. Jika viewer, tolak dengan error:
```javascript
// Di server.js, case 'call':
if (req.user.role === 'viewer') {
  ws.send(JSON.stringify({ type: 'error', message: 'Viewers tidak bisa melakukan panggilan PTT' }));
  return;
}
```

---

### Phase 11: Audit Logging System

**File**: `backend/utils/auditLog.js` (NEW)

```javascript
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
      ip: req.ip,
      userAgent: req.get('user-agent'),
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
    .limit(limit)
    .toArray();
}

module.exports = { ACTIONS, logAction, getAuditLogs };
```

**Logging Points**:
- POST /api/auth/login → log `login` or `login_failed` (dengan username, reason)
- POST /api/auth/logout → log `logout`
- POST /api/admin/users → log `user_created` (dengan new username, role)
- PUT /api/admin/users/:id → log `user_updated` (dengan old role, new role)
- DELETE /api/admin/users/:id → log `user_deleted`
- PUT /api/admin/users/:id/deactivate → log `user_deactivated`
- POST /api/admin/users/:id/reset-password → log `password_reset`
- WebSocket case 'call' → log `ptt_call_initiated` (dengan caller, target)
- WebSocket case 'muteDevice' → log `device_muted`
- GET /api/admin/audit-logs → retrieve logs (admin only)

---

### Phase 12: Frontend Role Guard

**File**: `frontend/src/roleGuard.js` (NEW)

```javascript
// Fetch current user & apply role-based UI visibility
async function setupRoleGuard() {
  try {
    const resp = await fetch('/api/auth/me', { credentials: 'include' });
    if (!resp.ok) return; // not authenticated
    
    const user = await resp.json();
    window.currentUser = user;
    
    // Hide admin panel for non-admins
    if (user.role !== 'admin') {
      document.getElementById('adminPanelBtn').style.display = 'none';
    }
    
    // Hide PTT UI for viewers
    if (user.role === 'viewer') {
      document.getElementById('pttActivePanel').style.display = 'none';
      document.querySelectorAll('[data-require-operator]').forEach(el => {
        el.style.display = 'none';
      });
    }
    
    // Show user badge
    const userBadge = document.getElementById('userBadge');
    if (userBadge) {
      userBadge.innerHTML = `<i class="fa-solid fa-user"></i> ${user.displayName} (${user.role})`;
    }
  } catch (err) {
    console.error('Role guard error:', err);
  }
}

// Call pada page load
document.addEventListener('DOMContentLoaded', setupRoleGuard);
```

---

### Phase 13: Docker & Environment

**File**: `deploy_pelindo/backend/.env` (MODIFY)

```env
PORT=9090
MONGO_URI=mongodb://mongo:27017
MONGO_DB=pelindo_maps
COOKIE_SECRET=generate-random-32-char-string-here
ADMIN_DEFAULT_PASSWORD=TempPassword123!
NODE_ENV=production
```

**File**: `deploy_pelindo/backend/package.json` (MODIFY)

Tambah dependencies:
```json
{
  "dependencies": {
    "mongodb": "^6.x",
    "bcrypt": "^5.x",
    "express-rate-limit": "^7.x",
    "helmet": "^7.x"
  }
}
```

---

## File Changes Summary

### New Files
| File | Purpose |
|------|---------|
| `backend/db.js` | MongoDB connection singleton, indexes, audit log helper |
| `backend/seed.js` | Seed default admin user on first boot |
| `backend/utils/auditLog.js` | logAction(action, userId, targetId, details, req) |
| `backend/middleware/auth.js` | authMiddleware, adminMiddleware, viewerMiddleware, rate limiters |
| `backend/middleware/roles.js` | requireRole(role), requireAdmin, requireOperatorOrAbove |
| `backend/routes/auth.js` | Login, logout, me endpoints + audit logging |
| `backend/routes/admin.js` | User CRUD (admin only) + audit logging |
| `backend/routes/viewer.js` | Viewer-specific endpoints (if needed) |
| `frontend/src/admin.js` | Admin panel modal UI (user list, create, edit, delete) |
| `frontend/src/roleGuard.js` | Role-based UI visibility (hide admin panel for non-admins, hide PTT for viewers) |

### Modified Files
| File | Changes |
|------|---------|
| `backend/server.js` | Add helmet, fix CORS, fix SSRF, mount routes, seed admin, init audit log, role enforcement |
| `backend/package.json` | Add mongodb, bcrypt, express-rate-limit, helmet |
| `backend/.env` | Add MONGO_URI, MONGO_DB, COOKIE_SECRET, ADMIN_DEFAULT_PASSWORD |
| `frontend/index.html` | Login form, logout button, admin panel modal |
| `frontend/src/auth.js` | Backend captcha + login flow, remove client-side captcha |
| `frontend/src/roleGuard.js` | Check user.role on page load, hide features per role |
| `frontend/script.js` | Load roleGuard, hide admin/PTT UI for non-admins/viewers |
| `frontend/style.css` | Login form, admin panel modal styles |

---

## Security Checklist

| # | Threat | Mitigation | Status |
|---|--------|------------|--------|
| 1 | Brute-force login | Rate limiter (5/15min) + account lockout (5 fails = 15min lock) | ☐ |
| 2 | Captcha bypass | Server-side SVG captcha, signed cookie, rate limited | ☐ |
| 3 | Password cracking | bcrypt cost 12, min 8 chars complexity requirements | ☐ |
| 4 | Session hijacking | httpOnly + secure + sameSite cookies, signed | ☐ |
| 5 | Session fixation | New token on every login, old sessions invalidated | ☐ |
| 6 | XSS token theft | No token in JS-accessible storage (no localStorage/sessionStorage) | ☐ |
| 7 | CSRF | sameSite: 'strict' cookies, state-changing ops = POST only | ☐ |
| 8 | SSRF via N8N proxy | URL whitelist, hostname validation | ☐ |
| 9 | Timing attacks | Generic error messages ("username atau password salah") | ☐ |
| 10 | User enumeration | Same error for wrong username vs wrong password | ☐ |
| 11 | Session persistence | MongoDB-backed sessions survive restart, TTL auto-cleanup | ☐ |
| 12 | Weak tokens | crypto.randomUUID() (128-bit entropy) | ☐ |
| 13 | HTTP security headers | helmet (X-Frame-Options, CSP, HSTS, etc.) | ☐ |
| 14 | Client-side bypass | No client-side auth state; all checks server-side | ☐ |
| 15 | Privilege escalation | Role-based middleware, admin can't delete self | ☐ |
| 16 | Cookie secret leak | COOKIE_SECRET from env var, not hardcoded | ☐ |
| 17 | Password in logs | Never log passwords, only log username on failed attempts | ☐ |
| 18 | MongoDB injection | Parameterized queries (MongoDB driver handles this) | ☐ |

---

## Verification / Testing

1. **Login flow**:
   - [ ] Captcha SVG loads from backend
   - [ ] Correct credentials + captcha → login success → dashboard loads
   - [ ] Wrong captcha → error, captcha refreshes
   - [ ] Wrong password → error, captcha refreshes, failedAttempts increments
   - [ ] 5 wrong passwords → account locked 15 minutes
   - [ ] Rate limit after 5 rapid login attempts → 429 response

2. **Session management**:
   - [ ] Cookie set correctly (httpOnly, secure, signed)
   - [ ] Refresh page → still authenticated (GET /api/auth/me)
   - [ ] Logout → cookie cleared, can't access protected routes
   - [ ] Server restart → sessions survive (MongoDB)
   - [ ] Expired session → auto-cleaned by MongoDB TTL

3. **Admin panel**:
   - [ ] Only visible for admin role
   - [ ] Create user with valid data → success
   - [ ] Create user with duplicate username → error
   - [ ] Create user with weak password → validation error
   - [ ] Deactivate user → their sessions deleted, can't login
   - [ ] Non-admin trying admin endpoints → 403

4. **Security**:
   - [ ] `sessionStorage.ptt_auth_passed` no longer exists
   - [ ] DevTools console: no token in localStorage/sessionStorage
   - [ ] N8N proxy: arbitrary URL → 403
   - [ ] Response headers include helmet security headers
   - [ ] CORS only allows configured origins

---

## Risks & Tradeoffs

1. **bcrypt di Node.js** — bcrypt native binding bisa gagal build di Alpine Docker. Mitigation: gunakan `bcryptjs` (pure JS) sebagai fallback, atau pastikan `python3` + `make` ada di Dockerfile.

2. **MongoDB dependency** — user data dan sessions sekarang depend pada MongoDB. Jika MongoDB down, tidak ada yang bisa login. Mitigation: MongoDB sudah ada di stack dan dipakai N8N.

3. **Default admin password** — hardcoded di env. Mitigation: log warning di console untuk segera ganti password setelah first boot.

4. **No email/2FA** — plan ini tidak include email verification atau 2FA. Bisa ditambahkan di iterasi berikutnya jika diperlukan.

5. **Mobile app (TruckPTT)** — mobile app menggunakan REGISTRATION_SECRET via WebSocket, BUKAN login user. Plan ini tidak mengubah flow mobile. Mobile tetap bypass auth via WebSocket secret.

---

## Decisions (Resolved)

1. **User roles**: 3 roles — `admin`, `operator`, `viewer`. Viewer = read-only (bisa lihat map & history, TIDAK bisa PTT/call/mute).
2. **Audit log**: Ya — MongoDB collection `audit_logs` { action, userId, username, targetId, details, ip, userAgent, timestamp }. Actions: login, logout, login_failed, user_created, user_updated, user_deleted, user_deactivated, password_reset.
3. **Password expiry**: Tidak perlu.
4. **Admin panel**: Modal overlay di dashboard (bukan halaman terpisah).
