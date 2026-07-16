/**
 * Map rendering, marker management, device list sidebar, search.
 * Extracted from script.js.
 */
import { getBatteryDisplay, escapeHtml, escapeJsString } from './utils.js';
import { state } from './state.js';
import { startPttCall, isOperatorOnline, forceLogoutDevice } from './ptt.js';

let _config = {};

/**
 * Configure map module with external dependencies.
 * @param {{ apiUrl: string, searchInput: HTMLElement, deviceListContainer: HTMLElement, totalDeviceCount: HTMLElement }} cfg
 */
export function setupMap(cfg) {
  _config = cfg;
}

export async function fetchDeviceData() {
  try {
    const { apiUrl, deviceListContainer, searchInput } = _config;
    // REMOVED: deviceListContainer.innerHTML = '...'; // Don't clear to avoid flicker

    const response = await fetch(apiUrl, { credentials: 'include' });
    const data = await response.json();

    state.devicesData = data.map(item => {
      const connDate = item.lastConnectionDate ? new Date(item.lastConnectionDate.time) : new Date();
      const now = new Date();
      const diffMinutes = Math.floor((now - connDate) / (1000 * 60));
      const status = diffMinutes < 120 ? 'active' : 'idle';

      const deviceId = item.deviceId;
      let coords = [parseFloat(item.latitude), parseFloat(item.longitude)];

      // ANTI-JUMP LOGIC:
      // Check if this device has sent a real-time update recently (last 30s)
      const lastWsUpdate = state.activeRealtimeDevices[deviceId];
      if (lastWsUpdate && (now.getTime() - lastWsUpdate < 30000)) {
        const existingDevice = state.devicesData.find(d => d.id === deviceId);
        if (existingDevice) {
          // Prioritize current local coordinates (from WebSocket) over API data
          coords = existingDevice.coordinates;
        }
      }

      return {
        id: deviceId,
        truckNumber: item.serialNumber, // Nama truk/Nomor polisi
        serialNumber: item.serialNumber, // Simpan mentah untuk badge
        coordinates: coords,
        status,
        speed: '- km/h',
        lastUpdate: connDate.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' WIB',
        tags: item.deviceTags || [],
        battery: item.battery || 0,
        pptCode: item.pptCode,
      };
    });

    renderMarkers();
    renderDeviceList(filteredBySearch());
  } catch (error) {
    console.error('Gagal mengambil data dari API:', error);
    if (_config.deviceListContainer) {
      _config.deviceListContainer.innerHTML = '<p style="text-align:center; color: var(--idle-orange); margin-top: 20px;"><i class="fa-solid fa-triangle-exclamation"></i> Gagal mengambil data. Pastikan Webhook N8N menyala.</p>';
    }
  }
}

function filteredBySearch() {
  const keyword = _config.searchInput?.value?.toLowerCase() || '';
  return state.devicesData.filter(d => {
    const tagMatch = d.tags && d.tags.some(tag => (tag.tagValue || tag).toString().toLowerCase().includes(keyword));
    return (d.truckNumber && d.truckNumber.toLowerCase().includes(keyword)) ||
           (d.id && d.id.toLowerCase().includes(keyword)) ||
           tagMatch;
  });
}

