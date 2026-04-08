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
                lastUpdate: connDate.toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute:'2-digit' })
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
        
        card.innerHTML = `
            <div class="card-header">
                <div class="truck-id">
                    <i class="fa-solid fa-microchip"></i> ${device.truckNumber}
                </div>
                <div class="status-badge ${statusClass}">${device.status}</div>
            </div>
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
