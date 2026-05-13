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

  ws.on('message', (message, isBinary) => {
    if (isBinary) {
      // Audio chunk received, forward to partner
      if (currentClientId) {
        const partnerId = sessions.get(currentClientId);
        if (partnerId) {
          const partnerWs = clients.get(partnerId);
          if (partnerWs && partnerWs.readyState === WebSocket.OPEN) {
            partnerWs.send(message, { binary: true });
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
