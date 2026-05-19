require('dotenv').config();
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const REGISTRATION_SECRET = process.env.REGISTRATION_SECRET;

const wss = new WebSocket.Server({ port: PORT });

// Map of clientId -> WebSocket connection
const clients = new Map();

// Map of clientId -> partnerClientId (who they are currently in a call with)
const sessions = new Map();

// Helper to get all command center connections
function getCenterClients() {
  return Array.from(clients.entries()).filter(([id]) => id.startsWith('center'));
}

console.log(`WebSocket Relay Server started on port ${PORT}`);

wss.on('connection', (ws) => {
  console.log("New connection established");
  let currentClientId = null;
  ws.isAlive = true;

  // Respond to pong
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (message, isBinary) => {
    if (isBinary) {
      // 1. Always forward a copy to ALL center clients for global monitoring
      if (currentClientId && !currentClientId.startsWith('center')) {
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

      // 2. Forward to session partner if active
      if (currentClientId) {
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
            
            // Broadcast updated status to all centers
            broadcastConnectionStatus();
            break;

          case 'call':
            // { type: 'call', targetId: 'truck-123' }
            const targetId = data.targetId;
            
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
            }
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
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
      
      // Update centers dashboard about disconnection
      broadcastConnectionStatus();
    }
  });
});

// Helper to notify dashboard about which trucks are online for PTT
function broadcastConnectionStatus() {
  const centers = getCenterClients();
  const onlineIds = Array.from(clients.keys()).filter(id => !id.startsWith('center'));
  
  centers.forEach(([id, centerWs]) => {
    if (centerWs.readyState === WebSocket.OPEN) {
      centerWs.send(JSON.stringify({
        type: 'connectionStatusUpdate',
        onlineDeviceIds: onlineIds
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

wss.on('close', () => {
  clearInterval(keepaliveInterval);
});