export function renderMarkers() {
  const map = state.map;
  if (!map) return;
  const currentIds = new Set();

  state.devicesData.forEach(device => {
    const isNav = _config.isNavActive?.() && _config.getNavTarget?.();
    if (isNav && device.id !== _config.getNavTarget?.()?.id) return;
    if (isNaN(device.coordinates[0]) || isNaN(device.coordinates[1])) return;

    currentIds.add(device.id);
    const existing = state.markersList[device.id];

    if (existing) {
      existing.setLatLng(device.coordinates);
    } else {
      let badgeHtml = '';
      if (device.tags && device.tags.length > 0) {
        // H6: N8N tags are unauthenticated source — must escape before innerHTML
        const firstTag = escapeHtml(device.tags[0].tagValue || device.tags[0]);
        badgeHtml = `<div class="marker-floating-badge">${firstTag}</div>`;
      }

      const bgColor = device.status === 'active' ? '#2563eb' : '#f59e0b';
      const shadowColor = device.status === 'active' ? 'rgba(37,99,235,0.4)' : 'rgba(245,158,11,0.4)';

      const customIcon = L.divIcon({
        html: `<div style="position: relative; background-color: ${bgColor}; color: white; width: 36px; height: 36px; display: flex; justify-content: center; align-items: center; border-radius: 50%; box-shadow: 0 4px 12px ${shadowColor}; border: 2px solid white;">
                <i class="fa-solid fa-truck"></i>
                ${badgeHtml}
               </div>`,
        className: 'custom-div-icon',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -18]
      });

      const marker = L.marker(device.coordinates, { icon: customIcon }).addTo(map);

      let tagsHtml = '';
      if (device.tags && device.tags.length > 0) {
        const badges = device.tags.map(tag => `<span class="tag-badge"><i class="fa-solid fa-tag"></i> ${tag.tagValue || tag}</span>`).join('');
        tagsHtml = `<div class="device-tags" style="margin-bottom: 10px;">${badges}</div>`;
      }

      const battery = getBatteryDisplay(device.battery);

      const popupContent = `
        <div class="custom-popup-content">
          <h3><i class="fa-solid fa-truck"></i> ${escapeHtml(device.truckNumber)}</h3>
          ${tagsHtml}
          <p><strong>Device ID:</strong> ${escapeHtml(device.id.substring(0, 8))}...</p>
          <p><strong>Baterai:</strong> <span style="color: ${battery.color}; font-weight: 600;"><i class="fa-solid ${battery.icon}"></i> ${battery.text}</span></p>
          <p><strong>Koordinat:</strong> ${escapeHtml(device.coordinates[0])}, ${escapeHtml(device.coordinates[1])}</p>
          <p><strong>Status:</strong> <span style="text-transform: capitalize;">${escapeHtml(device.status)}</span></p>
          <p><strong>Update:</strong> ${escapeHtml(device.lastUpdate)}</p>
          <button class="call-btn popup-call-btn" id="call-btn-${escapeHtml(device.id)}">
            <i class="fa-solid fa-headset"></i> Panggil Operator
          </button>
          <button class="history-btn" id="hist-btn-${escapeHtml(device.id)}">
            <i class="fa-solid fa-route"></i> Riwayat Perjalanan
          </button>
          <button class="direction-btn" id="dir-btn-${escapeHtml(device.id)}">
            <i class="fa-solid fa-location-crosshairs"></i> Arahkan ke Truk
          </button>
        </div>
      `;

      marker.bindPopup(popupContent);

      marker.on('popupopen', () => {
        const callBtn = document.getElementById(`call-btn-${device.id}`);
        if (callBtn) {
          const operatorOnline = isOperatorOnline();
          if (!operatorOnline) {
            callBtn.disabled = true;
            callBtn.classList.add('popup-call-btn-disabled');
            callBtn.title = 'Operator tidak terhubung (PTT offline)';
          } else {
            callBtn.disabled = false;
            callBtn.classList.remove('popup-call-btn-disabled');
            callBtn.title = 'Panggil operator yang sedang online';
          }
          callBtn.addEventListener('click', () => {
            if (isOperatorOnline()) {
              startPttCall(device.id, device.truckNumber);
              marker.closePopup();
            }
          });
        }
        const histBtn = document.getElementById(`hist-btn-${device.id}`);
        if (histBtn) {
          histBtn.addEventListener('click', () => {
            if (_config.openHistoryModal) _config.openHistoryModal(device.id, device.truckNumber);
          });
        }
        const dirBtn = document.getElementById(`dir-btn-${device.id}`);
        if (dirBtn) {
          dirBtn.addEventListener('click', () => {
            if (_config.startDirectionMode) _config.startDirectionMode(device);
          });
        }
      });

      state.markersList[device.id] = marker;
    }
  });

  // Remove stale markers
  Object.keys(state.markersList).forEach(id => {
    if (!currentIds.has(id)) {
      map.removeLayer(state.markersList[id]);
      delete state.markersList[id];
    }
  });
}

