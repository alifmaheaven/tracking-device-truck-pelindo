# Coding Conventions

**Analysis Date:** 2026-05-15

## Project Overview

This is a multi-project repository with three distinct codebases, each with its own conventions:

| Project | Path | Language | Paradigm |
|---------|------|----------|----------|
| Backend | `backend/` | JavaScript (CommonJS) | WebSocket relay server |
| Frontend | `frontend/` | JavaScript (vanilla ES6+) | Browser single-page app |
| Mobile | `mobile/TruckPTT_Expo/` | TypeScript (React Native/Expo) | Mobile PTT client |

## Naming Patterns

### Files

**Backend (`backend/`):**
- Single file: `server.js` — no file naming convention needed

**Frontend (`frontend/`):**
- JavaScript: camelCase — `script.js`
- CSS: kebab-case — `style.css`
- HTML: kebab-case — `index.html`

**Mobile (`mobile/TruckPTT_Expo/`):**
- Components: kebab-case matching the component name — `themed-text.tsx`, `hello-wave.tsx`, `external-link.tsx`
- Screen pages: kebab-case — `index.tsx`, `explore.tsx`, `modal.tsx`
- Layout files: underscore-prefixed kebab-case — `_layout.tsx`
- Hooks: kebab-case — `use-color-scheme.ts`, `use-theme-color.ts`
- Constants/config: kebab-case — `theme.ts`
- Platform-specific: `.ios.tsx`, `.web.ts` suffixes — `icon-symbol.ios.tsx`, `use-color-scheme.web.ts`

### Functions

**Backend:**
- camelCase — `no named functions; all logic is inline`

**Frontend:**
- camelCase, descriptive names with a mix of English and Bahasa Indonesia — `fetchDeviceData`, `renderMarkers`, `openHistoryModal`, `startGeoTracking`, `handleIncomingAudioStream`
- Event handlers prefixed with descriptive verbs — `handleLogin`, `handlePressIn`, `handlePressOut`

**Mobile:**
- Components: PascalCase named function — `export default function HomeScreen()`, `export function ThemedText()`
- Hooks: camelCase with `use` prefix — `useColorScheme`, `useThemeColor`
- Event handlers: camelCase with `handle` prefix — `handleLogin`, `handleLogout`, `handlePressIn`, `handlePressOut`

### Variables

**Backend:**
- camelCase — `currentClientId`, `partnerId`, `keepaliveInterval`
- Maps for state: `const clients = new Map()`, `const sessions = new Map()`

**Frontend:**
- camelCase for most variables — `devicesData`, `markersList`, `isNavigating`
- `ALL_CAPS` for constants — `const API_URL = '...'`
- Mix of Bahasa Indonesia and English variable names — `connDate`, `batteryVal`, `deviceListContainer`
- Global-scope `let` declarations for mutable state — `let historyMapInstance = null`

**Mobile:**
- camelCase — `activeDevice`, `isConnected`, `callStatus`
- `useRef` for persistent mutable references — `wsRef`, `activeDeviceRef`, `foregroundServiceStarted`
- `ALL_CAPS` for external constants — `const WEBSOCKET_URL = '...'`, `const API_URL = '...'`
- React state via `useState` — `const [isRecording, setIsRecording] = useState(false)`

### Types (TypeScript — Mobile Only)

- PascalCase for type aliases and interfaces — `ThemedTextProps`, `ThemedViewProps`, `IconMapping`
- Intersection types for extending built-ins — `type ThemedTextProps = TextProps & { ... }`
- Inline type annotations for `useRef` — `useRef<WebSocket | null>(null)`
- Record/object type mappings — `Record<SymbolViewProps['name'], ComponentProps<typeof MaterialIcons>['name']>`

## Code Style

### Formatting

**Backend:**
- No formatter or linter configured
- 2-space indentation (consistent though not enforced)
- Template literals preferred for string interpolation — `` console.log(`Client registered: ${currentClientId}`) ``
- Double quotes for strings in `JSON.stringify` calls; single quotes for other strings

**Frontend:**
- No formatter or linter configured
- Inconsistent indentation (mixture of 4-space and occasional different patterns)
- Heavy use of inline styles via template literals — `` `<div style="background-color: ${bgColor}; ...">` ``
- Single quotes for JavaScript strings; double quotes for HTML attributes
- Template literals for multi-line HTML generation
- Section headers with comment blocks: `// ==========================================` and `// LOGIKA MODAL RIWAYAT PERJALANAN (HISTORY) // ==========================================`

**Mobile:**
- ESLint configured via `eslint-config-expo/flat` (Expo default) — `mobile/TruckPTT_Expo/eslint.config.js`
- TypeScript strict mode enabled — `"strict": true` in `tsconfig.json`
- Path alias `@/*` maps to project root — `mobile/TruckPTT_Expo/tsconfig.json`
- Double quotes for JSX string props
- Semi-colons used consistently
- Inline style objects preferred over `StyleSheet.create` within render (heavier styles use `StyleSheet.create` at file bottom)

