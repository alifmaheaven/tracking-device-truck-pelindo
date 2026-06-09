# System Architecture

## 1. System Overview

**Tracking Device Truck Pelindo** is a real-time web-based UI application for tracking the position of truck fleets in the Teluk Lamong Port area. The system visualizes GPS coordinates sent by IoT devices through an n8n webhook pipeline, using Leaflet.js for interactive mapping.

- **Intended Audience**: Internal operations and logistics monitoring at Pelindo (PT Prakhya Tama Cakrawala).
- **Core Workflow**: IoT devices ping coordinates → n8n Webhook processes payload → Backend provides APIs/WS → Frontend visualizes realtime movements on a map.

## 2. Tech Stack

- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6 Modules). Bundled via **Vite**. UI Map powered by **Leaflet.js** (OSM Tiles).
- **Backend**: **Node.js** with **Express.js**. Features WebSocket (`ws`) for potential real-time streaming, `bcrypt` for auth, `helmet` and `express-rate-limit` for security.
- **Database**: **MongoDB** (with `mongo-express` for UI management).
- **Automation / Integration**: **n8n** (Node-based workflow automation) acts as the webhook receiver for IoT devices.
- **Deployment**: Containerized using **Docker Compose** with an Nginx web server layer.

## 3. Top-Level Directory Map

- `/frontend/` — Client-side web application source code (HTML, CSS, JS, Vite config).
- `/backend/` — Server-side Node.js application (Express routes, Auth, WebSockets).
- `/mobile/` — Contains Expo builds/APK for the mobile version (`TruckPTT_Expo`).
- `docker-compose.yml` — Orchestration for Frontend, Backend, MongoDB, and n8n.

## 4. Entry Points

- **Web Frontend**: HTTP entry point on port 80 (routed to Nginx container). Core logic initialized in `/frontend/script.js` and `/frontend/src/map.js`.
- **Backend API**: Node.js server running on port 9090. Entry point at `/backend/server.js`. Auth routes at `/backend/routes/auth.js`.
- **n8n Webhook**: Port 5678. External IoT devices push JSON payloads to `https://n8n.freeat.me/webhook/device-cordinate`.

## 5. Data Flow & Integrations

1. **Ingestion**: Hardware devices ping a predefined n8n webhook endpoint with JSON payloads containing `deviceId`, `serialNumber`, `latitude`, `longitude`, and `lastConnectionDate`.
2. **Persistence**: Stored or buffered via n8n/Backend into MongoDB.
3. **Delivery**: The frontend fetches device data actively (or listens via WebSockets) to plot active vs. idle trucks on the Leaflet map based on timestamp delta.

## 6. Known Limitations

- **Offline / Network dependencies**: Relies on `n8n.freeat.me` endpoint for webhook functionality.
- **Security Boundaries**: Frontend currently performs background fetching without strict authentication visible in the primary JS layer (though Backend has bcrypt/helmet implemented).
