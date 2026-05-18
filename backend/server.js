require('dotenv').config();
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const REGISTRATION_SECRET = process.env.REGISTRATION_SECRET;

const wss = new WebSocket.Server({ port: PORT });

// Map of clientId -> WebSocket connection
const clients = new Map();

// Map of clientId -> partnerClientId (who they are currently in a call with)
const sessions = new Map();

console.log(`WebSocket Relay Server started on port ${PORT}`);

wss.on('connection', (ws) => {
  console.log("New connection established");
  let currentClientId = null;
  ws.isAlive = true;

  // Respond to pong
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (message, isBinary) => {
    if (isBinary) {
      // 1. Always forward a copy to center-main for global monitoring
      if (currentClientId) {
        const centerWs = clients.get('center-main');
        if (centerWs && centerWs.readyState === WebSocket.OPEN && currentClientId !== 'center-main') {
          centerWs.send(JSON.stringify({
            type: 'audioStream',
            from: currentClientId,
            data: message.toString('base64')
          }));
        }
      }

      // 2. Forward to session partner if active
      if (currentClientId) {
        const partnerId = sessions.get(currentClientId);
        if (partnerId) {
          const partnerWs = clients.get(partnerId);
          if (partnerWs && partnerWs.readyState === WebSocket.OPEN) {
            // For mobile, send raw binary
            if (partnerId !== 'center-main') {
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
            // Basic security check if secret is configured
            if (REGISTRATION_SECRET && data.secret !== REGISTRATION_SECRET) {
              console.log(`Registration failed for ${data.id}: Invalid secret`);
              ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed: Invalid secret' }));
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
            
            // Broadcast updated status to center-main
            broadcastConnectionStatus();
            break;

          case 'call':
            // { type: 'call', targetId: 'truck-123' }
            const targetId = data.targetId;
            const targetWs = clients.get(targetId);

            console.log(`Call request: ${currentClientId} -> ${targetId}`);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
              // Forward call request
              targetWs.send(JSON.stringify({
                type: 'incomingCall',
                callerId: currentClientId
              }));
              console.log(`Call initiated from ${currentClientId} to ${targetId}`);
            } else {
              // Target not found or offline
              ws.send(JSON.stringify({
                type: 'error',
                message: `Target is offline or not found (targetId: ${targetId})`
              }));
              console.log(`Call FAILED: target '${targetId}' not in clients map`);
            }
            break;

          case 'voiceMessage':
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
            // { type: 'acceptCall', callerId: 'center-main' }
            const callerId = data.callerId;
            const callerWs = clients.get(callerId);
            
            if (callerWs && callerWs.readyState === WebSocket.OPEN) {
              // Establish session for both
              sessions.set(currentClientId, callerId);
              sessions.set(callerId, currentClientId);
              
              callerWs.send(JSON.stringify({
                type: 'callAccepted',
                targetId: currentClientId
              }));
              console.log(`Call accepted: Session formed between ${currentClientId} and ${callerId}`);
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
            }
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;

          case 'locationUpdate':
            // { type: 'locationUpdate', deviceId: '...', coordinates: [lat, lng] }
            const centerWsLoc = clients.get('center-main');
            if (centerWsLoc && centerWsLoc.readyState === WebSocket.OPEN) {
              centerWsLoc.send(message.toString());
            }
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
      }
      
      // Update center dashboard about disconnection
      broadcastConnectionStatus();
    }
  });
});

// Helper to notify dashboard about which trucks are online for PTT
function broadcastConnectionStatus() {
  const centerWs = clients.get('center-main');
  if (centerWs && centerWs.readyState === WebSocket.OPEN) {
    const onlineIds = Array.from(clients.keys()).filter(id => id !== 'center-main');
    centerWs.send(JSON.stringify({
      type: 'connectionStatusUpdate',
      onlineDeviceIds: onlineIds
    }));
  }
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

wss.on('close', () => {
  clearInterval(keepaliveInterval);
});