export function renderDeviceList(devices) {
  const container = _config.deviceListContainer;
  if (!container) return;

  // Use filtered data if no specific list provided (e.g. from WebSocket update)
  const listToRender = devices || filteredBySearch();

  container.innerHTML = '';

  if (_config.totalDeviceCount) {
    _config.totalDeviceCount.innerText = listToRender.length;
  }

  if (listToRender.length === 0) {
    container.innerHTML = '<p style="text-align:center; color: var(--text-muted); margin-top: 20px;">Tidak ada device/truk ditemukan.</p>';
    return;
  }

  listToRender.forEach(device => {
    const card = document.createElement('div');
    card.className = 'device-card';
    card.id = `card-${device.id}`;
    card.addEventListener('click', () => focusDevice(device.id));

    // SECURITY (M02 L10): escape user-controlled strings before innerHTML
    const safeId = escapeJsString(device.id);
    const safeTruck = escapeJsString(device.truckNumber || device.id);
    const safeSerial = escapeHtml(device.serialNumber || 'N/A');

    let tagsContent = '';
    if (device.tags && device.tags.length > 0) {
      const badges = device.tags.map(tag => `<span class="tag-badge" style="font-size: 15px; padding: 6px 12px; border-radius: 6px;"><i class="fa-solid fa-tag"></i> ${escapeHtml(tag.tagValue || tag)}</span>`).join('');
      tagsContent = `<div class="device-tags" style="display: flex; flex-wrap: wrap; gap: 8px;">${badges}</div>`;
    } else {
      tagsContent = '<div style="color: var(--text-muted); font-size: 13px; font-style: italic;">No Tag</div>';
    }
    const tagsHtml = `<div class="tags-wrapper">${tagsContent}<button class="tag-edit-btn" id="edit-tag-btn-${safeId}" data-device-id="${safeId}" data-device-name="${safeTruck}" title="Edit tags"><i class="fa-solid fa-pen-to-square"></i></button></div>`;

    const battery = getBatteryDisplay(device.battery);
    const isPttOnline = state.onlineDeviceIds.includes(device.id);
    const isMuted = state.mutedDeviceIds.includes(device.id);

    // Add muted class to card for visual indicator
    if (isMuted) {
      card.classList.add('device-muted');
    }

    // Call button: disabled if PTT offline
    const callBtnDisabled = !isPttOnline;
    const callBtnClass = callBtnDisabled ? 'call-btn call-btn-disabled' : 'call-btn';
    const callBtnOnclick = callBtnDisabled
      ? ''
      : `onclick="event.stopPropagation(); startPttCall('${safeId}', '${safeTruck}')"`;
    const callBtnTitle = callBtnDisabled ? 'Device tidak terhubung ke server PTT' : 'Panggil operator di tablet';

    // Mute button
    const muteIcon = isMuted ? 'fa-microphone-slash' : 'fa-microphone';
    const muteTitle = isMuted ? 'Unmute device ini' : 'Mute device ini';
    const muteAction = isMuted ? 'unmutePttDevice' : 'mutePttDevice';
    const muteBtnClass = isMuted ? 'mute-btn muted' : 'mute-btn';

    card.innerHTML = `
      ${isMuted ? '<div class="muted-overlay"><i class="fa-solid fa-microphone-slash"></i> MUTED</div>' : ''}
      <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
        <div style="flex: 1; display: flex; align-items: center; gap: 8px;">
          <div class="ptt-status-dot" title="${isPttOnline ? 'PTT Ready (Connected)' : 'PTT Offline'}" style="width: 10px; height: 10px; border-radius: 50%; background-color: ${isPttOnline ? '#10b981' : '#ef4444'}; flex-shrink: 0; box-shadow: 0 0 4px ${isPttOnline ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)'};"></div>
          ${tagsHtml}
        </div>
        <div class="battery-status" title="Battery: ${battery.text}" style="color: ${battery.color}; font-weight: 700; font-size: 14px; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
          <div style="font-size: 10px; color: #64748b; background-color: #f1f5f9; padding: 2px 6px; border-radius: 4px; border: 1px solid #e2e8f0; font-weight: 600; margin-bottom: 2px;">SN: ${safeSerial}</div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <i class="fa-solid ${battery.icon}" style="font-size: 20px;"></i>
            <span style="font-size: 12px;">${battery.text}</span>
          </div>
          ${window.currentUser?.role === 'admin' ? `
          <button class="force-logout-btn" data-force-logout-id="${escapeHtml(device.id)}" data-force-logout-label="${escapeHtml(device.truckNumber || device.id)}" title="Logout paksa device ini dari pusat (M01 P4)" style="margin-top: 4px; background-color: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 6px; padding: 4px 8px; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px; justify-content: center; width: 100%;">
            <i class="fa-solid fa-right-from-bracket"></i> Force Logout
          </button>
          ` : ''}
        </div>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <div style="background-color: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; font-weight: bold; font-size: 14px; color: #0f172a; display: flex; align-items: center; justify-content: center; letter-spacing: 1px;" title="PPT Code untuk login Tablet">
          <i class="fa-solid fa-key" style="margin-right: 6px; color: #64748b; font-size: 12px;"></i>
          ${escapeHtml(device.pptCode || '------')}
        </div>
        <button class="${muteBtnClass}" title="${escapeHtml(muteTitle)}" onclick="event.stopPropagation(); ${muteAction}('${safeId}')">
          <i class="fa-solid ${muteIcon}"></i>
        </button>
        <button class="${callBtnClass}" style="flex: 1; margin-top: 0;" ${callBtnOnclick} title="${escapeHtml(callBtnTitle)}" ${callBtnDisabled ? 'disabled' : ''}>
          <i class="fa-solid fa-headset"></i> Panggil Operator
        </button>
      </div>
    `;
    container.appendChild(card);
  });

  // SECURITY (M02 M1): bind force-logout buttons via event delegation instead of inline
  //   onclick. Avoids exposing forceLogoutDevice to window. Re-bind on every render
  //   (cheap — small list, listener replaces prior one).
  bindForceLogoutButtons(container);

  // Bind tag edit buttons
  container.querySelectorAll('.tag-edit-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.dataset.deviceId;
      const name = btn.dataset.deviceName;
      if (id) openTagModal(id, name);
    };
  });
}

