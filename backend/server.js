require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const svgCaptcha = require('svg-captcha');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');

const { connectDB, getDb } = require('./db');
const { seedAdmin } = require('./seed');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const deviceRoutes = require('./routes/device');
const reportRoutes = require('./routes/reports');
const { authMiddleware } = require('./middleware/auth');
const { logAction, ACTIONS } = require('./utils/auditLog');

const app = express();
const server = http.createServer(app);
// SECURITY (M02 M4 + M7): bound payload size to 1MB and verify Origin header to prevent
//   browser-based WS hijack. Mobile clients (no Origin) allowed; empty/missing Origin from
//   native clients is expected.
const wss = new WebSocket.Server({
  server,
  path: '/ws',
  maxPayload: 1024 * 1024, // 1MB max per message
  verifyClient: ({ origin, req }) => {
    // Allow no Origin (native mobile / curl / wscat) and whitelisted web origins.
    if (!origin) return true;
    try {
      const { hostname } = new URL(origin);
      return WS_ALLOWED_ORIGINS.includes(hostname);
    } catch {
      return false;
    }
  },
});

const PORT = process.env.PORT || 9090;
const REGISTRATION_SECRET = process.env.VITE_REGISTRATION_SECRET || process.env.REGISTRATION_SECRET || '';
const WS_ALLOWED_ORIGINS = (process.env.WS_ALLOWED_ORIGINS || 'ptt.teluklamong.co.id,www.ptt.teluklamong.co.id').split(',').map(s => s.trim()).filter(Boolean);

// Connect to MongoDB
connectDB().then(async () => {
  await seedAdmin();
}).catch(err => {
  console.error('FATAL: Failed to connect to MongoDB:', err.message);
  process.exit(1);
});

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Matikan CSP agar tidak bentrok dengan script frontend sementara
}));

app.use(cors({
  origin: ['https://ptt.teluklamong.co.id', 'https://www.ptt.teluklamong.co.id'],
  credentials: true
}));
app.use(express.json({ limit: '1mb' })); // M02 L3: bound body size to prevent DoS
app.set('trust proxy', 2); // M02 L6: Cloudflare (1) + nginx (2) hops. Salah hitung → rate limiter & audit log pakai IP salah.
// SECURITY (M02 H1): reject startup if COOKIE_SECRET missing — fallback hardcoded in source = forgeable session.
const cookieSecret = process.env.COOKIE_SECRET;
if (!cookieSecret || cookieSecret.length < 32) {
  console.error('FATAL: COOKIE_SECRET env var must be set (>=32 chars). Refusing to start.');
  process.exit(1);
}
app.use(cookieParser(cookieSecret));

