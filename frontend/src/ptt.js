/**
 * Push-To-Talk WebSocket + Audio Recording module.
 * Extracted from script.js — manages WebSocket lifecycle, MediaRecorder, and audio playback.
 */
import { getBatteryDisplay, playPcmAudio } from './utils.js';
import { renderDeviceList } from './map.js';
import { state } from './state.js';

let pttPanel, pttTargetName, pttTalkBtn, pttEndBtn, pttStatusText, scrollGuide, scrollGuideText;
let wsUrl = '';
let regSecret = '';

/**
 * Initialize PTT module with configuration and DOM refs.
 */
export function setupPtt(config) {
  wsUrl = config.wsUrl || 'ws://43.157.242.182:9090';
  regSecret = config.registrationSecret || '';
  pttPanel = document.getElementById('pttActivePanel');
  pttTargetName = document.getElementById('pttTargetName');
  pttTalkBtn = document.getElementById('pttTalkBtn');
  pttEndBtn = document.getElementById('pttEndBtn');
  pttStatusText = document.getElementById('pttStatusText');
  scrollGuide = document.getElementById('scrollGuide');
  scrollGuideText = document.getElementById('scrollGuideText');
}

function endPttCallUI() {
  pttPanel?.classList.add('hidden');
  state.pttActiveTarget = null;
  if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
    state.mediaRecorder.stop();
  }
  if (pttTalkBtn) {
    pttTalkBtn.classList.remove('active');
    const span = pttTalkBtn.querySelector('span');
    if (span) span.innerText = 'TAHAN UNTUK BICARA';
  }
}

async function startRecording() {
  if (!pttTalkBtn || pttTalkBtn.style.pointerEvents === 'none') return;
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
      if (state.pttWs && state.pttWs.readyState === WebSocket.OPEN) {
        state.pttWs.send(JSON.stringify({
          type: 'voiceMessage',
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
    console.log("PTT WS already connecting or open, skipping duplicate init");
    return;
  }

  if (state.pttWs) {
    state.pttWs.onclose = null;
    state.pttWs.onerror = null;
    state.pttWs.onmessage = null;
    state.pttWs.onopen = null;
  }

  state.pttWs = new WebSocket(wsUrl);
  state.pttWs.binaryType = 'blob';

  state.pttWs.onopen = () => {
    console.log("PTT WebSocket connected");
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
      if (!window.audioCtx) {
        window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (window.audioCtx.state === 'suspended') {
        await window.audioCtx.resume();
      }

      const reader = new FileReader();
      reader.onload = async function () {
        if (!window.audioCtx) {
          window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (window.audioCtx.state === 'suspended') {
          await window.audioCtx.resume();
        }
        state.pttNextStartTime = playPcmAudio(window.audioCtx, reader.result, state.pttNextStartTime);
      };
      reader.readAsArrayBuffer(event.data);
    } else {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case 'audioStream':
          await handleIncomingAudioStream(data.from, data.data);
          break;
        case 'connectionStatusUpdate':
          console.log('Online PTT clients: ', data.onlineDeviceIds);
          state.onlineDeviceIds = data.onlineDeviceIds;
          renderDeviceList(); // Redraw list to show green/red dots
          break;
        case 'incomingCall':
          console.log('Incoming call from: ', data.callerId);
          state.pttWs.send(JSON.stringify({ type: 'acceptCall', callerId: data.callerId }));
          state.pttActiveTarget = data.callerId;
          const device = state.devicesData.find(d => d.id === data.callerId);
          if (pttTargetName) pttTargetName.innerText = device ? device.serialNumber || device.deviceId : data.callerId;
          if (pttPanel) pttPanel.classList.remove('hidden');
          if (pttStatusText) pttStatusText.innerText = 'Status: Terhubung (Masuk)';
          break;
        case 'callAccepted':
          if (pttStatusText) pttStatusText.innerText = 'Status: Terhubung';
          if (pttTalkBtn) {
            pttTalkBtn.style.opacity = '1';
            pttTalkBtn.style.pointerEvents = 'auto';
          }
          break;
        case 'callEnded':
          endPttCallUI();
          alert('Panggilan diakhiri oleh target atau terputus.');
          break;
        case 'error':
          alert('PTT Error: ' + data.message);
          endPttCallUI();
          break;
      }
    }
  };

  state.pttWs.onerror = (e) => {
    console.error("PTT WebSocket error:", e);
  };

  state.pttWs.onclose = () => {
    console.log("PTT WebSocket disconnected, reconnecting...");
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
    alert("Koneksi PTT belum siap. Mencoba menghubungkan ulang...");
    initPttWebSocket();
    return;
  }

  state.pttActiveTarget = targetId;
  if (pttTargetName) pttTargetName.innerText = targetName;
  if (pttPanel) pttPanel.classList.remove('hidden');
  if (pttStatusText) pttStatusText.innerText = 'Status: Memanggil...';
  if (pttTalkBtn) {
    pttTalkBtn.style.opacity = '0.5';
    pttTalkBtn.style.pointerEvents = 'none';
  }

  state.pttWs.send(JSON.stringify({ type: 'call', targetId: targetId }));
}

/** Wire up button event listeners. Call once after DOM ready. */
export function bindPttButtons() {
  // AudioContext warmup
  window.addEventListener('click', () => {
    if (!window.audioCtx) {
      window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (window.audioCtx.state === 'suspended') {
      window.audioCtx.resume();
    }
  }, { once: true });

  if (pttEndBtn) {
    pttEndBtn.addEventListener('click', () => {
      if (state.pttWs && state.pttWs.readyState === WebSocket.OPEN) {
        state.pttWs.send(JSON.stringify({ type: 'endCall' }));
      }
      endPttCallUI();
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