/**
 * Attach click handlers to any .force-logout-btn inside `container`.
 * Replaces the old window.forceLogoutDevice() global.
 */
function bindForceLogoutButtons(container) {
  container.querySelectorAll('.force-logout-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.dataset.forceLogoutId;
      const label = btn.dataset.forceLogoutLabel;
      if (id) forceLogoutDevice(id, label);
    };
  });
}

export function focusDevice(deviceId) {
  const device = state.devicesData.find(d => d.id === deviceId);
  if (!device) return;

  const allCards = document.querySelectorAll('.device-card');
  allCards.forEach(c => c.classList.remove('active-card'));

  const selectedCard = document.getElementById(`card-${deviceId}`);
  if (selectedCard) selectedCard.classList.add('active-card');

  state.map?.flyTo(device.coordinates, 16, { duration: 1.5 });

  if (window.innerWidth <= 768) {
    const sideEl = document.getElementById('sidebar');
    const togEl = document.getElementById('toggleSidebarBtn');
    if (sideEl) sideEl.classList.add('collapsed');
    if (togEl) togEl.classList.add('collapsed');
  }

  setTimeout(() => {
    if (state.markersList[deviceId]) {
      state.markersList[deviceId].openPopup();
    }
  }, 1500);
}

export function handleSearchInput(e) {
  const keyword = e.target.value.toLowerCase();
  const filteredDevices = state.devicesData.filter(d => {
    const tagMatch = d.tags && d.tags.some(tag => (tag.tagValue || tag).toString().toLowerCase().includes(keyword));
    return (d.truckNumber && d.truckNumber.toLowerCase().includes(keyword)) ||
           (d.id && d.id.toLowerCase().includes(keyword)) ||
           tagMatch;
  });
  renderDeviceList(filteredDevices);
}

/**
 * Update a specific device's coordinates from real-time WebSocket data.
 * @param {string} deviceId 
 * @param {[number, number]} coordinates 
 */
export function updateDeviceCoordinates(deviceId, coordinates) {
  const device = state.devicesData.find(d => d.id === deviceId);
  if (device) {
    device.coordinates = coordinates;
    // Update marker directly for smooth movement
    const marker = state.markersList[deviceId];
    if (marker) {
      marker.setLatLng(coordinates);
    }
  }
}

// ==========================================
// TAG EDIT MODAL LOGIC
// ==========================================

/**
 * Internal state for tag editing — persists across modal open/close.
 * @type {{ deviceId: string|null, originalTags: string[], currentTags: string[] }}
 */
let _tagState = { deviceId: null, originalTags: [], currentTags: [] };
const TAG_MAX_COUNT = 10;

