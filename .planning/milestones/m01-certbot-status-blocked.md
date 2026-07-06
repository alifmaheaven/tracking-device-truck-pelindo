# Certbot Status — BLOCKED

**Tanggal:** 2026-07-06
**Status:** LE HTTP-01 challenge gagal — upstream firewall block inbound dari LE anycast IP (timeout 30s).
**Server public IP:** `103.89.155.80` (NAT ke private `10.118.62.60`)

## Apa yang sudah dilakukan

1. ✅ Install `nginx` + `certbot` + `python3-certbot-nginx` di host
2. ✅ Bind Docker ports ke `127.0.0.1` (port 80 → 8080, port 9090 tetap 0.0.0.0)
3. ✅ Deploy HTTP-only nginx config dengan `/.well-known/acme-challenge/` webroot
4. ✅ Start nginx di port 80
5. ❌ `certbot certonly --webroot` timeout 3x retry

## Diagnosis

| Test | Hasil |
|---|---|
| `dig ptt.teluklamong.co.id` dari sandbox | resolves ke `10.118.62.60` (private — local override) |
| `dig ptt.teluklamong.co.id @1.1.1.1` dari server | resolves ke `103.89.155.80` (public) |
| Sandbox → `103.89.155.80:80` (nc) | OK (TCP connect) |
| Server → `103.89.155.80:80` (curl) | **TIMEOUT 5s** (no hairpin NAT) |
| Sandbox → `103.89.155.80:443`, `:9090` | **FAIL** (port closed/blocked) |
| LE anycast → `103.89.155.80:80` | **TIMEOUT 30s** (sama kayak server) |

**Root cause:** Server di belakang NAT tanpa hairpin. Inbound ke public IP dari external mungkin intermittent/limited. LE anycast IP kena block atau rate limit di upstream firewall.

**Port status di public IP:**
- ✅ 80 — open (intermittent ke LE)
- ❌ 443 — closed (perlu dibuka untuk HTTPS ke WS via nginx)
- ❌ 9090 — closed (perlu dibuka untuk WS direct, atau route via 443)

## Path Forward (perlu user action)

### Opsi A — Buka port 443 + 9090 upstream (RECOMMENDED)
1. Hubungi provider / datacenter, minta buka inbound:
   - `103.89.155.80:443` (HTTPS)
   - `103.89.155.80:9090` (WebSocket, per instruksi M01)
2. Setelah dibuka, **coba certbot lagi** — biasanya HTTP-01 ke port 80 bisa jalan intermittent, HTTPS pakai cert yg sama.
3. Restore SSL blocks di nginx config (saya punya di `m01-nginx-ptt.teluklamong.co.id.conf`).

### Opsi B — Setup Cloudflare proxy (no port 443 needed, tapi no port 9090 direct)
1. Ubah DNS A record `ptt.teluklamong.co.id` ke **proxied** (orange cloud)
2. Cloudflare otomatis issue cert (no certbot)
3. WS: pakai Cloudflare Spectrum (paid) atau expose WS di port 443 via nginx
4. **Konsekuensi:** keluar dari Opsi B instruction (port 9090 eksplisit)

### Opsi C — Self-signed cert (workaround)
1. Generate self-signed: `openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout /etc/ssl/private/ptt.key -out /etc/ssl/certs/ptt.crt`
2. Pakai di nginx SSL blocks
3. Distribute cert ke client (mobile app + browser) untuk trust
4. **Konsekuensi:** trust warning di browser, tdk otomatis trusted

### Opsi D — DNS-01 challenge (LE, no inbound port needed)
Butuh akses API ke DNS provider (Cloudflare/Route53/dll). Karena DNS provider tidak diketahui dari session ini, tdk bisa automate.

## Config files siap (siap deploy begitu port dibuka)

- `/etc/nginx/sites-available/ptt.teluklamong.co.id` — HTTP-only (saat ini aktif)
- `.planning/milestones/m01-nginx-ptt.teluklamong.co.id.conf` — Full config dgn SSL blocks (di local)
- `.planning/milestones/m01-certbot-guide.md` — Step-by-step guide

## Backup

Jika perlu restore port langsung (skip nginx host, balikin ke docker-compose port public):

```bash
cd /home/ptc/maps-device
# Restore compose
git checkout docker-compose.yml  # atau cp docker-compose.yml.bak.M01 docker-compose.yml
# Edit: ubah "127.0.0.1:8080:80" kembali ke "80:80"
docker compose up -d frontend
# Stop nginx
systemctl stop nginx
```

## Recommended next step (perlu input user)

Pilih A, B, C, atau D. Saya bisa eksekusi otomatis setelahnya.
