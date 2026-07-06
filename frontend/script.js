import { getBatteryDisplay, playPcmAudio } from './src/utils.js';
import { setupMap, fetchDeviceData, renderMarkers, renderDeviceList, handleSearchInput } from './src/map.js';
import { setupAuth } from './src/auth.js';
import { state } from './src/state.js';
import { initRoleGuard } from './src/roleGuard.js';

// Konfigurasi Dinamis berdasarkan Hostname
// M01: konsolidasi ke ptt.teluklamong.co.id
const hostname = window.location.hostname;
let API_URL, WS_URL, HISTORY_API_URL;

if (hostname.includes('ptt.teluklamong.co.id')) {
    // Production via subdomain baru
    const PTT_BASE = 'https://ptt.teluklamong.co.id';
    API_URL = PTT_BASE + '/webhook/device-cordinate';
    HISTORY_API_URL = PTT_BASE + '/webhook/device-history';
    WS_URL = 'wss://ptt.teluklamong.co.id/ws';
} else {
    // Dev / fallback (IP server lokal)
    API_URL = import.meta.env.VITE_API_URL || 'http://10.118.62.60:5678/webhook/device-cordinate';
    HISTORY_API_URL = import.meta.env.VITE_HISTORY_API_URL || 'http://10.118.62.60:5678/webhook/device-history';
    WS_URL = import.meta.env.VITE_WS_URL || 'wss://ptt.teluklamong.co.id/ws';
}
const REGISTRATION_SECRET = import.meta.env.VITE_REGISTRATION_SECRET || '';

// Proxy helper for N8N data (goes through backend to avoid CORS + add auth)
function n8nProxy(originalUrl) {
    if (originalUrl.startsWith('/api/')) return originalUrl; // already proxied
    return '/api/proxy/n8n?url=' + encodeURIComponent(originalUrl);
}

// Map init
const map = L.map('map').setView([-7.195, 112.68], 15);
state.map = map;

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// DOM refs
const deviceListContainer = document.getElementById('deviceList');
const searchInput = document.getElementById('searchInput');
const totalDeviceCount = document.getElementById('totalDeviceCount');

// Initialize Auth (Captcha)
setupAuth({
    wsUrl: WS_URL,
    onAuthenticated: () => {
        // Start app only after successful captcha
        initRoleGuard();
        initApp();
    }
});

function initApp() {
    // Configure map module with shared state bindings
    function _navActive() { return isNavigating; }
    function _navTarget() { return navTargetDevice; }
    setupMap({
        apiUrl: n8nProxy(API_URL),
        searchInput,
        deviceListContainer,
        totalDeviceCount,
        isNavActive: _navActive,
        getNavTarget: _navTarget,
        openHistoryModal: (id, name) => openHistoryModal(id, name),
        startDirectionMode: (d) => startDirectionMode(d),
    });

    // Search listener
    searchInput.addEventListener('input', handleSearchInput);

    // Menjalankan fetch data petama kali
    fetchDeviceData();

    // Start WebSocket PTT
    initPttWebSocket();

    // Start interval
    setInterval(updateRefreshCounter, 1000);
}

// auto update data lokasi secara real-time dengan counter countdown dinamis
let refreshInterval = state.refreshInterval;
let countdown = state.countdown;
const refreshCircle = document.getElementById('refreshCircle');

const refreshText = document.getElementById('refreshText');

const floatingRefreshBtn = document.getElementById('floatingRefreshBtn');
const refreshOptions = document.getElementById('refreshOptions');
const timeBtns = document.querySelectorAll('.time-btn');

if (floatingRefreshBtn && refreshOptions) {
    floatingRefreshBtn.addEventListener('click', () => {
        refreshOptions.classList.toggle('show');
    });
}

if (timeBtns) {
    // Atur tombol yang aktif pertama kali
    timeBtns.forEach(b => {
        if (parseInt(b.getAttribute('data-time')) === refreshInterval) b.classList.add('active');
    });

    timeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Hapus status active dari semua tombol lalu pasang yang baru
            timeBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            // Ubah interval
            const newTime = parseInt(e.target.getAttribute('data-time'));
            refreshInterval = newTime;
            countdown = newTime; // Reset timer counter
            
            // Tarik data baru dan segarkan UI saat itu juga
            updateRefreshCounterUI(); 
            fetchDeviceData();
            
            // Tutup menu
            refreshOptions.classList.remove('show');
        });
    });
}

function updateRefreshCounterUI() {
    // Animasi Lingkaran
    let dashValue = (countdown / refreshInterval) * 100;
    if (refreshCircle) {
        // Hilangkan efek transisi animasi jika kembali ke 100% supaya tidak terlihat ngelag mundur
        if (countdown === refreshInterval) {
            refreshCircle.style.transition = 'none';
        } else {
            refreshCircle.style.transition = 'stroke-dasharray 1s linear';
        }
        refreshCircle.setAttribute('stroke-dasharray', `${dashValue}, 100`);
    }
    
    // Update Text Angka
    if (refreshText) refreshText.innerText = countdown;
}

function updateRefreshCounter() {
    countdown--;
    
    if (countdown <= 0) {
        countdown = refreshInterval;
        fetchDeviceData(); // Tarik data API
    }
    
    updateRefreshCounterUI();
}

// Inisialisasi tampilan awal
updateRefreshCounterUI();

// Mulai perhitungan mundur setiap 1 detik
setInterval(updateRefreshCounter, 1000);

// Logika Toggle Sidebar
const sidebar = document.getElementById('sidebar');
const toggleBtn = document.getElementById('toggleSidebarBtn');

toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    toggleBtn.classList.toggle('collapsed');
    
    // Perbarui ukuran maps setelah animasi flex selesai (400ms) agar tiles tidak terpotong
    setTimeout(() => {
        map.invalidateSize();
    }, 400);
});

