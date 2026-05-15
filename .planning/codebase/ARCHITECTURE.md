# Architecture

**Analysis Date:** 2026-05-15

## System Overview

The system is a real-time truck tracking and Push-To-Talk (PTT) voice communication platform for Pelindo Teluk Lamong port operations. It consists of three independent modules deployed separately:

```text
+---------------------------------------------------------------+
|                     External Services                          |
|  N8N Webhook API (n8n.freeat.me)          OSRM Router API     |
|  - Device coordinates                     - Route snapping     |
|  - Device history                         - Navigation routes  |
+---------------------+---------------------+-------------------+
                      |                     |
          +-----------+-------+   +---------+--------+
          |                   |   |                  |
+---------v--------+  +-------v---v-------+  +------v----------+
|  Frontend (SPA)  |  |  Backend Relay    |  |  Mobile Tablet  |
|  Nginx Alpine    |  |  Node.js + ws     |  |  Expo/React     |
|  Vanilla JS      |  |  Port 8080        |  |  Native Android |
|  Leaflet.js      |  |  (Exp: 9090)      |  |  EAS Build APK  |
+---------+--------+  +--------+----------+  +--------+---------+
          |                    |                       |
          +--------------------+-----------------------+
               WebSocket PTT (ws://43.157.242.182:9090)
               - Binary PCM audio streaming
               - JSON signaling (call/accept/end)
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Frontend SPA | Device tracking dashboard, map rendering, PTT call UI, history playback | `frontend/script.js` |
| Frontend HTML | DOM structure, modals, sidebar, PTT panel | `frontend/index.html` |
| Frontend CSS | Full styling, responsive layout, animations | `frontend/style.css` |
| WebSocket Relay | Client registration, call signaling, binary audio forwarding | `backend/server.js` |
| Mobile Login | PPT Code authentication via N8N API, device binding | `mobile/TruckPTT_Expo/app/index.tsx` |
| Mobile PTT | Audio recording/playback, WS signaling, foreground service | `mobile/TruckPTT_Expo/app/index.tsx` |
| Mobile Root Layout | Notifee foreground service registration, theme provider | `mobile/TruckPTT_Expo/app/_layout.tsx` |
| Mobile Tabs | Expo starter template (Home/Explore screens, not used for PTT) | `mobile/TruckPTT_Expo/app/(tabs)/` |

## Pattern Overview

**Overall:** Modular monorepo with three independent deployable units, connected via WebSocket and REST.

**Key Characteristics:**
- Frontend is a **vanilla JavaScript SPA** (no React/Vue/Angular) built with Vite
- Backend is a **stateless WebSocket relay** with no database or persistence
- Mobile is an **Expo/React Native** app built as standalone Android APK via EAS Build
- Voice communication uses **half-duplex Push-To-Talk** (walkie-talkie model)
- Data sourcing relies entirely on **N8N webhook microservices** (no direct database access)

## Layers

### Frontend Layer

- **Purpose:** Real-time truck tracking dashboard for port operators
- **Location:** `frontend/`
- **Contains:** `index.html` (DOM), `style.css` (visual), `script.js` (all JS logic)
- **Depends on:** N8N webhook API, OSRM router API, WebSocket relay, CDN-hosted Leaflet.js and Chart.js
- **Used by:** Port operators via web browser (desktop + mobile responsive)
- **Entry point:** `frontend/index.html` served via Nginx Alpine on port 8123 (Docker mapped)

### Backend/Relay Layer

- **Purpose:** WebSocket switchboard for PTT voice communication routing
- **Location:** `backend/server.js`
- **Contains:** Client registration map, session pairing, binary audio forwarding, keep-alive pings
- **Depends on:** Only the `ws` npm package (no database, no auth)
- **Used by:** Both Frontend (as `center-main`) and Mobile (as truck device ID)
- **Entry point:** `backend/server.js` listening on port 8080 (exposed as 9090)

### Mobile Layer

- **Purpose:** In-truck tablet app for receiving PTT calls and push-to-talk
- **Location:** `mobile/TruckPTT_Expo/`
- **Contains:** Expo Router app with login screen, PTT main screen, foreground service
- **Depends on:** N8N webhook API (for login/auth), WebSocket relay (for PTT), Android native APIs (mic, notifications, foreground service)
- **Used by:** Truck drivers via Android tablet
- **Entry point:** `mobile/TruckPTT_Expo/app/index.tsx` (standalone PTT app, not the tab screens)

## Data Flow

### Primary Request Path: Live Device Tracking

1. Frontend runs `setInterval` timer (5s-60s configurable) calling `fetchDeviceData()` (`frontend/script.js:38`)
2. Fetches `GET https://n8n.freeat.me/webhook/device-cordinate` - returns JSON array of device positions
3. Data mapped: `deviceId`, `serialNumber`, `coordinates`, `status` (active/idle based on 2-hour threshold), `tags`, `battery` (`frontend/script.js:46-65`)
4. `renderMarkers()` clears all existing markers, re-renders Leaflet markers with custom `L.divIcon` (`frontend/script.js:93-189`)
5. `renderDeviceList()` populates sidebar cards with tags, battery, PPT code, call button (`frontend/script.js:197-264`)
6. Live search filters sidebar by truck number, device ID, or tags (`frontend/script.js:301-312`)

