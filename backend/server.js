require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const svgCaptcha = require('svg-captcha');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');

const { connectDB } = require('./db');
const { seedAdmin } = require('./seed');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const { authMiddleware } = require('./middleware/auth');
const { logAction, ACTIONS } = require('./utils/auditLog');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const PORT = process.env.PORT || 9090;
const REGISTRATION_SECRET = process.env.VITE_REGISTRATION_SECRET || '';

// Connect to MongoDB
connectDB().then(async () => {
  await seedAdmin();
});

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Matikan CSP agar tidak bentrok dengan script frontend sementara
}));

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.set('trust proxy', 1); // dibutuhkan untuk secure cookies di belakang Cloudflare/nginx
const cookieSecret = process.env.COOKIE_SECRET || 'fallback_secret_only_for_dev_2026';
app.use(cookieParser(cookieSecret));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// 1. Generate Captcha (Diperbarui)
app.get('/api/captcha', (req, res) => {
  const captcha = svgCaptcha.create({
    size: 5,
    noise: 4,
    color: true,
    background: '#f8fafc'
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
app.get('/api/proxy/n8n', authMiddleware, async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url parameter');

    // SSRF Prevention + Internal Docker hostname rewrite
    const N8N_EXTERNAL = 'n8n-teluk-lamong.freeat.me';
    const N8N_INTERNAL = 'pelindo-n8n:5678';
    const allowedHosts = ['10.118.62.60:5678', N8N_EXTERNAL];
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
      console.log('[proxy] calling:', finalUrl);
      const response = await fetch(finalUrl);
      const data = await response.json();
      console.log('[proxy] OK, items:', Array.isArray(data) ? data.length : typeof data);
      res.json(data);
    } catch (err) {
      console.error('[proxy] ERROR:', err.message);
      res.status(500).json({ error: 'Proxy failed', details: err.message });
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
          const cookieParser = require('cookie-parser');
          const cookieSecret = process.env.COOKIE_SECRET || 'fallback_secret_only_for_dev_2026';
          const unsigned = cookieParser.signedCookie(rawValue.slice(2), cookieSecret);
          if (unsigned !== false) authToken = unsigned;
        } else {
          authToken = rawValue;
        }
      }
    }
  }

  let currentClientId = null;
  ws.isAlive = true;

  // Respond to pong
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (message, isBinary) => {
    if (isBinary) {
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
            // Web browser (center-*) sudah login via HTTP, izinkan
            // Mobile truck harus kirim REGISTRATION_SECRET
            if (data.id && data.id.startsWith('center')) {
              // Browser center: skip credential check (already auth via HTTP login)
              ws.userRole = 'operator'; // default role, akan di-override jika ada session
              if (authToken) {
                try {
                  const db = getDb();
                  const session = await db.collection('sessions').findOne({ token: authToken });
                  if (session && session.expiresAt > new Date()) {
                    const user = await db.collection('users').findOne({ _id: session.userId });
                    if (user && user.isActive) ws.userRole = user.role;
                  }
                } catch(e) { /* fallback to operator */ }
              }
            } else if (true /* Skip mobile auth check */) {
              // Mobile truck authentication
              ws.userRole = 'truck';
            } else {
              console.log(`Registration failed for ${data.id}: Missing credentials`);
              ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed: Missing credentials' }));
              ws.close();
              return;
            }

            // Clean up old connection with same ID if exists
            const oldWs = clients.get(data.id);
            if (oldWs && oldWs !== ws) {
              console.log(`Closing stale connection for client: ${data.id}`);
              oldWs.close();
            }

            currentClientId = data.id;
            clients.set(currentClientId, ws);
            console.log(`Client registered: ${currentClientId} (total clients: ${clients.size})`);
            
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
                centers.forEach(([id, centerWs]) => {
                  if (centerWs.readyState === WebSocket.OPEN) {
                    centerWs.send(JSON.stringify({
                      type: 'incomingCall',
                      callerId: currentClientId
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
              // Forward call request
              targetWs.send(JSON.stringify({
                type: 'incomingCall',
                callerId: currentClientId
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
                  centerWs.send(message.toString());
                }
              });
            }
            
            // Also forward to session partner if active (truck receiving from center)
            const partnerIdMsg = sessions.get(currentClientId);
            if (partnerIdMsg) {
              const partnerWsMsg = clients.get(partnerIdMsg);
              if (partnerWsMsg && partnerWsMsg.readyState === WebSocket.OPEN) {
                // Forward the voice message JSON as-is
                partnerWsMsg.send(message.toString());
              }
            }
            break;

          case 'acceptCall':
            // { type: 'acceptCall', callerId: 'truck-123' }
            const callerId = data.callerId;
            const callerWs = clients.get(callerId);
            
            if (callerWs && callerWs.readyState === WebSocket.OPEN) {
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
            if (currentClientId && currentClientId.startsWith('center')) {
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
            }
            break;

          case 'unmuteDevice':
            // { type: 'unmuteDevice', targetId: 'device-123' } — sent by Command Center
            if (currentClientId && currentClientId.startsWith('center')) {
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
            }
            break;

          case 'locationUpdate':
            // { type: 'locationUpdate', deviceId: '...', coordinates: [lat, lng] }
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
    if (currentClientId) {
      clients.delete(currentClientId);
      // Clean up mute status on disconnect
      if (mutedDevices.has(currentClientId)) {
        mutedDevices.delete(currentClientId);
        broadcastMuteStatus();
      }
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

// Auto-end inactive calls after 25 seconds of no audio exchange
const AUTO_END_DELAY = 25000; // 25 seconds threshold
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

wss.on('close', () => {
  clearInterval(keepaliveInterval);
  clearInterval(autoEndInterval);
});
