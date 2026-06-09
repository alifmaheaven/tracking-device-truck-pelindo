# Ship Readiness Audit

**Date**: 2026-06-08
**Mode**: Ship Readiness (`/audit ship`)

## Verdict: BLOCK

The current codebase is **NOT READY** for production deployment due to critical security vulnerabilities in the backend configuration. These must be addressed before shipping.

## Blockers (Must fix before deploy)

1. **Critical CORS Misconfiguration (Security - Module 02)**
   - **Path**: `/backend/server.js` (line 34)
   - **Issue**: `app.use(cors({ origin: true, credentials: true }))`. Setting `origin: true` dynamically reflects the `Origin` header of *any* requesting site while `credentials: true` allows cookies to be sent. This completely defeats the Same-Origin Policy, making the application vulnerable to cross-site credentialed requests.
   - **Fix**: Explicitly specify allowed origins in an array (e.g., `origin: ['https://maps-device.pelindo.co.id']`) or use a strict regex.

2. **Weak Default Secrets (Security - Module 02)**
   - **Path**: `/backend/server.js` (line 40)
   - **Issue**: The fallback `cookieSecret` is hardcoded to `'fallback_secret_only_for_dev_2026'`. If `.env` is misconfigured or missing in production, this known secret is used to sign cookies, allowing attackers to forge valid authentication cookies.
   - **Fix**: Remove the fallback or throw a fatal startup error if `process.env.COOKIE_SECRET` is not provided.

3. **Insecure Proxy Validation / Potential SSRF (Security - Module 02)**
   - **Path**: `/backend/server.js` (line 60)
   - **Issue**: The proxy endpoint `/api/proxy/n8n` relies on `new URL(targetUrl).host` and checks against an `allowedHosts` array. While `URL` parsing is somewhat robust, passing unfiltered user input to `fetch(finalUrl)` carries high Server-Side Request Forgery (SSRF) risk. If the allowed host logic can be bypassed or DNS rebinding occurs, internal services are exposed.
   - **Fix**: Instead of allowing the client to pass full URLs, the frontend should only pass an identifier or query parameters, and the backend should strictly construct the target URL internally (`http://pelindo-n8n:5678/webhook/device-cordinate`).

## Caveats (High Priority, Fix soon)

4. **Zero Automated Test Coverage (Testing - Module 06)**
   - **Path**: `/backend/package.json`, `/frontend/package.json`
   - **Issue**: No automated tests exist. The backend test script defaults to `echo "Error: no test specified" && exit 1`.
   - **Fix**: Implement basic unit tests for the proxy endpoint and integration tests for the n8n data fetching loop before the first major post-launch patch.

5. **Disabled Content Security Policy (Security - Module 02)**
   - **Path**: `/backend/server.js` (line 31)
   - **Issue**: `helmet({ contentSecurityPolicy: false })` explicitly turns off CSP to avoid "clashing with frontend scripts". This leaves the application vulnerable to Cross-Site Scripting (XSS).
   - **Fix**: Configure a strict CSP that explicitly allows the required inline scripts or domain assets (like Leaflet map tiles).

## Watch List (Track post-launch)

6. **Missing Healthchecks in Docker (DevOps - Module 12)**
   - **Path**: `docker-compose.yml`
   - **Issue**: The services (`frontend`, `backend`, `n8n`) use `restart: unless-stopped` but lack `healthcheck` directives. Docker won't know if the Node.js app is deadlocked.
   
7. **Client-side Interval Polling vs WebSockets (Performance - Module 09/16)**
   - **Path**: `/frontend/script.js`
   - **Issue**: The frontend initializes a WebSocket (`initPttWebSocket()`) but also runs a 1-second interval (`setInterval(updateRefreshCounter, 1000)`). Ensure there isn't redundant heavy polling if WebSockets disconnect.

---
*Note: Due to the isolated environment (no outbound internet connection), Live Discovery for CVEs and latest dependency versions (Module 08) was skipped. Please run `npm audit` locally once internet access is restored.*