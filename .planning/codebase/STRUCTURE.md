# Codebase Structure

**Analysis Date:** 2026-05-15

## Directory Layout

```
Maps Device Pelindo/                        # Project root
├── frontend/                               # Web dashboard SPA
│   ├── index.html                          # Single-page HTML with all DOM elements
│   ├── style.css                           # Complete stylesheet (1228 lines)
│   ├── script.js                           # All JS logic (1663 lines, monolithic)
│   ├── package.json                        # Vite build config
│   ├── Dockerfile                          # Nginx Alpine deployment image
│   ├── dist/                               # Vite build output (committed)
│   │   ├── index.html
│   │   └── assets/
│   │       ├── index-B-mvlC5h.css
│   │       └── index-mIN11zV9.js
│   └── node_modules/                       # Dependencies (gitignored)
│
├── backend/                                # WebSocket PTT relay server
│   ├── server.js                           # WebSocket server (177 lines)
│   ├── package.json                        # Node.js config with ws dependency
│   ├── package-lock.json
│   └── node_modules/                       # Dependencies (gitignored)
│
├── mobile/                                 # Android tablet app
│   └── TruckPTT_Expo/                      # Expo project root
│       ├── app/                            # Expo Router screens
│       │   ├── _layout.tsx                 # Root layout: Notifee foreground service, Stack nav
│       │   ├── index.tsx                   # Login screen + Main PTT screen (680 lines)
│       │   ├── modal.tsx                   # Unused modal (Expo starter template)
│       │   └── (tabs)/                     # Tab navigator (Expo starter template)
│       │       ├── _layout.tsx             # Tab layout: Home + Explore tabs
│       │       ├── index.tsx               # Home tab (unused starter)
│       │       └── explore.tsx             # Explore tab (unused starter)
│       ├── components/                     # Reusable UI components
│       │   ├── external-link.tsx
│       │   ├── haptic-tab.tsx
│       │   ├── hello-wave.tsx
│       │   ├── parallax-scroll-view.tsx
│       │   ├── themed-text.tsx
│       │   ├── themed-view.tsx
│       │   └── ui/
│       │       ├── collapsible.tsx
│       │       ├── icon-symbol.tsx
│       │       └── icon-symbol.ios.tsx
│       ├── constants/
│       │   └── theme.ts                    # Colors and font constants
│       ├── hooks/
│       │   ├── use-color-scheme.ts
│       │   ├── use-color-scheme.web.ts
│       │   └── use-theme-color.ts
│       ├── assets/images/                  # App icons and splash images
│       ├── android/                        # Native Android project (Expo prebuild)
│       │   ├── app/
│       │   │   ├── build.gradle
│       │   │   ├── proguard-rules.pro
│       │   │   └── src/main/               # Android manifest, Java/Kotlin source
│       │   ├── build.gradle
│       │   ├── settings.gradle
│       │   ├── gradle.properties
│       │   └── gradle/wrapper/
│       ├── builds/                         # Built APK files
│       │   ├── TruckPTT_latest.apk
│       │   └── TruckPTT_production_*.apk
│       ├── scripts/
│       │   └── reset-project.js
│       ├── app.json                        # Expo config: permissions, plugins, package name
│       ├── eas.json                        # EAS Build configuration
│       ├── tsconfig.json                   # TypeScript config (strict, path alias @/*)
│       ├── eslint.config.js                # Expo ESLint config
│       ├── build-release.sh                # Production APK build script
│       ├── package.json                    # Expo/React Native dependencies
│       ├── package-lock.json
│       └── node_modules/                   # Dependencies (gitignored)
│
├── docker-compose.yml                      # Frontend Nginx deployment config
├── DESCRIPTION.md                           # AI assistant guide (project context)
├── README.md                                # Project overview (Bahasa Indonesia)
├── .gitignore                              # Git ignore rules
├── Note/                                   # Project notes directory
│   └── Next Step.txt
└── .planning/                              # Planning artifacts
    └── codebase/                           # Generated codebase maps
```

## Directory Purposes

### `frontend/`

- **Purpose:** Web dashboard for real-time truck tracking and PTT voice calls
- **Contains:** Single HTML page, monolithic CSS and JS files, Vite build configuration, Nginx Dockerfile
- **Key files:** `index.html` (DOM structure), `style.css` (full visual design), `script.js` (all application logic), `package.json` (Vite 6.0 build tooling), `Dockerfile` (Nginx Alpine deployment)