/**
 * Open the tag edit modal for a specific device.
 * Fetches current tags from N8N via backend proxy.
 * @param {string} deviceId
 * @param {string} truckNumber
 */
export function openTagModal(deviceId, truckNumber) {
  const modal = document.getElementById('tagEditModal');
  const nameEl = document.getElementById('tagModalDeviceName');
  const loading = document.getElementById('tagModalLoading');
  const content = document.getElementById('tagModalContent');
  const error = document.getElementById('tagEditError');
  const input = document.getElementById('newTagInput');

  if (!modal) return;

  // Reset state
  _tagState.deviceId = deviceId;
  nameEl.textContent = truckNumber;
  loading.style.display = 'block';
  content.style.display = 'none';
  error.style.display = 'none';
  input.value = '';
  input.disabled = false;

  modal.classList.add('active');

  // Fetch current tags from N8N
  _fetchDeviceTags(deviceId);
}

/**
 * Fetch tags for a device from N8N via backend proxy.
 * GET /api/proxy/n8n?url=https://ptt.teluklamong.co.id/webhook/tags?deviceId=...
 */
async function _fetchDeviceTags(deviceId) {
  const proxyUrl = '/api/proxy/n8n?url=' + encodeURIComponent('https://ptt.teluklamong.co.id/webhook/tags?deviceId=' + deviceId);

  try {
    const resp = await fetch(proxyUrl, { credentials: 'include', cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();

    console.log('[tagEdit] raw response:', data);

    // N8N returns envelope: [{ resultValue: [...], resultCode, resultMessage }]
    // resultValue is the array of tag objects: { tagValue, domain, tenantId, mappedId }
    // We store the full tag objects so PUT can send them back whole.
    let tags = [];
    if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0].resultValue)) {
      tags = data[0].resultValue;
    } else if (Array.isArray(data)) {
      tags = data;
    }

    console.log('[tagEdit] normalized tags:', tags);

    _tagState.originalTags = [...tags];
    _tagState.currentTags = [...tags];

    document.getElementById('tagModalLoading').style.display = 'none';
    document.getElementById('tagModalContent').style.display = 'flex';
    _renderTagChips();
  } catch (err) {
    console.error('Gagal fetch tags:', err);
    const loadingEl = document.getElementById('tagModalLoading');
    loadingEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color: #dc2626;"></i> Gagal memuat tags.<br><button onclick="document.getElementById(\'closeTagEditModalBtn\').click()" style="margin-top: 10px; padding: 8px 16px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;">Tutup</button>';
  }
}

/**
 * Extract display value from a tag object.
 * Tag can be plain string, or object { tagValue, ... }
 * @param {*} tag
 * @returns {string}
 */
function _tagDisplayValue(tag) {
  if (typeof tag === 'string') return tag;
  if (tag && typeof tag.tagValue === 'string') return tag.tagValue;
  if (tag && typeof tag === 'object') return String(tag);
  return '';
}

/**
 * Render current tag chips in the modal container.
 * Reads from _tagState.currentTags.
 */
function _renderTagChips() {
  const container = document.getElementById('tagChipsContainer');
  if (!container) return;

  const tags = _tagState.currentTags;
  if (!tags.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = tags.map((tag, idx) =>
    `<span class="tag-chip">
      <i class="fa-solid fa-tag"></i> ${escapeHtml(_tagDisplayValue(tag))}
      <button class="tag-chip-remove" data-tag-idx="${idx}" title="Hapus tag">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </span>`
  ).join('');

  // Bind remove buttons
  container.querySelectorAll('.tag-chip-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.tagIdx);
      if (!isNaN(idx) && idx >= 0 && idx < _tagState.currentTags.length) {
        _tagState.currentTags.splice(idx, 1);
        _renderTagChips();
      }
    });
  });
}

/**
 * Save current tags to N8N via backend proxy.
 * PUT /api/proxy/n8n?url=https://ptt.teluklamong.co.id/webhook/update-tags
 * Body: { deviceId, tags: string[] }
 */
