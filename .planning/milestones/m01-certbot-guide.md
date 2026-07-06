# Certbot TLS Guide — ptt.teluklamong.co.id

**Tanggal:** 2026-07-06
**Tujuan:** Pasang TLS cert Let's Encrypt untuk subdomain baru.
**Arsitektur:** nginx di HOST (Ubuntu 26.04) → proxy ke container Docker.

## Kenapa Nginx di Host?

Saat ini semua service jalan di Docker container tanpa nginx di host:
- Port 80 → docker-proxy → `pelindo-frontend` (nginx:alpine)
- Port 9090 → docker-proxy → `pelindo-backend` (Node.js)

Untuk domain baru, kita perlu:
1. **Nginx di host** sebagai reverse proxy & TLS terminator
2. **Docker ports** di-bind ke `127.0.0.1` saja (supaya nginx host yg handle external)

## Step 1 — Install Nginx di Host

```bash
ssh ptc@ssh-map-ttl.freeat.me
echo 'ptc@2026#!' | sudo -S apt update
echo 'ptc@2026#!' | sudo -S apt install -y nginx certbot python3-certbot-nginx
```

Verifikasi:
```bash
nginx -v   # nginx/1.x.x
certbot --version
```

## Step 2 — Ubah docker-compose.yml: bind ke localhost only

Edit `/home/ptc/maps-device/docker-compose.yml`:
```yaml
services:
  frontend:
    build: ./frontend
    container_name: pelindo-frontend
    ports:
      - "127.0.0.1:8080:80"   # host nginx akan forward ke 8080 (was 80)
    restart: unless-stopped
    env_file:
      - ./frontend/.env

  backend:
    build: ./backend
    container_name: pelindo-backend
    ports:
      - "127.0.0.1:9090:9090"  # tetap, tapi localhost only
    restart: unless-stopped
    env_file:
      - ./backend/.env
```

**PENTING:** Migrasi dari `0.0.0.0:80` ke `127.0.0.1:8080` — port 80 host sekarang dipakai nginx. Frontend container tetap di port 80 internal, tapi di-publish ke host port 8080.

Restart:
```bash
cd /home/ptc/maps-device
echo 'ptc@2026#!' | sudo -S docker compose down frontend backend
echo 'ptc@2026#!' | sudo -S docker compose up -d frontend backend
```

Cek:
```bash
echo 'ptc@2026#!' | sudo -S ss -tlnp | grep -E ":(80|443|8080|9090)"
# Expected: 8080 (frontend container), 9090 (backend container), 80/443 (nginx host)
```

## Step 3 — Setup DNS

Di Cloudflare / DNS provider:
- **A record:** `ptt.teluklamong.co.id` → IP server (`ssh-map-ttl.freeat.me` resolves to)
- **Verify:** `dig ptt.teluklamong.co.id +short` → dapat IP

**Tunggu 1-24 jam** untuk propagasi. Certbot butuh DNS resolve dulu.

## Step 4 — Deploy nginx config

Saya sudah siapkan di `.planning/milestones/m01-nginx-ptt.teluklamong.co.id.conf` di repo local.

Copy ke server:
```bash
# Dari local:
scp .planning/milestones/m01-nginx-ptt.teluklamong.co.id.conf \
    ptc@ssh-map-ttl.freeat.me:/tmp/

# Di server:
echo 'ptc@2026#!' | sudo -S cp /tmp/m01-nginx-ptt.teluklamong.co.id.conf \
    /etc/nginx/sites-available/ptt.teluklamong.co.id
echo 'ptc@2026#!' | sudo -S ln -sf /etc/nginx/sites-available/ptt.teluklamong.co.id \
    /etc/nginx/sites-enabled/
echo 'ptc@2026#!' | sudo -S rm -f /etc/nginx/sites-enabled/default  # hapus default site
```

## Step 5 — Test nginx config (BELUM pakai cert)

Cert belum ada, comment dulu SSL block:

```bash
echo 'ptc@2026#!' | sudo -S nano /etc/nginx/sites-available/ptt.teluklamong.co.id
# Comment line: listen 443 ssl; → # listen 443 ssl;
# Comment semua ssl_certificate* lines
# Tambah return 200 "OK" di location / temporary

echo 'ptc@2026#!' | sudo -S nginx -t
# Expected: syntax is ok, test is successful
```

## Step 6 — Install Cert dengan Certbot