### `backend/`

- **Purpose:** Stateless WebSocket relay for PTT voice communication routing
- **Contains:** Single Node.js server file, package.json with ws dependency
- **Key files:** `server.js` (WebSocket server on port 8080, client registration, call signaling, binary forwarding, keepalive)

### `mobile/TruckPTT_Expo/`

- **Purpose:** Android tablet app for truck drivers to receive PTT calls and communicate
- **Contains:** Expo Router screens, React Native components, native Android project, build scripts
- **Key files:** `app/index.tsx` (login + main PTT screen), `app/_layout.tsx` (foreground service registration), `app.json` (permissions, cleartext traffic), `eas.json` (EAS Build config), `build-release.sh` (production APK script)

### `mobile/TruckPTT_Expo/app/(tabs)/`

- **Purpose:** Expo starter template tab screens (Home, Explore)
- **Contains:** Expo starter template code - NOT used for PTT functionality
- **Key files:** `_layout.tsx` (tab navigator), `index.tsx` (home screen), `explore.tsx` (explore screen)

### `mobile/TruckPTT_Expo/android/`

- **Purpose:** Prebuilt Android native project for EAS Build
- **Contains:** Gradle build scripts, Android manifest, app source
- **Key files:** `app/build.gradle`, `settings.gradle`, `gradle.properties`

### `mobile/TruckPTT_Expo/builds/`

- **Purpose:** Output directory for production APK files
- **Contains:** Built APK installers for Android tablets
- **Key files:** `TruckPTT_latest.apk` (latest build), timestamped production APKs

### `Note/`

- **Purpose:** Internal project notes (not part of application code)
- **Contains:** Future development planning notes
- **Key files:** `Next Step.txt`

### `.planning/`

- **Purpose:** AI-generated planning and analysis artifacts
- **Contains:** Codebase mapping documents for AI-assisted development
- **Key files:** `codebase/ARCHITECTURE.md`, `codebase/STRUCTURE.md`, `codebase/STACK.md` (and others)

## Key File Locations

**Entry Points:**
- `frontend/index.html`: Web dashboard entry point, served by Nginx on port 8123
- `backend/server.js`: WebSocket relay entry point, listens on port 8080 (exposed as 9090)
- `mobile/TruckPTT_Expo/app/index.tsx`: Mobile app entry point, handles both login and PTT screens
- `mobile/TruckPTT_Expo/app/_layout.tsx`: Expo Router root layout, registers Notifee foreground service

**Configuration:**
- `docker-compose.yml`: Docker deployment config (frontend Nginx container on port 8123)
- `frontend/Dockerfile`: Nginx Alpine build for serving static frontend files
- `frontend/package.json`: Vite build tooling (dev, build, preview scripts)
- `backend/package.json`: Node.js config, ws dependency, start script
- `mobile/TruckPTT_Expo/app.json`: Expo config (Android package `com.pelindo.truckptt`, permissions, plugins, cleartext traffic)
- `mobile/TruckPTT_Expo/eas.json`: EAS Build config (APK builds, internal distribution)
- `mobile/TruckPTT_Expo/tsconfig.json`: TypeScript strict mode with `@/*` path alias
- `mobile/TruckPTT_Expo/eslint.config.js`: Expo ESLint configuration
- `.gitignore`: Ignores `node_modules`, `.DS_Store`, `builds/`, `graphify-out`

**Core Logic:**
- `frontend/script.js`: All frontend logic - map rendering (Leaflet), API fetching (N8N), PTT WebSocket, history modal, navigation mode, speed chart (Chart.js), sidebar management, refresh timer
- `frontend/style.css`: Complete visual design - responsive layout, theme variables, animations, PTT panel, modal, mobile breakpoint
- `backend/server.js`: WebSocket relay - client map, session map, binary forwarding, JSON signaling, keepalive pings
- `mobile/TruckPTT_Expo/app/index.tsx`: All mobile logic - login/auth, WebSocket, audio recording/playback, PTT UI, foreground service, permissions

**Deployment:**
- `frontend/dist/`: Vite build output, served by Nginx Docker container
- `frontend/Dockerfile`: Builds Nginx Alpine image with dist/ contents
- `mobile/TruckPTT_Expo/build-release.sh`: Shell script for production standalone APK builds
- `mobile/TruckPTT_Expo/builds/`: APK output directory

