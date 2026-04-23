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
- **`index.html`**: Kerangka antarmuka (*Single Page*). Mempunyai area ganda: `.app-container` (berisi `<aside id="sidebar">` dan `<main class="map-container">`) serta area bayangan `<div id="historyModal">`. Ada logo Teluk Lamong bergaya *floating* estetik.
- **`style.css`**: Modul visual yang kaya (*vibrant & modern*). Memuat deklarasi root `--colors`, logika efek transisi pelipatan sidebar (`.sidebar.collapsed`), `.toggle-btn`, UI custom tag badges, status baterai, dan CSS Modal Overlay statis (`z-index: 9999`).
- **`script.js`**: Pusat saraf yang terbagi ke dalam: Logika Fetch API, Logika Peta Utama (*Markers* berjalan dengan *multi-tag badges* & indikator baterai), Logika Sinkronisasi Antarmuka (*DOM event listener*, *Live Search*), dan Logika Peta Modal Sekunder (*History polyline*, *interactive waypoints*, dan *OSRM routing*).

## 3. Webhooks API Integrations (N8N Microservices)
Kode ini mengkonsumsi data dari dua *endpoint* Webhooks N8N via metode HTTP `GET`.

### A. Endpoint 1: *Current Devices Cordinate*
* **URL:** `https://n8n.freeat.me/webhook/device-cordinate`
* **Sifat Eksekusi:** Otomatis melalui timer *Interval* dinamis (pilihan 5s, 10s, 15s) untuk mengemas efek _Live Tracking_.
* **Expected JSON Contract:**
  ```json
  [
    {
      "deviceId": "string",
      "serialNumber": "string",  // Digunakan sebagai ID Plat Truk
      "latitude": "stringable float",
      "longitude": "stringable float",
      "lastConnectionDate": { "time": timestamp_number }, // Penentu Status dan Timestamp visual
      "deviceTags": ["tag1", "tag2"], // Array tag untuk device
      "battery": number // Level baterai (persentase)
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

## 4. Newly Added Features (Keep Context)
   - **SEO & Logo Optimization**: `index.html` diperkaya standar Meta tags/OG, serta logo Teluk Lamong *floating* (latar putih transparan & *shadow*) di pojok kanan atas map agar UI terasa lebih premium.
   - **Rich Floating Marker Badges**: Ikon pada peta tidak hanya memuat truk, namun ditumpuk oleh elemen HTML kaya (`.marker-floating-badge`) yang menampilkan *multiple device tags*, persentase indikator baterai dengan warna dinamis (hijau/kuning/merah), dan info detail ID pada popup. Tampilan badge di Sidebar per-device juga sudah diperbesar & responsif.
   - **Interval Countdown & Total Counter**: Sidebar memuat `Total Device: X` yang auto-recalculated berdasarkan filter search. Terdapat animasi *countdown SVG lingkaran* berlari mundur untuk memvisualisasikan hitungan waktu memanggil API. User bisa mengubah interval timer (5s, 10s, 15s) via toggle menu *floating*.
   - **Interactive Route Waypoints**: Saat fitur *History* menampilkan lintasan polyline, sistem akan melukis *circle markers (waypoints)* biru di seluruh titik lekukan rute perjalanan. Jika *waypoints* ini di-*hover*, tooltip dengan jam/waktu persis kedatangan truk bersangkutan akan dimunculkan.
   - **OSRM vs Manual Routing Toggle**: Modal Riwayat dilengkapi untuk beralih antar dua mode. Secara bawaan (Smart Route) menggunakan *OSRM Route Snapping* agar mengikuti liukan jalan raya. Jika OSRM gagal, ada API _error_, atau user sengaja memilih "Mode Garis Lurus", lintasan di-_fallback_ ke manual lurus putus-putus.
   - **Dynamic Speed Line Chart**: Modal histori tidak hanya menampilkan rute jalan, tetapi dilengkapi Tab "Grafik Kecepatan" yang disokong oleh `Chart.js`. Grafik dilukis dinamis (hijau < 30km/j, kuning 30-50, merah > 50) dengan sumbu-X waktu `HH:MM`.
   - **Interactive HTML Custom Tooltip (Click-to-Route)**: Menggantikan fungsi bawaan Chart.js dengan *Custom HTML Tooltip* interaktif agar menerima dukungan klik DOM murni (`pointer-events: auto`). Di dalamnya tersemat tombol *"Lihat Rute"* yang, saat ditekan, secara programatis mengatur Filter Waktu (Manual) sejauh `1 Jam Start-End Date`, auto-switch ke Tab Peta, dan memaksa API me-render potret lintasan lokasi tersebut detik itu juga (1-Click Switch).
   - **Mobile Responsiveness UI**: Aplikasi sangat adaptif untuk penggunaan perangkat seluler. Sidebar kini direkayasa melayang (*Absolute Overlay*) pada *mobile* dan menutup secara otonom saat ditekan/diakses. Tombol-tombol mengambang (drawer & timer) merangkak menjauh dari bahaya tumpang-tindih *mobile browser menu* (diposisikan nyaman sentuh ibu jari).
   - **Smart Time Date Filtering**: Menambahkan prasetel pencarian data N8N (1, 3, 6, 12 Jam, dan seterusnya) untuk optimalisasi bobot koordinat. Bilamana berganti mode kalender (Input Custom), sistem secara cerdas menjembataninya dengan mereproduksi tanggal dari interaksi muatan API terakhir (*Auto-Fill Active Sync*) beserta *Reset Button* instan.
   - **Self-Hosted Navigation GPS (Mode Perjalanan/Direction)**: Menyulap aplikasi menjadi GPS *tracker* mandiri dengan integrasi sensor `navigator.geolocation`. Menghapus *link out* ke Google Maps dan menggantinya dengan fitur "Arahkan ke Truk". Saat aktif, peta mengisolasi target (*hide other trucks*), menggambar *user marker* (panah kompas berputar dinamis), memunculkan *Navigation Floating Card* (ETA & Jarak di posisi dasar), serta melukis lajur jalan raya `router.project-osrm.org` secara interaktif bersinergi layaknya duel 1-vs-1.
   - **Smart State Restoration**: Ekosistem Mode Perjalanan dilengkapi rekaman status. Saat navigasi ditutup, aplikasi otomatis mengingat dan mengembalikan Anda tanpa hambatan ke posisi "Mode Monitoring" (mematikan GPS kembali) atau tetap di posisi mode awal pra-navigasi tanpa memutus memori.

## 5. Crucial Logic Rules & Constraints (DO NOT BREAK)

Setiap asisten AI yang memodifikasi sistem ini **HARUS MEMATUHI** aturan mutlak berikut:

1. **Leaflet Invalidate Size Issue:**
   - Memasukkan objek Leaflet ke dalam struktur Flex/Grid (seperti peluasan Container pasca Sidebar dilipat) atau melampirkannya pada div tertutup (`display: none` pada Modal) secara alamiah akan mengacau otak pemuatan *tiles map* Leaflet (gambar peta jadi abu-abu sebagian).
   - **Solusi Yang Harus Dipertahankan:** Selidiki `setTimeout` kecil (~300-400ms) di dalam `script.js` tempat fungsi `map.invalidateSize()` dan `historyMapInstance.invalidateSize()` dieksekusi. Ini difungsikan untuk memicu _re-rendering_ dimensi pasca efek transisi CSS kelar.
2. **Double Map Instance:**
   - Terdapat **Dua** instance global Leaflet: `map` (Peta Utama) dan `historyMapInstance` (Peta dalam Modal). Jangan membingungkan atau me-referensi UI pada variabel / lapisan layer (*layerGroup*) yang saling bersilangan.
3. **Data Sorting for Polylines:**
   - Leaflet `L.polyline` niscaya akan kusut (garis lompat-lompat mundur) jika array data koordinat yang dijejali tidak tersortir kronologis.
   - Logika sortir sekarang: **Prioritaskan `a.createdDate`** -> Fallback ke Native Mongo sort `a._id.localeCompare`.
4. **No Direct DOM Mutations on Real-time Events:**
   - Mengingat *refresh API* array perangkat berjalan tiap interval habis (misal 5 detik), **semua Markers di-_reset_** `clearLayers()`. Jangan sembarangan menyuntik state *hardcode* ID per *marker* menggunakan `document.getElementById()`, selangkah lebih elok deklarasikan *rendering interface* itu di dalam loop `renderMarkers()`.
5. **OSRM Route Snapping & Simplify Coordinates:**
   - Jalur riwayat truk dikirim ke _Open Source Routing Machine_ (`router.project-osrm.org`) melalui fetch URL memanjang. Guna mencegah blokade API _limit points_, koordinat sengaja di_downsampling_ via fungsi `simplifyCoordinates(latlngs, 90)`.
   - String aneh output OSRM ditangani aman oleh decoder Algorithm Google Polyline: `decodePolyline(str, precision)`. Jangan usik rumusnya.
6. **Timezone (WIB) Layering Effect:**
   - Seluruh logika simpan DB (N8N) berpaku pada standar murni ISO 8601 UTC Time. Tanggal Waktu Indonesia Barat `Asia/Jakarta` mutlak dijadikan sebatas format topeng presentasi ke *User Interface* (`.toLocaleString()` dsb). Jangan keliru memutar logika dan mengoper WIB mentah-mentah saat merequest *History API Date Range*.

## 6. Known Pending Features / Todos
Area iterasi selanjutnya (Bila diperlukan/diminta):
* Mekanisme **Marker Clustering** murni Leaflet bila kelak populasi API alat membludak tembus target > 500 titik per detik.
* **Geofencing & Polygon Warning**: Mewarnakan peta area terlarang doking pelabuhan untuk menyiarkan sinyal _Alert_ UI merah bila koordinat truk melenceng menabrak benteng Polygon.
* Ekspor Laporan Histori ke File `CSV / Excel / PDF` berdasarkan urutan koordinat N8N.
* Animasi Transisi Halus (*Moving Marker*) antartitik alih-alih me-_refresh_ dengan efek letupan (*teleporting markers*).
