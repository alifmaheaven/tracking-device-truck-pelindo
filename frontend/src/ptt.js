/**
 * Push-To-Talk WebSocket + Audio Recording module.
 * Extracted from script.js — manages WebSocket lifecycle, MediaRecorder, and audio playback.
 * Supports Multi-call Queue (Stack) and Active Focus.
 */
import { getBatteryDisplay, playPcmAudio } from './utils.js';
import { renderDeviceList, updateDeviceCoordinates } from './map.js';
import { state } from './state.js';

let pttPanel, pttTargetName, pttTalkBtn, pttEndBtn, pttStatusText, scrollGuide, scrollGuideText, pttCallStack;
let wsUrl = '';
let regSecret = '';
let isTakenOver = false;

// Track multiple active calls { deviceId: { truckNumber, tags, startTime } }
const activeCalls = new Map();

/**
 * Initialize PTT module with configuration and DOM refs.
 */
export function setupPtt(config) {
  wsUrl = config.wsUrl || state.WS_URL;
  regSecret = config.registrationSecret || '';
  pttPanel = document.getElementById('pttActivePanel');
  pttTargetName = document.getElementById('pttTargetName');
  pttTalkBtn = document.getElementById('pttTalkBtn');
  pttEndBtn = document.getElementById('pttEndBtn');
  pttStatusText = document.getElementById('pttStatusText');
  scrollGuide = document.getElementById('scrollGuide');
  scrollGuideText = document.getElementById('scrollGuideText');
  pttCallStack = document.getElementById('pttCallStack');
}