## Naming Conventions

**Files:**
- Frontend: `kebab-case` with descriptive names (`index.html`, `style.css`, `script.js`)
- Backend: `kebab-case` (`server.js`, `package-lock.json`)
- Mobile: Expo Router uses `_layout.tsx` for layouts, `index.tsx` for screens, `kebab-case` for components (`external-link.tsx`, `themed-text.tsx`)

**Directories:**
- Expo Router: parenthesized group directories `(tabs)` for route grouping
- Mobile: `components/`, `hooks/`, `constants/`, `assets/` standard React Native conventions
- Build outputs: `dist/` (frontend), `builds/` (mobile)

**Component Files (Mobile):**
- Components use kebab-case filenames with `.tsx` extension: `themed-text.tsx`, `hello-wave.tsx`, `haptic-tab.tsx`
- Platform-specific files use `.ios.tsx` suffix: `icon-symbol.ios.tsx`

**TypeScript Path Aliases:**
- `@/*` maps to project root: `@/components/themed-text`, `@/hooks/use-color-scheme`, `@/constants/theme`

## Where to Add New Code

**New Frontend Feature:**
- Primary code: `frontend/script.js` (add to the monolithic file OR refactor into new JS modules)
- Styles: `frontend/style.css` (append new CSS rules at the end)
- DOM: `frontend/index.html` (add new HTML elements to the body)
- Tests: Not applicable (no testing setup exists)

**New Frontend Feature (Recommended Modular Pattern):**
- Create `frontend/src/` directory with modular JS files:
  - `frontend/src/api.js` (fetch logic)
  - `frontend/src/map.js` (Leaflet rendering)
  - `frontend/src/ptt.js` (WebSocket PTT)
  - `frontend/src/history.js` (history modal)
  - `frontend/src/navigation.js` (direction mode)
  - `frontend/src/main.js` (orchestrator)
- Update `frontend/index.html` to import `src/main.js` as the entry

**New Backend Feature:**
- Primary code: `backend/server.js` (add new message types to the switch statement)
- Configuration: `backend/package.json` (add new dependencies)

**New Mobile Feature:**
- Primary code: Create new file in `mobile/TruckPTT_Expo/app/` using Expo Router conventions
- Components: `mobile/TruckPTT_Expo/components/` (create new `.tsx` files)
- Hooks: `mobile/TruckPTT_Expo/hooks/` (create new `.ts` files)
- Constants: `mobile/TruckPTT_Expo/constants/`
- Android config: `mobile/TruckPTT_Expo/android/app/src/main/AndroidManifest.xml` (permissions)
- Expo config: `mobile/TruckPTT_Expo/app.json` (permissions, plugins)

**New Mobile Screen (Expo Router):**
- File-based routing: create `mobile/TruckPTT_Expo/app/[screen-name].tsx`
- Tab screens: create in `mobile/TruckPTT_Expo/app/(tabs)/[screen-name].tsx` and add to `(tabs)/_layout.tsx`
- Layout components: use `_layout.tsx` in route directories

**Utilities:**
- Frontend shared helpers: Add functions to `frontend/script.js` (top of file) or create new module files
- Mobile shared helpers: Create `mobile/TruckPTT_Expo/lib/` or `mobile/TruckPTT_Expo/utils/` directory

## Special Directories

### `frontend/dist/`

- Purpose: Vite build output - minified HTML/CSS/JS bundles
- Generated: Yes (via `vite build` command)
- Committed: Yes (served directly by Nginx Docker without Vite at runtime)

### `mobile/TruckPTT_Expo/android/`

- Purpose: Prebuilt Android project for native module access and APK building
- Generated: Yes (via `expo prebuild` or `eas build`)
- Committed: Partially (source files committed, build artifacts in `app/build/` are not)

### `mobile/TruckPTT_Expo/builds/`

- Purpose: Production APK output directory
- Generated: Yes (via `build-release.sh` or EAS Build downloads)
- Committed: Yes (APK files are committed for distribution)

### `mobile/TruckPTT_Expo/.expo/`

- Purpose: Expo development cache and generated types
- Generated: Yes (auto-generated during development)
- Committed: Partially (types directory committed, web cache not)

### `.planning/`

- Purpose: AI-generated planning artifacts for development workflow
- Generated: Yes (via GSD commands)
- Committed: Not yet (to be committed after generating codebase maps)

---

*Structure analysis: 2026-05-15*
