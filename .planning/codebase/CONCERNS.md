# Codebase Concerns

**Analysis Date:** 2026-05-15

## Tech Debt

### Monolithic Frontend Script (`frontend/script.js` - 1662 lines)

- Issue: Entire application logic (map rendering, API data fetching, WebSocket PTT, GPS geolocation, history/chart modal, navigation routing, DOM manipulation) is contained in a single JavaScript file with no module separation.
- Files: `frontend/script.js`
- Impact: Any modification risks breaking unrelated features. Code review is nearly impossible. Reuse of logic (battery rendering, marker creation) requires copy-paste.
- Fix approach: Split into ES modules: `map.js`, `api.js`, `ptt.js`, `history.js`, `navigation.js`, `ui.js`. Use Vite's existing module support (package.json already has `"type": "module"`).

### Global State Pollution in Frontend

- Issue: Multiple global variables (`devicesData`, `markersList`, `map`, `historyMapInstance`, `pttWs`, `mediaRecorder`, `audioStream`, `isNavigating`, `navTargetDevice`, `talkingTimeouts`, `window.audioCtx`, `window.startPttCall`) pollute the global scope. Some are attached to `window` explicitly.
- Files: `frontend/script.js` (lines 4-1375+)
- Impact: State mutations from anywhere cause unpredictable behavior. Debugging requires tracing global state across 1662 lines.
- Fix approach: Encapsulate state in a single application state object or use a lightweight state management pattern. Remove `window.*` assignments.

### Mobile App Monolithic Component (`mobile/TruckPTT_Expo/app/index.tsx` - 681 lines)

- Issue: Login screen, PTT main screen, WebSocket management, audio recording/playback, foreground service, and notification handling all live in a single React component file.
- Files: `mobile/TruckPTT_Expo/app/index.tsx`
- Impact: Component re-renders are excessive. Logic is not reusable. Hard to test individual features.
- Fix approach: Extract into dedicated hooks (`useWebSocket`, `useAudioRecord`, `usePTTCall`) and separate screen components (`LoginScreen`, `PTTScreen`).

### Expo Starter Boilerplate Not Removed

- Issue: The mobile app contains unused Expo starter template files: `(tabs)/index.tsx`, `(tabs)/explore.tsx`, `(tabs)/_layout.tsx`, `modal.tsx`, and all boilerplate component/hook files (`hello-wave.tsx`, `parallax-scroll-view.tsx`, `themed-text.tsx`, `themed-view.tsx`, `collapsible.tsx`, `external-link.tsx`, `haptic-tab.tsx`, `icon-symbol.tsx`, `icon-symbol.ios.tsx`, `use-color-scheme.ts`, `use-color-scheme.web.ts`, `use-theme-color.ts`, `constants/theme.ts`).
- Files: `mobile/TruckPTT_Expo/app/(tabs)/**`, `mobile/TruckPTT_Expo/components/**` (all except actually used), `mobile/TruckPTT_Expo/hooks/**`, `mobile/TruckPTT_Expo/constants/theme.ts`
- Impact: Increases APK size with unused code. Confuses developers about which code is active. The tabs-based navigation still loads despite PTT logic living in `app/index.tsx`.
- Fix approach: Remove all unused Expo template files. Restructure `app/` to contain only `index.tsx` or a clean navigation structure.

### No Test Coverage

- Issue: Zero tests exist across the entire project. Backend `package.json` explicitly has `"test": "echo \"Error: no test specified\" && exit 1"`. No test framework configured for frontend or mobile.
- Files: `backend/package.json` (line 7), no `*.test.*` or `*.spec.*` files anywhere in the project
- Impact: Any change risks breaking core functionality (WebSocket relay, PTT audio, map rendering, GPS tracking). No safety net for refactoring.
- Fix approach: Add Jest/Vitest for backend unit tests. Add Vitest + jsdom for frontend. Add Jest + React Native Testing Library for mobile. Start with critical paths: WebSocket message routing, API data mapping, audio PCM decoding.

### Console Logging in Production

