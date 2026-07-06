# DevOps Deploy Review — M01

**Tujuan:** Pastikan deploy ke `ptt.teluklamong.co.id` mulus tanpa salah konfig.

## 1. Current Topology (existing)

```
[Client Browser] ──HTTPS──→ [Cloudflare: *.freeat.me] ──→ [Server: ssh-map-ttl.freeat.me]
                                                       ├── port 80   → pelindo-frontend (nginx static)
                                                       ├── port 5678 → pelindo-n8n
                                                       ├── port 9090 → pelindo-backend (Node + WS /ws)
                                                       └── port 8081 → pelindo-mongo-express (localhost only)
```

**Catatan:** Top-level `ptt.teluklamong.co.id` **belum ter-setup** di Cloudflare/DNS. Existing pakai subdomain `n8n-teluk-lamong.freeat.me` dan `websocket-teluk-lamong.freeat.me`. Migrasi = tambah/pindah ke `ptt.teluklamong.co.id`.

## 2. Yang Perlu Disiapkan DevOps

### 2.1 DNS
- **A/CNAME record:** `ptt.teluklamong.co.id` → IP server `ssh-map-ttl.freeat.me` (atau behind Cloudflare).
- **Verifikasi:** `dig ptt.teluklamong.co.id` resolve ke IP yg sama dgn `n8n-teluk-lamong.freeat.me`.
- **Subdomain untuk apa:** single root (`ptt.teluklamong.co.id`) sajа, tanpa `ws.` atau `api.`. Path-based routing.

### 2.2 TLS Certificate
- **Cloudflare:** kalau pakai Cloudflare, cert otomatis issued.
- **Self-host cert:** kalau terminating TLS di server, perlu cert untuk `ptt.teluklamong.co.id`. Let's Encrypt via `certbot` (recommended).
- **Verifikasi:** `openssl s_client -connect ptt.teluklamong.co.id:443 -servername ptt.teluklamong.co.id` (atau 9090 untuk direct WS).

### 2.3 Reverse Proxy / Routing

Ada 2 pilihan. **Rekomendasi: external (Cloudflare / nginx) di depan port 80, route semua lewat sana.**

#### Opsi A — Cloudflare-only (recommended, paling minimal)
- Setup Cloudflare tunnel atau CNAME → server.
- Di server, listen 9090 (backend) — sudah ada.
- Tidak perlu setup nginx baru.
- **Risk:** WS lewat Cloudflare ada batasan (free tier max 100 connections, timeout 100s untuk idle). PTT butuh long-lived, bisa kena.
- **Mitigasi:** pakai Cloudflare Spectrum (paid) untuk WS, atau bypass Cloudflare untuk WS (DNS only / grey cloud).

#### Opsi B — Nginx di depan (lebih kontrol)
```nginx
server {
    listen 443 ssl;
    server_name ptt.teluklamong.co.id;

    ssl_certificate /etc/letsencrypt/live/ptt.teluklamong.co.id/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ptt.teluklamong.co.id/privkey.pem;

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:9090/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /ws {
        proxy_pass http://127.0.0.1:9090/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;  # Penting: keep alive untuk PTT
        proxy_send_timeout 3600s;
    }

    # Frontend (static)
    location / {
        proxy_pass http://127.0.0.1:80/;
        # atau serve static langsung
    }
}
```

### 2.4 Backend Container
- **Tidak ada perubahan Dockerfile/COMPOSE.** Backend sudah listen 9090.
- **CORS change:** `origin: true` → `origin: ['https://ptt.teluklamong.co.id']`. Mobile native HTTP tidak kena CORS, jadi aman.
- **Restart procedure:**
  ```bash
  cd /home/ptc/Maps\ Device\ Pelindo  # atau path deploy
  docker compose up -d --build backend
  docker logs pelindo-backend --tail 50
  ```
  **Cek:** `Server started on port 9090` muncul.

### 2.5 Mobile (EAS Build)
- **Update `eas.json`:** kedua profile (`preview` & `production`) env ke subdomain baru.
  ```json
  "env": {
    "EXPO_PUBLIC_API_URL": "https://ptt.teluklamong.co.id/webhook/device-cordinate",
    "EXPO_PUBLIC_WS_URL": "wss://ptt.teluklamong.co.id:9090/ws"
  }
  ```
- **Build:**
  ```bash
  cd mobile/TruckPTT_Expo
  eas build --profile production --platform android --non-interactive
  ```
