# Audit & Plan: Maps Device Pelindo
**Tanggal:** 2026-07-06
**Scope:** E2E login → report
**Auditor:** Dev team (3 agent gagal 429 — dilakukan manual oleh lead)
**PM:** Claude (sintesis)
**Status:** READY FOR QA

> Catatan: 3 sub-agent audit gagal (upstream 429). Audit dilakukan manual terhadap file yang sudah dibaca langsung: `backend/server.js`, `backend/routes/{auth,admin}.js`, `backend/middleware/{auth,roles,auditLog}.js`, `backend/db.js`, `frontend/src/{auth,admin,map,ptt,state,utils}.js`, `frontend/index.html`, `frontend/dist/index.html`, `mobile/TruckPTT_Expo/app/index.tsx`, `docker-compose.yml`. File `frontend/script.js` (50KB) dan `mobile/modules/ptt-overlay/*` dibaca sebagian via grep + targeted reads.

---

## 1. Hasil Audit — Bug yang Ditemukan

### CRITICAL (harus fix sebelum production)

| # | Lokasi | Masalah | Dampak |
|---|---|---|---|
| C1 | `mobile/TruckPTT_Expo/app/index.tsx:96-117` | `if (callSessionRef.current.active \|\| true)` — `\|\| true` membuat kondisi selalu true → mic bisa merekam walau belum ada call aktif | Privacy: mikrofon bocor ke WS |
| C2 | `mobile/TruckPTT_Expo/app/index.tsx:534-569` | `startForegroundService()` skip kalau `AppState !== 'active'`. Padahal driver sering pakai PTT dari overlay saat app di-background → service tidak pernah start → mic/audio bisa di-kill Android | Fungsi PTT mati di skenario real |
| C3 | `backend/server.js:185` | `cookieParser.signedCookie(rawValue.slice(2), cookieSecret)` — pakai `cookieSecret` (env var, sudah valid). OK. **TAPI** fallback hardcoded di line lain? Cek lebih lanjut — `const cookieSecret = process.env.COOKIE_SECRET;` line 58 langsung exit kalau missing. Aman. **TAPI** di WS handshake `verifyClient` whitelisted `'localhost'` — di prod harusnya hanya prod hostname. | Potensi CSWSH (Cross-Site WebSocket Hijack) dari localhost dev |
| C4 | `backend/server.js:115-118` | `allowedHosts` N8N proxy: `['10.118.62.60:5678', 'ptt.teluklamong.co.id', 'n8n-teluk-lamong.freeat.me']` — ada IP private hardcoded. Backend harusnya pakai hostname internal Docker (`pelindo-n8n:5678`) saja. IP private leak. | SSRF surface lebih luas; fingerprint infra internal |
| C5 | `backend/server.js:268` | `else if (true /* Skip mobile auth check */)` — mobile truck tanpa `REGISTRATION_SECRET` di-accept. Secret tidak pernah dipakai. | Anyone bisa register sebagai truck/deviceId manapun → spoof device → mute device lain → broadcast audio atas nama orang lain |
| C6 | `mobile/TruckPTT_Expo/app/index.tsx:262-287` | `attemptAutoLogin` panggil `fetch(API_URL)` (N8N webhook device-cordinate) tanpa auth, lalu cari `serialNumber` cocok. N8N webhook bisa return semua device → siapa saja bisa enumerate semua device + SN + PPT code aktif. | Enumeration attack: bocor semua plat truk, SN, PPT code (kunci login tablet) |
| C7 | `backend/server.js:103-105` | `cors({ origin: ['https://ptt.teluklamong.co.id'], credentials: true })` — origin tidak include `'https://www.ptt.teluklamong.co.id'` (www subdomain). User yg akses via www → cookie tidak terkirim. | Login loop / 401 random |
| C8 | `mobile/TruckPTT_Expo/app/index.tsx:343,353` | `notifee.stopForegroundService()` di cleanup effect, tapi `foregroundServiceStarted.current` di-reset di line 339. Race: kalau cleanup jalan sebelum register effect baru mount, service ke-stop permanen. | PTT mati setelah toggle device |

### HIGH (harus fix segera, mungkin ok untuk ship kalau ada mitigation)