function updateCallStackUI() {
  if (!pttCallStack) return;
  pttCallStack.innerHTML = '';

  activeCalls.forEach((data, id) => {
    // Only show in stack if NOT the main active focus
    if (id === state.pttActiveTarget) return;

    const safeTruckNumber = document.createTextNode(data.truckNumber || '').textContent;

    let tagsHtml = '';
    if (data.tags && data.tags.length > 0) {
      const badges = data.tags.map(tag => {
        const safeTag = document.createTextNode(tag.tagValue || tag).textContent;
        return `<span class="tag-badge" style="font-size: 10px; padding: 2px 6px; margin-right: 4px; display: inline-block; background-color: var(--primary); color: white; border-radius: 4px;"><i class="fa-solid fa-tag"></i> ${safeTag}</span>`;
      }).join('');
      tagsHtml = `<div style="margin-top: 4px;">${badges}</div>`;
    }

    const item = document.createElement('div');
    item.className = 'ptt-stack-item';
    item.innerHTML = `
      <div style="flex: 1;">
        <div class="truck-name">${safeTruckNumber}</div>
        ${tagsHtml}
        <div class="stack-status" style="margin-top: 4px;">Panggilan Aktif</div>
      </div>
      <div class="stack-actions">
        <button class="stack-btn end" data-id="${id}" title="Akhiri"><i class="fa-solid fa-phone-slash"></i></button>
      </div>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.stack-btn')) return;
      focusCall(id, data.truckNumber, data.tags);
    });

    item.querySelector('.end').addEventListener('click', (e) => {
      e.stopPropagation();
      endSpecificCall(id);
    });

    pttCallStack.appendChild(item);
  });
}

export function focusCall(targetId, targetName, targetTags = []) {
  state.pttActiveTarget = targetId;
  
  if (pttTargetName) {
    let tagsHtml = '';
    if (targetTags && targetTags.length > 0) {
       const badges = targetTags.map(tag => {
         const safeTag = document.createTextNode(tag.tagValue || tag).textContent;
         return `<span class="tag-badge" style="font-size: 12px; padding: 4px 8px; margin-left: 8px; vertical-align: middle; background-color: var(--primary); color: white; border-radius: 4px;"><i class="fa-solid fa-tag"></i> ${safeTag}</span>`;
       }).join('');
       tagsHtml = ` ${badges}`;
    }
    const safeTargetName = document.createTextNode(targetName || '').textContent;
    pttTargetName.innerHTML = `${safeTargetName}${tagsHtml}`;
  }
  
  if (pttPanel) pttPanel.classList.remove('hidden');
  if (pttStatusText) pttStatusText.innerText = 'Status: Terhubung';
  
  if (pttTalkBtn) {
    pttTalkBtn.style.opacity = '1';
    pttTalkBtn.style.pointerEvents = 'auto';
  }
  
  updateCallStackUI();
}

function endSpecificCall(id) {
  if (state.pttWs && state.pttWs.readyState === WebSocket.OPEN) {
    state.pttWs.send(JSON.stringify({ type: 'endCall', targetId: id }));
  }
  activeCalls.delete(id);
  if (state.pttActiveTarget === id) {
    state.pttActiveTarget = null;
    pttPanel?.classList.add('hidden');
  }
  updateCallStackUI();
}

function endPttCallUI() {
  if (state.pttActiveTarget) {
    endSpecificCall(state.pttActiveTarget);
  }
}

async function startRecording() {
  if (!pttTalkBtn || pttTalkBtn.style.pointerEvents === 'none' || !state.pttActiveTarget) return;
  if (state.mediaRecorder && state.mediaRecorder.state === 'recording') return;

  if (!state.audioStream) {
    try {
      state.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      alert('Tidak dapat mengakses microphone: ' + e.message);
      return;
    }
  }

  const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
  state.mediaRecorder = new MediaRecorder(state.audioStream, { mimeType });
  state.audioChunks = [];

  state.mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) state.audioChunks.push(e.data);
  };

  state.mediaRecorder.onstop = () => {
    const audioBlob = new Blob(state.audioChunks, { type: mimeType });
    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = () => {
      const base64data = reader.result.split(',')[1];
      if (state.pttWs && state.pttWs.readyState === WebSocket.OPEN && state.pttActiveTarget) {
        state.pttWs.send(JSON.stringify({
          type: 'voiceMessage',
          targetId: state.pttActiveTarget, // Specify who we are talking to
          audioBase64: base64data
        }));
      }
    };
  };

  state.mediaRecorder.start();
  pttTalkBtn.classList.add('active');
  const span = pttTalkBtn.querySelector('span');
  if (span) span.innerText = 'MEREKAM...';
}

function stopRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
    state.mediaRecorder.stop();
  }
  if (pttTalkBtn?.classList.contains('active')) {
    pttTalkBtn.classList.remove('active');
    const span = pttTalkBtn.querySelector('span');
    if (span) span.innerText = 'TAHAN UNTUK BICARA';
  }
}

async function handleIncomingAudioStream(fromId, base64Data) {
  const binaryString = window.atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  if (!window.audioCtx) window.audioCtx = new AudioContext();
  if (window.audioCtx.state === 'suspended') {
    await window.audioCtx.resume();
  }

  state.pttNextStartTime = playPcmAudio(window.audioCtx, bytes.buffer, state.pttNextStartTime);

  const card = document.getElementById(`card-${fromId}`);
  if (card) {
    card.classList.add('is-talking');

    const device = state.devicesData.find(d => d.id === fromId);
    const truckNum = device ? device.truckNumber : fromId;

    if (state.talkingTimeouts[fromId]) clearTimeout(state.talkingTimeouts[fromId]);
    state.talkingTimeouts[fromId] = setTimeout(() => {
      card.classList.remove('is-talking');
      if (scrollGuide) scrollGuide.classList.remove('visible');
      delete state.talkingTimeouts[fromId];
    }, 2000);

    const container = document.getElementById('deviceList');
    if (!container) return;

    const rect = card.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const isVisible = (rect.top >= containerRect.top && rect.bottom <= containerRect.bottom);

    if (!isVisible && scrollGuide && scrollGuideText) {
      scrollGuideText.innerText = `${truckNum} sedang bicara...`;
      scrollGuide.classList.add('visible');
      scrollGuide.onclick = () => {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        scrollGuide.classList.remove('visible');
      };
    } else if (scrollGuide) {
      scrollGuide.classList.remove('visible');
    }
  }
}

export function initPttWebSocket() {
  if (state.pttWs && (state.pttWs.readyState === WebSocket.CONNECTING || state.pttWs.readyState === WebSocket.OPEN)) {
    return;
  }

  state.pttWs = new WebSocket(wsUrl);
  state.pttWs.binaryType = 'blob';

  state.pttWs.onopen = () => {
    state.pttWs.send(JSON.stringify({
      type: 'register',
      id: 'center-main',
      secret: regSecret
    }));
    const dot = document.getElementById('wsDot');
    const text = document.getElementById('wsText');
    if (dot && text) {
      dot.style.backgroundColor = '#10b981';
      text.innerText = 'Server PTT Terhubung';
    }
  };

  state.pttWs.onmessage = async (event) => {
    if (event.data instanceof Blob) {
       // Logic for raw binary if needed
    } else {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case 'audioStream':
          await handleIncomingAudioStream(data.from, data.data);
          break;
        case 'connectionStatusUpdate':
          state.onlineDeviceIds = data.onlineDeviceIds;
          renderDeviceList();
          break;
        case 'locationUpdate':
          // { type: 'locationUpdate', deviceId: '...', coordinates: [lat, lng] }
          state.activeRealtimeDevices[data.deviceId] = Date.now();
          updateDeviceCoordinates(data.deviceId, data.coordinates);
          break;
        case 'confirmTakeover':
          const confirmModal = document.getElementById('takeoverConfirmModal');
          const btnConfirm = document.getElementById('btnConfirmTakeover');
          const btnCancel = document.getElementById('btnCancelTakeover');
          
          if (confirmModal) confirmModal.classList.remove('hidden');
          
          if (btnConfirm) {
            btnConfirm.onclick = () => {
              confirmModal.classList.add('hidden');
              state.pttWs.send(JSON.stringify({
                type: 'register',
                id: 'center-main',
                secret: regSecret,
                force: true
              }));
            };
          }
          
          if (btnCancel) {
            btnCancel.onclick = () => {
              confirmModal.classList.add('hidden');
              state.pttWs.close(); // Cancel connection
            };
          }
          break;
        case 'takenOver':
          isTakenOver = true;
          const noticeModal = document.getElementById('takenOverNoticeModal');
          if (noticeModal) {
            noticeModal.classList.remove('hidden');
            const btnReload = document.getElementById('btnReloadTakenOver');
            if (btnReload) btnReload.onclick = () => location.reload();
          } else {
            alert(data.message);
          }
          break;
        case 'incomingCall':
          console.log('Incoming multi-call from: ', data.callerId);
          state.pttWs.send(JSON.stringify({ type: 'acceptCall', callerId: data.callerId }));
          
          const device = state.devicesData.find(d => d.id === data.callerId);
          const name = device ? device.truckNumber : data.callerId;
          const tags = device ? (device.deviceTags || device.tags || []) : [];
          
          activeCalls.set(data.callerId, { truckNumber: name, tags: tags, startTime: Date.now() });
          
          // If no one is focused, focus this one
          if (!state.pttActiveTarget) {
            focusCall(data.callerId, name, tags);
          } else {
            updateCallStackUI();
          }
          break;
        case 'callAccepted':
          const accDevice = state.devicesData.find(d => d.id === data.targetId);
          const accName = accDevice ? accDevice.truckNumber : data.targetId;
          const accTags = accDevice ? (accDevice.deviceTags || accDevice.tags || []) : [];
          activeCalls.set(data.targetId, { truckNumber: accName, tags: accTags, startTime: Date.now() });
          focusCall(data.targetId, accName, accTags);
          break;
        case 'callEnded':
          const peerId = data.peerId || data.targetId;
          activeCalls.delete(peerId);
          if (state.pttActiveTarget === peerId) {
             state.pttActiveTarget = null;
             pttPanel?.classList.add('hidden');
             // Try to focus another call if exists
             if (activeCalls.size > 0) {
                const nextId = activeCalls.keys().next().value;
                focusCall(nextId, activeCalls.get(nextId).truckNumber);
             }
          }
          updateCallStackUI();
          break;
        case 'error':
          alert('PTT Error: ' + data.message);
          break;
      }
    }
  };

  state.pttWs.onclose = () => {
    const dot = document.getElementById('wsDot');
    const text = document.getElementById('wsText');
    if (dot && text) {
      dot.style.backgroundColor = '#ef4444';
      text.innerText = 'Server PTT Terputus';
    }
    setTimeout(initPttWebSocket, 3000);
  };
}

export function startPttCall(targetId, targetName) {
  if (!state.pttWs || state.pttWs.readyState !== WebSocket.OPEN) {
    alert("Koneksi PTT belum siap.");
    return;
  }
  state.pttWs.send(JSON.stringify({ type: 'call', targetId: targetId }));
}

export function bindPttButtons() {
  window.addEventListener('click', () => {
    if (!window.audioCtx) window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (window.audioCtx.state === 'suspended') window.audioCtx.resume();
  }, { once: true });

  if (pttEndBtn) {
    pttEndBtn.addEventListener('click', () => {
      if (state.pttActiveTarget) {
        endSpecificCall(state.pttActiveTarget);
      }
    });
  }

  if (pttTalkBtn) {
    pttTalkBtn.addEventListener('mousedown', startRecording);
    pttTalkBtn.addEventListener('mouseup', stopRecording);
    pttTalkBtn.addEventListener('mouseleave', stopRecording);
    pttTalkBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); }, { passive: false });
    pttTalkBtn.addEventListener('touchend', stopRecording);
  }
}
