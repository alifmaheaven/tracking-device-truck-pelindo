# Milestone: Migrasi Subdomain & Lockdown Logout Mobile

**Tanggal:** 2026-07-06
**Driver:** Project Manager
**Scope:** Konsolidasi semua endpoint ke `ptt.teluklamong.co.id`, ganti tombol Logout mobile jadi Minimize, tambah force-logout dari pusat via WS event.

---

## 0. Decisions Locked (2026-07-06)

- **Reverse proxy:** Nginx (bukan Cloudflare-only) — untuk support PTT long-lived tanpa timeout 100s
- **Path API:** path-based di root domain `ptt.teluklamong.co.id` (bukan `api.ptt.`/`ws.ptt.`)
- **Force logout scope:** per-device saja (tidak ada broadcast kill-all untuk MVP)

## 1. Ringkasan Perubahan

| # | Perubahan | Domain | File utama |
|---|---|---|---|
| P1 | API base → `https://ptt.teluklamong.co.id` | mobile+frontend+backend | `.env`, `app.json`, `script.js` |
| P2 | WS → `wss://ptt.teluklamong.co.id:9090` | mobile+frontend+backend | `.env`, `app/index.tsx`, `ptt.js`, `server.js` |
| P3 | Tombol "Logout" → "Minimize" | mobile only | `app/index.tsx` (handleLogout + TouchableOpacity + styles) |
| P4 | Force-logout dari pusat via WS event | backend+frontend+mobile | `server.js` (case baru), `admin.js` (UI), `app/index.tsx` (case baru), `index.tsx` clear state |

## 2. Urutan Eksekusi (dependency-ordered)

```
P1a (env files) ─┐
P1b (hardcoded fallback di code) ─┤
                  ├──→ P1e (verify semua URL konsisten)
P2a (WS env) ────┘

P3a (ganti handler) ─→ P3b (ganti label + style) ─→ P3e (verify: hanya minimize, tdk clear AsyncStorage)

P4a (backend: case forceLogout + invalidate auth_token cookie) ─→
P4b (frontend admin: tombol "Force Logout" di device list, kirim WS msg) ─→
P4c (mobile: handle WS msg forceLogout → clear state, close WS, kembali ke login) ─→
P4d (test E2E: admin logout driver X, driver X kembali ke login screen)

P5 (cleanup: hapus fallback URL lama)
```

## 3. Detail Task per File

### P1 — URL Migrasi

**`mobile/TruckPTT_Expo/.env`**
- `EXPO_PUBLIC_API_URL=https://ptt.teluklamong.co.id/webhook/device-cordinate`
- `EXPO_PUBLIC_WS_URL=wss://ptt.teluklamong.co.id:9090`
- (Path `/webhook/device-cordinate` mengikuti backend reverse-proxy config; konfirmasi dgn DevOps)

**`frontend/.env`**
- `VITE_API_URL=https://ptt.teluklamong.co.id/webhook/device-cordinate`
- `VITE_HISTORY_API_URL=https://ptt.teluklamong.co.id/webhook/device-history`
- `VITE_WS_URL=wss://ptt.teluklamong.co.id:9090/ws`

**`mobile/TruckPTT_Expo/app/index.tsx:32-33`**
- Fallback hardcoded `wss://websocket-teluk-lamong.freeat.me/ws` → `wss://ptt.teluklamong.co.id:9090/ws`
- Fallback `https://n8n-teluk-lamong.freeat.me/...` → `https://ptt.teluklamong.co.id/webhook/device-cordinate`

**`frontend/script.js:11-21`**
- Sederhanakan: hapus branch `teluk-lamong.freeat.me`, langsung pakai `ptt.teluklamong.co.id`:
```js
const N8N_BASE = 'https://ptt.teluklamong.co.id/webhook';
API_URL = import.meta.env.VITE_API_URL || N8N_BASE + '/device-cordinate';
HISTORY_API_URL = import.meta.env.VITE_HISTORY_API_URL || N8N_BASE + '/device-history';
WS_URL = import.meta.env.VITE_WS_URL || 'wss://ptt.teluklamong.co.id:9090/ws';
```

**`frontend/src/ptt.js:59`**
- Fallback `ws://43.157.242.182:9090/ws` → `wss://ptt.teluklamong.co.id:9090/ws`

### P2 — WS config tetap (port 9090)

**`backend/server.js:21`** → tetap `PORT = 9090` ✓
**`docker-compose.yml`** → tetap `9090:9090` ✓
- DevOps: reverse proxy `ptt.teluklamong.co.id` route `/ws` ke backend container port 9090

### P3 — Tombol Logout → Minimize

**`mobile/TruckPTT_Expo/app/index.tsx`**

- **Line 1040-1042** (TouchableOpacity "Logout"):
  - Ganti `onPress={handleLogout}` → `onPress={() => minimizeApp()}`
  - Ganti label `Logout` → `Minimize`

- **Line 447-466** (`handleLogout`):
  - **Hapus seluruh function** (atau biarkan dead code dengan comment "removed P3 — use minimizeApp instead")
  - Prefer hapus + hapus style `logoutBtnSmall`/`logoutBtnText` (line 1188, 1194)

- **Line 1188, 1194** (styles `logoutBtnSmall`, `logoutBtnText`):
  - Rename jadi `minimizeBtnSmall`, `minimizeBtnText` (optional)

**`mobile/TruckPTT_Expo/app/index.tsx:217-221`** (auto-restore dari AsyncStorage):
- TIDAK diubah. Session tetap persist. Saat app dibuka kembali, jika WS dapat `forceLogout` event, baru clear.

### P4 — Force Logout dari Pusat