| # | Lokasi | Masalah | Dampak |
|---|---|---|---|
| H1 | `backend/server.js:589-598` | Keepalive `setInterval(25000)` panggil `ws.ping()` — tidak ada clear saat `wss.close`? Sebenarnya line 630 clear. OK. **TAPI** `autoEndInterval` (line 602) hanya bersihkan `sessions`, tidak bersihkan `callActivity` jika ada entries tanpa session → memory leak kecil. | Memory growth |
| H2 | `frontend/src/ptt.js:355-363` | `ws.onclose` panggil `setTimeout(initPttWebSocket, 3000)` — **tidak exponential backoff**. Network putus 5 menit = 100 reconnect attempts = CPU spike + server stampede. | WS reconnect storm |
| H3 | `frontend/src/ptt.js:262-265` | `initPttWebSocket` check `CONNECTING/OPEN` skip. **TAPI** `CLOSED` masih lanjut replace `state.pttWs` — race kalau close event fire setelah set baru. | WS leak / double listener |
| H4 | `backend/server.js:140` | `fetch(finalUrl, { redirect: 'manual' })` — bagus, tapi `console.log('[proxy] calling:', finalUrl)` di line 135 log full URL. Kalau ada query string berisi token → leak ke logs. | Token leak di log |
| H5 | `backend/routes/admin.js:33-47` | Admin buat user: `password.length < 8` — tidak enforce complexity (uppercase, angka, simbol). `bcrypt.hash(password, 12)` salt round 12 OK. | Weak password di-accept |
| H6 | `backend/server.js:600-627` | `AUTO_END_DELAY = 25 detik` + `setInterval(10000)` check — artinya call bisa auto-end setelah 25-35 detik tanpa audio. Untuk operator yg diam mendengar (mute mic), call di-end. **Berlawanan dengan use case dispatcher**. | Call putus terlalu cepat |
| H7 | `backend/server.js:268` | `REGISTRATION_SECRET` env var di-load di line 39 tapi tidak dipakai di line 268 (`else if (true)`). Dead code + bypass auth = C5 diperburuk. | (sama dgn C5) |
| H8 | `mobile/TruckPTT_Expo/app/index.tsx:623-663` | `connectWebSocket` set `pingIntervalRef.current` di onopen, tapi kalau WS error/close, ping interval di-clear. **Race**: `setInterval` jalan sebelum `clearInterval` kalau re-entry. | Memory leak kecil |
| H9 | `frontend/src/map.js:34` | `parseFloat(item.latitude)` — kalau N8N return string `"abc"` → `parseFloat` → `NaN`. Check di line 89 `isNaN` handle. OK. **TAPI** line 39 `(now - connDate) / (1000 * 60)` jika `lastConnectionDate.time` invalid → `NaN minutes` → `status` ke `idle` regardless. | Status selalu idle jika format date salah |

### MEDIUM (perlu fix, tidak blocking tapi harus dijadwalkan)

