// Konfigurasi API N8N
const API_URL = 'https://n8n.freeat.me/webhook/device-cordinate';

// State global untuk menyimpan data terbaru
let devicesData = [];
const markersList = {};

// Initialize Map Leaflet (Pusat titik dipindah ke area koordinat riil Teluk Lamong dari API)
const map = L.map('map').setView([-7.195, 112.68], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Custom icon untuk marker truck
const truckActiveIcon = L.divIcon({
    html: `<div style="background-color: #2563eb; color: white; width: 36px; height: 36px; display: flex; justify-content: center; align-items: center; border-radius: 50%; box-shadow: 0 4px 12px rgba(37,99,235,0.4); border: 2px solid white;">
            <i class="fa-solid fa-truck"></i>
           </div>`,
    className: 'custom-div-icon',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18]
});

const truckIdleIcon = L.divIcon({
    html: `<div style="background-color: #f59e0b; color: white; width: 36px; height: 36px; display: flex; justify-content: center; align-items: center; border-radius: 50%; box-shadow: 0 4px 12px rgba(245,158,11,0.4); border: 2px solid white;">
            <i class="fa-solid fa-truck"></i>
           </div>`,
    className: 'custom-div-icon',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18]
});


// Fungsi untuk memanggil data dari API N8N
async function fetchDeviceData() {
    try {
        deviceListContainer.innerHTML = '<p style="text-align:center; margin-top: 20px;">Mengambil data API...</p>';
        
        const response = await fetch(API_URL);
        const data = await response.json();
        
        // Memetakan (Mapping) hasil API ke format yang dibutuhkan UI kita
        devicesData = data.map(item => {
            // Karena API tidak menyimpan keterangan status aktif, kita buat logika sederhana:
            // Jika update terakhir di bawah 60 menit, kita anggap 'active'. Lebih dari itu 'idle'.
            const connDate = item.lastConnectionDate ? new Date(item.lastConnectionDate.time) : new Date();
            const now = new Date();
            const diffMinutes = Math.floor((now - connDate) / (1000 * 60));
            const status = diffMinutes < 120 ? 'active' : 'idle'; // Toleransi 2 jam
            
            return {
                id: item.deviceId,
                truckNumber: item.serialNumber, // Menggunakan Serial Number sebagai representasi Truk
                coordinates: [parseFloat(item.latitude), parseFloat(item.longitude)],
                status: status,
                speed: '- km/h', // API saat ini belum memberikan value speed
                lastUpdate: connDate.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute:'2-digit' }) + ' WIB',
                tags: item.deviceTags || []
            };
        });

        // Setelah data berhasil termapping, render ke Maps dan Sidebar
        renderMarkers();
        // Reset Search Input dan render list
        const keyword = searchInput.value.toLowerCase();
        const filtered = devicesData.filter(d => 
            d.truckNumber.toLowerCase().includes(keyword) || 
            d.id.toLowerCase().includes(keyword)
        );
        renderDeviceList(filtered);

    } catch (error) {
        console.error('Gagal mengambil data dari API:', error);
        deviceListContainer.innerHTML = '<p style="text-align:center; color: var(--idle-orange); margin-top: 20px;"><i class="fa-solid fa-triangle-exclamation"></i> Gagal mengambil data. Pastikan Webhook N8N menyala.</p>';
        
        // Tampilkan setidaknya dummy data jika gagal agar layout tidak kosong melompong.
        // renderDeviceList([... dummy array if needed])
    }
}