### PTT Voice Call Flow

1. Frontend operator clicks "Panggil Operator" button on a device card (`frontend/script.js:257`)
2. `startPttCall()` sends `{ type: 'call', targetId: deviceId }` via WebSocket to relay (`frontend/script.js:1507`)
3. Relay (`backend/server.js:59-83`) forwards `{ type: 'incomingCall', callerId: 'center-main' }` to target mobile client
4. Mobile auto-accepts (`app/index.tsx:339`), sends `{ type: 'acceptCall', callerId: 'center-main' }`
5. Relay establishes session: `sessions.set(center-main, deviceId)` and `sessions.set(deviceId, center-main)` (`backend/server.js:103-104`)
6. Frontend operator presses and holds "TAHAN UNTUK BICARA" button:
   - `MediaRecorder` captures audio from browser microphone as WebM/Opus chunks (`frontend/script.js:1532-1573`)
   - On button release, full audio blob encoded as Base64, sent as `{ type: 'voiceMessage', audioBase64: ... }` (`frontend/script.js:1554-1567`)
   - Relay forwards the JSON message verbatim to the session partner (`backend/server.js:85-94`)
7. Mobile receives `voiceMessage`: writes base64 to temp file via `expo-file-system`, plays with `expo-av` Audio.Sound (`app/index.tsx:358-383`)
8. Mobile PTT button press: `AudioRecord` streams raw 16-bit 16000Hz PCM as binary WebSocket frames (`app/index.tsx:232-237`)
9. Relay receives binary: forwards copy to `center-main` as JSON `{ type: 'audioStream', from: deviceId, data: base64 }` AND raw binary to session partner (`backend/server.js:22-45`)
10. Frontend receives binary PCM blob: decodes `Int16Array` to `Float32Array`, plays via Web Audio API `AudioContext` with queued scheduling (`frontend/script.js:1416-1443`)

### History Route Flow

1. User clicks "Riwayat Perjalanan" in marker popup -> `openHistoryModal(deviceId, truckNumber)` (`frontend/script.js:612`)
2. Fetches `GET https://n8n.freeat.me/webhook/device-history?deviceId=X&createdDate_gte=...&createdDate_lte=...` with time filter (`frontend/script.js:566-609`)
3. Data sorted chronologically by `createdDate` (fallback to `_id`), speed calculated between consecutive points (`frontend/script.js:646-693`)
4. If OSRM mode selected: coordinates down-sampled to max 90 points via `simplifyCoordinates()`, fetched from `router.project-osrm.org`, polyline decoded via Google Polyline Algorithm, rendered with `L.polyline` (`frontend/script.js:951-1017`)
5. If manual mode (or OSRM fails): straight dashed-line polyline in red (`frontend/script.js:1001-1017`)
6. Speed badges rendered at midpoints between waypoints, circle markers with hover tooltips at each data point (`frontend/script.js:1019-1064`)
7. Speed line chart rendered in Chart.js with dynamic bucket aggregation and custom HTML tooltip with "Lihat Rute" button (`frontend/script.js:871-945`)

### Navigation/Direction Flow

