const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

// Map of clientId -> WebSocket connection
const clients = new Map();

// Map of clientId -> partnerClientId (who they are currently in a call with)
const sessions = new Map();

console.log("WebSocket Relay Server started on port 8080");

wss.on('connection', (ws) => {
  console.log("New connection established");
  let currentClientId = null;
  ws.isAlive = true;

  // Respond to pong
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (message, isBinary) => {
    if (isBinary) {
      // 1. Always forward a copy to center-main for global monitoring
      const centerWs = clients.get('center-main');
      if (centerWs && centerWs.readyState === WebSocket.OPEN && currentClientId !== 'center-main') {
        centerWs.send(JSON.stringify({
          type: 'audioStream',
          from: currentClientId,
          data: message.toString('base64')
        }));
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
            currentClientId = data.id;
            clients.set(currentClientId, ws);
            console.log(`Client registered: ${currentClientId}`);
            break;

          case 'call':
            // { type: 'call', targetId: 'truck-123' }
            const targetId = data.targetId;
            const targetWs = clients.get(targetId);
            
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
                message: 'Target is offline or not found'
              }));
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
              // End session for both
              sessions.delete(currentClientId);
              sessions.delete(activePartnerId);
              console.log(`Call ended between ${currentClientId} and ${activePartnerId}`);
            }
            break;

          default:
            console.log(`Unknown message type: ${data.type}`);
        }
      } catch (e) {
        console.error("Failed to parse message:", e);
      }
    }
  });

  ws.on('close', () => {
    if (currentClientId) {
      console.log(`Client disconnected: ${currentClientId}`);
      clients.delete(currentClientId);
      
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
    }
  });
});

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