- Issue: Extensive `console.log`, `console.warn`, `console.error` calls throughout all layers. Backend logs client lists and call details. Frontend logs WS connection state. Mobile logs every reconnect attempt.
- Files: `backend/server.js` (13 occurrences), `frontend/script.js` (9 occurrences), `mobile/TruckPTT_Expo/app/index.tsx` (multiple via `console.log`)
- Impact: No structured logging. Production logs are noisy and inconsistent. No log levels or filtering.
- Fix approach: Implement a logging utility with levels (debug/info/warn/error) and production-mode filtering. Backend should use a proper logger (pino/winston).

### Duplicated Battery Indicator Logic

- Issue: Battery percentage-to-color/icon mapping is duplicated identically in both `renderMarkers()` and `renderDeviceList()` in the frontend.
- Files: `frontend/script.js` (lines 135-148 and 226-238)
- Impact: Changing battery thresholds requires editing in two places. Risk of visual inconsistency.
- Fix approach: Extract into a single `getBatteryDisplay(batteryVal)` function returning `{ color, icon, text }`.

### Duplicated Audio Playback Logic (PCM Decoding)

- Issue: Raw 16-bit 16000Hz PCM decoding via Int16Array-to-Float32Array and AudioContext buffer creation is duplicated for WebSocket binary messages and for the `handleIncomingAudioStream` function (base64 wrapped audio).
- Files: `frontend/script.js` (lines 1414-1441 and 1598-1624)
- Impact: Bug fixes to audio decoding need to be applied twice. Code drift risk.
- Fix approach: Extract into `playPcmAudio(arrayBuffer)` function.

### Hardcoded Configuration Values

- Issue: Server IPs, WebSocket URLs, API endpoints, and ports are hardcoded in source files. WebSocket URL `ws://43.157.242.182:9090` appears in both frontend and mobile code.
- Files: `frontend/script.js` (lines 2, 1398), `mobile/TruckPTT_Expo/app/index.tsx` (lines 23-24), `backend/server.js` (line 3)
- Impact: Changing server addresses requires code changes and redeployment. No environment-based configuration.
- Fix approach: Use environment variables (`VITE_WS_URL`, `VITE_API_URL`) for frontend via Vite. Use `expo-constants` or `.env` for mobile. Use `process.env` for backend.

### Mixed Language in Code and Comments

- Issue: Comments and UI strings are in Indonesian while code identifiers are in English. This is inconsistent and creates a barrier for non-Indonesian developers.
- Files: All source files
- Impact: Harder to onboard developers who don't speak Indonesian. Code search for patterns requires bilingual awareness.
- Fix approach: Use English for code identifiers and technical comments. Keep Indonesian for user-facing strings only.

---

## Known Bugs

### WebSocket Session State Mismatch on Reconnect

- Symptoms: When the mobile app reconnects after a disconnect, the backend forms a new session but the old session may not be properly cleaned. If the old `currentClientId` was in a session, the partner sees `callEnded` (reason: disconnected) but the old session entry may persist if the `close` event timing is off.
- Files: `backend/server.js` (lines 140-159), `mobile/TruckPTT_Expo/app/index.tsx` (lines 277-285)
- Trigger: Mobile app loses connection, auto-reconnects (5 second delay), old session cleanup races with new registration.
- Workaround: Manual call end by operator.

### Frontend AudioContext May Not Resume on Mobile Browsers

- Symptoms: Audio playback for incoming PTT voice messages may silently fail on mobile browsers (especially iOS Safari) because `AudioContext` requires a user gesture to start and the one-time click listener on `window` may have already fired before the AudioContext is created.
- Files: `frontend/script.js` (lines 1379-1386)
- Trigger: PTT audio arrives before user has interacted with the page, or AudioContext was created but suspended.
- Workaround: Click anywhere on the page to resume audio context.

### Center-main Receives Its Own Audio Echo

- Symptoms: When center-main sends binary audio (PCM), a JSON-wrapped copy is sent to `center-main` itself (line 25-30). While the condition on line 25 checks `currentClientId !== 'center-main'`, this still means the frontend receives its own audio as a JSON `audioStream` message via the `handleIncomingAudioStream` path, potentially causing echo or double-playback.
- Files: `backend/server.js` (lines 24-31)
- Trigger: Frontend operator sends voice message while center-main is registered.
- Workaround: The frontend currently handles `audioStream` type messages separately from raw binary, so echo may be hidden by the message type check. But the data path exists.

### PPT Code "Changes Every 5 Minutes" is Misleading