| # | Lokasi | Masalah |
|---|---|---|
| M1 | `frontend/script.js` (50KB) + `DESCRIPTION.md` "Pending #3" | **Tidak ada export laporan CSV/PDF**. User request "end-to-end dari login sampai laporan" → gap besar. |
| M2 | `backend/server.js:50-54` | CORS allow-list hardcoded. Tidak support staging. |
| M3 | `backend/server.js:208-212` | Audio frame rate limit 50/s — kalau truck ada di tempat sepi (idle), 50/s sangat boros bandwidth. Adaptive threshold by signal strength lebih baik. |
| M4 | `frontend/src/ptt.js:209-260` | `handleIncomingAudioStream` decode base64 → `atob` → loop char-by-char untuk Uint8Array. **Tidak efisien**: `atob` + TextEncoder dalam 1 line = 10× lebih cepat. |
| M5 | `mobile/TruckPTT_Expo/app/index.tsx:744-808` | `processAudioQueue` decode PCM → tulis ke file WAV di disk → load via `Audio.Sound.createAsync` → play → unload. **Setiap chunk = full disk I/O + decode**. Untuk audio real-time, latency tinggi. |
| M6 | `mobile/TruckPTT_Expo/app.json` (per DESCRIPTION.md #6.3) | `usesCleartextTraffic: true` — nyalakan cleartext untuk semua domain. Sebaiknya scope ke domain spesifik saja. |
| M7 | `backend/routes/auth.js:39` | Captcha compare: `safeCaptchaCode.toLowerCase() !== expectedCaptcha.toLowerCase()` — bukan constant-time comparison. Timing attack teoretis. |
| M8 | `frontend/src/admin.js:99` | `usersCache = await res.json()` — kalau response 401, `res.json()` masih dipanggil, lempar error. OK. **TAPI** tidak ada cache invalidation kalau `currentUser.id` di-deactivate dari server lain → admin bisa tetap di UI sampai refresh. |
| M9 | `backend/server.js:223-229` | Forward audio base64 ke centers: `message.toString('base64')` per chunk. **Memory churn**: setiap frame toString buat string besar. Kalau 50 frames/s × 50 centers = 2500 allocations/s. |
| M10 | `mobile/TruckPTT_Expo/app/index.tsx:30-34` | WebSocket URL default hardcoded ke `wss://ptt.teluklamong.co.id/ws`. Tidak ada fallback ke IP jika DNS down di pelabuhan. |

### LOW (nice-to-have)

| # | Lokasi | Masalah |
|---|---|---|
| L1 | `frontend/index.html:48-58` | Login form captcha input `maxlength=6` (sudah fix tadi), tapi `flex: 1; min-width: 100px` — di mobile portrait mungkin overflow. |
| L2 | `backend/server.js:175-191` | Manual cookie parsing di WS handshake — fragile, tidak handle multiple cookies dengan nama sama. |
| L3 | `mobile/TruckPTT_Expo/app/index.tsx:744-808` | `audioQueue.current` unbounded — kalau WS buffer flush lambat, queue numpuk. |
| L4 | `frontend/src/map.js:106-115` | `L.divIcon` di-recreate setiap marker baru — kalau ada 500 device = 500 div icon. Cluster perlu. |
| L5 | `backend/server.js:171` | `wss.on('connection', async (ws, req) =>` — `async` di handler tidak masalah, tapi tidak ada `await` di body sampai ws.message. Synchronous, OK. |

---

## 2. Plan + Problem Solving

### Phase 1 — Stop the bleeding (CRITICAL only) — ETA: 1-2 hari

**Problem C5/C7 (Mobile auth bypass + CORS) → Solusi:**
1. Hapus `else if (true)` di `server.js:268`. Wajibkan `REGISTRATION_SECRET` cocok:
   ```js
   } else {
     if (data.secret !== REGISTRATION_SECRET) {
       ws.send(JSON.stringify({ type:'error', message:'Invalid credentials' }));
       ws.close();
       return;
     }
     ws.userRole = 'truck';
   }
   ```
2. Tambah `www.ptt.teluklamong.co.id` di CORS allowlist.

**Problem C1 (mic bocor) → Solusi:**
Replace `callSessionRef.current.active || true` jadi `callSessionRef.current.active` saja. Kalau call belum aktif, tap = place call dulu, tap berikutnya = record. Atau pakai 2-tap pattern (first tap dials, second tap records).

**Problem C2 (foreground service skip) → Solusi:**
Hapus guard `AppState.currentState === 'active'`. Service harus start regardless — user pakai PTT dari notification/overlay = app di-background. Notifee sudah handle lifecycle-nya.

**Problem C3 (WS verifyClient localhost) → Solusi:**
Ganti whitelist ke env-based `WS_ALLOWED_ORIGINS` dengan default hanya prod domain. 'localhost' cuma untuk dev.

**Problem C4 (N8N IP private leak) → Solusi:**
Hapus `'10.118.62.60:5678'` dan `'n8n-teluk-lamong.freeat.me'` dari `allowedHosts`. Cukup `ptt.teluklamong.co.id` (external) yang akan di-rewrite ke `pelindo-n8n:5678` (internal).

**Problem C6 (N8N enumeration) → Solusi:**
Mobile tidak boleh hit N8N langsung. Tambah endpoint backend `POST /api/auth/device-login` (auth via PTT code + serialNumber) yg return device data saja untuk device tersebut. Atau: enforce auth di N8N webhook.

**Problem C8 (foreground service race) → Solusi:**
Pindah `foregroundServiceStarted.current = false` ke saat cleanup, dan re-start logic panggil langsung `startForegroundService()` (bukan via setTimeout yg bisa double-fire).

### Phase 2 — Hardening (HIGH) — ETA: 1 hari

- **H2 (reconnect storm):** Tambah exponential backoff (3s → 6s → 12s → max 60s, reset on success).
- **H4 (log leak):** Ganti `console.log('[proxy] calling:', finalUrl)` jadi `console.log('[proxy] calling:', parsedUrl.host + parsedUrl.pathname)` (no query string).
- **H5 (password complexity):** Tambah regex check min 1 upper, 1 lower, 1 digit di `admin.js:33`.
- **H6 (auto-end too aggressive):** Naikkan `AUTO_END_DELAY` ke 60-120 detik, atau pakai "talking" detection (mic activity dari truck, bukan diam-diam).
- **H7:** Sudah ter-cover C5.

### Phase 3 — E2E Report (gap utama) — ETA: 2-3 hari

**Problem:** `DESCRIPTION.md` "Pending #3" — tidak ada export. **End-to-end login → report tidak clear.**

**Solusi:**
1. Tambah tombol "Export Laporan" di history modal.
2. Format CSV minimal: `timestamp, latitude, longitude, speed_kmh, distance_meters_from_prev`.
3. Format PDF: render Leaflet map snapshot (via `leaflet-image` atau canvas) + table.
4. Filter by date range yang sama dengan history filter.
5. Backend: tambah endpoint `GET /api/reports/:deviceId?from=...&to=...&format=csv` yang fetch N8N history dan return CSV langsung (auth-protected).

**File yang akan dibuat/diubah:**
- `backend/routes/reports.js` (baru)
- `frontend/src/report.js` (baru)
- `frontend/index.html` (tambah button di history modal)
- `frontend/script.js` (bind button, call export)

### Phase 4 — UX Cleanup (MEDIUM/LOW) — ETA: 2-3 hari

- **M1, M4, M5, M6:** Cluster markers, audio decode optimization, audio playback optimization, narrow `usesCleartextTraffic` scope.

---

## 3. E2E Flow yang Harus Clear (Login → Report)

```
[USER: Driver/Operator]
    │
    ▼
[1] Buka browser → frontend/index.html
    ▼
[2] Captcha loaded dari /api/captcha (SVG, 6 digit, signed cookie)
    ▼
[3] Input username + password + captcha → POST /api/auth/login
    │       ├─ bcrypt.verify (DB users.passwordHash)
    │       ├─ Lockout check (failedAttempts >= 5 → 15 min lock)
    │       └─ Session 24h stored in MongoDB
    ▼
[4] Set-Cookie: auth_token=<uuid> (httpOnly, signed, SameSite=None, Secure)
    │
    ▼
[5] GET /api/auth/me → return user {id, username, role}
    │
    ▼
[6] WS connect ke wss://ptt.teluklamong.co.id/ws (cookie auth via handshake)
    │       └─ Register sebagai 'center-<timestamp>-<random>'
    ▼
[7] Map: GET /api/proxy/n8n?url=.../device-cordinate (every 5/10/15s)
    │       └─ N8N returns array device + coords + battery
    ▼
[8] Click truck → GET /api/proxy/n8n?url=.../device-history
    │       └─ OSRM route + speed chart
    ▼
[9] [GAP] Export Laporan → BUTUH endpoint /api/reports/:deviceId
    │
    ▼
[10] Mobile (driver): buka app, input PPT Code
    │       └─ Hit N8N device-cordinate langsung (C6 — perlu fix)
    │       └─ WS register sebagai deviceId + REGISTRATION_SECRET (C5 — perlu fix)
    ▼
[11] Foreground service start (C2 — perlu fix) → mic PTT
    ▼
[12] Push to talk → audio PCM 16kHz via WS
    │
    ▼
[13] Center menerima audio → Web Audio API play
    ▼
[14] End call / disconnect → session cleanup
    │
    ▼
[15] Logout (center): POST /api/auth/logout → hapus session di DB
    │       Mobile: force-logout dari pusat (admin) → WS close code 4001
    ▼
END
```

---

## 4. Tanggung Jawab (PM + QA)

**Project Manager (Claude):**
- Sintesis audit ✅
- Plan + problem solving ✅
- Track fix progress
- Verifikasi tiap fix sesuai issue ID
- Co-sign sebelum hand-off ke QA

**QA Lead (akan di-spawn setelah fix selesai):**
- Verify E2E login → report (12 steps di section 3)
- Verify tiap fix unit-test style (curl, manual click)
- Verify C5 fix: coba register tanpa secret → harus reject
- Verify C6 fix: enumeration harus return 401/data kosong
- Verify Phase 3: export CSV/PDF bisa di-download + data benar
- **TIDAK approve** sampai semua CRITICAL + HIGH + Phase 3 report done
- Kalau ada yg miss → balik ke PM, PM dispatch ke dev untuk fix

**Dev Team:**
- Implement Phase 1 (CRITICAL) dulu → submit
- Lanjut Phase 2 (HIGH) → submit
- Lanjut Phase 3 (Report) → submit
- Atomic commit per fix dengan message format: `fix(C#): description`

---

## 5. Sign-off

- [ ] Dev: implement Phase 1
- [ ] Dev: implement Phase 2
- [ ] Dev: implement Phase 3
- [ ] PM: verify commit per issue ID
- [ ] QA: run E2E + verify exports
- [ ] PM: ship to staging
- [ ] QA: smoke test staging
- [ ] PM: production deploy

**Status saat ini:** READY TO START PHASE 1.
