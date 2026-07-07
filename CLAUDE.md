# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Summary

**Maps Device Pelindo** — real-time truck fleet tracking + half-duplex Push-To-Talk (PTT) for Teluk Lamong Port operations (PT Prakhya Tama Cakrawala / Pelindo). Three components:

1. **Web dashboard** (`frontend/`) — Leaflet map + sidebar + PTT control, consumed by Command Center operators.
2. **Node.js backend** (`backend/`) — Express API + WebSocket PTT relay (VPS-hosted, port 9090).
3. **Android tablet** (`mobile/TruckPTT_Expo/`) — Expo/React Native, the driver-side PTT client (mic capture, foreground service for WS keepalive).

External: **n8n** webhook pipeline ingests GPS pings from IoT devices and exposes the data to the frontend. Default map center: `-7.195, 112.68`.

## Common Commands

### Run the stack (Docker — recommended)
```bash
docker compose up -d          # frontend:80, backend:9090, mongo:27017, mongo-express:8081, n8n:5678
```
Volumes are hot-reloaded for `frontend/` (Nginx serves the dist). Backend code changes require container restart (no nodemon).

### Frontend dev (Vite, hot reload, no Docker)
```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
npm run build                 # outputs to dist/ (served by Nginx in Docker)
npm run preview
```

### Backend dev
```bash
cd backend
npm install
npm start                     # node server.js, port 9090
```
No test script. No lint script. No formatter enforced.

### Mobile (Expo)
```bash
cd mobile/TruckPTT_Expo
npm install
npx expo start                # dev server
npm run android               # native Android build (EAS)
npm run lint
```

### SSH to deploy server
```bash
sshpass -p "ptc@2026#!" ssh -o StrictHostKeyChecking=no ptc@ssh-map-ttl.freeat.me
```

## Environment

Both `frontend/.env` and `backend/.env` are required. Backend refuses to start without:
- `COOKIE_SECRET` (≥32 chars) — signed cookies
- `REGISTRATION_SECRET` — mobile truck WS auth (empty = no mobile clients can connect)
- `MONGO_URI` — defaults to `mongodb://mongo:27017/pelindo`
- `WS_ALLOWED_ORIGINS` — comma-separated hostnames for WS origin allowlist

Frontend uses Vite env (`VITE_API_URL`, `VITE_WS_URL`, `VITE_REGISTRATION_SECRET`, etc.). Production hostname detection in `script.js`: `ptt.teluklamong.co.id` → production URLs, else → dev fallback.

## Architecture & Data Flow

```
IoT GPS device
   │ (HTTPS POST)
   ▼
n8n webhook (https://n8n.freeat.me/webhook/device-cordinate)  [or ptt.teluklamong.co.id]
   │
   ▼
MongoDB (containers: mongo, n8n_data volume)
   │
   ├─→ Frontend polls N8N via backend proxy: /api/proxy/n8n?url=...
   │     backend/server.js whitelists host ptt.teluklamong.co.id, rewrites to internal
   │     Docker hostname (pelindo-n8n:5678) — SSRF prevention
   │
   └─→ PTT: WebSocket /ws (bidirectional, see backend/server.js wss.on('connection'))
         mobile trucks ↔ backend relay ↔ center browsers
```

### Backend (port 9090)

`backend/server.js` (656 lines) is the monolith. Three concerns share one file:
- **Express HTTP**: `/api/auth` (login + captcha), `/api/admin` (user mgmt), `/api/device` (device registry), `/api/reports`, `/api/captcha`, `/api/proxy/n8n` (SSRF-hardened N8N proxy).
- **WebSocket PTT relay** (`wss` on `/ws`): pure switchboard — never decodes audio. Binary frames = raw PCM (mobile→center). JSON `voiceMessage` = WebM/Opus base64 (center→mobile). Frame types: `register`, `call`, `acceptCall`, `endCall`, `voiceMessage`, `muteDevice`, `ping/pong`.
- **PTT routing logic**: `clients` Map (id→ws), `sessions` Map (id↔partnerId), `mutedDevices` Set, `trustedCenters` Set (centers with verified HTTP session). Centers authenticated via signed `auth_token` cookie parsed from WS upgrade headers.

Routes (`backend/routes/`): `auth.js` (login/logout/captcha), `admin.js` (CRUD users + audit), `device.js` (register/list), `reports.js`. Middleware: `auth.js` (cookie validation), `roles.js`, `auditLog.js` (action log helper). `db.js` exports `connectDB()` + `getDb()`. `seed.js` ensures an admin user exists on first boot.

### Frontend (Vite + ES modules, served via Nginx)

Vite entrypoint is `frontend/index.html` (Vite transforms it), but the actually-loaded JS is `script.js` (top-level orchestrator). ES modules in `frontend/src/`:

