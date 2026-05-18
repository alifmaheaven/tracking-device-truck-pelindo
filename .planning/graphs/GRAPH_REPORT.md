# Graph Report - Maps Device Pelindo  (2026-05-18)

## Corpus Check
- 43 files · ~41,993 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 206 nodes · 287 edges · 28 communities (21 shown, 7 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `53a8f1b8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Mobile Theme & UI Components|Mobile Theme & UI Components]]
- [[_COMMUNITY_Frontend Dashboard Core|Frontend Dashboard Core]]
- [[_COMMUNITY_Mobile PTT Application Logic|Mobile PTT Application Logic]]
- [[_COMMUNITY_System Architecture & Services|System Architecture & Services]]
- [[_COMMUNITY_Android Application Configuration|Android Application Configuration]]
- [[_COMMUNITY_Android Activity Lifecycle|Android Activity Lifecycle]]
- [[_COMMUNITY_Frontend History & Route Processing|Frontend History & Route Processing]]
- [[_COMMUNITY_Mobile App Navigation & Layout|Mobile App Navigation & Layout]]
- [[_COMMUNITY_Frontend Device Synchronization|Frontend Device Synchronization]]
- [[_COMMUNITY_PTT Core Backend & Mobile Bridge|PTT Core Backend & Mobile Bridge]]
- [[_COMMUNITY_Frontend Map Visualization Modes|Frontend Map Visualization Modes]]
- [[_COMMUNITY_External Link Components|External Link Components]]
- [[_COMMUNITY_Mobile Branding Assets|Mobile Branding Assets]]
- [[_COMMUNITY_iOS Specific UI Symbols|iOS Specific UI Symbols]]
- [[_COMMUNITY_Project Maintenance Scripts|Project Maintenance Scripts]]
- [[_COMMUNITY_Project Identity & Metadata|Project Identity & Metadata]]
- [[_COMMUNITY_Android Project Build|Android Project Build]]
- [[_COMMUNITY_Android Settings|Android Settings]]

## God Nodes (most connected - your core abstractions)
1. `useThemeColor()` - 8 edges
2. `PttOverlayService` - 8 edges
3. `Project Architecture & Context (For AI Assistants)` - 8 edges
4. `ThemedView()` - 7 edges
5. `Frontend Web Dashboard` - 7 edges
6. `fetchDeviceData()` - 6 edges
7. `renderDeviceList()` - 6 edges
8. `ThemedText()` - 6 edges
9. `Tracking Device Truck Pelindo` - 6 edges
10. `renderMarkers()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `Frontend Web Dashboard` --semantically_similar_to--> `Android Foreground Service`  [INFERRED] [semantically similar]
  frontend/index.html → DESCRIPTION.md
- `Frontend Web Dashboard` --calls--> `N8N Webhooks Microservices`  [EXTRACTED]
  frontend/index.html → README.md
- `Frontend Web Dashboard` --calls--> `Leaflet.js Maps Engine`  [EXTRACTED]
  frontend/index.html → README.md
- `Truck PTT Mobile App (Expo/React Native)` --implements--> `Push-to-Talk Communication System`  [EXTRACTED]
  mobile/TruckPTT_Expo/README.md → Note/Next Step.txt
- `Push-to-Talk Communication System` --references--> `WebSocket Relay Server`  [EXTRACTED]
  Note/Next Step.txt → DESCRIPTION.md

## Hyperedges (group relationships)
- **PTT Real-time Communication Stack** — ui_dashboard, comp_ws_relay, app_truck_ptt [EXTRACTED 0.95]
- **Real-time Tracking Data Flow** — ext_n8n_webhook, ui_dashboard, lib_leaflet [EXTRACTED 0.90]
- **TruckPTT App Branding Assets** — icon_expo, splash_icon_grid, react_logo_react [INFERRED 0.85]

## Communities (28 total, 7 thin omitted)

### Community 0 - "Mobile Theme & UI Components"
Cohesion: 0.16
Nodes (11): RootLayout(), ExternalLink(), HapticTab(), HelloWave(), ParallaxScrollView(), ThemedText(), ThemedView(), useColorScheme() (+3 more)

### Community 1 - "Frontend Dashboard Core"
Cohesion: 0.12
Nodes (18): buildWav(), dismissCallNotification(), handleBinaryAudio(), handlePressIn(), handlePressOut(), handleSignaling(), processAudioQueue(), showIncomingCallNotification() (+10 more)

### Community 2 - "Mobile PTT Application Logic"
Cohesion: 0.12
Nodes (8): N8N API Endpoints, Real-time Monitoring, buildHistoryUrl(), openHistoryModal(), pad(), simplifyCoordinates(), toLocalIso(), Leaflet.js UI Map

### Community 3 - "System Architecture & Services"
Cohesion: 0.17
Nodes (11): bindPttButtons(), endPttCallUI(), endSpecificCall(), focusCall(), handleIncomingAudioStream(), initPttWebSocket(), setupPtt(), startPttCall() (+3 more)

### Community 4 - "Android Application Configuration"
Cohesion: 0.15
Nodes (12): 1. Project Overview & Environment, 2. File Structure & Scope, 3. Webhooks API Integrations (N8N Microservices), 4. Newly Added Features (Keep Context), 5. Crucial Logic Rules & Constraints (DO NOT BREAK), 6. Push-To-Talk (PTT) System Architecture, 7. Known Pending Features / Todos, A. Endpoint 1: *Current Devices Cordinate* (+4 more)

### Community 5 - "Android Activity Lifecycle"
Cohesion: 0.17
Nodes (11): 1. Menjalankan via Docker Compose (Direkomendasikan), 2. Dijalankan Manual (Tanpa Docker/Web Server), 🌐 Alur Data API N8N, 🚀 Cara Menjalankan Aplikasi di Lokal, code:bash (# 1. Buka terminal, pastikan masuk dulu ke root direktori re), code:javascript (// Konfigurasi endpoint Webhook N8N:), code:json ([), 🌟 Fitur Utama (+3 more)

### Community 6 - "Frontend History & Route Processing"
Cohesion: 0.18
Nodes (12): Android Foreground Service, Truck PTT Mobile App (Expo/React Native), WebSocket Relay Server, N8N Webhooks Microservices, OSRM Route Snapping Service, Samsung Tab Active 5, Chart.js Visualization, Leaflet.js Maps Engine (+4 more)

### Community 7 - "Mobile App Navigation & Layout"
Cohesion: 0.25
Nodes (9): decodePolyline(), exitDirectionMode(), fetchDeviceData(), renderDeviceList(), renderMarkers(), startDirectionMode(), updateNavRoute(), updateRefreshCounter() (+1 more)

### Community 9 - "PTT Core Backend & Mobile Bridge"
Cohesion: 0.22
Nodes (8): code:bash (npm install), code:bash (npx expo start), code:bash (npm run reset-project), Get a fresh project, Get started, Join the community, Learn more, Welcome to your Expo app 👋

### Community 10 - "Frontend Map Visualization Modes"
Cohesion: 0.43
Nodes (6): fetchDeviceData(), filteredBySearch(), handleSearchInput(), renderDeviceList(), renderMarkers(), setupMap()

### Community 15 - "Project Identity & Metadata"
Cohesion: 0.67
Nodes (3): Expo Framework Logo, React Framework Logo, App Splash Screen Grid

## Knowledge Gaps
- **38 isolated node(s):** `🌟 Fitur Utama`, `🛠️ Tech Stack & Library`, `code:bash (# 1. Buka terminal, pastikan masuk dulu ke root direktori re)`, `2. Dijalankan Manual (Tanpa Docker/Web Server)`, `code:javascript (// Konfigurasi endpoint Webhook N8N:)` (+33 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Are the 4 inferred relationships involving `useThemeColor()` (e.g. with `ThemedText()` and `ParallaxScrollView()`) actually correct?**
  _`useThemeColor()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `🌟 Fitur Utama`, `🛠️ Tech Stack & Library`, `code:bash (# 1. Buka terminal, pastikan masuk dulu ke root direktori re)` to the rest of the system?**
  _38 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Frontend Dashboard Core` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
- **Should `Mobile PTT Application Logic` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._