// BE-#11: global rejection/exception handlers — without these the process keeps running
//   with dbInstance === null after a transient DB failure, returning 500 to all auth routes.
process.on('unhandledRejection', (reason, promise) => {
  console.error('FATAL: unhandledRejection — crashing to prevent silent data loss:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('FATAL: uncaughtException — crashing:', err);
  process.exit(1);
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/device', deviceRoutes);
app.use('/api/reports', reportRoutes);

// 1. Generate Captcha (M02 H4: hardening against OCR + add per-IP rate limit)
const captchaRateLimit = new Map(); // ip -> { count, resetAt }
const CAPTCHA_LIMIT = 30; // 30 fetches per 5 min per IP
const CAPTCHA_WINDOW = 5 * 60 * 1000;
app.get('/api/captcha', (req, res) => {
  // Per-IP rate limit (defeats mass-OCR to harvest codes)
  const ip = req.ip;
  const now = Date.now();
  const entry = captchaRateLimit.get(ip) || { count: 0, resetAt: now + CAPTCHA_WINDOW };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + CAPTCHA_WINDOW; }
  if (entry.count >= CAPTCHA_LIMIT) {
    return res.status(429).json({ error: 'Too many captcha requests, slow down' });
  }
  entry.count++;
  captchaRateLimit.set(ip, entry);

  const captcha = svgCaptcha.create({
    size: 6,         // 6 chars (was 5) — bigger search space
    noise: 6,        // more noise
    color: true,
    background: '#f8fafc',
    charPreset: '0123456789', // digits only, no letters (smaller OCR-confusable set)
    width: 180,
    height: 60,
  });

  res.cookie('captcha_text', captcha.text, {
    maxAge: 300000, // 5 minutes
    httpOnly: true,
    signed: true,
    sameSite: 'none',
    secure: true
  });

  res.type('svg');
  res.status(200).send(captcha.data);
});

// 2. Proxy for N8N (Secure access - Diperbaiki untuk cegah SSRF)
app.all('/api/proxy/n8n', authMiddleware, async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url parameter');

    // SSRF Prevention + Internal Docker hostname rewrite
    // M01: N8N ikut migrasi ke ptt.teluklamong.co.id. Backend rewrite external URL
    //      ke internal Docker hostname (pelindo-n8n:5678) untuk efisiensi.
    //      Client (frontend) akses via ptt.teluklamong.co.id, backend ke N8N lewat Docker network.
    // C4: only the public hostname is allowed. Internal IP and external freeat hostname
    //     removed to prevent SSRF to internal infra and external proxy abuse.
    const N8N_EXTERNAL = 'ptt.teluklamong.co.id';
    const N8N_INTERNAL = 'pelindo-n8n:5678';
    const allowedHosts = [N8N_EXTERNAL];
    let finalUrl = targetUrl;
    
    try {
      const parsedUrl = new URL(targetUrl);
      if (!allowedHosts.includes(parsedUrl.host)) {
        return res.status(403).json({ error: 'Forbidden: Proxy destination not allowed' });
      }
      // Rewrite external Cloudflare URL to internal Docker hostname
      if (parsedUrl.host === N8N_EXTERNAL) {
        finalUrl = targetUrl.replace('https://' + N8N_EXTERNAL, 'http://' + N8N_INTERNAL);
      }
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    try {
      // H4 fix: log only host + pathname, never the full URL. Query strings
      //   on N8N webhooks may contain tokens; logging them leaks secrets.
      let parsedForLog;
      try { parsedForLog = new URL(finalUrl); } catch { parsedForLog = null; }
      const logTarget = parsedForLog ? `${parsedForLog.host}${parsedForLog.pathname}` : '<unparseable>';
      console.log('[proxy] calling:', logTarget);
      // BE-#6: add timeout + body cap to prevent hanging event loop + OOM
      //   Previous unbounded fetch could hang forever on slow upstream.
      //   Cap at 5s timeout and 5MB response body.
      // BE-#20: drop err.message from client response to prevent hostname/connection info leak
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      // BE-#21: forward method + body for non-GET requests (e.g. PUT update-tags)
      //   DO NOT forward url/query param from body — request body is pure N8N payload.
      const fetchOptions = {
        method: req.method,
        redirect: 'manual',
        signal: controller.signal,
      };
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        fetchOptions.headers = { 'Content-Type': 'application/json' };
        if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
          fetchOptions.body = JSON.stringify(req.body);
        }
      }
      let response;
      try {
        response = await fetch(finalUrl, fetchOptions);
      } finally {
        clearTimeout(timeoutId);
      }
      if (response.status >= 300 && response.status < 400) {
        return res.status(502).json({ error: 'Upstream redirect not allowed' });
      }
      // Cap response body size
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
        return res.status(502).json({ error: 'Upstream response too large' });
      }
      const text = await response.text();
      if (text.length > 5 * 1024 * 1024) {
        return res.status(502).json({ error: 'Upstream response too large' });
      }
      const data = JSON.parse(text);
      console.log('[proxy] OK, items:', Array.isArray(data) ? data.length : typeof data);
      res.json(data);
    } catch (err) {
      if (err.name === 'AbortError') {
        console.error('[proxy] TIMEOUT: upstream did not respond within 5s');
        return res.status(504).json({ error: 'Upstream timeout' });
      }
      console.error('[proxy] ERROR:', err.message);
      res.status(500).json({ error: 'Proxy failed' }); // BE-#20: no err.message in response
    }
});

