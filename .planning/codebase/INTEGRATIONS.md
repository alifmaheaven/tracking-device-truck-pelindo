# External Integrations

**Analysis Date:** 2026-05-15

## APIs & External Services

**Device Tracking (N8N Webhooks):**

The system relies on two N8N webhook endpoints hosted at `n8n.freeat.me` for all device coordinate and history data.

- **Device Coordinates Webhook** - Polled at configurable intervals (5s, 10s, or 15s) to fetch real-time device positions.
  - URL: `https://n8n.freeat.me/webhook/device-cordinate`
  - Method: GET
  - Used by: `frontend/script.js` (line 2, called at line 42) and `mobile/TruckPTT_Expo/app/index.tsx` (line 24, called at line 120)
  - Mobile usage: Validates driver PPT code against active device list to bind `deviceId` for WebSocket registration
  - Frontend usage: Renders all device markers on Leaflet map with status badges, battery indicators, and speed
  - Expected JSON contract:
    ```json
    [
      {
        "deviceId": "string",
        "serialNumber": "string",
        "latitude": "stringable float",
        "longitude": "stringable float",
        "lastConnectionDate": { "time": "timestamp_number" },
        "deviceTags": ["tag1", "tag2"],
        "battery": "number"
      }
    ]
    ```

- **Device History Webhook** - Fetched on-demand when a user opens the history modal for a specific device.
  - URL: `https://n8n.freeat.me/webhook/device-history?deviceId={deviceId}&createdDate_gte={startIso}&createdDate_lte={endIso}`
  - Method: GET
  - Used by: `frontend/script.js` (line 567, called at line 641)
  - Purpose: Retrieves historical coordinate points for drawing polyline routes on Leaflet map and speed chart data
  - Expected JSON contract:
    ```json
    [
      {
        "_id": "string",
        "deviceId": "string",
        "latitude": "stringable float",
        "longitude": "stringable float",
        "createdDate": "ISO Timestamp String"
      }
    ]
    ```

**Open Source Routing Machine (OSRM):**

- **OSRM Public API** - Converts raw coordinate points into road-snapped route polylines.
  - URL: `https://router.project-osrm.org/route/v1/driving/{coordinates}?overview=full&geometries=polyline`
  - Method: GET
  - Used by: `frontend/script.js` (lines 967, 1337)
  - Purpose: Two modes -- (1) History modal route snapping for realistic road-following polylines, (2) Navigation mode for turn-by-turn driving directions from user GPS location to target truck
  - Coordinate simplification applied before sending (max 90 points) to avoid API limits
  - Fallback: Manual straight-line polyline if OSRM returns no routes or error

**OpenStreetMap (Tile Server):**

- **OSM Tile Layer** - Map tile imagery for both main map and history modal map.
  - URL: `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`
  - Used by: `frontend/script.js` (lines 11, 625)
  - Client: Leaflet.js `L.tileLayer()`

## Data Storage

**Databases:**
- **None locally.** The system has no local database, ORM, or persistent data store.
- All data originates from the N8N webhook endpoints (backed by what appears to be a MongoDB instance on the N8N server, based on the `_id` field in history JSON responses and the `createdDate_gte`/`createdDate_lte` query parameters).

**File Storage:**
- Local temporary file system only. Mobile app uses `expo-file-system` at `FileSystem.documentDirectory` to temporarily write `.wav` files for PTT audio playback (`mobile/TruckPTT_Expo/app/index.tsx` line 361).

**Caching:**
- `AsyncStorage` on mobile for persisting the logged-in device session across app restarts (`mobile/TruckPTT_Expo/app/index.tsx` lines 48-55).
- No server-side caching.

## Authentication & Identity

**Auth Provider:**
- **Custom PPT Code verification via N8N.** The mobile app login flow fetches the devices list from the N8N webhook and matches the entered PPT code against the `pptCode` field in the response (`mobile/TruckPTT_Expo/app/index.tsx` lines 110-137).
- On successful match, the `deviceId` is stored in `AsyncStorage` and used as the WebSocket registration identifier.
- No JWT, OAuth, or session tokens. No password-based auth.
- The frontend web dashboard has no authentication layer -- it is accessed directly.

## Monitoring & Observability

**Error Tracking:**
- None. No Sentry, Bugsnag, or equivalent error tracking service.