// Render Markers ke Map
function renderMarkers() {
    // Hapus marker lama sebelum menaruh yang baru (untuk mencegah duplikasi jika di-refresh)
    Object.values(markersList).forEach(marker => {
        map.removeLayer(marker);
    });

    devicesData.forEach(device => {
        // Cek jika koordinat invalid
        if (isNaN(device.coordinates[0]) || isNaN(device.coordinates[1])) return;

        const customIcon = device.status === 'active' ? truckActiveIcon : truckIdleIcon;
        const marker = L.marker(device.coordinates, { icon: customIcon }).addTo(map);
        
        // Setup popup konten
        const popupContent = `
            <div class="custom-popup-content">
                <h3><i class="fa-solid fa-truck"></i> ${device.truckNumber}</h3>
                <p><strong>Device ID:</strong> ${device.id.substring(0,8)}...</p>
                <p><strong>Koordinat:</strong> ${device.coordinates[0]}, ${device.coordinates[1]}</p>
                <p><strong>Status:</strong> <span style="text-transform: capitalize;">${device.status}</span></p>
                <p><strong>Update:</strong> ${device.lastUpdate}</p>
                <button class="history-btn" onclick="openHistoryModal('${device.id}', '${device.truckNumber}')">
                    <i class="fa-solid fa-route"></i> Riwayat Perjalanan
                </button>
                <a href="https://www.google.com/maps/search/?api=1&query=${device.coordinates[0]},${device.coordinates[1]}" target="_blank" class="gmaps-link">
                    <i class="fa-solid fa-location-arrow"></i> Buka di Google Maps
                </a>
            </div>
        `;
        
        marker.bindPopup(popupContent);
        markersList[device.id] = marker;
    });
}

// DOM Elements
const deviceListContainer = document.getElementById('deviceList');
const searchInput = document.getElementById('searchInput');

// Render list device ke sidebar
function renderDeviceList(devices) {
    deviceListContainer.innerHTML = '';
    
    if (devices.length === 0) {
        deviceListContainer.innerHTML = '<p style="text-align:center; color: var(--text-muted); margin-top: 20px;">Tidak ada device/truk ditemukan.</p>';
        return;
    }

    devices.forEach(device => {
        const card = document.createElement('div');
        card.className = 'device-card';
        card.id = `card-${device.id}`; // untuk keperluan highlight
        
        // Event click untuk fokus ke maps
        card.onclick = () => focusDevice(device.id);

        const statusClass = device.status === 'active' ? 'status-active' : 'status-idle';
        
        let tagsHtml = '';
        if (device.tags && device.tags.length > 0) {
            const badges = device.tags.map(tag => `<span class="tag-badge"><i class="fa-solid fa-tag"></i> ${tag.tagValue || tag}</span>`).join('');
            tagsHtml = `<div class="device-tags">${badges}</div>`;
        }

        card.innerHTML = `
            <div class="card-header">
                <div class="truck-id">
                    <i class="fa-solid fa-microchip"></i> ${device.truckNumber}
                </div>
                <div class="status-badge ${statusClass}">${device.status}</div>
            </div>
            ${tagsHtml}
            <div class="device-details">
                <div class="detail-row">
                    <i class="fa-solid fa-barcode"></i>
                    <span>Device: ${device.id.substring(0, 10)}...</span>
                </div>
                <div class="detail-row">
                    <i class="fa-solid fa-location-dot"></i>
                    <span>${device.coordinates[0].toFixed(5)}, ${device.coordinates[1].toFixed(5)}</span>
                </div>
                <!-- 
                <div class="detail-row">
                    <i class="fa-solid fa-gauge-high"></i>
                    <span>Speed: ${device.speed}</span>
                </div>
                -->
            </div>
        `;
        deviceListContainer.appendChild(card);
    });
}

// Fungsi untuk fokus pada salah satu device
function focusDevice(deviceId) {
    const device = devicesData.find(d => d.id === deviceId);
    if (!device) return;

    // Reset highlight di semua card
    const allCards = document.querySelectorAll('.device-card');
    allCards.forEach(c => c.classList.remove('active-card'));
    
    // Set highlight di card yg dipilih
    const selectedCard = document.getElementById(`card-${deviceId}`);
    if (selectedCard) {
        selectedCard.classList.add('active-card');
    }

    // Arahkan map ke koordinat (FlyTo) dengan zoom 16
    map.flyTo(device.coordinates, 16, { duration: 1.5 });
    
    // Tampilkan popup dari marker setelah map mendarat
    setTimeout(() => {
        if(markersList[deviceId]) {
            markersList[deviceId].openPopup();
        }
    }, 1500); // Sinkronisasi dengan durasi flyTo
}

// Fitur pencarian realtime
searchInput.addEventListener('input', (e) => {
    const keyword = e.target.value.toLowerCase();
    
    const filteredDevices = devicesData.filter(d => 
        (d.truckNumber && d.truckNumber.toLowerCase().includes(keyword)) || 
        (d.id && d.id.toLowerCase().includes(keyword))
    );
    
    renderDeviceList(filteredDevices);
});