async function _saveTags() {
  const saveBtn = document.getElementById('saveTagBtn');
  const error = document.getElementById('tagEditError');
  const errorText = document.getElementById('tagEditErrorText');

  if (!_tagState.deviceId) return;

  // Disable button while saving
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
  error.style.display = 'none';

  try {
    const proxyUrl = '/api/proxy/n8n?url=' + encodeURIComponent('https://ptt.teluklamong.co.id/webhook/update-tags');
    const resp = await fetch(proxyUrl, {
      method: 'PUT',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      // N8N expects tags as plain string array, not objects.
      // GET returns full objects {tagValue, domain, ...} but PUT only needs the values.
      body: JSON.stringify({
        deviceId: _tagState.deviceId,
        tags: _tagState.currentTags.map(_tagDisplayValue)
      })
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error('Server merespon ' + resp.status + (errBody ? ': ' + errBody.slice(0, 100) : ''));
    }

    // Success — close modal and refresh device data
    document.getElementById('tagEditModal').classList.remove('active');
    fetchDeviceData();
    _showToast(
      '<i class="fa-solid fa-circle-check"></i> Perubahan menunggu beberapa saat, periksa lagi dalam beberapa menit. Terima kasih!',
      'success'
    );
  } catch (err) {
    console.error('Gagal update tags:', err);
    errorText.textContent = 'Gagal menyimpan tags: ' + err.message + '. Silakan coba lagi.';
    error.style.display = 'block';
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan';
  }
}

/**
 * Validate and add a tag to the current list.
 * New tags follow N8N format: { tagValue, domain, tenantId }
 */
function _addTag() {
  const input = document.getElementById('newTagInput');
  const error = document.getElementById('tagEditError');
  const errorText = document.getElementById('tagEditErrorText');
  const value = input.value.trim();

  if (!value) return;

  // Max count check
  if (_tagState.currentTags.length >= TAG_MAX_COUNT) {
    errorText.textContent = 'Maksimal ' + TAG_MAX_COUNT + ' tags per device. Hapus tag lain terlebih dahulu.';
    error.style.display = 'block';
    return;
  }

  // Duplicate check (case-insensitive on tagValue)
  const isDuplicate = _tagState.currentTags.some(t => _tagDisplayValue(t).toLowerCase() === value.toLowerCase());
  if (isDuplicate) {
    errorText.textContent = 'Tag "' + value + '" sudah ada.';
    error.style.display = 'block';
    return;
  }

  // Clear error
  error.style.display = 'none';

  // Build new tag object matching N8N format.
  // Use domain/tenantId from first existing tag if available; else defaults.
  const existingTag = _tagState.currentTags.find(t => typeof t === 'object' && t.domain);
  const newTag = {
    tagValue: value,
    domain: existingTag ? existingTag.domain : 'DEVICE',
    tenantId: existingTag ? existingTag.tenantId : 'teluklamong.co.id',
  };

  _tagState.currentTags.push(newTag);
  _renderTagChips();
  input.value = '';
  input.focus();
}

// ==========================================
// TAG MODAL EVENT HANDLERS (bound once on first use)
// ==========================================

/**
 * Show a floating toast notification that auto-dismisses.
 * @param {string} message HTML content
 * @param {'success'|'error'} type
 */
function _showToast(message, type) {
  const toast = document.createElement('div');
  toast.className = 'tag-toast tag-toast-' + (type || 'success');
  toast.innerHTML = message;
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('show'));

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

// Use DOMContentLoaded to ensure DOM is ready, but module scripts are deferred
// so the DOM is already parsed when this runs.
function _initTagModalHandlers() {
  if (_initTagModalHandlers._done) return;
  _initTagModalHandlers._done = true;

  // Close button
  const closeBtn = document.getElementById('closeTagEditModalBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      document.getElementById('tagEditModal').classList.remove('active');
    });
  }

  // Cancel button
  const cancelBtn = document.getElementById('cancelTagEditBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      document.getElementById('tagEditModal').classList.remove('active');
    });
  }

  // Save button
  const saveBtn = document.getElementById('saveTagBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', _saveTags);
  }

  // Add tag button
  const addBtn = document.getElementById('addTagBtn');
  if (addBtn) {
    addBtn.addEventListener('click', _addTag);
  }

  // Enter key in tag input
  const input = document.getElementById('newTagInput');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        _addTag();
      }
    });
  }

  // Close on overlay click (but not on content click)
  const modal = document.getElementById('tagEditModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  }
}

// Initialize handlers on module load
_initTagModalHandlers();