- Symptoms: The mobile UI states PPT Code changes every 5 minutes, but the actual login logic (`handleLogin`) fetches the full device list and matches the PPT code against it. There is no evidence that PPT codes actually rotate on a 5-minute interval in the API response. If the N8N webhook returns static PPT codes, the "5 minute" label is incorrect.
- Files: `mobile/TruckPTT_Expo/app/index.tsx` (line 411)
- Trigger: User reads the instruction and expects the code to expire.
- Workaround: None needed functionally, but UX is confusing.

### OSRM Simplify Function Can Drop Critical Points

- Symptoms: The `simplifyCoordinates` function (line 471) uses uniform sampling (`step`), which means critical turn points can be lost if they fall between samples. This causes OSRM routing to snap to incorrect roads.
- Files: `frontend/script.js` (lines 471-482)
- Trigger: Large history datasets (1 month) with many GPS points. The uniform downsampling to 90 points may skip important waypoints.
- Workaround: Switch to "Manual" (straight-line) routing mode.

---

## Security Considerations

### Cleartext WebSocket Communication

- Risk: All PTT audio and signaling data is transmitted over unencrypted `ws://` connections. Anyone on the same network can eavesdrop on voice communications and call metadata.
- Files: `backend/server.js` (line 3, port 8080), `frontend/script.js` (line 1398), `mobile/TruckPTT_Expo/app/index.tsx` (line 23), `mobile/TruckPTT_Expo/app.json` (line 54, `usesCleartextTraffic: true`)
- Current mitigation: The Android app explicitly allows cleartext traffic (`usesCleartextTraffic: true`) because there is no TLS certificate.
- Recommendations: (1) Deploy the WebSocket server behind a reverse proxy (nginx) with TLS termination. (2) Use `wss://` protocol. (3) Remove `usesCleartextTraffic: true` from `app.json` after TLS is configured.

### No Authentication on WebSocket Relay

- Risk: Any client that connects to the WebSocket server can register with any `id` value. There is no token, secret, or credential check. A malicious actor could register as `center-main`, `truck-123`, or any other ID and intercept or inject audio streams.
- Files: `backend/server.js` (lines 52-57, `register` handler)
- Current mitigation: The server IP and port are not publicly advertised, but there is no access control.
- Recommendations: Implement a shared secret or token-based authentication on the `register` message. Reject unauthenticated connections.

### Hardcoded IP Addresses in Source Control

- Risk: Server IP `43.157.242.182` is committed to git history in three files. This exposes internal infrastructure and makes it easy for attackers to target the server.
- Files: `frontend/script.js` (line 1398), `mobile/TruckPTT_Expo/app/index.tsx` (line 23), `frontend/dist/assets/index-mIN11zV9.js`
- Current mitigation: None.
- Recommendations: Remove hardcoded IPs from source control. Use DNS names and environment variables. Rotate the server IP if exposure is a concern.

### External N8N Webhook as Single Point of Failure

- Risk: All device tracking data depends on a third-party hosted N8N instance at `n8n.freeat.me`. If this service goes down, the entire tracking dashboard becomes non-functional.
- Files: `frontend/script.js` (line 2), `mobile/TruckPTT_Expo/app/index.tsx` (line 24)
- Current mitigation: The frontend shows an error message and keeps the last-known data visible.
- Recommendations: Add a fallback data source or cache last-known positions locally. Consider self-hosting N8N for production reliability.

### No Input Validation on API Responses

- Risk: Both frontend and mobile parse API responses without schema validation. Malformed or malicious data (NaN coordinates, script injection in truck names/PPT codes) could cause runtime errors or XSS via innerHTML.
- Files: `frontend/script.js` (lines 46-65, data mapping), `mobile/TruckPTT_Expo/app/index.tsx` (lines 121-125)
- Current mitigation: Some NaN checks exist for coordinates (`isNaN(device.coordinates[0])` in `renderMarkers`).
- Recommendations: Add JSON schema validation (e.g., Zod or a simple validator) for all API responses. Sanitize all strings used in `innerHTML`.

### Frontend innerHTML Usage Without Sanitization