// Map of clientId -> WebSocket connection
const clients = new Map();
// Map of clientId -> partnerClientId (who they are currently in a call with)
const sessions = new Map();
// Set of deviceIds that are muted by Command Center
const mutedDevices = new Set();
// Map of session clientId -> last activity timestamp (for auto-end inactive calls)
const callActivity = new Map();
// SECURITY (M02 H6): track trusted center IDs (centers whose auth_token resolved to
//   a real user session). Mobile trucks only auto-answer incomingCall from these.
const trustedCenters = new Set();

// Helper to get all command center connections
function getCenterClients() {
  return Array.from(clients.entries()).filter(([id]) => id.startsWith('center'));
}

server.listen(PORT, () => {
  console.log(`HTTP & WebSocket Server started on port ${PORT}`);
});

wss.on('connection', async (ws, req) => {
  console.log("New connection established");
  
  // Parse cookies from WS upgrade request manually
  let authToken = null;
  if (req.headers.cookie) {
    const rawCookies = req.headers.cookie.split(';').map(c => c.trim());
    for (const cookie of rawCookies) {
      if (cookie.startsWith('auth_token=')) {
        // Express signed cookie starts with s%3A (s:)
        const rawValue = decodeURIComponent(cookie.split('=')[1]);
        if (rawValue.startsWith('s:')) {
          // SECURITY (M02 H1): use the validated cookieSecret declared at startup (no fallback).
          // BUGFIX: pass rawValue (including 's:' prefix) to signedCookie. Previous
          //   .slice(2) removed the prefix, causing signedCookie to return the raw
          //   string (value.signature) instead of unsigned value. This made session
          //   lookup fail with "Unauthorized: valid login session required" after BE-#3.
          const unsigned = cookieParser.signedCookie(rawValue, cookieSecret);
          if (unsigned !== false) authToken = unsigned;
        } else {
          authToken = rawValue;
        }
      }
    }
  }

  let currentClientId = null;
  ws.isAlive = true;
  // SECURITY (M02 M4): per-conn flood control. Max 50 binary frames / second.
  // BE-#9: also enforce byte budget — 50 frames of 1MB each = 50MB/s, so cap total
  //   bytes per second at 5MB (average 100KB/frame). Close conn if exceeded.
  let audioFrameCount = 0;
  let audioFrameWindow = Date.now();
  let audioByteBudget = 0;
  let audioByteBudgetWindow = Date.now();

  // Respond to pong
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (message, isBinary) => {
    if (isBinary) {
      // SECURITY (M02 M4): enforce per-conn audio frame rate + byte budget.
      //   If exceeded, drop frame and log. This caps broadcast amplification.
      const now = Date.now();
      if (now - audioFrameWindow >= 1000) {
        audioFrameCount = 0;
        audioFrameWindow = now;
      }
      if (now - audioByteBudgetWindow >= 1000) {
        audioByteBudget = 0;
        audioByteBudgetWindow = now;
      }
      audioFrameCount++;
      if (audioFrameCount > 50) return;
      // BE-#9: per-second byte budget. 50 frames × 1MB each = 50MB/s possible
      //   with maxPayload=1MB. Cap at 5MB/s and kill conn if exceeded.
      audioByteBudget += message.length || message.byteLength || 0;
      if (audioByteBudget > 5 * 1024 * 1024) {
        console.warn('Audio byte budget exceeded, closing connection');
        ws.close(4009, 'byte_budget_exceeded');
        return;
      }
      // 1. Always forward a copy to ALL center clients for global monitoring
      // MUTE CHECK: skip forwarding audio from muted devices
      if (currentClientId && !currentClientId.startsWith('center') && !mutedDevices.has(currentClientId)) {
        // Track call activity timestamp
        callActivity.set(currentClientId, Date.now());
        const partnerId = sessions.get(currentClientId);
        if (partnerId) callActivity.set(partnerId, Date.now());
        
        const centers = getCenterClients();
        centers.forEach(([id, centerWs]) => {
          if (centerWs.readyState === WebSocket.OPEN) {
            centerWs.send(JSON.stringify({
              type: 'audioStream',
              from: currentClientId,
              data: message.toString('base64')
            }));
          }
        });
      }

      // 2. Forward to session partner if active (and not muted)
      if (currentClientId && !mutedDevices.has(currentClientId)) {
        const partnerId = sessions.get(currentClientId);
        if (partnerId) {
          const partnerWs = clients.get(partnerId);
          if (partnerWs && partnerWs.readyState === WebSocket.OPEN) {
            // For mobile trucks, send raw binary
            if (!partnerId.startsWith('center')) {
              partnerWs.send(message, { binary: true });
            }
          }
        }
      }
    } else {
      // JSON Control Message
      try {
        const data = JSON.parse(message.toString());
        
        switch (data.type) {
          case 'register':
            // BE-#18: validate client ID — block control chars + log injection, but allow
            //   any printable ASCII. Serial numbers from Samsung/Knox devices vary widely
            //   (alphanumeric, spaces, dashes, etc). Original regex was too strict.
            if (!data.id || typeof data.id !== 'string' || data.id.length < 2) {
              console.log('[REGISTER] REJECTED empty/short id:', JSON.stringify(data.id));
              ws.send(JSON.stringify({ type: 'error', message: 'Invalid client ID' }));
              ws.close(4002, 'invalid_id');
              return;
            }
            if (data.id.length > 64) {
              ws.send(JSON.stringify({ type: 'error', message: 'Client ID too long' }));
              ws.close(4002, 'invalid_id');
              return;
            }
            if (/[\x00-\x1f]/.test(data.id)) {
              // Block control characters to prevent log injection
              ws.send(JSON.stringify({ type: 'error', message: 'Invalid characters in client ID' }));
              ws.close(4002, 'invalid_id');
              return;
            }
            // Web browser (center-*) sudah login via HTTP, izinkan
            // Mobile truck harus kirim REGISTRATION_SECRET
            if (data.id && data.id.startsWith('center')) {
              // BE-#3: reject center connections without a valid HTTP session.
              //   Previously, unauth browsers could join as 'operator' and receive audio,
              //   see device lists, and send calls. Now close(4401) if the session
              //   check fails — only authenticated HTTP users can join via WS.
              //   This also blocks the privilege-escalation-to-DoS chain where an
              //   unauthenticated attacker could call/force-logout devices.
              ws.userRole = 'operator';
              let sessionValid = false;
              if (authToken) {
                try {
                  const db = getDb();
                  const session = await db.collection('sessions').findOne({ token: authToken });
                  if (session && session.expiresAt > new Date()) {
                    const user = await db.collection('users').findOne({ _id: session.userId });
                    if (user && user.isActive) {
                      ws.userRole = user.role;
                      sessionValid = true;
                    }
                  }
                } catch(e) {
                  console.error('[WS] Session lookup error:', e.message);
                }
              }
              if (!sessionValid) {
                console.log('[WS] Rejected center connection: no valid session (authToken: ' + !!authToken + ')');
                ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized: valid login session required' }));
                ws.close(4401, 'unauthorized');
                return;
              }
            } else {
              // C5: require REGISTRATION_SECRET for mobile trucks. Previously `else if (true)`
              //     accepted any client → spoofing deviceId, broadcast audio on behalf of
              //     others, mute other devices. Now secret is enforced; empty secret = no
              //     mobile client can connect (set VITE_REGISTRATION_SECRET in deploy env).
              if (!REGISTRATION_SECRET) {
                console.error('FATAL: REGISTRATION_SECRET not configured. Refusing truck connection.');
                ws.send(JSON.stringify({ type: 'error', message: 'Server misconfigured: no registration secret' }));
                ws.close();
                return;
              }
              if (data.secret !== REGISTRATION_SECRET) {
                console.log(`Truck registration rejected: bad secret for ${data.id}`);
                ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed: invalid credentials' }));
                ws.close();
                return;
              }
              ws.userRole = 'truck';
            }

            // Clean up old connection with same ID if exists
            const oldWs = clients.get(data.id);
            if (oldWs && oldWs !== ws) {
              // BE-#10: tag old connection as replaced so its on('close') handler skips
              //   cleanup (otherwise it would delete the new connection's entry from clients Map)
              oldWs._replaced = true;
              console.log(`Closing stale connection for client: ${data.id}`);
              oldWs.close();
            }

            currentClientId = data.id;
            clients.set(currentClientId, ws);
            // SECURITY (M02 H6): only centers with a verified HTTP session are trusted
            //   sources for incomingCall. Mark them so trucks can distinguish.
            if (currentClientId.startsWith('center') && ws.userRole && ws.userRole !== 'viewer') {
              trustedCenters.add(currentClientId);
            }
            console.log(`Client registered: ${currentClientId} (role: ${ws.userRole || 'unknown'}, total clients: ${clients.size})`);
            
            // Jika client ini masih ada di daftar mute, kirim info mute ke dia agar status mobile menyesuaikan
            if (mutedDevices.has(currentClientId)) {
              ws.send(JSON.stringify({ type: 'muteStatus', muted: true }));
            }
            // Broadcast updated status to all centers
            broadcastConnectionStatus();
            break;

          case 'call':
            if (ws.userRole === 'viewer') {
              ws.send(JSON.stringify({ type: 'error', message: 'Viewer tidak memiliki akses PTT' }));
              return;
            }
            // { type: 'call', targetId: 'truck-123' }
            const targetId = data.targetId;
            
            // MUTE CHECK: if the calling device is muted, reject the call
            if (mutedDevices.has(currentClientId)) {
              ws.send(JSON.stringify({ type: 'error', message: 'Anda sedang di-mute oleh Command Center. Tidak bisa melakukan panggilan.' }));
              console.log(`Call blocked: ${currentClientId} is muted`);
              return;
            }
            
            // Special case: if calling 'center-main', find any available center
            let finalTargetId = targetId;
            if (targetId === 'center-main') {
              const centers = getCenterClients();
              if (centers.length > 0) {
                // For now, call the first available center or broadcast to all centers?
                // User says: "bisa denger semuanya maupun merespon"
                // So we broadcast the incoming call to all centers.
                // SECURITY (M02 H6): tag caller as trustedCenter so receivers can verify.
                centers.forEach(([id, centerWs]) => {
                  if (centerWs.readyState === WebSocket.OPEN) {
                    centerWs.send(JSON.stringify({
                      type: 'incomingCall',
                      callerId: currentClientId,
                      trustedCenter: trustedCenters.has(currentClientId)
                    }));
                  }
                });
                console.log(`Call broadcasted from ${currentClientId} to all centers`);
                return;
              }
            }

            const targetWs = clients.get(finalTargetId);
            console.log(`Call request: ${currentClientId} -> ${finalTargetId}`);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
              // Forward call request (tag trustedCenter so trucks only auto-answer legit centers)
              targetWs.send(JSON.stringify({
                type: 'incomingCall',
                callerId: currentClientId,
                trustedCenter: trustedCenters.has(currentClientId)
              }));
              console.log(`Call initiated from ${currentClientId} to ${finalTargetId}`);
            } else {
              // Target not found or offline
              ws.send(JSON.stringify({
                type: 'error',
                message: `Target is offline or not found (targetId: ${finalTargetId})`
              }));
              console.log(`Call FAILED: target '${finalTargetId}' not in clients map`);
            }
            break;

          case 'voiceMessage':
            if (ws.userRole === 'viewer') return; // blok voice message dari viewer
            
            // Track call activity for auto-end timeout
            if (currentClientId) {
              callActivity.set(currentClientId, Date.now());
              const partnerId = sessions.get(currentClientId);
              if (partnerId) callActivity.set(partnerId, Date.now());
            }
            
            // If this is a center client sending voice, broadcast to all center clients
            if (currentClientId && currentClientId.startsWith('center')) {
              const centers = getCenterClients();
              centers.forEach(([id, centerWs]) => {
                if (centerWs.readyState === WebSocket.OPEN && id !== currentClientId) {
                  // BE-#8: serialize through JSON.parse+stringify to guarantee clean
                  //   JSON output. message.toString() on binary data would corrupt audio.
                  //   Even though we're in the JSON branch, this protects against edge
                  //   cases where isBinary=false but content is binary-like.
                  try {
                    centerWs.send(JSON.stringify(JSON.parse(message.toString())));
                  } catch (e) {
                    console.error('voiceMessage forward error:', e.message);
                  }
                }
              });
            }
            
            // Also forward to session partner if active (truck receiving from center)
            const partnerIdMsg = sessions.get(currentClientId);
            if (partnerIdMsg) {
              const partnerWsMsg = clients.get(partnerIdMsg);
              if (partnerWsMsg && partnerWsMsg.readyState === WebSocket.OPEN) {
                // BE-#8: same safe serialization for partner forward
                try {
                  partnerWsMsg.send(JSON.stringify(JSON.parse(message.toString())));
                } catch (e) {
                  console.error('voiceMessage partner forward error:', e.message);
                }
              }
            }
            break;

          case 'acceptCall':
            // { type: 'acceptCall', callerId: 'truck-123' }
            const callerId = data.callerId;
            const callerWs = clients.get(callerId);

            if (callerWs && callerWs.readyState === WebSocket.OPEN) {
              // BE-#2: reject if caller already in a session — prevents double-session
              //   audio fan-out when two centers simultaneously accept the same call.
              if (sessions.has(callerId)) {
                console.log('acceptCall rejected: ' + callerId + ' already in session');
                ws.send(JSON.stringify({ type: 'error', message: 'Caller already in an active session' }));
                return;
              }
              // Establish session for both
              sessions.set(currentClientId, callerId);
              sessions.set(callerId, currentClientId);
              
              // Init call activity timestamps
              callActivity.set(currentClientId, Date.now());
              callActivity.set(callerId, Date.now());
              
              callerWs.send(JSON.stringify({
                type: 'callAccepted',
                targetId: currentClientId
              }));
              console.log(`Call accepted: Session formed between ${currentClientId} and ${callerId}`);
              
              // Notify other centers that this call was handled? 
              // (Optional improvement: centers see which truck is busy)
            }
            break;

          case 'endCall':
            const activePartnerId = sessions.get(currentClientId);
            if (activePartnerId) {
              const activePartnerWs = clients.get(activePartnerId);
              if (activePartnerWs && activePartnerWs.readyState === WebSocket.OPEN) {
                activePartnerWs.send(JSON.stringify({
                  type: 'callEnded',
                  peerId: currentClientId
                }));
              }
              sessions.delete(currentClientId);
              sessions.delete(activePartnerId);
              callActivity.delete(currentClientId);
              callActivity.delete(activePartnerId);
            }
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;

          case 'muteDevice':
            // { type: 'muteDevice', targetId: 'device-123' } — sent by Command Center
            // SECURITY: require admin role (M02: privilege escalation fix)
            if (currentClientId && currentClientId.startsWith('center') && ws.userRole === 'admin') {
              const muteTarget = data.targetId;
              mutedDevices.add(muteTarget);
              console.log(`Device ${muteTarget} muted by ${currentClientId}`);

              // Notify the muted device
              const mutedWs = clients.get(muteTarget);
              if (mutedWs && mutedWs.readyState === WebSocket.OPEN) {
                mutedWs.send(JSON.stringify({ type: 'muteStatus', muted: true }));
              }

              // Broadcast updated mute list to all centers
              broadcastMuteStatus();
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'Forbidden: admin role required' }));
            }
            break;

          case 'unmuteDevice':
            // { type: 'unmuteDevice', targetId: 'device-123' } — sent by Command Center
            // SECURITY: require admin role
            if (currentClientId && currentClientId.startsWith('center') && ws.userRole === 'admin') {
              const unmuteTarget = data.targetId;
              mutedDevices.delete(unmuteTarget);
              console.log(`Device ${unmuteTarget} unmuted by ${currentClientId}`);

              // Notify the unmuted device
              const unmutedWs = clients.get(unmuteTarget);
              if (unmutedWs && unmutedWs.readyState === WebSocket.OPEN) {
                unmutedWs.send(JSON.stringify({ type: 'muteStatus', muted: false }));
              }

              // Broadcast updated mute list to all centers
              broadcastMuteStatus();
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'Forbidden: admin role required' }));
            }
            break;

          case 'forceLogout':
            // { type: 'forceLogout', targetId: 'device-123' } — sent by Command Center (admin)
            // M01 P4: admin kick device dari pusat. Device akan clear state + kembali ke login.
            // SECURITY: require admin role (M02: privilege escalation fix). Operator tidak boleh kick.
            // BE-#7: close immediately + tag _forceLogoutedAt. Previous setTimeout(1s) created a
            //   race where if the device reconnects within 1s, the timeout kills the NEW connection.
            if (currentClientId && currentClientId.startsWith('center') && ws.userRole === 'admin') {
              const targetId = data.targetId;
              console.log(`Device ${targetId} force-logout by ${currentClientId}`);
              const targetWs = clients.get(targetId);
              if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs._forceLogoutedAt = Date.now();
                targetWs.send(JSON.stringify({ type: 'forceLogout', reason: 'logout_from_center' }));
                targetWs.close(4001, 'force_logout');
                // Cleanup maps + broadcast offline status — close handler will skip
                //   because of _forceLogoutedAt guard, so we do it here.
                clients.delete(targetId);
                trustedCenters.delete(targetId);
                const partnerId = sessions.get(targetId);
                if (partnerId) {
                  const partnerWs = clients.get(partnerId);
                  if (partnerWs && partnerWs.readyState === WebSocket.OPEN) {
                    partnerWs.send(JSON.stringify({ type: 'callEnded', peerId: targetId, reason: 'force_logout' }));
                  }
                  sessions.delete(targetId);
                  sessions.delete(partnerId);
                  callActivity.delete(targetId);
                  callActivity.delete(partnerId);
                }
                mutedDevices.delete(targetId);
                broadcastConnectionStatus();
              }
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'Forbidden: admin role required' }));
            }
            break;

          case 'locationUpdate':
            // { type: 'locationUpdate', deviceId: '...', coordinates: [lat, lng] }
            // SECURITY (M02 H5): validate coordinates to prevent spoofing. Reject if
            //   coords are out of range or deviceId is empty/wrong-shape.
            if (data.deviceId !== currentClientId) {
              console.warn(`locationUpdate rejected: deviceId ${data.deviceId} !== ${currentClientId}`);
              break;
            }
            if (!Array.isArray(data.coordinates) || data.coordinates.length !== 2 ||
                typeof data.coordinates[0] !== 'number' || typeof data.coordinates[1] !== 'number' ||
                data.coordinates[0] < -90 || data.coordinates[0] > 90 ||
                data.coordinates[1] < -180 || data.coordinates[1] > 180) {
              console.warn(`locationUpdate rejected: bad coords from ${currentClientId}`);
              break;
            }
            const centers = getCenterClients();
            centers.forEach(([id, centerWs]) => {
              if (centerWs.readyState === WebSocket.OPEN) {
                centerWs.send(message.toString());
              }
            });
            break;
        }
      } catch (err) {
        console.error("Error parsing JSON message:", err);
      }
    }
  });

  ws.on('close', () => {
    // BE-#7+BE-#10: skip cleanup if this connection was force-logouted or replaced
    //   by a new registration. Otherwise stale close handler would delete the
    //   new connection's entry from clients Map.
    if (ws._forceLogoutedAt || ws._replaced) return;
    if (currentClientId) {
      clients.delete(currentClientId);
      trustedCenters.delete(currentClientId);
      console.log(`Client disconnected: ${currentClientId}`);
      
      const partnerId = sessions.get(currentClientId);
      if (partnerId) {
        const partnerWs = clients.get(partnerId);
        if (partnerWs && partnerWs.readyState === WebSocket.OPEN) {
          partnerWs.send(JSON.stringify({
            type: 'callEnded',
            peerId: currentClientId,
            reason: 'disconnected'
          }));
        }
        sessions.delete(currentClientId);
        sessions.delete(partnerId);
        callActivity.delete(currentClientId);
        callActivity.delete(partnerId);
      }
      
      // Update centers dashboard about disconnection
      broadcastConnectionStatus();
    }
  });
});