// Auto-collapse saat website pertama kalinya termuat di layar kecil (HP)
if (window.innerWidth <= 768 && sidebar && toggleBtn) {
    sidebar.classList.add('collapsed');
    toggleBtn.classList.add('collapsed');
}

// ==========================================
// LOGIKA MODAL RIWAYAT PERJALANAN (HISTORY)
// ==========================================

const historyModal = document.getElementById('historyModal');
const closeHistoryModalBtn = document.getElementById('closeHistoryModalBtn');
const loadingHistory = document.getElementById('loadingHistory');
let historyMapInstance = null;
let historyLayerGroup = null;
let historyAutoHideTimer = null; // Auto-hide after 10 minutes

// TABS UI DOM
const tabMapBtn = document.getElementById('tabMapBtn');
const tabChartBtn = document.getElementById('tabChartBtn');
const mapTabContent = document.getElementById('mapTabContent');
const chartTabContent = document.getElementById('chartTabContent');
let speedChartInstance = null;

// LOGIKA TABS
if (tabMapBtn && tabChartBtn) {
    tabMapBtn.addEventListener('click', () => {
        tabMapBtn.classList.add('active');
        tabChartBtn.classList.remove('active');
        mapTabContent.style.display = 'flex'; // Sembunyikan dan Munculkan container fleksibel
        chartTabContent.style.display = 'none';
        setTimeout(() => {
            if (historyMapInstance) historyMapInstance.invalidateSize();
        }, 300);
    });

    tabChartBtn.addEventListener('click', () => {
        tabChartBtn.classList.add('active');
        tabMapBtn.classList.remove('active');
        mapTabContent.style.display = 'none';
        chartTabContent.style.display = 'block';
    });
}

// Setup Icon Start & End secara dinamis
const startIcon = L.divIcon({
    html: `<div style="background-color: #10b981; color: white; width: 30px; height: 30px; display: flex; justify-content: center; align-items: center; border-radius: 50%; box-shadow: 0 4px 6px rgba(0,0,0,0.3); border: 2px solid white;"><i class="fa-solid fa-play" style="margin-left: 2px;"></i></div>`,
    className: 'custom-div-icon',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
});

const endIcon = L.divIcon({
    html: `<div style="background-color: #ef4444; color: white; width: 30px; height: 30px; display: flex; justify-content: center; align-items: center; border-radius: 50%; box-shadow: 0 4px 6px rgba(0,0,0,0.3); border: 2px solid white;"><i class="fa-solid fa-flag-checkered"></i></div>`,
    className: 'custom-div-icon',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
});

const distanceInfoBox = document.getElementById('distanceInfo');
const totalDistanceText = document.getElementById('totalDistance');

// Fungsi untuk menyederhanakan array titik jika melebihi batas OSRM (100 koordinat)
function simplifyCoordinates(latlngs, maxPoints = 90) {
    if (latlngs.length <= maxPoints) return latlngs;
    const result = [];
    const step = (latlngs.length - 1) / (maxPoints - 1);
    for (let i = 0; i < maxPoints; i++) {
        result.push(latlngs[Math.round(step * i)]);
    }
    // Pastikan titik terakhir selalu ada
    if (result[result.length - 1] !== latlngs[latlngs.length - 1]) {
        result[result.length - 1] = latlngs[latlngs.length - 1];
    }
    return result;
}

// Dekode polyline string (Google Polyline Algorithm) dari OSRM
function decodePolyline(str, precision) {
    var index = 0, lat = 0, lng = 0, coordinates = [], shift = 0, result = 0, byte = null, latitude_change, longitude_change, factor = Math.pow(10, Number.isInteger(precision) ? precision : 5);
    while (index < str.length) {
        byte = null; shift = 0; result = 0;
        do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
        latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
        shift = result = 0;
        do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
        longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += latitude_change; lng += longitude_change;
        coordinates.push([lat / factor, lng / factor]);
    }
    return coordinates;
}

let currentModalDeviceId = null;
let currentModalTruckNumber = null;
let lastAppliedStartDate = null;
let lastAppliedEndDate = null;

// Filter DOM
const historyTimePreset = document.getElementById('historyTimePreset');
const customDateRange = document.getElementById('customDateRange');
const histStartDate = document.getElementById('histStartDate');
const histEndDate = document.getElementById('histEndDate');
const applyHistoryFilterBtn = document.getElementById('applyHistoryFilterBtn');

if (historyTimePreset) {
    historyTimePreset.addEventListener('change', (e) => {
        if (e.target.value === 'custom') {
            customDateRange.style.display = 'flex';
            
            // Auto-fill form dengan rentang waktu yang sedang aktif/dipilih
            if (lastAppliedStartDate && lastAppliedEndDate) {
                const pad = (n) => n.toString().padStart(2, '0');
                const toLocalIso = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                
                histStartDate.value = toLocalIso(lastAppliedStartDate);
                histEndDate.value = toLocalIso(lastAppliedEndDate);
            }
        } else {
            customDateRange.style.display = 'none';
        }
    });
}

if (applyHistoryFilterBtn) {
    applyHistoryFilterBtn.addEventListener('click', () => {
        if (currentModalDeviceId && currentModalTruckNumber) {
            openHistoryModal(currentModalDeviceId, currentModalTruckNumber);
        }
    });
}

const resetHistoryFilterBtn = document.getElementById('resetHistoryFilterBtn');
if (resetHistoryFilterBtn) {
    resetHistoryFilterBtn.addEventListener('click', () => {
        if (historyTimePreset) historyTimePreset.value = '1hour';
        if (customDateRange) customDateRange.style.display = 'none';
        if (histStartDate) histStartDate.value = '';
        if (histEndDate) histEndDate.value = '';
        
        const manualRadio = document.querySelector('input[name="routingMode"][value="manual"]');
        if (manualRadio) manualRadio.checked = true;

        if (currentModalDeviceId && currentModalTruckNumber) {
            openHistoryModal(currentModalDeviceId, currentModalTruckNumber);
        }
    });
}