- **Distribute:** APK/JaaS upload ke Play Console atau distribusi internal via Expo.

### 2.6 Frontend Deploy
- **Static build:** `npm run build` di `frontend/` → output `dist/`.
- **Update env sebelum build:** edit `frontend/.env` ke subdomain baru.
- **Deploy:** volume-mount `dist/` ke container `pelindo-frontend` (atau restart container setelah rebuild image).

## 3. Deploy Sequence (urutan penting)

```
1. Setup DNS + TLS untuk ptt.teluklamong.co.id       [DevOps, pre-impl]
2. Setup reverse proxy / Cloudflare routing          [DevOps, pre-impl]
3. Update backend/server.js (CORS) + restart         [Backend]
4. Update frontend/.env + npm run build              [Frontend]
5. Update frontend dist deploy                       [DevOps]
6. Test: curl https://ptt.teluklamong.co.id/api/captcha
7. Test: wscat wss://ptt.teluklamong.co.id:9090/ws
8. Update mobile/eas.json + build APK baru           [Mobile]
9. Test E2E force-logout: admin web + driver mobile  [QA]
10. Rollout APK ke device driver                     [DevOps/Distribusi]
11. Monitor: docker logs, error rate                [DevOps, post-deploy]
```

**PENTING:** Jangan rebuild APK sebelum #3-#7 selesai. Kalau APK sudah build dgn URL baru tapi server belum siap → driver gagal konek.

## 4. Verifikasi Pre-Deploy (DevOps checklist)

```bash
# DNS
dig ptt.teluklamong.co.id +short
# Expect: IP server

# TLS
echo | openssl s_client -connect ptt.teluklamong.co.id:443 -servername ptt.teluklamong.co.id 2>/dev/null | openssl x509 -noout -subject
# Expect: subject contain ptt.teluklamong.co.id

# Backend reachable via 9090 (direct, sebelum proxy)
curl -sI http://10.118.62.60:9090/api/captcha
# Expect: HTTP 200

# Backend reachable via subdomain (post-proxy)
curl -sI https://ptt.teluklamong.co.id/api/captcha
# Expect: HTTP 200 (atau 304)

# WS reachable
wscat -c wss://ptt.teluklamong.co.id:9090/ws
# Kirim: {"type":"register","id":"devops-check","secret":"<reg-secret>"}
# Expect: server tidak return error
```

## 5. Rollback

| Komponen | Rollback |
|---|---|
| Backend CORS | revert `server.js` → `origin: true`, `docker compose restart backend` |
| Mobile APK | Play Internal Testing → distribute build sebelumnya |
| Frontend | restore `dist/` lama (backup sebelum deploy) |
| DNS | tetap, tidak perlu rollback (CNAME tidak break existing) |

## 6. Risiko DevOps

| Risiko | Dampak | Mitigasi |
|---|---|---|
| DNS propagate lama (1-24 jam) | Driver tdk bisa konek setelah APK baru | Setup DNS H-1, cek `dig` dari multiple DNS |
| Cloudflare WS timeout 100s | PTT call >100s putus | Bypass Cloudflare untuk WS (grey cloud/DNS only), atau Spectrum |
| Cert belum ready | HTTPS error | Certbot pre-deploy, verify dgn openssl |
| Backend port 9090 conflict | Server tdk start | `ss -tlnp | grep 9090` pre-deploy |
| EAS build pakai cached env | APK dgn URL lama | `--clear-cache` di eas build, atau update env var via EAS dashboard |
| Existing `n8n-teluk-lamong.freeat.me` & `websocket-teluk-lamong.freeat.me` di `allowedHosts` & CORS | Bloat, security hole | Cleanup setelah migrasi stabil |

## 7. Cleanup Pasca-Stabil (1 minggu setelah deploy)

- Hapus `n8n-teluk-lamong.freeat.me` dari `allowedHosts` di `backend/server.js:74-76`
- Hapus branch `teluk-lamong.freeat.me` di `frontend/script.js:11-21`
- Hapus fallback IP `10.118.62.60` di semua `.env`
- Hapus `n8n-teluk-lalong.freeat.me` & `websocket-teluk-lamong.freeat.me` dari EAS preview env (jika tidak dipakai)
- Hapus subdomain `n8n-teluk-lamong.freeat.me` & `websocket-teluk-lamong.freeat.me` di Cloudflare (jika tidak dipakai)

---

**Status:** Draft, butuh klarifikasi dengan user: pakai Opsi A (Cloudflare) atau B (nginx) untuk reverse proxy?