```bash
echo 'ptc@2026#!' | sudo -S systemctl reload nginx
echo 'ptc@2026#!' | sudo -S certbot --nginx -d ptt.teluklamong.co.id
```

Certbot akan:
1. Generate cert di `/etc/letsencrypt/live/ptt.teluklamong.co.id/`
2. Edit nginx config untuk add SSL block otomatis
3. Setup HTTP→HTTPS redirect

**Flags yg mungkin dibutuhkan:**
```bash
echo 'ptc@2026#!' | sudo -S certbot --nginx -d ptt.teluklamong.co.id \
    --non-interactive --agree-tos \
    -m admin@pelindo.co.id \
    --redirect
```

## Step 7 — Edit nginx config untuk port 9090 (WebSocket)

Certbot hanya handle port 443. Untuk WS di port 9090 (per instruksi M01), tambah manual:

```bash
echo 'ptc@2026#!' | sudo -S nano /etc/nginx/sites-available/ptt.teluklamong.co.id
```

Tambah server block baru (di akhir file) untuk port 9090 SSL (sama cert):
```nginx
server {
    listen 9090 ssl;
    http2 on;
    server_name ptt.teluklamong.co.id;

    ssl_certificate /etc/letsencrypt/live/ptt.teluklamong.co.id/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ptt.teluklamong.co.id/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://127.0.0.1:9090/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Test + reload:
```bash
echo 'ptc@2026#!' | sudo -S nginx -t
echo 'ptc@2026#!' | sudo -S systemctl reload nginx
```

## Step 8 — Buka firewall (jika ada)

Jika pakai UFW:
```bash
echo 'ptc@2026#!' | sudo -S ufw allow 80/tcp
echo 'ptc@2026#!' | sudo -S ufw allow 443/tcp
echo 'ptc@2026#!' | sudo -S ufw allow 9090/tcp
```

## Step 9 — Verifikasi

```bash
# HTTP → HTTPS redirect
curl -I http://ptt.teluklamong.co.id
# Expected: 301 redirect ke https://

# HTTPS main page
curl -I https://ptt.teluklamong.co.id
# Expected: 200 OK

# API captcha
curl -I https://ptt.teluklamong.co.id/api/captcha
# Expected: 200 OK

# WebSocket
wscat -c wss://ptt.teluklamong.co.id:9090
# Expected: connect sukses

# Cert validity
echo | openssl s_client -connect ptt.teluklamong.co.id:443 -servername ptt.teluklamong.co.id 2>/dev/null | openssl x509 -noout -subject -dates
# Expected: subject contain ptt.teluklamong.co.id, notAfter ~90 hari
```

## Step 10 — Auto-renewal

Certbot auto-install timer. Verify:
```bash
echo 'ptc@2026#!' | sudo -S systemctl status certbot.timer
echo 'ptc@2026#!' | sudo -S certbot renew --dry-run
```

Cert di-renew 30 hari sebelum expired. Nginx auto-reload saat renewal via `certbot renew --deploy-hook "systemctl reload nginx"`.

## Rollback

```bash
# Hapus nginx dari host
echo 'ptc@2026#!' | sudo -S systemctl stop nginx
echo 'ptc@2026#!' | sudo -S apt remove -y nginx certbot python3-certbot-nginx

# Restore docker-compose ports ke 0.0.0.0
cd /home/ptc/maps-device
echo 'ptc@2026#!' | sudo -S docker compose up -d frontend backend
```

## Troubleshoot

| Problem | Solusi |
|---|---|
| Certbot gagal "DNS problem" | DNS belum propagate, tunggu / cek `dig` |
| Certbot gagal "Connection refused" | Port 80 belum listen — pastikan nginx running (`systemctl status nginx`) |
| Certbot gagal "rate limit" | Pakai `--staging` flag untuk test, atau tunggu 1 jam |
| WS timeout 60s | Cek `proxy_read_timeout 3600s` ada di nginx config |
| Cert tidak auto-renew | Cek `certbot.timer` active, manual run `certbot renew` |
| `nginx -t` error | Cek syntax, biasanya missing semicolon atau bracket |

## Out-of-Scope

- Migrasi subdomain existing (`*.freeat.me`) — biarkan jalan, cuma tambah `ptt.teluklamong.co.id` sebagai entry point baru
- Wildcard cert (`*.teluklamong.co.id`) — butuh DNS challenge, lebih kompleks. Tidak perlu karena cuma 1 subdomain
- HSTS preload — opsional, set di nginx jika perlu