- Risk: Multiple places use `innerHTML` to inject HTML strings containing API data (truck numbers, PPT codes, tag values). This is a potential XSS vector if the N8N API is compromised or returns malicious data.
- Files: `frontend/script.js` (lines 90, 150-166, 205, 222-260, 803-808)
- Current mitigation: None. The application trusts N8N API responses completely.
- Recommendations: Use `textContent` where possible. For rich HTML, sanitize strings or use DOM construction APIs (`createElement`, `appendChild`).

### Docker Compose Exposes Only Frontend, Not Backend

- Risk: The `docker-compose.yml` only defines the nginx frontend container. The WebSocket relay server (`backend/server.js`) has no Docker definition, suggesting it runs manually or on a different machine. This creates a deployment gap and makes the backend harder to manage.
- Files: `docker-compose.yml`
- Current mitigation: The backend is presumably run separately (directly via `node server.js` or on the VPS).
- Recommendations: Add the backend as a Docker service in `docker-compose.yml` with proper restart policies.

---

## Performance Bottlenecks

### Frontend Renders All Markers on Every Refresh Interval

- Problem: The `fetchDeviceData` function re-renders every device marker and triggers a full re-render of the device list on every refresh cycle, even if no data has changed.
- Files: `frontend/script.js` (lines 38-90, `fetchDeviceData` calls `renderMarkers()` and `renderDeviceList()`)
- Cause: No diffing between old and new data. Entire DOM is rebuilt.
- Improvement path: Implement a diff-based update: (1) Compare incoming data with cached `devicesData`. (2) Only update markers whose coordinates changed. (3) Use `setLatLng()` instead of creating new markers. (4) Use virtual scrolling for device list when device count grows.

### Inefficient Audio Relay for Center Monitoring

- Problem: Binary PCM audio from mobile is wrapped in JSON (base64-encoded) and sent to `center-main` for monitoring. This doubles the payload size (base64 overhead) and requires JSON serialization/deserialization.
- Files: `backend/server.js` (lines 22-31)
- Cause: To distinguish audio sources for monitoring, the server wraps raw binary in JSON with `from` metadata.
- Improvement path: Use a binary protocol prefix (e.g., first 2 bytes for sender ID length + sender ID bytes + raw PCM) instead of JSON wrapping.

### No WebSocket Message Batching

- Problem: Each audio chunk from mobile recording is sent as an individual WebSocket message. At 16kHz PCM, chunks arrive frequently (~every 100-200ms), causing high message overhead.
- Files: `mobile/TruckPTT_Expo/app/index.tsx` (lines 232-237, `AudioRecord.on('data')`)
- Cause: `AudioRecord` fires `data` event for each small recording chunk.
- Improvement path: Buffer chunks and send in larger batches (e.g., every 500ms) to reduce WebSocket frame overhead.

### Large History Modal Re-renders Entire Map on Filter Change

- Problem: Every time a history filter is applied (preset change, custom date, routing mode toggle), the entire history map is cleared and re-rendered including all waypoints, speed labels, and route polyline from scratch.
- Files: `frontend/script.js` (lines 612-1103, `openHistoryModal`)
- Cause: No caching of fetched history data; every filter change triggers a new API call and full re-render.
- Improvement path: Cache the last fetched history data. Only re-fetch when the date range changes (not when routing mode toggles). For routing mode changes, just re-draw the polyline using cached coordinates.

---

## Fragile Areas

### Backend WebSocket Server - In-Memory State

- Files: `backend/server.js` (lines 5-9, `clients` and `sessions` Maps)
- Why fragile: All state is held in memory. If the server process crashes or restarts, all active call sessions are lost with no recovery. No persistence, no clustering support.
- Safe modification: Any change to the `register`, `call`, `acceptCall`, or `endCall` handlers must consider edge cases around stale sessions and client map consistency.
- Test coverage: None.

### Frontend Map Instance Double-Booking

- Files: `frontend/script.js` (lines 9 and 623-624, two Leaflet map instances: `map` and `historyMapInstance`)
- Why fragile: Two map instances share the same page. The history map is created lazily on first modal open. If the modal is opened/closed rapidly, `historyMapInstance.invalidateSize()` may race with DOM rendering. `historyLayerGroup.addTo(historyMapInstance)` assumes the map exists.
- Safe modification: Always guard `historyMapInstance` access with null checks. Wait for modal transition to complete (300ms delay already in place, line 632).
- Test coverage: None.

