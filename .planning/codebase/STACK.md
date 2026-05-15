# Technology Stack

**Analysis Date:** 2026-05-15

## Languages

**Primary:**
- JavaScript (ES6) - Used across all three components: frontend (`frontend/script.js`), backend (`backend/server.js`), and mobile

**Secondary:**
- TypeScript 5.9.2 - Used in the React Native mobile app only (`mobile/TruckPTT_Expo/`)
- HTML5 - Frontend layout and structure (`frontend/index.html`)
- CSS3 - Frontend styling (`frontend/style.css`)
- Shell Script (Bash) - Production build script (`mobile/TruckPTT_Expo/build-release.sh`)

## Runtime

**Environment:**
- Node.js - Backend WebSocket relay server (`backend/server.js`)
- Node.js (via Vite dev server) - Frontend development server
- React Native 0.81.5 (via Expo 54) - Mobile application runtime

**Package Manager:**
- npm - All components
- Lockfiles present: `backend/package-lock.json`, `frontend/package-lock.json`, `mobile/TruckPTT_Expo/package-lock.json`

## Frameworks

**Core:**
- Expo SDK 54 with Expo Router 6 - Mobile application framework, API routes, deep linking (`mobile/TruckPTT_Expo/`)
- React 19.1.0 - Frontend framework for the mobile app
- React Navigation 7 - Mobile navigation including bottom tabs (`@react-navigation/bottom-tabs` v7.4.0)
- React Native Reanimated 4.1.1 - Mobile animations
- React Native Gesture Handler 2.28.0 - Touch gesture handling on mobile

**Frontend (Web Dashboard):**
- Vanilla JavaScript (no framework) - The web dashboard uses zero JavaScript frameworks, only vanilla ES6
- Vite 6 - Build tool and dev server for the frontend (`frontend/package.json`)
- Leaflet.js 1.9.4 - Interactive map rendering (loaded via CDN unpkg in `frontend/index.html`)
- Chart.js - Speed graph charting in history modal (loaded via CDN jsDelivr in `frontend/index.html`)
- FontAwesome 6.0.0 - UI icons (loaded via CDN cdnjs in `frontend/index.html`)
- Google Fonts (Inter) - Web typography (loaded via Google Fonts CDN in `frontend/index.html`)

**Backend:**
- ws 8.20.1 - WebSocket server library for the relay server (`backend/server.js`)

**Testing:**
- No testing framework configured in any component. All `package.json` have placeholder test scripts ("Error: no test specified").

**Build/Dev:**
- Vite 6 - Frontend build and preview
- Expo Build (EAS) - Mobile APK builds (`mobile/TruckPTT_Expo/eas.json`)
- Gradle (via Expo) - Android native build (`mobile/TruckPTT_Expo/android/`)
- React Native CLI bundle - Production JS bundle for standalone APK

## Key Dependencies

**Critical:**
- `ws` v8.20.1 - Backend WebSocket server powering all real-time PTT communication. Single external dependency of the relay.
- `expo` ~54.0.33 - Core Expo SDK powering the mobile app
- `expo-av` ~16.0.8 - Mobile audio playback for incoming PTT voice messages
- `react-native-audio-record` 0.2.2 - Mobile microphone capture (raw PCM audio recording)
- `@notifee/react-native` 9.1.8 - Android foreground service and notification system to keep PTT alive in background
- `expo-file-system` ~19.0.22 - File I/O for writing/reading audio files on mobile
- `@react-native-async-storage/async-storage` 2.2.0 - Persistent device session storage on mobile
- `react-native-sound` 0.13.0 - Sound playback on mobile

**Infrastructure:**
- `expo-build-properties` ~1.0.10 - Android native build configuration (cleartext traffic enablement, NDK version)
- `expo-dev-client` ~6.0.21 - Development builds with native module support
- `expo-linking` ~8.0.11 - Deep linking
- `expo-splash-screen` ~31.0.13 - Splash screen management
- `react-native-web` ~0.21.0 - Web support for Expo

## Configuration

**Environment:**
- No `.env` files detected in any component. All URLs and connection strings are hardcoded in source files.
- WebSocket URL: `ws://43.157.242.182:9090` (hardcoded in both `frontend/script.js` line 1398 and `mobile/TruckPTT_Expo/app/index.tsx` line 23)
- API URL: `https://n8n.freeat.me/webhook/device-cordinate` (hardcoded in both `frontend/script.js` line 2 and `mobile/TruckPTT_Expo/app/index.tsx` line 24)
- History API URL: `https://n8n.freeat.me/webhook/device-history` (hardcoded in `frontend/script.js` line 567)
- OSRM Routing API: `https://router.project-osrm.org/route/v1/driving/` (hardcoded in `frontend/script.js` lines 967, 1337)

**Build:**
- `mobile/TruckPTT_Expo/app.json` - Expo app configuration (permissions, plugins, build properties)
- `mobile/TruckPTT_Expo/eas.json` - EAS Build configuration (APK build type)
- `mobile/TruckPTT_Expo/tsconfig.json` - TypeScript config with `@/*` path alias
- `mobile/TruckPTT_Expo/build-release.sh` - Production standalone APK build script
- `frontend/Dockerfile` - Nginx Alpine Docker image for frontend serving
- `docker-compose.yml` - Frontend service orchestration (port 8123:80)

**Linting:**
- `mobile/TruckPTT_Expo/eslint.config.js` - ESLint 9 with `eslint-config-expo` preset

## Platform Requirements

**Development:**
- Node.js 18+ (for Vite and Expo CLI)
- npm
- Android SDK (for mobile APK builds)
- Expo CLI / EAS CLI (for Expo builds)
- Docker (for frontend container)

**Production:**
- **Frontend:** Nginx Alpine Docker container on port 8123 → 80 (defined in `docker-compose.yml` and `frontend/Dockerfile`)
- **Backend:** Node.js process running `server.js` on port 8080, exposed externally via Docker as port 9090 (deployed on VPS at `43.157.242.182`)
- **Mobile:** Standalone Android APK (minimum SDK from Expo 54), installed directly on truck driver tablets
- **No database:** The system uses no local database. All persistent data flows through external N8N webhooks

---

*Stack analysis: 2026-05-15*
