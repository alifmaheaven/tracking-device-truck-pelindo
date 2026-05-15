/**
 * Map rendering, marker management, device list sidebar, search.
 * Extracted from script.js.
 */
import { getBatteryDisplay } from './utils.js';
import { state } from './state.js';

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
    deviceListContainer.innerHTML = '<p style="text-align:center; margin-top: 20px;">Mengambil data API...</p>';

    const response = await fetch(apiUrl);
    const data = await response.json();

    state.devicesData = data.map(item => {
      const connDate = item.lastConnectionDate ? new Date(item.lastConnectionDate.time) : new Date();
      const now = new Date();
      const diffMinutes = Math.floor((now - connDate) / (1000 * 60));
      const status = diffMinutes < 120 ? 'active' : 'idle';

      return {
        id: item.deviceId,
        truckNumber: item.serialNumber,
        coordinates: [parseFloat(item.latitude), parseFloat(item.longitude)],
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
        const firstTag = device.tags[0].tagValue || device.tags[0];
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
          <h3><i class="fa-solid fa-truck"></i> ${device.truckNumber}</h3>
          ${tagsHtml}
          <p><strong>Device ID:</strong> ${device.id.substring(0, 8)}...</p>
          <p><strong>Baterai:</strong> <span style="color: ${battery.color}; font-weight: 600;"><i class="fa-solid ${battery.icon}"></i> ${battery.text}</span></p>
          <p><strong>Koordinat:</strong> ${device.coordinates[0]}, ${device.coordinates[1]}</p>
          <p><strong>Status:</strong> <span style="text-transform: capitalize;">${device.status}</span></p>
          <p><strong>Update:</strong> ${device.lastUpdate}</p>
          <button class="history-btn" id="hist-btn-${device.id}">
            <i class="fa-solid fa-route"></i> Riwayat Perjalanan
          </button>
          <button class="direction-btn" id="dir-btn-${device.id}">
            <i class="fa-solid fa-location-crosshairs"></i> Arahkan ke Truk
          </button>
        </div>
      `;

      marker.bindPopup(popupContent);

      marker.on('popupopen', () => {
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

  container.innerHTML = '';

  if (_config.totalDeviceCount) {
    _config.totalDeviceCount.innerText = devices.length;
  }

  if (devices.length === 0) {
    container.innerHTML = '<p style="text-align:center; color: var(--text-muted); margin-top: 20px;">Tidak ada device/truk ditemukan.</p>';
    return;
  }

  devices.forEach(device => {
    const card = document.createElement('div');
    card.className = 'device-card';
    card.id = `card-${device.id}`;
    card.addEventListener('click', () => focusDevice(device.id));

    let tagsHtml = '<div style="color: var(--text-muted); font-size: 13px; font-style: italic;">No Tag</div>';
    if (device.tags && device.tags.length > 0) {
      const badges = device.tags.map(tag => `<span class="tag-badge" style="font-size: 15px; padding: 6px 12px; border-radius: 6px;"><i class="fa-solid fa-tag"></i> ${tag.tagValue || tag}</span>`).join('');
      tagsHtml = `<div class="device-tags" style="display: flex; flex-wrap: wrap; gap: 8px;">${badges}</div>`;
    }

    const battery = getBatteryDisplay(device.battery);

    card.innerHTML = `
      <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
        <div style="flex: 1;">${tagsHtml}</div>
        <div class="battery-status" title="Battery: ${battery.text}" style="color: ${battery.color}; font-weight: 700; font-size: 14px; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
          <i class="fa-solid ${battery.icon}" style="font-size: 20px;"></i>
          <span style="font-size: 12px;">${battery.text}</span>
        </div>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <div style="background-color: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; font-weight: bold; font-size: 14px; color: #0f172a; display: flex; align-items: center; justify-content: center; letter-spacing: 1px;" title="PPT Code untuk login Tablet">
          <i class="fa-solid fa-key" style="margin-right: 6px; color: #64748b; font-size: 12px;"></i>
          ${device.pptCode || '------'}
        </div>
        <button class="call-btn" style="flex: 1; margin-top: 0;" onclick="event.stopPropagation(); startPttCall('${device.id}', '${device.truckNumber}')">
          <i class="fa-solid fa-headset"></i> Panggil Operator
        </button>
      </div>
    `;
    container.appendChild(card);
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
