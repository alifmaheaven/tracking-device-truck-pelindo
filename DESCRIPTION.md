# Project Architecture & Context (For AI Assistants)

Buku panduan ini ditulis khusus untuk **AI Assistant** / AI Coder yang akan meneruskan, me- *refactor*, atau menambahkan fitur baru ke dalam *codebase* ini. Mohon baca secara detail instruksi di bawah ini untuk memahami arsitektur DOM, peta, dan integrasi HTTP *endpoints* sebelum memodifikasi kode, agar tidak berhalusinasi atau merusak fitur *real-time* yang telah terbentuk.

---

## 1. Project Overview & Environment
- **Nama Projek:** Tracking Device Truck Pelindo (Teluk Lamong)
- **Tech Stack:** Vanilla HTML5, CSS3, ES6 JavaScript (Tanpa Framework seperti React/Vue/Node).
- **Library Tambahan Utama:** Leaflet.js (v1.9.4) & FontAwesome 6.
- **Environment:** Nginx Alpine Server (didefinisikan via `docker-compose.yml`) melalui pemetaan volume (*volume binding*) pada direktori statis `/usr/share/nginx/html`.
- **Lokasi Geografis Default:** Koordinat `-7.195, 112.68` (Surabaya/Teluk Lamong Port).

## 2. File Structure & Scope
- **`index.html`**: Kerangka antarmuka (*Single Page*). Mempunyai area ganda: `.app-container` (berisi `<aside id="sidebar">` dan `<main class="map-container">`) serta area bayangan `<div id="historyModal">`.
- **`style.css`**: Modul visual yang kaya (*vibrant & modern*). Memuat deklarasi root `--colors`, logika efek transisi pelipatan sidebar (`.sidebar.collapsed`), `.toggle-btn`, dan CSS Modal Overlay statis (`z-index: 9999`).
- **`script.js`**: Pusat saraf yang terbagi ke dalam: Logika Fetch API, Logika Peta Utama (*Markers* berjalan), Logika Sinkronisasi Antarmuka (*DOM event listener*, *Live Search*), dan Logika Peta Modal Sekunder (*Polyline Tracking*).

## 3. Webhooks API Integrations (N8N Microservices)
Kode ini mengkonsumsi data dari dua *endpoint* Webhooks N8N via metode HTTP `GET`.

### A. Endpoint 1: *Current Devices Cordinate*
* **URL:** `https://n8n.freeat.me/webhook/device-cordinate`
* **Sifat Eksekusi:** Otomatis melalui *Cron/Interval* (`setInterval` 60.000 md - 1 menit) untuk mengemas efek _Live Tracking_.
* **Expected JSON Contract:**
  ```json
  [
    {
      "deviceId": "string",
      "serialNumber": "string",  // Digunakan sebagai ID Plat Truk
      "latitude": "stringable float",
      "longitude": "stringable float",
      "lastConnectionDate": { "time": timestamp_number } // Digunakan sebagai penentu Status (Idle vs Active) dan Timestamp visual
    }
  ]
  ```

### B. Endpoint 2: *Device Tracking History Path*
* **URL:** `https://n8n.freeat.me/webhook/device-history?deviceId={deviceId}&createdDate_gte={startIso}&createdDate_lte={endIso}`
* **Sifat Eksekusi:** Sesuai permintaan (*on-demand*) yang terikat kepada rentang waktu UI Filter di modal (default 1 Hari Terakhir).
* **Expected JSON Contract:**
  ```json
  [
    {
      "_id": "69d61a53...", 
      "deviceId": "string",
      "latitude": "stringable float",
      "longitude": "stringable float",
      "createdDate": "ISO Timestamp String" // Digunakan untuk SORTING URUTAN RUTE (A->Z)
    }
  ]
  ```

## 4. Crucial Logic Rules & Constraints (DO NOT BREAK)

Setiap asisten AI yang memodifikasi sistem ini **HARUS MEMATUHI** aturan mutlak berikut:

1. **Leaflet Invalidate Size Issue:**
   - Memasukkan objek Leaflet ke dalam struktur Flex/Grid (seperti proses perluasan Container pasca Sidebar dilipat) atau melampirkannya pada div tak kasatmata (`display: none` pada Modal) secara alamiah akan mengacaukan pemuatan *tiles map* Leaflet (gambar abu-abu sepotong).
   - **Solusi Yang Harus Dipertahankan:** Selidiki `setTimeout` kecil (~300-400ms) di dalam `script.js` tempat fungsi `map.invalidateSize()` dieksekusi. Ini difungsikan untuk mendeteksi pemuatan dimensi pasca transisi CSS.
2. **Double Map Instance:**
   - Terdapat **Dua** instance objek Leaflet global: `map` (Peta Utama) dan `historyMapInstance` (Peta dalam Modal). Jangan tertukar atau menggabungkan variabel lapisannya (`historyLayerGroup`).
3. **Data Sorting for Polylines:**
   - Garis Leaflet (`L.polyline`) membutuhkan array lat/long yang berurutan secara waktu agar lukisan lintasan tidak kusut mondar-mandir. Format API *History* telah berevolusi menggunakan `createdDate`.
   - Logika urutan saat ini (*Current Sorting Strategy*): **Utamakan properti `a.createdDate`** -> Fallback ke struktur Native Mongo `a._id.localeCompare`.
4. **No Direct DOM Mutations on Real-time Events:**
   - Karena array perangkat (`devicesData`) di *refresh* setiap satu menit, **seluruh Markers akan di-`clearLayers()`**, dihapus dan dibuat ulang dari nol. Jika Anda ingin menambah status UI pada satu *marker* (misalnya animasi klip CSS), terapkan di *loop* rendering (`renderMarkers()`), bukan *hard-coding* merubah elemennya.
5. **OSRM Route Snapping:**
   - Garis rute dari data history dialirkan (`fetch`) ke Leaflet menggunakan *Open Source Routing Machine* (OSRM). Jika API OSRM menolak karena koordinat tidak berada di tepi jalan raya (*off-road*) atau error lainnya, terdapat *try...catch* yang memundurkannya (*fallback*) ke metode garis lurus manual bawaan array asli (`L.polyline` lurus putus-putus).
   - Penguraian *Polyline format* dari OSRM memanfaatkan decoder Google Polyline pada fungsi `decodePolyline(str, precision)`. Jangan hapus fungsi dasar ini.
6. **Timezone (WIB) UI Layering:**
   - Karena API N8N tetap mendasarkan perhitungan secara murni lewat `ISO Timestamp / UTC`, fungsi `toLocaleDateString` di Javascript telah direkayasa keras (*hardcoded*) untuk memaksakan pemformatan waktu Asia Barat (`timeZone: 'Asia/Jakarta'`) hanya pada *layer interface*.
   - Filter parameter yang meluncur via API URL haruslah dikirim menggunakan format `.toISOString()`.

## 5. Known Pending Features / Todos
Area iterasi masa depan (Jika Klien Meminta):
* Fitur Kluster Lanjutan (Marker Clustering) jika populasi alat > 300.
* Animasi *Moving Marker Backend* layaknya Ojek Online ketimbang efek melompat (*teleportation*).
* Integrasi *Geofencing Alert* berbasis *Polygon Layer* di Leaflet untuk area terlarang di pelabuhan.
* *Export to CSV/PDF* untuk laporan riwayat perjalanan harian.