### Linting

**Backend:** None — no ESLint, Prettier, or other linting tool configured.

**Frontend:** None — no ESLint, Prettier, or other linting tool configured.

**Mobile:**
- ESLint v9 with Expo flat config — `mobile/TruckPTT_Expo/eslint.config.js`
- Config file:
```javascript
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
module.exports = defineConfig([expoConfig, { ignores: ['dist/*'] }]);
```
- Lint command: `npx expo lint`
- No Prettier or Biome configured

**Run lint command:**
```bash
cd mobile/TruckPTT_Expo && npx expo lint
```

## Import Organization

**Mobile (TypeScript/Expo) — only project with imports:**

Import order (by convention, consistent across all mobile files):
1. React and React Native core — `import React from 'react'`, `import { View, Text } from 'react-native'`
2. Third-party Expo/React Navigation — `import { Stack } from 'expo-router'`, `import * as Haptics from 'expo-haptics'`
3. Third-party other packages — `import notifee from '@notifee/react-native'`
4. Local imports using `@/*` path alias — `import { useThemeColor } from '@/hooks/use-theme-color'`

Path aliases (configured in `mobile/TruckPTT_Expo/tsconfig.json`):
```json
"paths": { "@/*": ["./*"] }
```
This means `@/components/themed-text` resolves to `mobile/TruckPTT_Expo/components/themed-text`.

**Backend:** Single `require` — `const WebSocket = require('ws');`

**Frontend:** No module system — scripts loaded via HTML `<script>` tags in `frontend/index.html`. Dependencies (Leaflet, FontAwesome, Chart.js) loaded from CDN in HTML.

## Error Handling

### Patterns

**Backend (`backend/server.js`):**
- `try/catch` for JSON parse failures
- `console.error()` on parse failure; operation silently ignored
- Defensive checks: checks `ws.readyState === WebSocket.OPEN` before sending
- Nullable client lookups handled with `||` — `const partnerWs = clients.get(partnerIdMsg); if (partnerWsMsg && partnerWsMsg.readyState === ...)`
- No error propagation to clients beyond the `'error'` message type

**Frontend (`frontend/script.js`):**
- `try/catch` around all `fetch()` calls
- `console.error()` on failure with description — `console.error('Gagal mengambil data dari API:', error)`
- User-facing error injected as innerHTML in loading containers — `loadingHistory.innerHTML = 'Terjadi kesalahan jaringan...'`
- Fallback behavior: if API fails, shows error message in UI rather than crashing
- `finally` blocks used for cleanup — `loadingHistory.style.display = 'none'` after rendering
- Optional chaining not widely used; explicit null checks preferred — `if (btn) { btn.addEventListener(...) }`

**Mobile (`mobile/TruckPTT_Expo/app/index.tsx`):**
- `try/catch` with `.catch()` chains for promises — `Audio.setAudioModeAsync({...}).catch(e => console.log(...))`
- `Alert.alert()` for user-facing error dialogs — `Alert.alert('Gagal Login', 'PPT Code tidak valid...')`
- `console.error()` / `console.warn()` for non-critical failures
- Silent catch blocks for non-critical operations — `catch (e) { // ignore }`
- Ref-based stale closure avoidance — uses `activeDeviceRef` instead of `activeDevice` in closures

### Error Recovery

- **Backend:** WebSocket ping/pong heartbeat with `ws.isAlive` flag; dead connections terminated every 25 seconds
- **Frontend:** WebSocket auto-reconnect with 3-second delay on close — `setTimeout(initPttWebSocket, 3000)`
- **Mobile:** WebSocket auto-reconnect with 5-second delay; AppState listener triggers reconnect on foreground

## Logging

**Framework:** No logging framework in any project. All three use native `console.*` methods.

**Backend:**
- `console.log`: Connection lifecycle, registration, call state transitions
- `console.error`: JSON parse failures
- Template literal format: `` `Call request: ${currentClientId} -> ${targetId}` ``

**Frontend:**
- `console.log`: PTT WebSocket connection status, incoming call IDs
- `console.error`: API failures (fetch, geolocation, routing)
- `console.warn`: Non-fatal routing fallbacks, missing history data
- Messages primarily in English but with mixed Bahasa Indonesia context

**Mobile:**
- `console.log`: WebSocket lifecycle (connect, disconnect, register)
- `console.error`: AsyncStorage failures, JSON parse errors
- `console.warn`: Permission denials, battery optimization skips
- `console.log` used for both debug and operational logging — no log levels

**Patterns to follow:**
- Use `console.error` for unexpected failures
- Use `console.warn` for non-fatal fallbacks and recoverable issues
- Use `console.log` for connection lifecycle and state changes
- Log messages should include enough context to identify the source (device ID, call state, etc.)

## Comments

