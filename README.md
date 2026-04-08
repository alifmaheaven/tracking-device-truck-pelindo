# Tracking Device Truck Pelindo

Aplikasi antarmuka web (UI) interaktif untuk melacak posisi armada truk secara *real-time* di area Pelabuhan Teluk Lamong. Website ini diintegrasikan langsung dengan *webhooks* N8N untuk menerima data koordinat GPS perangkat IoT (*Internet of Things*) secara otomatis.

## 🌟 Fitur Utama

- **Peta Interaktif (Leaflet.js)**: Visualisasi lokasi truk di atas peta dengan fitur perbesaran otomatis (auto-zoom) dan animasi *fly-to* saat truk dipilih.
- **Auto-Refresh Real-Time**: Fitur penarikkan data di latar belakang yang secara otomatis memperbarui data dari Webhook N8N setiap 1 menit, tanpa perlu memuat ulang (*reload*) halaman browser.
- **Sidebar Dinamis yang Dapat Disembunyikan**: Susunan daftar perangkat (*device list*) yang bisa dilipat (*collapse*) dengan memanfaatkan tombol melayang (*floating button*), memberi pengguna pengalaman porsi layar penuh (*full-screen view*).
- **Status Kendaraan Menyesuaikan Waktu Pinging**: Truk akan menampilkan ikon warna biru apabila aktif, dan warna oranye apabila diasumsikan *idle* (diam), bergantung pada jeda waktu *timestamp* terakhir data GPS dikirimkan ke server.
- **Fitur Live-Search**: Pencarian instan untuk melacak truk spesifik melalui Nomor Seri Truk (*Serial Number*) maupun ID Perangkat (*Device ID*).

## 🛠️ Tech Stack & Library

- **Dasar**: Vanilla HTML5, CSS3, dan JavaScript (ES6+ Asynchronous Fetch)
- **Maps Engine**: [Leaflet.js](https://leafletjs.com/) v1.9.4 bersumber dari OpenStreetMap (OSM) Tiles.
- **Ikon dan Grafis**: FontAwesome 6 dan Google Fonts (Inter).
- **Web Server & Deployment**: Nginx Alpine via Docker Engine.

## 🚀 Cara Menjalankan Aplikasi di Lokal

Aplikasi *frontend* ini dirancang agar sangat portabel dan ringkas. Penggunaan Nginx via Docker sangat disarankan.

### 1. Menjalankan via Docker Compose (Direkomendasikan)

Pastikan aplikasi **Docker Desktop** kamu dalam keadaan menyala (*Engine Running*).

```bash
# 1. Buka terminal, pastikan masuk dulu ke root direktori repositori ini
cd tracking-device-truck-pelindo

# 2. Jalankan container secara detached (di background)
docker compose up -d
```
Aplikasi secara otomatis terpasang dengan Nginx web server. 
Buka browser favoritmu dan akses alamat: 👉 **http://localhost:8080**

> **💡 Tips Pengembangan**: Semua file (`index.html`, `style.css`, `script.js`) langsung terhubung (*volume mapped*). Setiap ada editan kode, cukup tekan Ctr-S (simpan) lalu tekan tombol **Refresh/F5** di browser. Tidak perlu me-reset atau menghentikan kontainer Docker sama sekali.

### 2. Dijalankan Manual (Tanpa Docker/Web Server)
Kamu juga bisa melihat tampilannya tanpa *tech stack* apapun. Cukup akses foldernya melalui File Manager (Finder/Windows Explorer) lalu klik ganda pada file `index.html`. Browser secara otomatis akan merender antarmuka penggunanya. (Note: Metode HTTP Server Nginx lebih disarankan jika dihadapkan pada kendala batasan keamanan CORS API *Cross-Origin Resource Sharing* dari browser versi terbaru).

## 🌐 Alur Data API N8N

Logika perantara antarmuka dengan *Microservices* N8N diletakkan di dalam urutan `fetchDeviceData` pada file `script.js`.

```javascript
// Konfigurasi endpoint Webhook N8N:
const API_URL = 'https://n8n.freeat.me/webhook/device-cordinate';
```
Kunci *payload* (*JSON structure*) wajib yang dikirimkan oleh mesin Webhook ke antarmuka klien ini adalah:
```json
[
  {
    "deviceId": "9305b0fa8c...31e035163c95",
    "serialNumber": "RRGYC03GDCY",
    "latitude": "-7.1868231",
    "longitude": "112.6878258",
    "lastConnectionDate": {
       "time": 1775632908860
    }
  }
]
```

## 📜 Lisensi
Aplikasi eksklusif pengembangan internal untuk kebutuhan Pelindo & PT Prakhya Tama Cakrawala. Node Webhooks secara ketat dibatasi untuk komunikasi via _server hostname_ `freeat.me`.
