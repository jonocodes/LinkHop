# LinkHop TS — Implementation Checklist

Based on the `LINKHOP_TS.md` spec.

### Core Infrastructure
- [x] Deno + Hono app setup (`src/main.ts`, `src/app.ts`)
- [x] Config from env vars / `.env` (`src/config.ts`)
- [x] Startup validation — refuses to start without `PASSWORD_HASH`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- [x] SQLite database with `devices` + `push_subscriptions` tables (`src/db.ts`)
- [x] TypeScript types (`src/types.ts`)
- [x] Base64url and crypto utilities (`src/utils/`)

### Auth
- [x] Password verification via bcrypt (`src/services/setup.ts`)
- [x] Session login/logout — signed HMAC cookies (`src/middleware/auth.ts`)
- [x] Device token flow — `device_<random>`, SHA256 hash, cookie + Bearer (`src/services/devices.ts`, `src/middleware/auth.ts`)
- [ ] Rate limiting middleware (values written to `.env` but never enforced)

### API Routes
- [x] `GET /api/push/config` — VAPID public key
- [x] `POST /api/push/subscriptions` — save push sub
- [x] `DELETE /api/push/subscriptions` — remove push sub
- [x] `GET /api/device/me` — current device info
- [x] `GET /api/devices` — list active devices
- [x] `POST /api/messages` — send a message
- [x] `POST /api/push/test` — test push
- [x] `POST /api/session/link` — extension bridge token

### Page Routes
- [x] `GET /` — redirect to inbox or login
- [x] `GET/POST /login` — login form
- [x] `GET /logout` — clear session
- [x] `GET /account/inbox` — inbox UI
- [x] `GET /account/send` — send form
- [x] `GET /account/devices` — device list
- [x] `GET /account/activate-device` — register browser
- [ ] `GET /account/bookmarklet` — stub only ("not wired yet")
- [ ] `GET /account/settings` — read-only display, no password change or rate-limit controls
- [x] `GET /hop` — bookmarklet entry point (redirects to send)
- [x] `GET /share` — Web Share Target (redirects to send)
- [x] `GET /healthz` — health check

### Push & Messaging
- [x] Push subscription persistence + CRUD (`src/services/push.ts`)
- [x] VAPID signing + push delivery (via `web-push` npm package)
- [x] Message validation + relay (`src/services/messages.ts`)
- [x] Self-send check (configurable via `ALLOW_SELF_SEND`)
- [ ] Device revocation (schema has `revoked_at` column, no UI/API to revoke)

### Client-Side / PWA
- [x] Service worker — caching, push handler, IndexedDB, notification clicks (`public/service-worker.js`)
- [x] Push subscription manager with auto-sync on page load (`public/push.js`)
- [x] Inbox UI with IndexedDB (`public/inbox.js`)
- [x] Service worker registration (`public/pwa-register.js`)
- [x] Stylesheet (`public/styles.css`)
- [x] PWA manifest (`public/manifest.json`)
- [ ] PWA icons — `"icons": []` is empty

### Docker
- [x] Dockerfile (denoland/deno, layered build)
- [x] docker-compose.yml
- [x] .dockerignore

### Thin backend (SPA migration)

**Strategy**: Keep `/login` server-rendered (works without JS), convert `/account/*` to SPA

#### Phase 1: API additions
- [x] `GET /api/me` — Check session status, return `{ authenticated: true }` or 401
- [x] Update `GET /` route — serve static `index.html` shell instead of redirect

#### Phase 2: Client-side infrastructure  
- [x] Create `public/app.html` — SPA entry point with nav shell
- [x] Create `public/app.js` — Client-side router
  - Handle hash or history-based routing (`#/inbox`, `#/send`, `#/devices`, `#/settings`)
  - Auth guard — redirect to `/login` if session invalid
  - Render appropriate view based on current route
- [x] API calls embedded in app.js — no separate api.js needed

#### Phase 3: Convert pages to client components
- [x] Inbox page (`/account/inbox`)
  - Move render logic from `inbox.js` into router view
  - Fetch device info from `/api/device/me` on load
  - Preserve existing push UI and message list functionality
- [x] Send page (`/account/send`)
  - Convert server-rendered form to client-rendered
  - Fetch device list from `/api/devices` on mount
  - POST to `/api/messages` with fetch
- [x] Devices page (`/account/devices`)
  - Convert server-rendered table to client-rendered
  - Fetch from `/api/devices` on mount
- [x] Settings page (`/account/settings`)
  - Convert read-only display to client-rendered

#### Phase 4: Backend cleanup
- [x] Remove `/account/inbox`, `/account/send`, `/account/devices` HTML routes from pages.ts
- [x] Keep `/account/activate-device` server-rendered (simpler, infrequent use)
- [x] Keep `/account/bookmarklet` server-rendered (no interactivity needed)
- [x] Simplify `src/routes/pages.ts` — only `/login`, `/logout`, `/account/activate-device`, `/account/bookmarklet`
- [x] Serve app.html/app.js from app.ts with static middleware

#### Phase 5: Testing & polish
- [ ] Test auth flow: login → redirect to SPA → logout
- [ ] Test navigation between routes
- [ ] Test direct URL access (e.g., `/account/send` → should serve SPA, client redirects)
- [ ] Verify push notifications still work with new auth flow
- [ ] Update service worker to cache `app.html` and `app.js`

### Not Implemented (from spec)
- [ ] Rate limiting (`src/middleware/rate-limit.ts`)
- [ ] Structured logging / `LOG_LEVEL` config
- [ ] Password change
- [ ] Bookmarklet code generation
- [ ] Alternative storage backends (`db.kv.ts`, `db.d1.ts`)
- [ ] Alternative runtimes (`main.cf.ts`, `main.node.ts`)
- [ ] Browser extension code (separate repo, API endpoint exists)

### Testing
- [x] Test framework set up (Deno built-in test runner)
- [x] Unit tests for `src/utils/crypto.ts`
- [x] Unit tests for `src/utils/base64url.ts`
- [x] Unit tests for `src/services/messages.ts` (validation + self-send)
- [ ] Unit tests for `src/services/devices.ts`
- [ ] Unit tests for `src/services/push.ts` (subscription CRUD, push delivery)
- [ ] Unit tests for `src/config.ts`
- [ ] Unit tests for `src/middleware/auth.ts` (session, device token, requireSession, requireDevice)
- [ ] Integration tests for API routes (`src/routes/api.ts`)
- [ ] Integration tests for page routes (`src/routes/pages.ts`)
- [ ] Database schema migration tests (`src/db.ts`)
- [ ] Service worker tests (`public/service-worker.js`)
- [x] End-to-end tests — full flow: login, device registration, messaging, push delivery, API coverage