1. User clicks "Arahkan ke Truk" in marker popup -> `startDirectionMode(device)` (`frontend/script.js:1275-1299`)
2. Forces app into "Perjalanan" mode, activates browser `navigator.geolocation.watchPosition()` (`frontend/script.js:1190-1230`)
3. Hides all other truck markers, shows user location as rotating compass arrow icon (`frontend/script.js:1160-1177`)
4. On each GPS update: fetches OSRM route from user position to target truck, renders emerald dashed polyline (`frontend/script.js:1324-1366`)
5. Shows navigation card with distance (km) and ETA (minutes) at bottom of map (`frontend/index.html:89-97`)

### Mobile Login/Auth Flow

1. Truck driver enters PPT Code (changes every 5 minutes via API) (`app/index.tsx:110-137`)
2. App fetches `GET https://n8n.freeat.me/webhook/device-cordinate`, finds device matching `pptCode`
3. On success: stores device in AsyncStorage, connects WebSocket, registers as `deviceId`, starts foreground service
4. On subsequent launches: loads stored device from AsyncStorage, auto-connects

## Key Abstractions

### Double Map Instance Pattern

**Purpose:** Separate Leaflet map instances for main dashboard and history modal to avoid DOM conflicts.
**Examples:** `frontend/script.js:9` (global `map`), `frontend/script.js:624` (`historyMapInstance` inside modal)
**Pattern:** Both use `L.map()` with their own DOM containers (`#map` and `#historyMap`). `map.invalidateSize()` must be called after any CSS layout change (sidebar toggle, modal open).

### Client Registration/Identity

**Purpose:** Each WebSocket client registers a unique string ID used for routing.
**Examples:** Frontend registers as `'center-main'` (`frontend/script.js:1403`), Mobile registers as device ID from N8N (`app/index.tsx:257`)
**Pattern:** Server maintains `Map<string, WebSocket>` of clients and `Map<string, string>` of session pairs.

### PCM Audio Relay

**Purpose:** Raw audio streaming without server-side processing.
**Examples:** `backend/server.js:22-45` - binary message handler
**Pattern:** Server never decodes audio. Binary messages from mobile are forwarded as-is to session partner, plus a base64-wrapped JSON copy to `center-main` for monitoring. Web-to-mobile voice messages are JSON with base64-encoded audio.

## Entry Points

### Frontend

**Browser access:**
- Location: `http://localhost:8123` (Docker) or open `frontend/dist/index.html` directly
- Triggers: User opens URL in browser
- Responsibilities: Renders tracking dashboard, initializes Leaflet map, starts API polling, connects WebSocket

### Backend WebSocket Relay

**WebSocket server:**
- Location: `backend/server.js:3`
- Triggers: Client connects via `ws://43.157.242.182:9090`
- Responsibilities: Client registration, call signaling, binary audio forwarding, keep-alive pings (25s interval)

### Mobile App

**APK entry point:**
- Location: `mobile/TruckPTT_Expo/app/index.tsx`
- Triggers: User opens Android app
- Responsibilities: Login screen (if not authenticated), PTT main screen (if authenticated), foreground service startup, WebSocket connection, audio recording/playback

### Expo Router

**Expo Router entry:**
- Location: `mobile/TruckPTT_Expo/app/_layout.tsx`
- Triggers: Expo Router boot
- Responsibilities: Registers Notifee foreground service, provides theme, mounts Stack navigator with tabs and modal

## Architectural Constraints

- **Threading:** Frontend is single-threaded (browser main thread). Backend is single-threaded Node.js event loop. Mobile is React Native JS thread + native UI thread.
- **Global state:** Frontend uses module-scope variables: `devicesData` array, `markersList` object, `isNavigating`, `pttWs`, `mediaRecorder`, `historyMapInstance`, `speedChartInstance` (all in `frontend/script.js:5-7`). Mobile uses React state + refs.
- **Map invalidation:** Any CSS layout change affecting Leaflet containers requires `map.invalidateSize()` or `historyMapInstance.invalidateSize()` called after a `setTimeout(..., 300-400ms)` to wait for CSS transitions to complete. This is critical and must not be removed.
- **Data sorting:** History API data MUST be sorted by `createdDate` before rendering polylines, otherwise Leaflet draws crossed/backtracking lines.
- **Timezone:** All API timestamps are ISO 8601 UTC. Display formatting uses `Asia/Jakarta` timezone via `toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })`. Never send WIB-formatted dates to the API.
- **Circular imports:** Not applicable (no module system in frontend, standard imports in mobile and backend).
- **Global state mutation:** `window.audioCtx`, `window.startPttCall` are attached to the global window object for cross-module access in the vanilla JS frontend.
- **Clear text traffic:** Mobile Android app requires `usesCleartextTraffic: true` in `app.json` to allow `ws://` (non-TLS) WebSocket connections on Android 9+.

