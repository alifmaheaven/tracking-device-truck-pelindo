# Stack-Specific Brief

## Current Stack Identified
- **Frontend**: Vite (esbuild/rollup), Leaflet.js, HTML/JS/CSS (Vanilla ES6).
- **Backend**: Node.js, Express.js.
- **Database**: MongoDB.
- **Integration**: n8n Webhook / Proxy.
- **Orchestration**: Docker Compose (Nginx reverse proxy implied).
- **Target OS/Environment**: Containerized (Linux/Alpine implicitly), deployed on a server with domain routing (Freeat.me, Cloudflare).

## Vendor-Specific Gotchas / Calibration

### 1. n8n (Workflow Automation)
- **SSRF Risks via Proxy**: The backend operates a proxy to bypass frontend CORS constraints (`/api/proxy/n8n`). It enforces URL host checks (`allowedHosts`) and rewrites external domains (`n8n-teluk-lamong.freeat.me`) to internal Docker network names (`pelindo-n8n:5678`). Any deviation in this rewrite logic opens SSRF attack vectors.
- **Payload Schema**: Code expects n8n to respond with arrays. Error handling here is rudimentary and could crash the proxy if n8n returns an HTML error page.

### 2. Vite (Frontend Tooling)
- **Env Variables**: Since it's Vanilla JS, `import.meta.env` shouldn't leak secret keys to the browser, but ensure no backend secrets (e.g., MongoDB credentials) are prefixed with `VITE_` in `.env`.
- **Production Builds**: `vite build` will bundle everything. Check if large libraries like Leaflet are properly tree-shaken or externalized, though Vanilla JS usage often imports them directly via CDN or static assets.

### 3. Express.js + WebSocket
- **Rate Limiting**: `express-rate-limit` is installed. Check if limits apply globally or per-route, especially for `/api/captcha` and `/api/auth`.
- **WebSocket Upgrade**: Ensure Nginx/Cloudflare configuration correctly proxies `Upgrade` headers for `/ws` to prevent socket dropouts.
- **Cookie Security**: `cookie-parser` relies on `COOKIE_SECRET`. SameSite is set to `none` with `secure: true`, which is required for cross-site framing (e.g., if UI is embedded), but means HTTPS is strictly mandated everywhere.

### 4. MongoDB
- **mongo-express**: Exposed on `127.0.0.1:8081` in `docker-compose.yml`. Good that it bounds to localhost, but verify if production servers have local access controls to prevent port forwarding exposures.