// Helper to notify dashboard about which trucks are online for PTT
function broadcastConnectionStatus() {
  const centers = getCenterClients();
  const onlineIds = Array.from(clients.keys()).filter(id => !id.startsWith('center'));
  const mutedIds = Array.from(mutedDevices);
  
  centers.forEach(([id, centerWs]) => {
    if (centerWs.readyState === WebSocket.OPEN) {
      centerWs.send(JSON.stringify({
        type: 'connectionStatusUpdate',
        onlineDeviceIds: onlineIds,
        mutedDeviceIds: mutedIds
      }));
    }
  });
}

// Helper to notify all centers about mute status changes
function broadcastMuteStatus() {
  const centers = getCenterClients();
  const mutedIds = Array.from(mutedDevices);
  
  centers.forEach(([id, centerWs]) => {
    if (centerWs.readyState === WebSocket.OPEN) {
      centerWs.send(JSON.stringify({
        type: 'muteStatusUpdate',
        mutedDeviceIds: mutedIds
      }));
    }
  });
}

// Ping all clients every 25 seconds to keep connections alive
const keepaliveInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('Terminating dead connection');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

// H6: bumped from 25s → 90s. The 25s window dropped calls while the
//     operator was silently monitoring (mic off, audio still playing).
//     Dispatcher use-case requires longer idle tolerance.
const AUTO_END_DELAY = 90 * 1000;
// BE-#4: periodic callActivity janitor — sweep entries whose clientId is no longer
//   in the clients Map. Without this, devices that disconnect during a call (or crash)
//   leave stale callActivity entries that grow memory unboundedly.
const callActivityJanitor = setInterval(() => {
  const clientIds = new Set(clients.keys());
  for (const key of callActivity.keys()) {
    if (!clientIds.has(key)) callActivity.delete(key);
  }
}, 60000);