**Logs:**
- `console.log()` / `console.error()` throughout all components.
- Backend logs to stdout: client registration, call request routing, disconnections (`backend/server.js`).
- Mobile logs via Metro bundler / React Native debug console.

**Status Indicators:**
- Frontend: WebSocket connection status dot (green/red) with text in sidebar (`frontend/index.html` lines 40-43, `frontend/script.js` lines 1404-1409).
- Mobile: Connection status dot with "Terhubung/Terputus" text (`mobile/TruckPTT_Expo/app/index.tsx` lines 451-456).

## CI/CD & Deployment

**Hosting:**
- **Frontend (Web Dashboard):** Docker container via `docker-compose.yml`, running `nginx:alpine` serving static files from `frontend/dist/` on host port 8123.
- **Backend (WebSocket Relay):** Node.js process on external VPS (`43.157.242.182`), exposed on port 9090 via Docker port mapping (internal port 8080).

**CI Pipeline:**
- None detected. No GitHub Actions workflows, GitLab CI, or other CI configuration files.

**Mobile Build Pipeline:**
- Manual build via `mobile/TruckPTT_Expo/build-release.sh` which bundles JS with Metro, then runs Gradle `assembleRelease` to produce a standalone APK.
- EAS Build configured for cloud builds (`mobile/TruckPTT_Expo/eas.json` -- project ID `d63f22b1-d7db-485c-ab0d-f8ef47cbb33a`) with APK build type for both preview and production profiles.

## Environment Configuration

**Required env vars:**
- No environment variables are used. All URLs are hardcoded directly in source files:
  - `ws://43.157.242.182:9090` -- WebSocket relay server
  - `https://n8n.freeat.me/webhook/device-cordinate` -- Device coordinates API
  - `https://n8n.freeat.me/webhook/device-history` -- Device history API

**Secrets location:**
- No secret management. No `.env` files detected.

## Webhooks & Callbacks

**Incoming:**
- None. The system does not expose any webhook endpoints. All data fetching is client-initiated (polling or on-demand).

**Outgoing:**
- Two N8N webhook endpoints (described above under APIs & External Services).
- OSRM routing API calls (described above).

## CDN Dependencies (Frontend)

The web dashboard loads the following from CDN (no local copies):

| Library | CDN | Version | File |
|----------|-----|---------|------|
| Leaflet.js (JS + CSS) | unpkg | 1.9.4 | `frontend/index.html` lines 29, 215 |
| Chart.js | jsDelivr | latest | `frontend/index.html` line 217 |
| Font Awesome | cdnjs | 6.0.0 | `frontend/index.html` line 27 |
| Google Fonts (Inter) | Google Fonts | latest | `frontend/index.html` line 25 |

## Hardware / Platform Integrations (Mobile)

**Android Permissions (via `app.json` and runtime requests):**
- `RECORD_AUDIO` -- Microphone access for PTT voice recording
- `FOREGROUND_SERVICE` -- Persistent background service for WebSocket and audio
- `FOREGROUND_SERVICE_MICROPHONE` -- Android 14+ foreground microphone type
- `FOREGROUND_SERVICE_MEDIA_PLAYBACK` -- Android 14+ foreground media playback type
- `WAKE_LOCK` -- Keep device awake during PTT calls
- Battery optimization exemption requested at runtime (`mobile/TruckPTT_Expo/app/index.tsx` lines 183-189)

**Native Mobile Modules:**
- `react-native-audio-record` -- Direct Android `AudioRecord` API for raw PCM capture (16-bit, 16000Hz, mono, VOICE_RECOGNITION source)
- `@notifee/react-native` -- Android foreground service, notification channels, incoming call full-screen intents
- `expo-av` -- Audio playback with background support
- `expo-file-system` -- File read/write for temporary audio files

**Web Browser APIs (Frontend PTT):**
- `AudioContext` / `webkitAudioContext` -- Decode and play raw PCM audio streams from mobile devices (`frontend/script.js` lines 1415-1441)
- `navigator.mediaDevices.getUserMedia()` -- Microphone access for web-based PTT (`frontend/script.js` line 1537)
- `MediaRecorder` -- WebM/Opus audio recording for PTT voice messages (`frontend/script.js` lines 1545-1569)
- `FileReader` -- Base64 encoding of audio blobs for transmission
- `navigator.geolocation` -- GPS position for navigation/direction mode (`frontend/script.js`)

---

*Integration audit: 2026-05-15*