// Menjalankan fetch data petama kali
fetchDeviceData();

// auto update data lokasi secara real-time setiap 1 menit (60.000 ms)
setInterval(fetchDeviceData, 60000);

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

// ==========================================
// LOGIKA MODAL RIWAYAT PERJALANAN (HISTORY)
// ==========================================

const historyModal = document.getElementById('historyModal');
const closeHistoryModalBtn = document.getElementById('closeHistoryModalBtn');
const loadingHistory = document.getElementById('loadingHistory');
let historyMapInstance = null;
let historyLayerGroup = null;

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

function buildHistoryUrl(deviceId) {
    let baseUrl = `https://n8n.freeat.me/webhook/device-history?deviceId=${deviceId}`;
    if (!historyTimePreset) return baseUrl;

    const preset = historyTimePreset.value;
    let startDate = new Date();
    let endDate = new Date();
    
    if (preset === '1day') {
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
        startDate.setDate(endDate.getDate() - 1);
    }

    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();
    return `${baseUrl}&createdDate_gte=${startIso}&createdDate_lte=${endIso}`;
}

// Fungsi memanggil API histori dan merender garis
async function openHistoryModal(deviceId, truckNumber) {
    currentModalDeviceId = deviceId;
    currentModalTruckNumber = truckNumber;

    historyModal.classList.add('active'); // Tampilkan Modal
    loadingHistory.innerHTML = 'Sedang memuat data rute perjalanan...';
    loadingHistory.style.display = 'flex'; // Tampilkan Loading
    distanceInfoBox.style.display = 'none'; // Sembunyikan jarak sementara
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
        const response = await fetch(fetchUrl);
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

            // Ekstrak koordinat asli
            let rawLatlngs = data.map(item => [parseFloat(item.latitude), parseFloat(item.longitude)]);
            
            // Batasi koordinat untuk mencegah OSRM menolak request jika poin terlalu banyak (maks 100)
            let sampledLatlngs = simplifyCoordinates(rawLatlngs, 90);

            // Rangkai URL OSRM: format {lon},{lat};{lon},{lat}
            const coordinatesString = sampledLatlngs.map(coord => `${coord[1]},${coord[0]}`).join(';');
            
            // Mengambil rute perjalanan jalan raya via public API OSRM
            try {
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
                console.warn('Gagal merute via OSRM, kembali ke mode garis lurus.', osrmError);
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
                // Lewati titik ujung agar tidak bentrok dengan marker stard/end yang besar
                if (index === 0 || index === data.length - 1) return;

                const lat = parseFloat(item.latitude);
                const lng = parseFloat(item.longitude);

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
                .bindTooltip(`<b>${timeStr}</b><br>Truck: ${truckNumber}`, { direction: 'top', opacity: 0.9 })
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
            loadingHistory.innerHTML = `Tidak ada rekam data histori perjalanan.<br><button onclick="closeHistoryModalBtn.click()" style="margin-top:10px; padding:6px 12px; cursor:pointer;">Tutup</button>`;
            return;
        }
    } catch (e) {
        console.error("Gagal mendapatkan riwayat:", e);
        loadingHistory.innerHTML = `Terjadi kesalahan jaringan saat mengambil riwayat API.<br><button onclick="closeHistoryModalBtn.click()" style="margin-top:10px; padding:6px 12px; cursor:pointer;">Tutup</button>`;
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
    // Kembalikan text loading dan sembunyikan jarak
    distanceInfoBox.style.display = 'none';
    
    // Reset Filter UI kembali ke default (1 Hari)
    if (historyTimePreset) historyTimePreset.value = '1day';
    if (customDateRange) customDateRange.style.display = 'none';
    if (histStartDate) histStartDate.value = '';
    if (histEndDate) histEndDate.value = '';

    setTimeout(() => {
        loadingHistory.innerHTML = 'Sedang memuat data rute perjalanan...';
        loadingHistory.style.display = 'none'; // Tambahkan ini agar tidak melayang kalau sedang ditutup
    }, 500);
});
