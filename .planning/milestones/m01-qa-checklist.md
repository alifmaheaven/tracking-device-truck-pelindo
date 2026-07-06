# QA Verification Checklist — M01 Subdomain Migration

**Status saat dokumen ini dibuat:** pre-impl (semua AC akan fail). Jalankan tiap cek setelah DevOps deploy + Mobile build baru.

## Per-Item Checks

### AC1 — Tidak ada URL lama di code production
```bash
grep -rE "(freeat\.me|10\.118\.62\.60|43\.157\.242\.182|teluk-lamong\.freeat)" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=build \
  --exclude-dir=.gradle --exclude-dir=.expo --exclude-dir=docs \
  .
```
**Expected:** 0 matches (kecuali di file legacy yg di-ignore, misal `.env.bak`).

### AC2 — Mobile: tombol "Minimize", bukan "Logout"
- **File check:** `mobile/TruckPTT_Expo/app/index.tsx`
  - grep `>Logout<` → 0
  - grep `>Minimize<` → 1
  - grep `onPress={handleLogout}` → 0
  - grep `onPress={() => minimizeApp()}` (atau setara) → 1
- **Runtime check:** install APK di device, lihat tombol.

### AC3 — Mobile: minimize → buka lagi → session masih aktif
- Test: login → minimize (tombol UI atau home button) → buka lagi dari recents.
- **Expected:** app langsung kembali ke PTT screen (tidak muncul login).
- **Verify:** `AsyncStorage.getItem('activeDevice')` masih ada.

### AC4 — Backend CORS tighten
- **File check:** `backend/server.js` line 34-37
  - `origin: ['https://ptt.teluklamong.co.id']` (bukan `origin: true`)

### AC5 — Frontend: tombol "Force Logout" untuk admin
- **File check:** `frontend/src/admin.js` atau `map.js`
  - grep `forceLogout` → minimal 1 di send, 1 di handler UI
- **Runtime check:** login admin → device list → tombol tersedia.

### AC6 — E2E force logout
**Pre-req:** 1 admin logged in di web, 1 device logged in di mobile. Keduanya konek WS.

1. Admin klik "Force Logout" di device tsb
2. Expected dalam <2 detik:
   - Mobile terima WS message `{type:'forceLogout'}`
   - Mobile clear `activeDevice` di AsyncStorage
   - Mobile stop foreground service (notification hilang)
   - Mobile kembali ke login screen
   - WS tertutup dengan code `4001`
   - Mobile TIDAK auto-reconnect (cek: tidak muncul PTT screen)
3. Admin lihat device list update: device tsb "offline"

**Verifikasi file:**
- Backend: case `forceLogout` ada di switch (line ~404)
- Backend: `targetWs.send(JSON.stringify({ type: 'forceLogout' }))` ada
- Backend: `ws.close(4001, 'force_logout')` ada
- Mobile: case `forceLogout` ada di WS onmessage switch
- Mobile: cek `event.code === 4001` di onclose → skip reconnect

### AC7 — Mobile clear AsyncStorage saat force-logout
- File: `app/index.tsx` case `forceLogout`
  - `await AsyncStorage.removeItem('activeDevice')` ada

### AC8 — EAS build sukses
```bash
cd mobile/TruckPTT_Expo
eas build --profile production --platform android --non-interactive
```
**Expected:** exit 0, build URL dicapture.

### AC9 — Backend reachable via subdomain
```bash
curl -sI https://ptt.teluklamong.co.id:9090/
curl -sI https://ptt.teluklamong.co.id/api/captcha
```
**Expected:** HTTP 200 / 304 (bukan 502/503/timeout).

### AC10 — WebSocket reachable
```bash
# Install wscat: npm i -g wscat
wscat -c wss://ptt.teluklamong.co.id:9090/ws
# Kirim: {"type":"register","id":"qa-test","secret":"<reg-secret>"}
# Expected: server response (no error)
```

## Negative Tests

| Test | Expected |
|---|---|
| Mobile minimize tanpa login → tidak ada error spam | OK |
| Admin force-logout device yg **offline** | Backend return tanpa error, mobile terima saat online lagi? (Pilih: server queue, atau skip — **keputusan**: skip, server hanya kick yg online) |
| WebSocket connect tanpa `secret` | Server tolak (cek existing logic) |
| Frontend load dari `http://` (non-HTTPS) | Browser block mixed content; CORS block |
| Force-logout 2x untuk device sama (sudah logout) | Idempotent: backend no-op |

## Sign-off

| Step | PIC | Status |
|---|---|---|
| Recon | — | DONE |
| Mobile impact | — | DONE |
| Frontend impact | — | DONE |
| Backend impact | — | DONE |
| PM plan | — | DONE |
| DevOps deploy review | pending | — |
| Impl | pending | — |
| QA verify AC1-10 | pending | — |
| E2E force-logout | pending | — |
| Sign-off release | pending | — |
