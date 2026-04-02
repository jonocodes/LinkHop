# LinkHop Lite — Serverless Architecture with ntfy/UnifiedPush

## Overview

LinkHop Lite is a zero-backend version of LinkHop that uses **ntfy.sh** (or any UnifiedPush-compatible server) as the message relay. The entire app is static files — no server, no database, no VAPID key management. All state lives client-side in IndexedDB, synced between devices via ntfy topics.

ntfy.sh is free, open source (Go binary), and implements the UnifiedPush spec. It can be used as a hosted service at ntfy.sh or self-hosted.

---

## Architecture

```
┌──────────┐     POST to ntfy topic     ┌──────────┐
│ Device A │ ──────────────────────────→ │ ntfy.sh  │
│ (sender) │                             │ (relay)  │
└──────────┘                             └────┬─────┘
                                              │
                              ┌───────────────┼───────────────┐
                              ↓               ↓               ↓
                         ┌─────────┐    ┌─────────┐    ┌─────────┐
                         │Device B │    │Device C │    │Device D │
                         │(Web Push│    │(SSE/WS) │    │(polling)│
                         └─────────┘    └─────────┘    └─────────┘
```

There is no LinkHop server. ntfy.sh is the only server component. The app is served as static files from any host (GitHub Pages, Cloudflare Pages, local file server, etc.).

---

## Core Concepts

### Topics

ntfy uses **topics** — named channels that anyone can publish to or subscribe to. A topic URL looks like `https://ntfy.sh/my-topic-name`. Knowing the topic name is equivalent to having access.

LinkHop Lite uses two types of topics:

1. **Registry topic** — shared by all devices, used to sync the device list
2. **Device topics** — one per device, used to receive messages

### Authentication

Single-user system. One password protects the entire network.

The password is never stored directly. It derives two things:

```
password + "linkhop-registry" → SHA-256 → registry topic name
password + "linkhop-encrypt"  → SHA-256 → AES-GCM encryption key
```

The registry topic name acts as a shared secret — only someone who knows the password can derive it. The encryption key provides E2E encryption so ntfy.sh cannot read message contents.

### Encryption

All messages (both registry updates and device-to-device messages) are encrypted client-side with AES-GCM before being sent to ntfy. ntfy.sh only sees opaque ciphertext.

```
Sender: JSON payload → AES-GCM encrypt with shared key → POST to ntfy
Receiver: ntfy delivers ciphertext → AES-GCM decrypt → JSON payload
```

This gives E2E encryption for free. The shared key is derived from the password, which all devices know.

---

## Device Registration Flow

### First device (initial setup)

```
1. User opens the app, enters a password
2. App derives:
   - registry_topic = sha256(password + "linkhop-registry")  // e.g. "lh_a8f3c9..."
   - encryption_key = sha256(password + "linkhop-encrypt")
3. App subscribes to ntfy Web Push for a new random device topic
   - ntfy assigns endpoint: https://ntfy.sh/up_<random>
4. App publishes encrypted message to registry topic:
   { action: "join", name: "Laptop", endpoint: "https://ntfy.sh/up_xyz" }
5. App stores in IndexedDB:
   - password hash (for session validation)
   - encryption key
   - registry topic name
   - own device info
   - device list: [{ name: "Laptop", endpoint: "https://ntfy.sh/up_xyz" }]
```

### Additional devices

```
1. User opens app on new device, enters same password
2. App derives same registry_topic and encryption_key
3. App fetches cached messages from registry topic:
   GET https://ntfy.sh/<registry_topic>/json?poll=1&since=all
4. Decrypts cached messages → learns about existing devices
5. Subscribes to own new device topic via ntfy Web Push
6. Publishes encrypted join message to registry topic:
   { action: "join", name: "Phone", endpoint: "https://ntfy.sh/up_abc" }
7. All other devices receive the update in real-time and update their lists
```

### Device list sync

The registry topic serves as an event log. Messages are:

```json
{ "action": "join", "name": "Laptop", "endpoint": "https://ntfy.sh/up_xyz", "ts": 1712000000 }
{ "action": "join", "name": "Phone", "endpoint": "https://ntfy.sh/up_abc", "ts": 1712001000 }
{ "action": "rename", "old_name": "Phone", "name": "Phone Firefox", "endpoint": "https://ntfy.sh/up_abc", "ts": 1712002000 }
{ "action": "leave", "name": "Phone Firefox", "ts": 1712003000 }
```

Each device replays these events to build the current device list.

**Cache expiry:** ntfy.sh caches messages for 12 hours by default. If all devices are offline for >12 hours, the registry events expire. To handle this:

- Each device persists the full device list in IndexedDB (it's the source of truth, not the cache)
- On reconnect, a device publishes `{ action: "sync_request" }` to the registry topic
- Any online device responds with `{ action: "sync_response", devices: [...] }`
- As a protocol convention, each device re-publishes its own `join` message on app open to keep the cache warm

---

## Message Sending Flow

```
1. User picks recipient "Phone" from local device list
2. App looks up Phone's endpoint: https://ntfy.sh/up_abc
3. App encrypts the message payload:
   {
     id: "<uuid>",
     type: "url",
     body: "https://example.com/article",
     sender: "Laptop",
     created_at: "2026-04-02T12:00:00Z"
   }
4. POST https://ntfy.sh/up_abc
   Body: <encrypted ciphertext>
5. ntfy delivers to Phone via Web Push (or SSE/WS if app is open)
6. Phone's service worker decrypts, stores in IndexedDB, shows notification
```

---

## Delivery Mechanisms

### PWA (main web app)

Two delivery paths:

| App state | Mechanism | Latency |
|---|---|---|
| **Open/foreground** | EventSource (SSE) to ntfy topic | Instant |
| **Closed/background** | Web Push via ntfy | Instant (wakes service worker) |

The service worker registers a Web Push subscription with ntfy:

```js
const subscription = await self.registration.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: NTFY_WEB_PUSH_PUBLIC_KEY,
});

await fetch(`https://ntfy.sh/${deviceTopic}/web-push/subscribe`, {
  method: "POST",
  body: JSON.stringify(subscription),
});
```

ntfy manages the VAPID keys and push delivery. The app never touches VAPID.

### Chrome extension (MV3)

MV3 service workers are not persistent (killed after ~30 seconds idle). Two options:

**Option A: Web Push (recommended)** — Same as PWA. Register a push subscription with ntfy. The browser wakes the service worker on push events.

```js
// background.js (service worker)
self.addEventListener("push", (event) => {
  const data = decrypt(event.data.text(), encryptionKey);
  const msg = JSON.parse(data);
  chrome.notifications.create({ type: "basic", title: `From ${msg.sender}`, message: msg.body });
  // Store in IndexedDB
});
```

**Option B: Polling fallback** — Use `chrome.alarms` to poll every 1 minute:

```js
chrome.alarms.create("poll", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => {
  fetch(`https://ntfy.sh/${deviceTopic}/json?poll=1&since=2m`)
    .then(r => r.text())
    .then(lines => { /* process messages */ });
});
```

Option A is preferred — instant delivery, same mechanism as current implementation.

### Firefox extension (MV2)

MV2 allows persistent background pages. Use a WebSocket for real-time delivery:

```js
const ws = new WebSocket(`wss://ntfy.sh/${deviceTopic}/ws`);
ws.onmessage = (e) => {
  const data = decrypt(JSON.parse(e.data).message, encryptionKey);
  // Show notification, store in IndexedDB
};
```

---

## Data Model

### IndexedDB stores (per device)

**`config`** — Single record

```json
{
  "passwordHash": "<bcrypt or argon2 hash>",
  "registryTopic": "lh_a8f3c9...",
  "encryptionKey": "<derived AES key>",
  "deviceName": "Laptop",
  "deviceTopic": "up_xyz123"
}
```

**`devices`** — One record per known device

```json
{ "name": "Laptop", "endpoint": "https://ntfy.sh/up_xyz123", "joinedAt": "2026-04-02T..." }
{ "name": "Phone", "endpoint": "https://ntfy.sh/up_abc456", "joinedAt": "2026-04-02T..." }
```

**`messages`** — Same as current LinkHop

```json
{
  "id": "<uuid>",
  "type": "url",
  "body": "https://example.com",
  "sender": "Laptop",
  "direction": "incoming",
  "created_at": "2026-04-02T...",
  "read": false
}
```

### No server-side storage

ntfy.sh stores messages temporarily in its cache (12 hours by default). This is ephemeral and only used for offline catch-up. The persistent source of truth for device list and messages is always the client-side IndexedDB.

---

## UI Pages

The entire UI is static HTML + JS. Four views (could be tabs in a single page):

### 1. Login / Setup

- Password field
- On submit: derive registry topic + encryption key, subscribe, fetch device list
- First-time: also prompts for device name
- If device already set up (config exists in IndexedDB), auto-login

### 2. Send

- Device picker (from local device list)
- Type selector (URL / text)
- Message body input
- Submit → encrypt → POST to recipient's ntfy topic

### 3. Inbox

- Same as current: reads from IndexedDB, renders message list
- Service worker stores incoming messages, notifies page to re-render
- Filter: all / incoming / sent

### 4. Devices

- List of known devices (from IndexedDB)
- Register new device (different flow — this is for viewing, not registering from here)
- Remove device (publishes `leave` to registry, removes from local list)
- Rename device (publishes `rename` to registry)
- Current device indicator

---

## File Structure

```
linkhop-lite/
  index.html              # Main app shell (all views)
  app.js                  # UI logic, routing between views
  crypto.js               # Key derivation, AES-GCM encrypt/decrypt
  ntfy.js                 # ntfy API wrapper (publish, subscribe, Web Push registration)
  devices.js              # Device list management, registry sync
  db.js                   # IndexedDB wrapper (config, devices, messages)
  service-worker.js       # Push handler, message storage, notification display
  style.css               # Styling
  manifest.json           # PWA manifest