- **`script.js`** (1237 lines) — entrypoint: hostname detection, env config, Leaflet map init (`map` global), PTT WS init, history modal, navigation mode (geolocation + OSRM routing), and "Direction Mode" with self-restoration state.
- **`src/map.js`** — `fetchDeviceData()`, marker rendering, sidebar device list, search, battery badges, anti-jump logic (WS-fed coords override N8N API coords for 30s). Uses `L.map` directly.
- **`src/ptt.js`** — PTT WS client, call state machine, PCM playback (Web Audio API, `AudioContext`), MediaRecorder (WebM/Opus) for outgoing voice, mute/online indicators.
- **`src/auth.js`** — captcha flow, login form, signed cookie session.
- **`src/admin.js`** — admin panel: user list, role management, audit log viewer.
- **`src/state.js`** — shared `state` object (devices, activeRealtimeDevices, map, session, etc.).
- **`src/roleGuard.js`** — RBAC route guarding.
- **`src/utils.js`** — HTML/JS escaping, battery display, PCM audio playback.

**Two Leaflet map instances**: `map` (main dashboard) and `historyMapInstance` (inside history modal). Don't cross-reference their `layerGroup`s. After sidebar collapse or modal open, both need `invalidateSize()` on a 300–400ms timeout (CSS transition settles first).

### Mobile (Expo SDK 54, React Native 0.81)

`mobile/TruckPTT_Expo/` — Android tablet only (Knox MDM, foreground service). Key deps:
- `@notifee/react-native` — persistent foreground notification (type `MICROPHONE` + `MEDIA_PLAYBACK` for Android 14+).
- `react-native-audio-record` — raw 16-bit PCM 16kHz capture from mic.
- `expo-av` + `react-native-sound` — audio playback.
- `expo-build-properties` — `android.usesCleartextTraffic: true` (required for `ws://`).
- `expo-location` — for future geo features.
- `ptt-overlay` — local module in `modules/ptt-overlay` (overlay UI for in-app call).
- File-based routing via `expo-router`.

`build_apk.sh` — custom EAS-like build script (pre-EAS workflow). `app.json` has `expo-build-properties` + foreground service config — these are mandatory or Android kills WS on Doze.

Login flow: tablet polls API every ~5 min for a fresh `pptCode` (rotating credential) bound to `deviceId`. That pptCode becomes the WS `register` payload (along with `REGISTRATION_SECRET`).

## Critical Constraints (Do Not Break)

1. **Leaflet `invalidateSize()` timing** — must be on `setTimeout` ~300–400ms after any container resize (sidebar collapse, modal open) or map tiles render grey.
2. **N8N proxy SSRF** — only `ptt.teluklamong.co.id` allowed. `redirect: 'manual'` blocks redirect-chain SSRF. Log only `host+pathname`, never query string (may contain tokens).
3. **PTT WS origin allowlist** — empty Origin (native mobile) is allowed; web must match `WS_ALLOWED_ORIGINS`. Per-conn binary frame rate-limit: 50/sec.
4. **Truck WS auth** — `REGISTRATION_SECRET` enforced; empty env = no mobile trucks connect (intentional fail-closed).
5. **Mute privilege** — only `center-*` clients with `userRole === 'admin'` can send `muteDevice`. Viewer role is read-only (no PTT).
6. **Trusted center marking** — `trustedCenters` Set is populated only after verifying HTTP session in Mongo. Trucks auto-answer `incomingCall` only from trusted centers (anti-spoofing).
7. **Polyline sorting** — history polyline must sort by `a.createdDate` then `a._id.localeCompare` (Mongo natural order). Unsorted = jumpy polylines.
8. **OSRM downsampling** — `simplifyCoordinates(latlngs, 90)` before OSRM call or 400/429 on long routes.
9. **Timezone** — all DB timestamps are UTC ISO 8601; `Asia/Jakarta` is presentation-only via `toLocaleString`. Never pass WIB into History API date range.
10. **Marker refresh** — every interval (5/10/15s) `clearLayers()` is called and markers re-rendered. Don't `getElementById` to patch markers — mutate inside `renderMarkers()` loop or flicker.
11. **Cookie secret** — backend `process.exit(1)` at startup if `COOKIE_SECRET` missing or <32 chars. No hardcoded fallback (forgeable sessions).
12. **Trust proxy** — `app.set('trust proxy', 2)` for Cloudflare (1) + nginx (2). Wrong value = wrong IP in rate limiter + audit log.

## Style & Conventions

- Frontend: vanilla ES6 modules, no TypeScript, no React. CSS uses custom properties at `:root` for theme. Heavy use of Leaflet `L.divIcon` for custom marker badges.
- Backend: CommonJS, Express middleware ordering matters (helmet → cors → json → cookieParser → routes). All `authMiddleware`-protected routes must be registered after `app.use(cookieParser)`.
- Mobile: TypeScript + file-based routing. No tests. ESLint config present.
- No tests anywhere. No CI config. No pre-commit hooks.
- Commit messages: lowercase, conventional-ish (e.g. `feat:`, `fix:`, `build:`).

## Docs in Repo

- `README.md` — user-facing feature overview + Docker quickstart.
- `DESCRIPTION.md` — AI-assistant-targeted deep dive (DOM architecture, N8N contracts, critical rules). Read this for feature-level context.
- `docs/system-architecture.md` — high-level system diagram.
- `SERVER_INFO.md` — SSH credentials + connection protocol.
- `.planning/AUDIT-PLAN-2026-07-06.md` and `FULL-PLAN-2026-07-07.md` — recent planning artifacts (security audit, full plan). User follows GSD workflow per `memory/workflow-preference.md`.