// BE-#5: captchaRateLimit janitor — sweep stale entries when size exceeds threshold.
//   An attacker cycling through IPs or behind a large NAT could grow this Map
//   unboundedly without periodic cleanup.
const captchaRateLimitJanitor = setInterval(() => {
  if (captchaRateLimit.size > 10000) {
    const now = Date.now();
    for (const [ip, entry] of captchaRateLimit) {
      if (now > entry.resetAt) captchaRateLimit.delete(ip);
    }
  }
}, 300000); // every 5 min

const autoEndInterval = setInterval(() => {
  const now = Date.now();
  sessions.forEach((partnerId, clientId) => {
    const lastActivity = callActivity.get(clientId) || 0;
    if (now - lastActivity > AUTO_END_DELAY) {
      console.log(`Auto-ending inactive call: ${clientId} ↔ ${partnerId}`);
      
      // Notify both parties
      const clientWs = clients.get(clientId);
      const partnerWs = clients.get(partnerId);
      
      if (clientWs && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'callEnded', peerId: partnerId, reason: 'inactivity' }));
      }
      if (partnerWs && partnerWs.readyState === WebSocket.OPEN) {
        partnerWs.send(JSON.stringify({ type: 'callEnded', peerId: clientId, reason: 'inactivity' }));
      }
      
      // Clean up sessions
      sessions.delete(clientId);
      sessions.delete(partnerId);
      callActivity.delete(clientId);
      callActivity.delete(partnerId);
    }
  });
}, 10000);

// BE-#19: also listen on server.close() — if HTTP server is closed directly
//   without wss.close(), the intervals would orphan.
server.on('close', () => {
  clearInterval(keepaliveInterval);
  clearInterval(callActivityJanitor);
  clearInterval(captchaRateLimitJanitor);
  clearInterval(autoEndInterval);
});

wss.on('close', () => {
  clearInterval(keepaliveInterval);
  clearInterval(callActivityJanitor);
  clearInterval(captchaRateLimitJanitor);
  clearInterval(autoEndInterval);
});