```

No build step required. Plain JS modules (or a single bundled file). Can be served from any static host or opened directly from the filesystem.

---

## Comparison with Django Version

| Aspect | Django version | Lite version |
|---|---|---|
| Server | Django + SQLite + pywebpush | None (static files only) |
| Push relay | Your server → VAPID → push service | ntfy.sh → push service |
| VAPID keys | You generate and manage | ntfy handles it |
| Database | SQLite on server | IndexedDB per device |
| Device list | Server-side DB | Client-side, synced via registry topic |
| Auth | Django sessions + device tokens | Password → derived topics + encryption |
| E2E encryption | Not implemented | Built-in (AES-GCM, derived from password) |
| Admin panel | Unfold admin UI | Simple settings page |
| Multi-user | Yes (accounts, owners) | No (single user) |
| Message log | Server-side file log | Per-device IndexedDB only |
| Hosting cost | $0-5/mo (VPS) | $0 (static hosting) |
| Self-host relay | N/A | Optional (ntfy is a single Go binary) |
| Privacy | You control everything | ntfy sees ciphertext only (if encrypted) |
| Offline tolerance | Web Push caches briefly | ntfy caches 12h + IndexedDB persistent |

---

## ntfy API Reference (relevant subset)

### Publish a message

```
POST https://ntfy.sh/<topic>
Content-Type: application/json

{ "message": "<encrypted payload>" }
```

### Subscribe (SSE)

```
GET https://ntfy.sh/<topic>/sse
→ Server-sent events stream
```

### Subscribe (WebSocket)

```
WS wss://ntfy.sh/<topic>/ws
→ WebSocket stream
```

### Poll for cached messages

```
GET https://ntfy.sh/<topic>/json?poll=1&since=all
→ One JSON object per line (NDJSON)
```

### Register Web Push subscription

```
POST https://ntfy.sh/<topic>/web-push/subscribe
Content-Type: application/json

{
  "endpoint": "https://fcm.googleapis.com/...",
  "keys": { "p256dh": "...", "auth": "..." }
}
```

### ntfy self-hosting

```bash
# Install
go install iot.eclipse.org/packages/ntfy@latest
# Or download binary from https://ntfy.sh/docs/install/

# Run with custom cache duration
ntfy serve --cache-duration=168h  # 7 days
```

---

## Open Questions / Decisions

1. **Password change** — Changing the password changes the registry topic and encryption key. All devices would need to re-join. Could support this by publishing a "migration" message to the old registry topic before switching.

2. **Device limit** — ntfy.sh free tier has no explicit device limit, but Web Push subscriptions per topic may have practical limits. Unlikely to matter for single user with <10 devices.

3. **Message size** — ntfy limits messages to 4096 bytes by default (configurable if self-hosted). Encrypted payloads add ~50% overhead from base64. Max plaintext body would be ~2700 characters. Current LinkHop text limit is 3500 — may need to reduce, or split large messages.

4. **Rate limiting** — ntfy.sh free tier allows 250 messages/day per IP. Sufficient for personal use but worth noting.

5. **Attachments** — ntfy supports file attachments (up to 15MB on free tier). Could enable sending images/files in the future.

6. **Multiple ntfy servers** — The app could allow configuring a custom ntfy server URL, defaulting to ntfy.sh. This supports both hosted and self-hosted setups with no code changes.

7. **Bookmarklet / share target** — The bookmarklet currently opens `/hop?type=url&body=...` which hits the server. In the lite version, the bookmarklet would open the app's send page directly (static HTML) with query params. Share target (PWA) would work the same way.

8. **Browser extension linking** — Currently the extension reads the device token from the page. In the lite version, the extension would need the encryption key and device topic. Could share via the same page-to-extension postMessage mechanism, passing the config from IndexedDB.