// Listener Mode Routing (OSRM vs Manual)
const routingRadios = document.querySelectorAll('input[name="routingMode"]');
routingRadios.forEach(radio => {
    radio.addEventListener('change', () => {
        if (currentModalDeviceId && currentModalTruckNumber) {
            openHistoryModal(currentModalDeviceId, currentModalTruckNumber);
        }
    });
});

function buildHistoryUrl(deviceId) {
    let baseUrl = `${HISTORY_API_URL}?deviceId=${deviceId}`;
    if (!historyTimePreset) return baseUrl;

    const preset = historyTimePreset.value;
    let startDate = new Date();
    let endDate = new Date();
    
    if (preset === '1hour') {
        startDate.setHours(endDate.getHours() - 1);
    } else if (preset === '3hour') {
        startDate.setHours(endDate.getHours() - 3);
    } else if (preset === '6hour') {
        startDate.setHours(endDate.getHours() - 6);
    } else if (preset === '12hour') {
        startDate.setHours(endDate.getHours() - 12);
    } else if (preset === '1day') {
        startDate.setDate(endDate.getDate() - 1);
    } else if (preset === '1week') {
        startDate.setDate(endDate.getDate() - 7);
    } else if (preset === '1month') {
        startDate.setMonth(endDate.getMonth() - 1);
    } else if (preset === 'custom') {
        if (!histStartDate.value || !histEndDate.value) {
            alert('Peringatan: Silakan isikan tanggal mulai dan selesai untuk custom range. Mengambil data 1 hari terakhir sebagai default.');
            startDate.setDate(endDate.getDate() - 1);
        } else {
            startDate = new Date(histStartDate.value);
            endDate = new Date(histEndDate.value);
        }
    } else {
        // Fallback default
        startDate.setHours(endDate.getHours() - 1);
    }

    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();
    
    // Simpan object date lokal agar bisa dipakai pre-fill UI ketika pindah mode 'custom'
    lastAppliedStartDate = startDate;
    lastAppliedEndDate = endDate;

    return n8nProxy(`${baseUrl}&createdDate_gte=${startIso}&createdDate_lte=${endIso}`);
}

