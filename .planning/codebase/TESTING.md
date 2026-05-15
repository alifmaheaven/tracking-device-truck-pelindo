# Testing Patterns

**Analysis Date:** 2026-05-15

## Current State: No Tests

**There are zero tests in this repository.** None of the three sub-projects (backend, frontend, mobile) have any test files, test frameworks, or test configuration.

### Status Per Project

| Project | Path | Test Script | Test Framework | Test Files |
|---------|------|-------------|----------------|------------|
| Backend | `backend/` | `"test": "echo \"Error: no test specified\" && exit 1"` | None | 0 |
| Frontend | `frontend/` | Not defined | None | 0 |
| Mobile | `mobile/TruckPTT_Expo/` | Not defined | None | 0 |

### Backend Test Script

`backend/package.json` explicitly acknowledges the absence of tests:
```json
"scripts": {
  "start": "node server.js",
  "test": "echo \"Error: no test specified\" && exit 1"
}
```

### Frontend (no package.json test script)

`frontend/package.json` has no test-related entries:
```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview"
}
```

### Mobile (no test infrastructure)

`mobile/TruckPTT_Expo/package.json` has no test scripts or test-related dependencies:
```json
"scripts": {
  "start": "expo start",
  "reset-project": "node ./scripts/reset-project.js",
  "android": "expo run:android",
  "ios": "expo run:ios",
  "web": "expo start --web",
  "lint": "expo lint"
}
```

The only quality tool present is ESLint (`expo lint`), which provides static analysis but no runtime testing.

## Recommended Testing Setup

### For Backend (`backend/`)

**Unit/Integration Testing:**
The backend (`backend/server.js`) is a WebSocket relay server. Testing should focus on:
- Message routing logic (register, call, acceptCall, endCall)
- Binary forwarding behavior
- Session management
- Keepalive/heartbeat mechanism
- Reconnection handling on client disconnect

**Recommended framework:**
```bash
npm install --save-dev vitest ws
```

**Recommended test file location:**
```
backend/
  __tests__/
    server.test.js
```

**Recommended run command:**
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

### For Frontend (`frontend/`)

**End-to-End / Integration Testing:**
The frontend (`frontend/script.js`) is tightly coupled to DOM manipulation and external APIs (N8N webhooks, OSRM routing). Testing should focus on:
- API data parsing and mapping (`fetchDeviceData`)
- Marker rendering logic (`renderMarkers`)
- Device list rendering (`renderDeviceList`)
- Search filtering logic
- History modal routing (OSRM vs manual fallback)
- WebSocket PTT signaling logic

**Recommended framework:**
For the vanilla JS frontend, unit testing individual functions is difficult because they all operate on global state and the DOM. Consider either:
1. Refactoring core logic into testable pure functions (recommended first step)
2. Using Playwright or Cypress for end-to-end browser testing

**Recommended run command:**
```json
"scripts": {
  "test:e2e": "playwright test"
}
```

### For Mobile (`mobile/TruckPTT_Expo/`)

**Unit/Component Testing:**
The mobile app uses React Native with Expo. Testing should focus on:
- Component rendering (React Native Testing Library)
- Hook behavior (`useThemeColor`, `useColorScheme`)
- WebSocket signaling handlers (`handleSignaling`)
- Audio recording/playback flow
- Login/logout flow with AsyncStorage

**Recommended framework:**
```bash
npm install --save-dev jest @testing-library/react-native jest-expo
```

**Recommended test file location (co-located):**
```
mobile/TruckPTT_Expo/
  app/
    index.tsx
    index.test.tsx
    _layout.tsx
    _layout.test.tsx
  components/
    themed-text.tsx
    themed-text.test.tsx
  hooks/
    use-theme-color.ts
    use-theme-color.test.ts
```

**Recommended run command:**
```json
"scripts": {
  "test": "jest",
  "test:watch": "jest --watch"
}
```

## Coverage

**Current Coverage:** 0% — no coverage tooling is present.

**Recommended threshold:** Start with 0% baseline, target 60-80% on critical paths:
- Backend: All signaling message types, session lifecycle
- Mobile: `app/index.tsx` core logic, `handleSignaling`, audio recording flow
- Frontend: API data parsing, search filtering, routing fallback logic

## Linting (Existing Quality Tool)

The mobile project has a lint command available:
```bash
cd mobile/TruckPTT_Expo && npx expo lint
```

This is the only automated quality check across the entire repository. The backend and frontend have no linting or static analysis.

## Testable vs Untestable Code

### Current Challenges

**Backend:**
- Single monolithic file — no function extraction makes unit testing impractical
- Inline event handlers — cannot test message routing in isolation
- No DI — WebSocket server created at module level, cannot inject mocks

**Frontend:**
- All functions depend on global DOM state (`document.getElementById`, `map` global)
- No module boundaries — everything is a global function
- Business logic mixed with rendering (e.g., `openHistoryModal` is ~490 lines doing fetch, chart rendering, map rendering, and UI updates)

**Mobile:**
- `app/index.tsx` is ~682 lines mixing WebSocket, audio, notifications, auth, and UI
- `handleSignaling` is relatively isolated and testable
- `useThemeColor` hook is small, pure, and highly testable

### Recommended Refactoring for Testability

1. **Backend:** Extract message handlers into separate functions, export them for testing
2. **Frontend:** Extract data parsing/mapping from `fetchDeviceData` into pure functions, extract search filtering from the event listener
3. **Mobile:** Extract WebSocket logic from `app/index.tsx` into a `hooks/usePttWebSocket.ts`, extract audio recording into `hooks/useAudioRecord.ts`

---

*Testing analysis: 2026-05-15*