**Backend:**
- Minimal inline comments — `// Map of clientId -> WebSocket connection`, `// Respond to pong`
- Section comment: `// Ping all clients every 25 seconds to keep connections alive`

**Frontend:**
- Heavy commenting in Bahasa Indonesia (mixed with some English)
- Section separator pattern: `// ==========================================`, `// LOGIKA ... // ==========================================`
- Descriptive function-level comments: `// Fungsi untuk memanggil data dari API N8N`, `// Render Markers ke Map`
- Inline comments explaining logic: `// Jika update terakhir di bawah 60 menit, kita anggap 'active'.`
- Commented-out code left in place — `// renderDeviceList([... dummy array if needed])`

**Mobile:**
- JSDoc-style block comments on exported utilities — `components/ui/icon-symbol.tsx`, `constants/theme.ts`, `hooks/use-theme-color.ts`
- Minimal inline comments in `app/index.tsx` — `// Hanya connect WebSockets dan Service ketika sudah login (punya activeDevice)`
- Section comments in `app/index.tsx`: `// --- RENDER LOGIN SCREEN ---`, `// --- RENDER MAIN PTT SCREEN ---`

**When to Comment (convention to follow):**
- JSDoc block for exported shared utilities and hooks
- Section headers for distinct logical blocks within a large component
- Inline comments for non-obvious business logic or calculations
- Do NOT leave commented-out code; remove it

## Function Design

### Size

**Backend:** Single file of ~177 lines; no named function extraction. Event handlers are inline callbacks.

**Frontend:** Single file of ~1663 lines. Functions range from small helpers (10 lines) to very large orchestrators (`openHistoryModal`: ~490 lines, `renderMarkers`: ~90 lines, `renderDeviceList`: ~70 lines). No effort to split into modules.

**Mobile:**
- `app/index.tsx`: ~682 lines — the main PTT app (large by component standards, contains all logic)
- Other components: Small, focused — `themed-text.tsx` (60 lines), `haptic-tab.tsx` (18 lines), `collapsible.tsx` (45 lines)
- Hooks: Small and single-purpose — `use-theme-color.ts` (21 lines), `use-color-scheme.web.ts` (21 lines)

**Convention to follow for new code:**
- Keep components under 200 lines when possible
- Extract reusable UI into `components/`
- Extract reusable logic into `hooks/`
- Shared constants in `constants/`

### Parameters

**Backend/Frontend:** Plain positional parameters. Objects passed for complex data — `openHistoryModal(deviceId, truckNumber)`

**Mobile:**
- Props objects destructured in function signature — `export function ThemedText({ style, lightColor, darkColor, type = 'default', ...rest }: ThemedTextProps)`
- Rest spread for forwarding to underlying components — `{...rest}`, `{...otherProps}`
- Default parameter values used frequently — `type = 'default'`, `size = 24`

### Return Values

**Backend/Frontend:** Implicit `undefined` return values from most functions. Side-effect driven (DOM manipulation, WebSocket sending).

**Mobile:** JSX returned from all component functions. Hooks return computed values.

## Module Design

### Exports

**Backend:** No module system — `require()` for imports only; no `module.exports`

**Frontend:** No module system — all functions are global (`window.startPttCall`, `window.audioCtx`)

**Mobile:**
- Default exports for page/screen components — `export default function HomeScreen()`
- Named exports for reusable components — `export function ThemedText()`, `export function ExternalLink()`
- Named exports for hooks — `export function useThemeColor()`
- Named exports for constants — `export const Colors = { ... }`
- Re-export pattern in `hooks/use-color-scheme.ts`: `export { useColorScheme } from 'react-native';`

### Barrel Files

Not used in this project. Each module is imported directly from its file path.

### Path Alias

Mobile uses `@/*` path alias (configured in `tsconfig.json`) which resolves to the project root `mobile/TruckPTT_Expo/`. All internal imports use this alias:
```typescript
import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
```

## Styling Conventions

### Mobile (React Native)

- `StyleSheet.create()` used for static styles defined outside the component — `const styles = StyleSheet.create({ ... })`
- Inline style arrays for combining styles: `style={[{ backgroundColor }, style]}`
- Conditional styling via array spread with ternaries:
```typescript
style={[
  styles.pttButton,
  isRecording ? styles.pttActive : styles.pttIdle,
  !callSessionRef.current.active && styles.pttDisabled,
]}
```
- Color values: lowercase hex with shorthand preference — `'#0f172a'`, `'#ffffff'`, `'#3b82f6'`
- Theme-aware colors via `useThemeColor` hook — `const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text')`

### Frontend (CSS)

- Single `style.css` file — no CSS modules or pre-processors
- CSS custom properties (variables) used for theming — `var(--idle-orange)`, `var(--text-muted)`
- Heavy inline CSS via JavaScript template literals for dynamic marker/popup styles
- Responsive breakpoint at 768px for mobile sidebar collapse

---

*Convention analysis: 2026-05-15*