### Mobile Foreground Service - Android Doze/Battery Optimization

- Files: `mobile/TruckPTT_Expo/app/index.tsx` (lines 160-195, `requestPermissions` and `startForegroundService`), `mobile/TruckPTT_Expo/app/_layout.tsx` (lines 9-13)
- Why fragile: Android's battery optimization can kill the foreground service on some devices/manufacturers (Xiaomi, Huawei, Oppo). The `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` intent may be blocked by the system. The foreground service Promise in `_layout.tsx` never resolves, which relies on `notifee` keeping the process alive.
- Safe modification: Test thoroughly on multiple Android device manufacturers. Add a keep-alive heartbeat mechanism that checks if the service is still running.
- Test coverage: None.

### AudioRecord Initialization Timing

- Files: `mobile/TruckPTT_Expo/app/index.tsx` (lines 222-238, `initAudioRecord`)
- Why fragile: `AudioRecord.init()` and `AudioRecord.on('data')` are called inside the `useEffect` that depends on `activeDevice`. If the component re-renders, it could re-initialize the audio recorder, potentially creating duplicate listeners or resetting the recording state.
- Safe modification: Move `AudioRecord.init()` to a ref-based guard (`useRef` flag) to prevent double initialization. Ensure `AudioRecord.on('data')` only registers once.
- Test coverage: None.

### Frontend MediaRecorder MIME Type Fallback

- Files: `frontend/script.js` (lines 1544-1545)
- Why fragile: The MIME type defaults to `audio/webm` with fallback to `audio/mp4`. Safari does not support `audio/webm` and `audio/mp4` recording may produce different container formats. The mobile app receives base64 audio and writes to WAV format, but the encoding mismatch could cause playback failures.
- Safe modification: Test recording and playback across Chrome, Firefox, Safari, and Edge. Standardize on a single codec or add transcoding.
- Test coverage: None.

---

## Scaling Limits

### Backend Single-Process Bottleneck

- Current capacity: One Node.js process handling all WebSocket connections. No clustering, no load balancing.
- Limit: Node.js single-threaded event loop will bottleneck under heavy load (many simultaneous audio relays). The `clients` and `sessions` Maps are bound to a single process.
- Scaling path: (1) Add Node.js cluster module for multi-core utilization. (2) Use Redis for shared state (sessions/clients) across multiple instances. (3) Add a load balancer with sticky sessions for WebSocket.

### Frontend Polling-Based Architecture

- Current capacity: Timer-based HTTP polling to N8N webhook at configurable intervals (5-60 seconds). Each poll re-fetches the full device list.
- Limit: As device count grows beyond 500+, each poll response grows proportionally. DOM rendering of 500+ markers and cards will degrade UI performance.
- Scaling path: Switch to WebSocket push for device location updates. Implement marker clustering (Leaflet.markercluster). Use canvas-based rendering for large marker sets. The DESCRIPTION.md already mentions this as a pending feature.

### N8N Webhook Rate Limits

- Current capacity: The `n8n.freeat.me` service is a shared instance. Rate limits and availability are unknown.
- Limit: If the polling interval is set to 5 seconds and there are multiple dashboard users, the N8N instance may throttle or fail.
- Scaling path: Self-host N8N or move to a dedicated API backend. Implement server-side caching to reduce N8N load.

---

## Dependencies at Risk

### `react-native-audio-record` (v0.2.2)

- Risk: This is a small, community-maintained package with limited downloads and potentially infrequent updates. It may break with newer React Native versions.
- Files: `mobile/TruckPTT_Expo/app/index.tsx` (line 17, import), `mobile/TruckPTT_Expo/package.json` (line 39)
- Impact: Core PTT functionality (audio recording) breaks if the package becomes incompatible or unmaintained.
- Migration plan: Evaluate `expo-audio` (newer Expo API) or `react-native-audio-api` as alternatives. Or create a custom native module.

### `@notifee/react-native` (v9.1.8)

- Risk: Notifee is well-maintained but tightly coupled to the foreground service implementation. If the Android foreground service API changes (Android 15+ restrictions), the current setup may need significant changes.
- Files: `mobile/TruckPTT_Expo/app/_layout.tsx`, `mobile/TruckPTT_Expo/app/index.tsx`
- Impact: Background WebSocket and microphone access would stop working, breaking PTT reliability.
- Migration plan: Monitor Android release notes. Keep Notifee updated to latest version.