// Fungsi memanggil API histori dan merender garis
async function openHistoryModal(deviceId, truckNumber) {
    currentModalDeviceId = deviceId;
    currentModalTruckNumber = truckNumber;

    historyModal.classList.add('active'); // Tampilkan Modal
    loadingHistory.innerHTML = 'Sedang memuat data rute perjalanan...';
    loadingHistory.style.display = 'flex'; // Tampilkan Loading
    distanceInfoBox.style.display = 'none'; // Sembunyikan jarak sementara
    
    // Clear previous auto-hide timer
    if (historyAutoHideTimer) { clearTimeout(historyAutoHideTimer); historyAutoHideTimer = null; }
    // Auto-hide history panel after 10 minutes (600,000 ms)
    historyAutoHideTimer = setTimeout(() => {
      historyModal.classList.remove('active');
      distanceInfoBox.style.display = 'none';
      if (tabMapBtn && tabChartBtn) {
        tabMapBtn.classList.add('active');
        tabChartBtn.classList.remove('active');
        mapTabContent.style.display = 'flex';
        chartTabContent.style.display = 'none';
      }
    }, 600000);
    totalDistanceText.innerText = '-';
    
    // Inisiasi History Map jika belum pernah dirender
    if (!historyMapInstance) {
        historyMapInstance = L.map('historyMap').setView([-7.195, 112.68], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(historyMapInstance);
        historyLayerGroup = L.layerGroup().addTo(historyMapInstance);
    }
    
    // Karena container modal baru muncul (display:flex), map API sering kali belum ngeh perubahan ukurannya.
    setTimeout(() => {
        historyMapInstance.invalidateSize();
    }, 300);

    // Hapus rute histori sebelumnya
    historyLayerGroup.clearLayers();

    try {
        const fetchUrl = buildHistoryUrl(deviceId);
        const response = await fetch(fetchUrl, { credentials: 'include' });
        const data = await response.json();
        
        if (data && data.length > 0) {
            // Urutkan data track berdasarkan waktu (createdDate) atau fallback ke ObjectID (_id)
            data.sort((a,b) => {
                if (a.createdDate && b.createdDate) {
                    return new Date(a.createdDate) - new Date(b.createdDate);
                } else if (a._id && b._id) {
                    return a._id.localeCompare(b._id);
                }
                return 0;
            });

            // --- SPEED CALCULATION LOGIC FOR CHART ---
            const chartLabels = [];
            const chartSpeeds = [];
            
            for (let i = 0; i < data.length; i++) {
                const currentPoint = [parseFloat(data[i].latitude), parseFloat(data[i].longitude)];
                let timeStr = '-';
                if (data[i].createdDate) {
                    const d = new Date(data[i].createdDate);
                    // sv-SE gives Standard YYYY-MM-DD HH:mm:ss format
                    const fmtDate = d.toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' });
                    timeStr = fmtDate.substring(0, 16); // YYYY-MM-DD HH:mm
                }
                chartLabels.push(timeStr);
                
                if (i === 0) {
                    chartSpeeds.push(0); // Titik pertama nge-stay (0 km/h)
                } else {
                    const prevPoint = [parseFloat(data[i-1].latitude), parseFloat(data[i-1].longitude)];
                    // Karena kita butuh method Leaflet distance
                    const p1 = L.latLng(prevPoint[0], prevPoint[1]);
                    const p2 = L.latLng(currentPoint[0], currentPoint[1]);
                    const distanceMeters = p1.distanceTo(p2);
                    
                    let diffSeconds = 1;
                    if (data[i].createdDate && data[i-1].createdDate) {
                        const t1 = new Date(data[i-1].createdDate).getTime();
                        const t2 = new Date(data[i].createdDate).getTime();
                        diffSeconds = (t2 - t1) / 1000;
                    }
                    if (diffSeconds <= 0) diffSeconds = 0.1; // Cekap ke nol tidak boleh
                    
                    let speedKmH = (distanceMeters / diffSeconds) * 3.6;
                    // Cap kecepatan maksimal jika error GPS dari n8n jumping ekstrem (max 150 km/h)
                    if (speedKmH > 150) speedKmH = 150; 
                    
                    chartSpeeds.push(speedKmH.toFixed(2));
                }
            }

            // --- AGGREGATION LOGIC FOR CHART ---
            let durationHours = 1;
            if (data.length > 2 && data[0].createdDate && data[data.length - 1].createdDate) {
                const startT = new Date(data[0].createdDate).getTime();
                const endT = new Date(data[data.length - 1].createdDate).getTime();
                durationHours = (endT - startT) / (1000 * 60 * 60);
            }
            
            let bucketMinutes = 1;
            let bucketLabel = "1 menit";
            
            if (durationHours <= 1.5) { bucketMinutes = 1; bucketLabel = "1 menit"; }
            else if (durationHours <= 3.5) { bucketMinutes = 5; bucketLabel = "5 menit"; }
            else if (durationHours <= 6.5) { bucketMinutes = 10; bucketLabel = "10 menit"; }
            else if (durationHours <= 12.5) { bucketMinutes = 15; bucketLabel = "15 menit"; }
            else if (durationHours <= 24.5) { bucketMinutes = 30; bucketLabel = "30 menit"; }
            else if (durationHours <= 72.5) { bucketMinutes = 60; bucketLabel = "1 jam"; }
            else if (durationHours <= 168.5) { bucketMinutes = 480; bucketLabel = "8 jam"; }
            else { bucketMinutes = 1440; bucketLabel = "1 hari"; }
            
            const bucketMillis = bucketMinutes * 60 * 1000;
            
            const aggregatedChartLabels = [];
            const aggregatedChartSpeeds = [];
            
            if (data.length > 0 && data[0].createdDate) {
                let currentBucketStart = new Date(data[0].createdDate).getTime();
                currentBucketStart = Math.floor(currentBucketStart / bucketMillis) * bucketMillis; // Bulatkan kebawah sesuai skala
                
                let currentBucketSpeeds = [];
                let currentBucketLabels = [];
                
                for (let i = 0; i < data.length; i++) {
                    if (!data[i].createdDate || isNaN(chartSpeeds[i])) continue;
                    const pointT = new Date(data[i].createdDate).getTime();
                    
                    // Jika melewati batas akhir ember (bucket), maka tutup ember dan simpan rata-ratanya
                    if (pointT >= currentBucketStart + bucketMillis) {
                        if (currentBucketSpeeds.length > 0) {
                            const maxSpeed = Math.max(...currentBucketSpeeds);
                            aggregatedChartSpeeds.push(maxSpeed.toFixed(2));
                            const maxIndex = currentBucketSpeeds.indexOf(maxSpeed);
                            aggregatedChartLabels.push(currentBucketLabels[maxIndex]);
                        }
                        
                        // Buka ember baru
                        currentBucketStart = Math.floor(pointT / bucketMillis) * bucketMillis;
                        currentBucketSpeeds = [];
                        currentBucketLabels = [];
                    }
                    
                    currentBucketSpeeds.push(parseFloat(chartSpeeds[i]));
                    currentBucketLabels.push(chartLabels[i]);
                }
                
                // Masukkan sisa poin yang ada di ember terakhir
                if (currentBucketSpeeds.length > 0) {
                    const maxSpeed = Math.max(...currentBucketSpeeds);
                    aggregatedChartSpeeds.push(maxSpeed.toFixed(2));
                    const maxIndex = currentBucketSpeeds.indexOf(maxSpeed);
                    aggregatedChartLabels.push(currentBucketLabels[maxIndex]);
                }
            } else {
                aggregatedChartLabels.push(...chartLabels);
                aggregatedChartSpeeds.push(...chartSpeeds);
            }

            // Handler Custom HTML Tooltip
            const getOrCreateTooltip = (chart) => {
                let tooltipEl = document.getElementById('customTooltip');
                if (!tooltipEl) {
                    tooltipEl = document.createElement('div');
                    tooltipEl.id = 'customTooltip';
                    tooltipEl.classList.add('custom-chartjs-tooltip');
                    document.body.appendChild(tooltipEl);
                    
                    // Hover behavior to prevent fading out quickly when moving to tooltip
                    tooltipEl.addEventListener('mouseenter', () => tooltipEl.classList.add('hovering'));
                    tooltipEl.addEventListener('mouseleave', () => tooltipEl.classList.remove('hovering'));
                }
                return tooltipEl;
            };

            const externalTooltipHandler = (context) => {
                const {chart, tooltip} = context;
                const tooltipEl = getOrCreateTooltip(chart);

                if (tooltipEl.classList.contains('hovering')) {
                    // Jangan ubah posisi atau hide jika kursor sedang di dalam kotak tooltip (mencegah kejar-kejaran)
                    return;
                }

                if (tooltip.opacity === 0) {
                    tooltipEl.style.opacity = 0;
                    setTimeout(() => { 
                        if(tooltipEl.style.opacity == 0) tooltipEl.style.visibility = 'hidden'; 
                    }, 200); // delay nunggu kursor pindah
                    return;
                }

                tooltipEl.style.visibility = 'visible';
                tooltipEl.style.opacity = 1;

                if (tooltip.body) {
                    const dataIndex = tooltip.dataPoints[0].dataIndex;
                    const originalLabel = chart.data.labels[dataIndex];
                    const speedVal = tooltip.dataPoints[0].raw;
                    
                    tooltipEl.innerHTML = `
                        <button class="tooltip-close-btn" id="tooltipCloseBtn"><i class="fa-solid fa-xmark"></i></button>
                        <div style="margin-bottom: 5px; font-weight: bold; font-size: 13px;">Waktu: ${originalLabel}</div>
                        <div style="margin-bottom: 2px; font-size: 13px;">Kecepatan: ${speedVal} km/jam</div>
                        <div style="margin-bottom: 8px; font-size: 10px; color: #cbd5e1; font-style: italic;">(Kecepatan ini adalah nilai tertinggi dalam ${bucketLabel})</div>
                        <button id="tooltipRouteBtn" class="tooltip-route-btn">🗺️ Lihat Rute</button>
                    `;

                    const closeBtn = tooltipEl.querySelector('#tooltipCloseBtn');
                    if (closeBtn) {
                        closeBtn.addEventListener('click', () => {
                            tooltipEl.classList.remove('hovering');
                            tooltipEl.style.opacity = 0;
                            tooltipEl.style.visibility = 'hidden';
                        });
                    }

                    const routeBtn = tooltipEl.querySelector('#tooltipRouteBtn');
                    routeBtn.addEventListener('click', () => {
                        const pointIsoLocal = originalLabel.replace(' ', 'T');
                        const dStart = new Date(pointIsoLocal);
                        // Tembak secara presisi: Hanya ambil 5 menit sebelum titik tertinggi (menghiraukan ukuran ember bulan/minggu)
                        dStart.setMinutes(dStart.getMinutes() - 5);
                        
                        const dEnd = new Date(pointIsoLocal);
                        // Sampai 5 menit setelahnya untuk melihat manuver berhentinya
                        dEnd.setMinutes(dEnd.getMinutes() + 5);
                        
                        const pad = (n) => n.toString().padStart(2, '0');
                        const formatIso = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                        
                        const startIsoLocal = formatIso(dStart);
                        const endIsoLocal = formatIso(dEnd);
                        
                        const historyTimePreset = document.getElementById('historyTimePreset');
                        const customDateRange = document.getElementById('customDateRange');
                        const histStartDate = document.getElementById('histStartDate');
                        const histEndDate = document.getElementById('histEndDate');
                        const applyHistoryFilterBtn = document.getElementById('applyHistoryFilterBtn');
                        
                        if (historyTimePreset && customDateRange && histStartDate && histEndDate && applyHistoryFilterBtn) {
                            historyTimePreset.value = 'custom';
                            customDateRange.style.display = 'flex';
                            histStartDate.value = startIsoLocal;
                            histEndDate.value = endIsoLocal;
                            
                            const tMapBtn = document.getElementById('tabMapBtn');
                            if (tMapBtn) tMapBtn.click();
                            applyHistoryFilterBtn.click();
                            tooltipEl.style.opacity = 0;
                            tooltipEl.style.visibility = 'hidden';
                        }
                    });
                }

                const position = context.chart.canvas.getBoundingClientRect();
                // Avoid tooltip going offscreen right
                const tooltipWidth = 160; 
                let leftPos = position.left + window.scrollX + tooltip.caretX + 15;
                if(leftPos + tooltipWidth > window.innerWidth) {
                    leftPos = position.left + window.scrollX + tooltip.caretX - tooltipWidth - 15;
                }

                tooltipEl.style.left = leftPos + 'px';
                tooltipEl.style.top = position.top + window.scrollY + tooltip.caretY + 'px';
            };

            // RENDER BAR CHART KECEPATAN
            const ctx = document.getElementById('speedChart');
            if (ctx) {
                if (speedChartInstance) {
                    speedChartInstance.destroy();
                }
                speedChartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: aggregatedChartLabels,
                        datasets: [{
                            label: `Kecepatan Truk (Tertinggi per ${bucketLabel})`,
                            data: aggregatedChartSpeeds,
                            pointBackgroundColor: aggregatedChartSpeeds.map(s => {
                                const speed = parseFloat(s);
                                if (speed > 50) return '#ef4444'; // Merah
                                if (speed >= 30) return '#f59e0b'; // Kuning
                                return '#10b981'; // Hijau
                            }),
                            pointBorderColor: '#ffffff',
                            pointRadius: 4,
                            pointHoverRadius: 6,
                            borderWidth: 2,
                            fill: false,
                            tension: 0.3,
                            segment: {
                                borderColor: ctx => {
                                    if (ctx.p1DataIndex === undefined) return '#10b981';
                                    const speed = parseFloat(aggregatedChartSpeeds[ctx.p1DataIndex]);
                                    if (speed > 50) return '#ef4444';
                                    if (speed >= 30) return '#f59e0b';
                                    return '#10b981';
                                }
                            }
                        }]
                    },
                    options: {
                        interaction: {
                            mode: 'index',
                            intersect: false,
                        },
                        layout: {
                            padding: { bottom: 20 }
                        },
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            tooltip: {
                                enabled: false,
                                external: externalTooltipHandler
                            },
                            legend: {
                                display: true,
                                labels: { font: { family: 'Inter', size: 13 } }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                title: { display: true, text: 'Kecepatan (km/jam)', font: { family: 'Inter', size: 12 } }
                            },
                            x: {
                                ticks: { 
                                    callback: function(value) {
                                        const label = this.getLabelForValue(value);
                                        return label ? label.substring(11, 16) : ''; // Hanya HH:mm
                                    },
                                    maxRotation: 45, 
                                    minRotation: 45, 
                                    font: { family: 'Inter', size: 10 } 
                                }
                            }
                        }
                    }
                });
            }

            // Ekstrak koordinat asli
            let rawLatlngs = data.map(item => [parseFloat(item.latitude), parseFloat(item.longitude)]);
            
            // Batasi koordinat untuk mencegah OSRM menolak request jika poin terlalu banyak (maks 100)
            let sampledLatlngs = simplifyCoordinates(rawLatlngs, 90);

            // Rangkai URL OSRM: format {lon},{lat};{lon},{lat}
            const coordinatesString = sampledLatlngs.map(coord => `${coord[1]},${coord[0]}`).join(';');
            
            // Mengambil rute perjalanan jalan raya via public API OSRM
            try {
                // Cek toggle radio button
                const routingModeNode = document.querySelector('input[name="routingMode"]:checked');
                const routingModeSelected = routingModeNode ? routingModeNode.value : 'manual';
                
                if (routingModeSelected === 'manual') {
                    throw new Error("Force Manual Routing Mode");
                }

                loadingHistory.innerHTML = 'Sedang mencari lintasan jalan (Mencocokkan rute)...';
                const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordinatesString}?overview=full&geometries=polyline`;
                
                const osrmResponse = await fetch(osrmUrl);
                const osrmData = await osrmResponse.json();

                if (osrmData.code === 'Ok' && osrmData.routes.length > 0) {
                    const route = osrmData.routes[0];
                    // Decoding polyline menjadi koordinat Leaflet
                    const routeCoordinates = decodePolyline(route.geometry);
                    
                    // Jarak jarak aslinya
                    const distanceKm = (route.distance / 1000).toFixed(2);
                    totalDistanceText.innerText = distanceKm;
                    distanceInfoBox.style.display = 'block';

                    // Gambar rute lintasan yang mengikuti jalan raya
                    const polyline = L.polyline(routeCoordinates, {
                        color: '#2563eb', // warna biru
                        weight: 5,        
                        opacity: 0.8,
                        smoothFactor: 1
                    }).addTo(historyLayerGroup);
                    
                    // Paskan peta zoom nya
                    historyMapInstance.fitBounds(polyline.getBounds(), { padding: [50, 50] });
                } else {
                    // Fallback jika API OSRM tidak bisa meresolusi rute (error / no routes)
                    throw new Error("No OSRM Route found");
                }
            } catch (osrmError) {
                if (osrmError.message !== "Force Manual Routing Mode") {
                    console.warn('Gagal merute via OSRM, kembali ke mode garis lurus.', osrmError);
                }
                // Hitung manual secara kasar jarak garis lurus 
                let manualDistance = 0;
                for (let i = 0; i < rawLatlngs.length - 1; i++) {
                    manualDistance += historyMapInstance.distance(rawLatlngs[i], rawLatlngs[i+1]);
                }
                totalDistanceText.innerText = (manualDistance / 1000).toFixed(2) + " (Garis Lurus)";
                distanceInfoBox.style.display = 'block';

                // Gambar lintasan lurus seperti semula
                const polyline = L.polyline(rawLatlngs, {
                    color: '#ef4444', // beri warna beda jika fallback (merah)
                    weight: 4,
                    opacity: 0.8,
                    dashArray: '10, 10' // Putus-putus tanda tidak ada jalan
                }).addTo(historyLayerGroup);
                
                historyMapInstance.fitBounds(polyline.getBounds(), { padding: [50, 50] });
            }
            
            // Titik penghubung (Waypoints) beserta jam/waktu
            data.forEach((item, index) => {
                const lat = parseFloat(item.latitude);
                const lng = parseFloat(item.longitude);
                let speedVal = chartSpeeds[index] ? chartSpeeds[index] : "0.00";

                // Tambahkan Label Kecepatan di Tengah-tengah Garis (antara titik sebelumnya dan saat ini)
                if (index > 0) {
                    const prevLat = parseFloat(data[index-1].latitude);
                    const prevLng = parseFloat(data[index-1].longitude);
                    
                    const midLat = (prevLat + lat) / 2;
                    const midLng = (prevLng + lng) / 2;
                    
                    const speedIcon = L.divIcon({
                        className: '', // Kosongkan string untuk menghapus styling bawaan .leaflet-div-icon (kotak abu-abu kosong)
                        html: `<div style="background-color: #6b7280; color: white; border-radius: 4px; font-size: 10px; font-weight: bold; width: 60px; text-align: center; padding: 2px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.3); opacity: 0.9;">${speedVal} <span style="font-size: 8px;">km/jam</span></div>`,
                        iconSize: [60, 20],
                        iconAnchor: [30, 10] // Titik tengah dari iconSize [60, 20]
                    });
                    
                    L.marker([midLat, midLng], {
                        icon: speedIcon,
                        interactive: false // Agar tidak mengganggu klik rute
                    }).addTo(historyLayerGroup);
                }

                // Lewati titik ujung agar tidak bentrok dengan marker stard/end yang besar
                if (index === 0 || index === data.length - 1) return;

                let timeStr = "Waktu Tidak Diketahui";
                if (item.createdDate) {
                    const d = new Date(item.createdDate);
                    timeStr = d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute:'2-digit' }) + ' WIB';
                }

                L.circleMarker([lat, lng], {
                    radius: 4,
                    color: '#2563eb', // biru agar senada dengan polyline
                    fillColor: '#ffffff',
                    fillOpacity: 1,
                    weight: 2
                })
                .bindTooltip(`<b>${timeStr}</b><br>Truck: ${truckNumber}<br><span style="display:inline-block; margin-top:5px; padding:3px 6px; background-color: #6b7280; color: white; border-radius: 4px; font-size: 11px; font-weight: bold;">${speedVal} km/jam</span>`, { direction: 'top', opacity: 0.9 })
                .addTo(historyLayerGroup);
            });

            // Marker Titik Mulai (Start - Indeks 0)
            let startTime = data[0].createdDate ? new Date(data[0].createdDate).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute:'2-digit' }) + ' WIB' : '-';
            L.marker(rawLatlngs[0], { icon: startIcon })
             .bindPopup(`<b>Kendaraan Mulai Berangkat</b><br>Truck: ${truckNumber}<br>Waktu: ${startTime}`)
             .addTo(historyLayerGroup);
            
            // Marker Titik Berhenti Saat Ini (End - Indeks Terakhir)
            if (rawLatlngs.length > 1) {
                let endTime = data[data.length - 1].createdDate ? new Date(data[data.length - 1].createdDate).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute:'2-digit' }) + ' WIB' : '-';
                L.marker(rawLatlngs[rawLatlngs.length - 1], { icon: endIcon })
                 .bindPopup(`<b>Posisi Terakhir</b><br>Truck: ${truckNumber}<br>Waktu: ${endTime}`)
                 .addTo(historyLayerGroup);
            }

        } else {
            console.warn('Tidak ada data histori ditemukan untuk ID device ini');
            loadingHistory.innerHTML = `Tidak ada rekam data histori perjalanan.<br><button id="errorCloseBtn" style="margin-top:10px; padding:6px 12px; cursor:pointer;">Tutup</button>`;
            const btn = document.getElementById('errorCloseBtn');
            if (btn) {
                btn.addEventListener('click', () => closeHistoryModalBtn.click());
            }
            return;
        }
    } catch (e) {
        console.error("Gagal mendapatkan riwayat:", e);
        loadingHistory.innerHTML = `Terjadi kesalahan jaringan saat mengambil riwayat API.<br><button id="fatalErrorCloseBtn" style="margin-top:10px; padding:6px 12px; cursor:pointer;">Tutup</button>`;
        const btn = document.getElementById('fatalErrorCloseBtn');
        if (btn) {
            btn.addEventListener('click', () => closeHistoryModalBtn.click());
        }
        return;
    } finally {
        // Jika sukses merender lintasan, Sembunyikan layar loading
        if(loadingHistory.innerHTML.includes("Sedang")) {
            loadingHistory.style.display = 'none';
        }
    }
}

// Tutup History Modal
closeHistoryModalBtn.addEventListener('click', () => {
    historyModal.classList.remove('active');
    // Clear auto-hide timer
    if (historyAutoHideTimer) { clearTimeout(historyAutoHideTimer); historyAutoHideTimer = null; }
    // Kembalikan text loading dan sembunyikan jarak
    distanceInfoBox.style.display = 'none';

    // Reset Tabs UI
    if (tabMapBtn && tabChartBtn) {
        tabMapBtn.classList.add('active');
        tabChartBtn.classList.remove('active');
        mapTabContent.style.display = 'flex';
        chartTabContent.style.display = 'none';
    }

    // Reset Mode Routing ke Garis Lurus (Manual)
    const manualRadio = document.querySelector('input[name="routingMode"][value="manual"]');
    if (manualRadio) {
        manualRadio.checked = true;
    }
    
    // Reset Filter UI kembali ke default (1 Jam)
    if (historyTimePreset) historyTimePreset.value = '1hour';
    if (customDateRange) customDateRange.style.display = 'none';
    if (histStartDate) histStartDate.value = '';
    if (histEndDate) histEndDate.value = '';

    setTimeout(() => {
        loadingHistory.innerHTML = 'Sedang memuat data rute perjalanan...';
        loadingHistory.style.display = 'none';
    }, 500);
});

// ==========================================
// PENGATURAN MODE APLIKASI (GEOLOCATION MAP)
// ==========================================
const logoMenuToggle = document.getElementById('logoMenuToggle');
const appModeMenu = document.getElementById('appModeMenu');
const modeRadios = document.querySelectorAll('input[name="appMode"]');

let userWatchId = null;
let userMarker = null;

if (logoMenuToggle && appModeMenu) {
    logoMenuToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        appModeMenu.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (!logoMenuToggle.contains(e.target) && !appModeMenu.contains(e.target)) {
            appModeMenu.classList.remove('show');
        }
    });
}

const createUserIcon = (heading) => {
    const rotate = heading !== null && !isNaN(heading) ? heading : 0;
    const svgIcon = `
        <div style="transform: rotate(${rotate}deg); transform-origin: center center;">
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <!-- Panah Elegan -->
                <path d="M16 2 L30 28 L16 22 L2 28 Z" fill="#3b82f6" stroke="white" stroke-width="2"/>
            </svg>
        </div>
    `;

    return L.divIcon({
        className: 'user-direction-marker',
        html: svgIcon,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    });
}

const stopGeoTracking = () => {
    if (userWatchId !== null) {
        navigator.geolocation.clearWatch(userWatchId);
        userWatchId = null;
    }
    if (userMarker) {
        map.removeLayer(userMarker);
        userMarker = null;
    }
};

const startGeoTracking = () => {
    if (!navigator.geolocation) {
        alert("Browser Anda tidak mendukung layanan Geolokasi.");
        const modeMonitoringRadio = document.querySelector('input[name="appMode"][value="monitoring"]');
        if(modeMonitoringRadio) modeMonitoringRadio.checked = true;
        return;
    }

    let isFirstPan = true;

    userWatchId = navigator.geolocation.watchPosition((position) => {
        const { latitude, longitude, heading } = position.coords;

        if (!userMarker) {
            userMarker = L.marker([latitude, longitude], { icon: createUserIcon(heading) }).addTo(map);
        } else {
            userMarker.setLatLng([latitude, longitude]);
            userMarker.setIcon(createUserIcon(heading));
        }

        if (isFirstPan) {
            map.flyTo([latitude, longitude], 15, { animate: true, duration: 1.5 });
            isFirstPan = false;
        }
        
        if (isNavigating) {
            updateNavRoute();
        }

    }, (error) => {
        console.error("Geolokasi Error: ", error);
        alert("Gagal membaca lokasi. Pastikan izin lokasi (GPS) browser diaktifkan dan dilonggarkan untuk web ini.");
        const modeMonitoringRadio = document.querySelector('input[name="appMode"][value="monitoring"]');
        if(modeMonitoringRadio) modeMonitoringRadio.checked = true;
        stopGeoTracking();
    }, {
        enableHighAccuracy: true,
        maximumAge: 0, 
        timeout: 10000
    });
};

if (modeRadios.length > 0) {
    modeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            const mode = e.target.value;
            const badge = document.getElementById('appModeBadge');
            
            if (mode === 'journey') {
                startGeoTracking();
                appModeMenu.classList.remove('show');
                if (badge) {
                    badge.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Perjalanan';
                    badge.classList.add('journey-active');
                }
            } else {
                stopGeoTracking();
                appModeMenu.classList.remove('show');
                if (badge) {
                    badge.innerHTML = '<i class="fa-solid fa-desktop"></i> Monitoring';
                    badge.classList.remove('journey-active');
                }
            }
        });
    });
}

// ==========================================
// TARGET DIRECTION MODE
// ==========================================
let isNavigating = false;
let navTargetDevice = null;
let navPolylineLayer = null;
let previousAppMode = 'monitoring';

const navigationCard = document.getElementById('navigationCard');
const navTargetName = document.getElementById('navTargetName');
const navDistanceValue = document.getElementById('navDistanceValue');
const navEtaValue = document.getElementById('navEtaValue');
const exitNavBtn = document.getElementById('exitNavBtn');

if (exitNavBtn) {
    exitNavBtn.addEventListener('click', exitDirectionMode);
}

function startDirectionMode(device) {
    if (!device) return;
    
    // Save current mode before forcefully changing it
    const activeRadio = document.querySelector('input[name="appMode"]:checked');
    if (activeRadio) {
        previousAppMode = activeRadio.value;
    }
    
    isNavigating = true;
    navTargetDevice = device;
    
    // Paksa masuk Mode Perjalanan secara programatis
    const modeJourneyRadio = document.querySelector('input[name="appMode"][value="journey"]');
    if(modeJourneyRadio && !modeJourneyRadio.checked) {
        modeJourneyRadio.checked = true;
        modeJourneyRadio.dispatchEvent(new Event('change')); 
    }
    
    navTargetName.innerHTML = `🚗 Menuju Target: ${device.truckNumber}`;
    navigationCard.classList.add('active');
    
    renderMarkers(); 
    updateNavRoute();
}

function exitDirectionMode() {
    isNavigating = false;
    navTargetDevice = null;
    navigationCard.classList.remove('active');
    
    if (navPolylineLayer) {
        map.removeLayer(navPolylineLayer);
        navPolylineLayer = null;
    }
    
    // Kembalikan semua marker
    renderMarkers();
    
    // Kembalikan ke mode sebelumnya
    if (previousAppMode === 'monitoring') {
        const modeMonitoringRadio = document.querySelector('input[name="appMode"][value="monitoring"]');
        if (modeMonitoringRadio && !modeMonitoringRadio.checked) {
            modeMonitoringRadio.checked = true;
            modeMonitoringRadio.dispatchEvent(new Event('change'));
        }
    }
}

async function updateNavRoute() {
    if (!isNavigating || !navTargetDevice) return;
    
    if (!userMarker) {
        navDistanceValue.innerText = 'Menunggu GPS...';
        navEtaValue.innerText = '--';
        return;
    }
    
    const targetLatLng = state.markersList[navTargetDevice.id] ? state.markersList[navTargetDevice.id].getLatLng() : L.latLng(navTargetDevice.coordinates[0], navTargetDevice.coordinates[1]);
    const userLatLng = userMarker.getLatLng();
    
    try {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${userLatLng.lng},${userLatLng.lat};${targetLatLng.lng},${targetLatLng.lat}?overview=full&geometries=polyline`;
        const res = await fetch(osrmUrl);
        const json = await res.json();
        
        if (json.routes && json.routes.length > 0) {
            const route = json.routes[0];
            const distanceKm = (route.distance / 1000).toFixed(1);
            const durationMin = Math.ceil(route.duration / 60);
            
            navDistanceValue.innerText = distanceKm + ' km';
            navEtaValue.innerText = durationMin + ' mnt';
            
            const coordsArray = decodePolyline(route.geometry);
            
            if (navPolylineLayer) {
                map.removeLayer(navPolylineLayer);
            }
            navPolylineLayer = L.polyline(coordsArray, { 
                color: '#10b981', // Emerald dash route target
                weight: 5, 
                dashArray: '10, 10', 
                lineCap: 'round'
            }).addTo(map);
            
            map.fitBounds(navPolylineLayer.getBounds(), { padding: [50, 50] });
        }
    } catch (e) {
        console.error("Gagal menarik rute navigasi API: ", e);
    }
}

// ==========================================
// PUSH-TO-TALK (PTT) WEBSOCKET LOGIC
// ==========================================
import { setupPtt, initPttWebSocket, startPttCall, bindPttButtons, muteDevice, unmuteDevice } from './src/ptt.js';

window.audioCtx = null;

setupPtt({
    wsUrl: WS_URL,
    registrationSecret: REGISTRATION_SECRET,
});

bindPttButtons();
// REMOVED: initPttWebSocket(); // Now called inside initApp after captcha

// Expose to global for inline onclick handlers
window.startPttCall = startPttCall;
window.mutePttDevice = muteDevice;
window.unmutePttDevice = unmuteDevice;