**`backend/server.js`** (after `unmuteDevice` case ~line 403, before `locationUpdate` ~line 405):

Tambah case baru:
```js
case 'forceLogout':
  // { type: 'forceLogout', targetId: 'device-123' } — sent by Command Center
  if (currentClientId && currentClientId.startsWith('center')) {
    const targetId = data.targetId;
    console.log(`Device ${targetId} force-logout by ${currentClientId}`);
    const targetWs = clients.get(targetId);
    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(JSON.stringify({ type: 'forceLogout', reason: 'logout_from_center' }));
      // Tunggu close dari mobile, atau force close setelah 1s
      setTimeout(() => {
        const ws = clients.get(targetId);
        if (ws) ws.close(4001, 'force_logout');
      }, 1000);
    }
  }
  break;
```

**`backend/server.js:34-37`** (CORS):
- Saat ini `origin: true` (allow all). **Tighten** ke allowlist:
```js
app.use(cors({
  origin: ['https://ptt.teluklamong.co.id'],
  credentials: true
}));
```
(Flutter/mobile pakai native HTTP, tidak kena CORS.)

**`mobile/TruckPTT_Expo/app/index.tsx`** (WS message switch ~line 862):

Tambah case baru sebelum `default`:
```js
case 'forceLogout':
  console.log('[WS] Force logout from center');
  // Stop any active PTT/recording
  if (notificationRecordingRef.current) {
    notificationRecordingRef.current = false;
    await AudioRecord.stop().catch(() => {});
    updateNotificationAction(false);
  }
  // Clear session
  setActiveDevice(null);
  setPptCodeInput('');
  setIsConnected(false);
  setCallStatus('Idle');
  callSessionRef.current = { active: false, callerId: null, incomingPending: false };
  // Clear stored session
  await AsyncStorage.removeItem('activeDevice');
  // Close WS
  if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null; }
  // Stop foreground service
  await stopForegroundService();
  // Notify user
  Alert.alert('Sesi diakhiri', 'Sesi Anda telah diakhiri oleh pusat. Silakan login ulang.');
  break;
```

**`frontend/src/admin.js`** (atau file UI device list):

Tambah tombol "Force Logout" di setiap device card. Kirim WS message:
```js
import { state } from './state.js';
function forceLogoutDevice(deviceId) {
  if (!confirm(`Logout paksa device ${deviceId}?`)) return;
  if (state.pttWs && state.pttWs.readyState === WebSocket.OPEN) {
    state.pttWs.send(JSON.stringify({ type: 'forceLogout', targetId: deviceId }));
  } else {
    alert('Koneksi PTT tidak aktif.');
  }
}
```
Bind di `renderDeviceList()` (di `map.js` atau `admin.js` sesuai struktur).

## 4. Acceptance Criteria

| ID | Kriteria | Verifikasi |
|---|---|---|
| AC1 | Tidak ada string `freeat.me` / IP `10.118.62.60` / `43.157.242.182` di code production | `grep -rE "freeat\|10\.118\.62\|43\.157\.242" --include="*.{ts,tsx,js}"` |
| AC2 | Mobile app: buka app, lihat tombol "Minimize" (bukan "Logout"). Klik → app minimize ke background | Manual test di device |
| AC3 | Mobile app: minimize → buka lagi → session masih aktif (tidak kembali ke login) | Manual test |
| AC4 | Backend: `origin: ['https://ptt.teluklamong.co.id']` di CORS | `grep "origin:" backend/server.js` |
| AC5 | Web frontend: tombol "Force Logout" tersedia untuk admin | Manual test di browser |
| AC6 | E2E: admin klik "Force Logout" device X → device X收到 `forceLogout` event → kembali ke login screen | Test 2 device |
| AC7 | Mobile clear `activeDevice` di AsyncStorage saat force-logout | `AsyncStorage.getItem('activeDevice')` di dev tools |
| AC8 | EAS build baru berhasil, APK ter-deploy | `eas build --profile production` exit 0 |
| AC9 | Backend Docker image rebuild + restart, port 9090 listening | `curl https://ptt.teluklamong.co.id:9090` (atau 80 lewat proxy) |
| AC10 | WebSocket `wss://ptt.teluklamong.co.id:9090/ws` reachable | `wscat -c wss://ptt.teluklamong.co.id:9090/ws` |

## 5. Rollback Plan

- **Mobile:** EAS rollback ke build sebelumnya via Play Console / EAS submit history
- **Backend:** `docker compose down && docker compose up -d` dengan image tag sebelumnya
- **Frontend:** redeploy static dist lama
- **DB:** tidak ada migration (semua perubahan runtime/config)

## 6. Risiko

| Risiko | Mitigasi |
|---|---|
| CORS tighten → mobile kena (native HTTP tidak kena, tapi cek) | Test dari mobile setelah deploy; jika gagal, sementara `origin: true` lagi |
| `forceLogout` race dengan reconnect mobile (mobile auto-reconnect dalam 3s) | Server close dgn code `4001`; client cek `event.code === 4001` dan skip reconnect |
| EAS build gagal karena env baru | Validasi env di `eas env:list` sebelum build |
| TLS cert belum ready di subdomain baru | DevOps pre-check cert ptt.teluklamong.co.id |

## 7. Out of Scope

- Migrasi user/admin data
- Perubahan DB schema
- Perubahan mobile native module `ptt-overlay` (logic minimize sudah ada)
- iOS (project ini Android-only based on `app.json`)

---

**Status:** Code impl selesai 2026-07-06. AC1-7 verified. AC8-10 (build/deploy) deferred ke user/DevOps. Out-of-scope: N8N SSRF allowlist (`n8n-teluk-lamong.freeat.me`) tetap karena N8N tidak di-migrasi di M01.
