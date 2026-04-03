# LinkHop TS — Single-User TypeScript Rewrite

## Overview

A ground-up rewrite of LinkHop in TypeScript using **Deno** and **Hono**. Single-user, multi-device. Same core functionality — send URLs and text between your own devices via Web Push — but drastically simpler without multi-user Django machinery.

Runs locally with `deno run` or deploys to Cloudflare Workers, Deno Deploy, Fly.io, or any container host.

---

## What changes from the Django version

### Removed

| Django feature | Why it's gone |
|---|---|
| User model / django.contrib.auth | Single user — one password in config |
| Django admin (Unfold) | Replaced by a simple settings page |
| Account site vs Admin site | One UI, one session |
| User registration / password reset | No users to register |
| GlobalSettings model | Config file or env vars |
| Axes (brute-force protection) | Simple rate limit on login |
| Whitenoise / collectstatic | Hono serves static files directly |
| Django ORM / migrations | SQLite via `deno-sqlite` or Deno KV |
| CSRF middleware | Token-based API; simple session check for forms |

### Kept (simplified)

| Feature | Django version | TS version |
|---|---|---|
| Device management | Per-user devices, admin view | Single device table, one UI |
| Device tokens | `device_<base64>` + SHA256 hash | Same scheme |
| Push subscriptions | Model per device | Same, stored in SQLite/KV |
| VAPID signing | pywebpush | Web Crypto API (`crypto.subtle`) |
| Message relay | Validate → push → forget | Same |
| PWA + service worker | Django-served templates | Static files served by Hono |
| Browser extensions | MV2 (Firefox) + MV3 (Chrome) | Same extensions, new server URL |
| Bookmarklet | `/hop` endpoint | Same |
| Web Share Target | `/share` GET handler | Same |
| Rate limiting | DB-backed per-device | In-memory or KV-backed |
| Message log | RotatingFileHandler | Structured log (stdout or file) |
| First-run setup | `/setup/` creates superuser | `/setup/` sets password + generates VAPID keys |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 Hono (Deno)                      │
│                                                  │
│  Static files ──→ /account/*, /manifest.json     │
│  API routes   ──→ /api/*                         │
│  Pages        ──→ /, /setup, /hop, /share        │
│  Auth         ──→ session middleware              │
│                                                  │
│  Storage: SQLite file (devices + push subs)      │
│  Push: Web Crypto VAPID signing → push services  │
│  Config: .env file or environment variables       │
└─────────────────────────────────────────────────┘
```

No message storage. Messages are validated, pushed to Web Push endpoints, and forgotten. The service worker on each device stores received messages in IndexedDB client-side.

---

## Auth

Single password. No usernames, no user table.

### Login flow

1. User submits password to `POST /login`
2. Server compares against hashed password in config
3. Sets a signed session cookie (`linkhop_session`)
4. Session contains: `{ authenticated: true, expires: <timestamp> }`

### Device token flow (same as Django version)

1. Browser visits `/activate-device`
2. Server generates `device_<random>` token, stores SHA256 hash in DB
3. Sets `linkhop_device` cookie (365 days, HttpOnly)
4. API requests use `Authorization: Bearer <token>` header

### Extension flow (same as Django version)

1. Extension opens `/account/inbox/` in a tab
2. Content script receives config via `postMessage` bridge
3. Extension stores token + server URL in `chrome.storage.local`

---

## Data model

Two tables. That's it.

```sql
CREATE TABLE devices (
  id TEXT PRIMARY KEY,          -- UUID
  name TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,     -- SHA256 of device token
  is_active INTEGER DEFAULT 1,
  device_type TEXT DEFAULT 'browser',  -- browser, extension, cli, api
  browser TEXT,
  os TEXT,
  last_seen_at TEXT,
  last_push_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,          -- UUID
  device_id TEXT NOT NULL REFERENCES devices(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth_secret TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  last_success_at TEXT,
  last_failure_at TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

No users table. No settings table (use env vars). No message table (messages aren't stored).

---

## API routes

Same API surface as Django version, minus user-management endpoints.

### Pages (HTML)

| Route | Auth | Purpose |
|---|---|---|
| `GET /` | — | Redirect to `/account/inbox` or `/login` |
| `GET /setup` | — | First-run: set password + auto-generate VAPID keys |
| `GET /login` | — | Login form |
| `POST /login` | — | Submit password |
| `GET /logout` | Session | Clear session |
| `GET /account/inbox` | Session+Device | Inbox (IndexedDB-backed) |
| `GET /account/send` | Session+Device | Send form |
| `GET /account/devices` | Session | Device list with manage controls |
| `GET /account/activate-device` | Session | Register this browser |
| `GET /account/bookmarklet` | Session | Bookmarklet code |
| `GET /account/settings` | Session | Password change, VAPID info, rate limits |
| `GET /hop` | Device cookie | Bookmarklet/shortcut entry point |
| `GET /share` | Device cookie | Web Share Target |

### JSON API

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/push/config` | — | VAPID public key + push capability |
| `POST /api/push/subscriptions` | Device token | Save push subscription |
| `DELETE /api/push/subscriptions` | Device token | Remove push subscription |
| `GET /api/device/me` | Device token | Current device info |
| `GET /api/devices` | Device token | List active devices |
| `POST /api/messages` | Device token | Send a message |
| `POST /api/push/test` | Device token | Send test push |
| `POST /api/session/link` | Session | Get device token for extension |

### Utility

| Route | Purpose |
|---|---|
| `GET /manifest.json` | PWA manifest |
| `GET /service-worker.js` | Service worker |
| `GET /healthz` | Health check |

---

## VAPID signing with Web Crypto

No `pywebpush` dependency. VAPID signing uses the Web Crypto API available in Deno, Cloudflare Workers, and all modern runtimes.

```typescript
async function signVapid(
  endpoint: string,
  vapidPrivateKey: CryptoKey,
  vapidPublicKey: Uint8Array,
  subject: string,
): Promise<{ authorization: string; cryptoKey: string }> {
  const audience = new URL(endpoint).origin;
  const expiry = Math.floor(Date.now() / 1000) + 12 * 3600;

  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud: audience, exp: expiry, sub: subject };

  const unsignedToken =
    base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(payload));

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    vapidPrivateKey,
    new TextEncoder().encode(unsignedToken),
  );

  return {
    authorization: `vapid t=${unsignedToken}.${base64url(signature)}, k=${base64url(vapidPublicKey)}`,
    cryptoKey: "", // included in authorization header for vapid draft-02
  };
}
```

Push message encryption (RFC 8291 / `aes128gcm`) also uses Web Crypto — `crypto.subtle.deriveKey` for ECDH, `crypto.subtle.encrypt` for AES-GCM. This replaces the `py_vapid` + `http_ece` Python libraries entirely.

---

## Project structure

```
linkhop-ts/
  deno.json               # Deno config, tasks, import map
  .env                    # PASSWORD_HASH, VAPID keys, etc.

  src/
    main.ts               # Entry point — Hono app, listen
    routes/
      pages.ts            # HTML page routes (login, inbox, send, etc.)
      api.ts              # JSON API routes
    middleware/
      auth.ts             # Session + device token middleware
      rate-limit.ts       # In-memory rate limiting
    services/
      push.ts             # VAPID signing, RFC 8291 encryption, push delivery
      devices.ts          # Device CRUD, token generation
      messages.ts         # Validate + relay (no storage)
    db.ts                 # SQLite connection + queries
    config.ts             # Env var parsing, defaults

  public/
    index.html            # App shell (if SPA) or redirect
    service-worker.js     # Push handler, IndexedDB, caching
    push.js               # Push subscription registration
    pwa-register.js       # Service worker registration
    inbox.js              # Inbox UI (IndexedDB reads)
    manifest.json         # PWA manifest
    icons/                # App icons

  data/
    linkhop.db            # SQLite database (gitignored)
```

~15 source files. No build step — Deno runs TypeScript directly.

---

## First-run setup

On first launch, there's no password and no VAPID keys. The app detects this and redirects everything to `/setup`.

`GET /setup` renders a form:
1. Choose a password (with confirmation)
2. Click "Set up"

`POST /setup`:
1. Hash password with `argon2` (or bcrypt via Deno std)
2. Generate VAPID key pair via `crypto.subtle.generateKey("ECDSA", ...)`
3. Write both to `.env` file (or persist to a `config` SQLite table)
4. Set session cookie, redirect to `/account/activate-device`

After setup, `/setup` redirects to `/`.

---

## Message flow

Same as Django version:

```
1. Sender picks recipient device from dropdown
2. POST /api/messages { to: "device-id", type: "url", body: "https://..." }
3. Server validates message (type, length, active devices, self-send check)
4. Server looks up recipient's push subscriptions
5. For each subscription:
   a. Encrypt payload with subscription keys (RFC 8291)
   b. Sign VAPID JWT with server's private key
   c. POST to push service endpoint (Mozilla/Google/Apple)
   d. Handle 410 Gone → deactivate subscription
6. Return { sent: N, failed: M }
7. Server logs metadata (sender, recipient, type, timestamp) — never the body
8. Push service delivers to recipient's service worker
9. Service worker stores message in IndexedDB, shows notification
```

No message storage on the server. Ever.

---

## Configuration

All via environment variables (or `.env` file):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PASSWORD_HASH` | Yes (after setup) | — | Argon2/bcrypt hash of login password |
| `VAPID_PUBLIC_KEY` | Yes (after setup) | — | Base64url-encoded VAPID public key |
| `VAPID_PRIVATE_KEY` | Yes (after setup) | — | Base64url-encoded VAPID private key |
| `VAPID_SUBJECT` | No | `mailto:admin@localhost` | VAPID subject claim |
| `PORT` | No | `8000` | Listen port |
| `HOST` | No | `0.0.0.0` | Listen address |
| `DB_PATH` | No | `./data/linkhop.db` | SQLite database path |
| `SESSION_SECRET` | No | Random on first run | Cookie signing key |
| `LOG_LEVEL` | No | `info` | Log verbosity |
| `RATE_LIMIT_SENDS` | No | `30` | Max messages per device per minute |
| `RATE_LIMIT_REGISTRATIONS` | No | `10` | Max device registrations per hour |
| `ALLOW_SELF_SEND` | No | `false` | Allow sending to own device |

Setup auto-generates `PASSWORD_HASH`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `SESSION_SECRET`.

---

## Testing

### API and HTTP (Deno)

In-process tests (no browser):

```bash
cd linkhop-ts
deno task test
```

Covers `GET /healthz`, login, session, device registration, `/api/*` routes, and related flows.

### Browser E2E (Playwright)

Full stack: real Chromium, service worker, inbox UI, and the **Test Push** button. Requires Node, npm, and Deno on `PATH`.

See **[playwright/README.md](playwright/README.md)** for install, commands, and what the test asserts.

---

## Deployment

### Local (Deno)

```bash
# Install Deno (if not already)
curl -fsSL https://deno.land/install.sh | sh

# Clone and run
git clone https://github.com/user/linkhop-ts
cd linkhop-ts
deno task start
# → http://localhost:8000
# → Visit /setup to create password
```

For HTTPS locally (needed for Web Push in some browsers):

```bash
# Option 1: mkcert for local TLS
mkcert -install
mkcert localhost
deno task start --cert localhost.pem --key localhost-key.pem

# Option 2: Caddy reverse proxy (auto-TLS for local dev)
caddy reverse-proxy --from localhost:443 --to localhost:8000
```

### Browser compatibility (Web Push)

The Deno server only signs and POSTs to subscription endpoints returned by the browser. **`pushManager.subscribe()`** and notification permission are entirely **client-side**.

- **Chromium** (Chrome, stock Chromium) normally uses Google’s push infrastructure. **Ungoogled Chromium** and some **custom/embedded** Chromium builds often cannot use that path — you may see registration failures, *push service not available*, or a long-running enable step. Use Firefox, vanilla Chrome/Chromium, or another device to verify receiving.
- Use **`http://127.0.0.1`**, **`http://localhost`**, or **HTTPS** so the page is a **secure context** and the service worker registers reliably.

Broken push on such a browser is **not** fixed by changing VAPID keys or LinkHop environment variables alone.

### Deno Deploy

```bash
# Install deployctl
deno install -Arf jsr:@deno/deployctl

# Deploy
deployctl deploy --project=linkhop src/main.ts

# Set env vars in Deno Deploy dashboard:
#   PASSWORD_HASH, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, SESSION_SECRET
```

Note: Deno Deploy doesn't support SQLite files (no persistent filesystem). Use **Deno KV** instead — swap `db.ts` to use `Deno.openKv()`. The data model maps cleanly to KV:

```typescript
const kv = await Deno.openKv();
// devices: ["devices", deviceId] → Device
// push_subscriptions: ["push_subs", subId] → PushSubscription
// push_subscriptions_by_device: ["push_subs_by_device", deviceId, subId] → true
```

### Cloudflare Workers

```bash
# Install wrangler
npm install -g wrangler

# wrangler.toml
# [vars]
#   PASSWORD_HASH = "..."
#   VAPID_PUBLIC_KEY = "..."
# [[d1_databases]]
#   binding = "DB"
#   database_name = "linkhop"

wrangler deploy
```

Swap SQLite for **D1** (Cloudflare's edge SQLite). Same SQL schema, different driver. Hono has first-class Cloudflare Workers support.

### Fly.io

```dockerfile
FROM denoland/deno:latest
WORKDIR /app
COPY . .
RUN deno cache src/main.ts
EXPOSE 8000
VOLUME /data
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "src/main.ts"]
```

```bash
fly launch
fly secrets set PASSWORD_HASH="..." VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..."
fly deploy
```

Fly supports persistent volumes for the SQLite file.

### Docker (any host)

```dockerfile
FROM denoland/deno:latest
WORKDIR /app
COPY . .
RUN deno cache src/main.ts
EXPOSE 8000
CMD ["deno", "task", "start"]
```

```bash
docker build -t linkhop .
docker run -p 8000:8000 -v linkhop-data:/app/data linkhop
```

Works on any VPS, home server, NAS, Raspberry Pi, etc.

### Platform abstraction

The app uses Hono's adapter pattern. The core logic is platform-agnostic — only the entry point and storage layer change:

```
src/main.ts          → Deno entry (Deno.serve)
src/main.cf.ts       → Cloudflare Workers entry (export default)
src/main.node.ts     → Node entry (serve from @hono/node-server)

src/db.ts            → SQLite (local/Fly/Docker)
src/db.kv.ts         → Deno KV (Deno Deploy)
src/db.d1.ts         → D1 (Cloudflare Workers)
```

A `DB_ADAPTER` env var or build-time flag selects the storage backend. The rest of the codebase (`routes/`, `services/`, `middleware/`) doesn't care.

---

## What stays client-side (unchanged from Django version)

These files transfer directly with little or no modification:

- `service-worker.js` — push handler, IndexedDB storage, caching
- `push.js` — push subscription registration
- `pwa-register.js` — service worker registration
- `inbox.js` — IndexedDB-backed inbox UI
- `manifest.json` — PWA manifest (update `start_url` if needed)
- Browser extensions (MV2 + MV3) — just change the server URL
- Bookmarklet — update server URL

The HTML templates need rewriting (Django template tags → plain HTML or a lightweight template engine like Eta), but the structure and UX stay the same.

---

## Migration from Django version

For existing users moving from the Django version:

1. Export devices: `python manage.py dumpdata core.Device --format=json`
2. Import into SQLite: parse JSON, insert into new schema
3. Push subscriptions will need re-registration (devices visit the new server, re-subscribe)
4. VAPID keys can be reused (copy from Django `.env` to new `.env`) — this preserves existing push subscriptions

If VAPID keys are reused, existing push subscriptions remain valid and devices don't need to re-register their push endpoints.

---

## Dependencies

Minimal:

```json
{
  "imports": {
    "hono": "jsr:@hono/hono",
    "@std/crypto": "jsr:@std/crypto",
    "@std/encoding": "jsr:@std/encoding"
  }
}
```

- **Hono** — HTTP framework (works on Deno, Cloudflare, Node, Bun)
- **@std/crypto** — Deno standard library for hashing (argon2/bcrypt for password)
- **@std/encoding** — Base64url encoding

VAPID signing and push encryption use the built-in `crypto.subtle` API — no external crypto libraries needed. SQLite uses Deno's built-in `Deno.openKv()` or the `deno-sqlite` FFI binding for file-based SQLite.

Total external dependencies: **1** (Hono). Everything else is Deno standard library or Web APIs.

---

## Comparison: Django vs TS

| Aspect | Django version | TS version |
|---|---|---|
| Language | Python | TypeScript |
| Framework | Django + Unfold | Hono |
| Runtime | Python + gunicorn | Deno |
| Database | SQLite (Django ORM) | SQLite (direct) or Deno KV |
| Users | Multi-user | Single user |
| Auth | Django sessions + device tokens | Signed cookies + device tokens |
| Admin UI | Django admin (Unfold) | Simple HTML pages |
| Push library | pywebpush | Web Crypto API (built-in) |
| Static files | Whitenoise | Hono static middleware |
| Dependencies | ~30 Python packages | 1 (Hono) |
| Lines of code (est.) | ~3000 | ~800-1000 |
| Deployment | VPS / Docker | Anywhere JS runs |
| Cold start | N/A (always running) | ~50ms (serverless) |
| Free hosting | Difficult (needs persistent process) | Deno Deploy, Cloudflare Workers |