### External CDN Dependencies in Frontend

- Risk: Leaflet.js, FontAwesome, Chart.js, and Google Fonts are loaded from external CDNs (`unpkg.com`, `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `fonts.googleapis.com`). If any CDN is down or blocked, the application breaks silently or with broken UI.
- Files: `frontend/index.html` (lines 25-31, 216-218)
- Impact: Map tiles may fail to load. Icons disappear. Charts break.
- Migration plan: Bundle all dependencies via npm/Vite instead of CDN links. Only OpenStreetMap tiles need external loading.

---

## Missing Critical Features

### No Offline Support

- Problem: Both the web dashboard and mobile app require constant network connectivity. If the network drops, the dashboard shows stale data, the mobile app disconnects from PTT, and there is no local caching.
- Blocks: Reliable truck tracking in areas with poor cellular coverage (common in port/logistics environments).
- Recommendation: Add service worker for frontend offline cache. Add local position queue on mobile that syncs when reconnected.

### No User Access Control

- Problem: The web dashboard has no login or authentication. Anyone with the URL can view all truck positions and initiate PTT calls. The mobile app has a PPT code login, but the code is static and transmitted over HTTP.
- Blocks: Production deployment in a security-conscious enterprise environment.
- Recommendation: Add at minimum a simple password/token gate for the dashboard. Implement proper JWT-based authentication for the WebSocket relay.

### No Alerting or Geofencing

- Problem: There is no mechanism to alert operators when a truck enters/exits a restricted zone, when battery is low, or when a device goes offline.
- Blocks: Proactive fleet management. The DESCRIPTION.md lists this as a pending feature.
- Recommendation: Implement geofence polygons on the map with visual alerts. Add battery-low and offline-device notifications.

### No Analytics or Reporting

- Problem: There is no data export feature. Trip history can be viewed on the map but cannot be exported to CSV/PDF/Excel for compliance or operational reports.
- Blocks: Operational reporting requirements for fleet management.
- Recommendation: Add CSV export of history data. Consider a simple PDF report generator for trip summaries.

---

## Test Coverage Gaps

### WebSocket Relay Server

- What's not tested: Message routing (register, call, acceptCall, endCall, binary forwarding), session management, concurrent connections, disconnect cleanup, keep-alive heartbeat.
- Files: `backend/server.js`
- Risk: Any change to the relay logic can break PTT communication. No way to verify message routing correctness.
- Priority: High. The relay server is the backbone of PTT communication.

### Frontend Data Mapping

- What's not tested: API response parsing and mapping (`fetchDeviceData`), battery status calculation, coordinate validation, lastConnectionDate status inference.
- Files: `frontend/script.js` (lines 38-90)
- Risk: Changes to the N8N API response format could silently break the mapping, causing NaN coordinates or incorrect status.
- Priority: High. Data mapping is critical for correct map display.

### Frontend PTT Audio Pipeline

- What's not tested: MediaRecorder encoding, WebSocket binary send/receive, PCM-to-Float32 conversion, AudioContext buffer scheduling, base64 audio decode/playback.
- Files: `frontend/script.js` (lines 1397-1662)
- Risk: Audio quality issues or playback failures would be discovered only in production.
- Priority: Medium. Audio pipeline is complex but failures are immediately noticeable.

### Mobile WebSocket Signaling

- What's not tested: WebSocket connect/reconnect, call state machine transitions (Idle -> Calling -> Connected -> Idle), notification display/dismiss, foreground service lifecycle.
- Files: `mobile/TruckPTT_Expo/app/index.tsx`
- Risk: Call state corruption or notification spam on rapid connect/disconnect cycles.
- Priority: High. Mobile PTT reliability is mission-critical.

### Frontend GPS Geolocation

- What's not tested: `navigator.geolocation.watchPosition` integration, heading-based marker rotation, mode switching (monitoring/journey), navigation route calculation.
- Files: `frontend/script.js` (lines 1140-1366)
- Risk: GPS features may fail silently on certain browsers or devices.
- Priority: Medium. GPS is a secondary feature (dashboard-focused rather than driver-focused).

---

*Concerns audit: 2026-05-15*
