# LinkHop TS — Implementation Checklist

Based on the `LINKHOP_TS.md` spec.

### Core Infrastructure
- [x] Deno + Hono app setup (`src/main.ts`, `src/app.ts`)
- [x] Config from env vars / `.env` (`src/config.ts`)
- [x] SQLite database with `devices` + `push_subscriptions` tables (`src/db.ts`)
- [x] TypeScript types (`src/types.ts`)
- [x] Base64url and crypto utilities (`src/utils/`)

### Auth
- [x] First-run setup — password + VAPID key generation (`src/services/setup.ts`)
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
- [x] `GET/POST /setup` — first-run setup
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
- [x] Push subscription manager (`public/push.js`)
- [x] Inbox UI with IndexedDB (`public/inbox.js`)
- [x] Service worker registration (`public/pwa-register.js`)
- [x] Stylesheet (`public/styles.css`)
- [x] PWA manifest (`public/manifest.json`)
- [ ] PWA icons — `"icons": []` is empty

### Thin backend
- [ ] make into a spa with client side template rendering
- [ ] reduce the backend to API calls

### Not Implemented (from spec)
- [ ] Rate limiting (`src/middleware/rate-limit.ts`)
- [ ] Structured logging / `LOG_LEVEL` config
- [ ] Password change
- [ ] Bookmarklet code generation
- [ ] Alternative storage backends (`db.kv.ts`, `db.d1.ts`)
- [ ] Alternative runtimes (`main.cf.ts`, `main.node.ts`)
- [ ] Browser extension code (separate repo, API endpoint exists)

### Testing
- [ ] Test framework set up (e.g. Deno built-in test runner)
- [ ] Unit tests for `src/config.ts`
- [ ] Unit tests for `src/services/devices.ts`
- [ ] Unit tests for `src/services/messages.ts` (validation + relay)
- [ ] Unit tests for `src/services/push.ts` (subscription CRUD, push delivery)
- [ ] Unit tests for `src/services/setup.ts` (password hashing, VAPID key generation)
- [ ] Unit tests for `src/utils/crypto.ts`
- [ ] Unit tests for `src/utils/base64url.ts`
- [ ] Unit tests for `src/middleware/auth.ts` (session, device token, requireSession, requireDevice)
- [ ] Integration tests for API routes (`src/routes/api.ts`)
- [ ] Integration tests for page routes (`src/routes/pages.ts`)
- [ ] Database schema migration tests (`src/db.ts`)
- [ ] Service worker tests (`public/service-worker.js`)
- [ ] End-to-end tests (login → activate device → send message → receive push)