## Anti-Patterns

### Monolithic script.js

**What happens:** All frontend logic (1663 lines) lives in a single file covering map rendering, API fetching, history modal, navigation mode, PTT WebSocket, chart rendering, DOM event handling, and sidebar management.
**Why it's wrong:** Difficult to maintain, test, or onboard new developers. No separation of concerns. Changes risk breaking unrelated features.
**Do this instead:** Split into modules: `api.js` (fetch logic), `map.js` (leaflet rendering), `ptt.js` (WebSocket PTT), `history.js` (history modal), `navigation.js` (direction mode), with a central `main.js` orchestrator. Use ES modules with Vite for tree shaking.

### Mixed global and local state management

**What happens:** Frontend uses module-scope globals for critical state (`devicesData`, `isNavigating`, `navTargetDevice`, etc.) alongside DOM-based state (CSS classes, data attributes). The Mobile app uses React state + refs but exposes some to global closure scope.
**Why it's wrong:** State is scattered and hard to trace. Side effects from one feature (e.g., navigation mode hiding markers) can break other features unexpectedly.
**Do this instead:** Create a central state object with well-defined mutation methods. For frontend: use a simple pub/sub or state manager pattern. For mobile: keep all state in React hooks with proper cleanup.

### Dual-screen architecture in a single Expo file

**What happens:** `app/index.tsx` contains two completely different UIs (login screen and main PTT screen) in one ~680-line file, controlled by a ternary render.
**Why it's wrong:** The login and PTT screens are entirely separate concerns with different layouts, state, and event handlers. Mixing them makes the file large and complex.
**Do this instead:** Implement proper Expo Router navigation with separate screens: `app/(auth)/login.tsx` and `app/(app)/ptt.tsx`, with navigator guard based on async storage auth state.

### Unused Expo starter template code

**What happens:** The `app/(tabs)/` directory contains Expo starter template screens (Home, Explore, modal) that are never used for PTT functionality. The actual PTT app lives in `app/index.tsx` as a standalone screen.
**Why it's wrong:** Dead code adds confusion about the app's actual entry point and purpose. New developers may assume the tabs are the app's primary interface.
**Do this instead:** Remove the tabs and starter template. Structure the app purely around PTT functionality with dedicated screens.

## Error Handling

**Strategy:** Best-effort with user-facing alerts.

**Patterns:**
- Frontend API errors: Display error message in sidebar `deviceListContainer`, fallback to empty state (`frontend/script.js:83-90`)
- WebSocket disconnection: Auto-reconnect with 3s delay (frontend) / 5s delay (mobile), show indicator dot color change (`frontend/script.js:1479-1488`, `app/index.tsx:277-285`)
- OSRM routing failure: Silently fallback to manual straight-line routing with red dashed polyline (`frontend/script.js:996-1017`)
- Mobile geolocation/permission errors: Alert dialog, fallback to Monitoring mode (`app/index.tsx:160-195`)
- Notifee foreground service failure: Non-fatal, logged to console (`app/index.tsx:217-219`)

## Cross-Cutting Concerns

**Logging:** Console-based (`console.log`, `console.error`, `console.warn`) across all modules. No structured logging or remote log collection.

**Validation:** Minimal. Frontend checks for `isNaN(coordinates)` before rendering markers. Mobile validates PPT code via API lookup. No schema validation on API responses.

**Authentication:** Mobile uses PPT Code binding against N8N API (5-minute rotation). No authentication for frontend or WebSocket relay - the relay trusts all incoming connections by client ID string alone.

**Responsive design:** Frontend has dedicated `@media (max-width: 768px)` breakpoint with absolute-positioned sidebar overlay, auto-collapse on mobile, repositioned floating buttons (`frontend/style.css:925-1025`).

---

*Architecture analysis: 2026-05-15*
