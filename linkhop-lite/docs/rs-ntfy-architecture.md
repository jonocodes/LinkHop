# RemoteStorage + ntfy Architecture Plan

## Overview

Two-layer architecture:

- **RemoteStorage (RS)** — source of truth for all persistent state: devices, messages, settings. Required.
- **ntfy** — real-time event delivery and VAPID push wakeup for mobile PWA background notifications. Required.

Both are required. Neither is optional.

---

## Network Identity

The network is identified by the user's RS account, not a passphrase.

```
RS user:        alice@5apps.com
network_id:     hmac-sha256(rs_user, network_secret)   ← used for ntfy topic derivation
network_secret: random 32-byte value, generated on first device setup, stored in RS settings
```

### First device setup

1. User enters RS handle (`alice@5apps.com`) and completes OAuth
2. App checks RS settings for an existing `network_secret`
3. If none found: generate a random `network_secret`, write to RS settings
4. Derive `network_id` from `hmac(rs_user, network_secret)`
5. ntfy topics are derived from `network_id` as before

### Subsequent devices

1. User enters RS handle on the new device and completes OAuth
2. App reads `network_secret` from RS settings (already there)
3. Derives same `network_id` → same ntfy topics → joins the network automatically

No credentials need to be shared between devices. RS access is the trust boundary.

### RS provider change

If the user connects a different RS account, the `network_id` will change — they are effectively starting a new network. The app detects this on startup and shows a clear warning before proceeding. No import or export of old data.

---

## Encryption (optional)

Encryption is opt-in per network. When enabled, message bodies are encrypted before being written to RS or sent via ntfy.

```
encryption_key: derived from network_secret via PBKDF2
```

Stored as a flag in RS settings (`encryption_enabled: true/false`). All devices on the network share the same encryption state. Either all messages are encrypted or none are.

The RS server operator and ntfy can see message metadata (timestamps, device IDs, topics) regardless of encryption. Only message body content is encrypted.

---

## Layer Responsibilities

### ntfy carries exactly three event types

| Event | Why ntfy |
|---|---|
| `device.announce` | Online peers see new device instantly via SSE |
| `device.leave` | Online peers remove device from UI instantly |
| `msg.send` | Full payload for real-time delivery + VAPID wakeup on mobile |

### RemoteStorage owns all persistent state

| Data | RS path | Notes |
|---|---|---|
| Network settings | `/linkhop/settings` | `network_secret`, `encryption_enabled`, `poll_interval_seconds`, `message_cull_days` |
| Device records | `/linkhop/{network_id}/devices/{device_id}` | Written on announce, updated on leave |
| Message records | `/linkhop/{network_id}/messages/{msg_id}` | Written on send, state updated on receive/view |

### Eliminated entirely

| Removed | Replaced by |
|---|---|
| `device.heartbeat` | Not needed — RS `last_seen` updated on announce |
| `sync.request` / `sync.response` | Not needed — just read RS on startup |
| `msg.received` ntfy ACK | RS `MessageRecord.state` field update |
| Shared network passphrase | RS user identity + `network_secret` in RS settings |

---

## RS Settings Document

Stored at `/linkhop/settings` (not scoped by `network_id` — needed to bootstrap it).

```json
{
  "network_secret": "base64-encoded-32-bytes",
  "encryption_enabled": false,
  "poll_interval_seconds": 600,
  "message_cull_days": 30
}
```

Generated once by the first device. Read by all subsequent devices after OAuth. Any device can update `poll_interval_seconds` and `message_cull_days`; all others pick it up on next RS sync.

---

## Event Flows

### Device joins

1. Device completes RS OAuth and derives `network_id`
2. Device writes `DeviceRecord` to RS
3. Device POSTs `device.announce` to ntfy registry topic
4. Online peers receive via SSE → update local device list immediately
5. Devices coming online later read RS directly → find all devices

### Device leaves

1. Device updates RS `DeviceRecord` with `is_removed: true`
2. Device POSTs `device.leave` to ntfy registry topic
3. Online peers receive via SSE → remove device from UI immediately

### Sending a message (A → B)

1. A writes `MessageRecord` to RS (`state: "pending"`, body encrypted if enabled)
2. A POSTs full `msg.send` event to B's ntfy device topic (body encrypted if enabled)
3. ntfy delivers VAPID push to B's browser/SW (even on locked phone)
4. B's SW receives push with full message payload — shows notification immediately, no RS fetch needed
5. B's SW writes `state: "received"` to RS (see SW auth note below)
6. A sees receipt on next RS poll (adaptive: one-shot at +20s, then back to standard interval)

### Message deduplication

If B receives the same message via both ntfy SSE (tab open) and RS poll:
- Check `messages.get(msg_id)` before processing
- If already present, skip — first delivery wins

### Marking a message viewed

1. User opens message in app
2. App updates RS `MessageRecord.state` to `"viewed"` and sets `viewed_at`
3. No ntfy event sent

---

## Service Worker RS Access

The service worker (SW) runs in a separate context and cannot use the remotestorage.js library. When a VAPID push wakes the SW on a locked phone, the SW needs to write `state: "received"` to RS via a plain HTTP PUT request.

The app stores the RS bearer token and server URL in a small IndexedDB store whenever it receives or refreshes an RS token. The SW reads from this store when handling push events. This is an internal implementation detail.

---

## Polling Strategy

### Standard poll

Interval read from RS settings (default 600s / 10 minutes).

Reads on each poll:
- All device records (detect new/removed devices that arrived while offline)
- All messages (catch any missed while ntfy window expired or push failed)

### Adaptive poll (after sending)

When this device sends a message, schedule a one-shot faster poll to catch the delivery receipt:

```
send → +20s poll → back to standard interval
```

Checks if `MessageRecord.state` has moved from `"pending"` to `"received"`.

---

## Message Culling

Run on every RS message write:
- Delete messages where `created_at` is older than `message_cull_days` (default 30)
- Culling is done by the writing device; all devices observe deletions via RS sync

---

## DeviceConfig Schema

```typescript
interface DeviceConfig {
  device_id: string;
  device_name: string;
  network_id: string;   // derived: hmac(rs_user, network_secret)
  rs_user: string;      // e.g. "alice@5apps.com" — set after OAuth
  env: string;
}
```

RS credentials (bearer token, server URL) are managed by the remotestorage.js library and stored separately — not part of `DeviceConfig`. The SW reads them from a dedicated IDB key.

---

## Mobile PWA Background Coverage

| Scenario | Mechanism |
|---|---|
| Tab open, in foreground | ntfy SSE (real-time) + RS change listener |
| Tab open, browser backgrounded | ntfy SSE still alive |
| PWA installed, app closed | ntfy VAPID push → SW shows notification, writes receipt to RS via HTTP |
| Phone locked | ntfy VAPID push → SW wakes, shows notification |
| Offline < 12h, then reconnects | ntfy delivers retained wake, RS has full content |
| Offline > 12h, then reconnects | ntfy wake expired — app startup reads RS, catches all missed messages |
| Sender goes offline mid-send | Background Sync API queues RS write + ntfy POST for when connectivity returns |
| ntfy temporarily unreachable | Message still in RS; receiver sees it on next 10 min poll |

iOS 16.4+ requires the PWA to be added to the home screen for VAPID push to work. Android works with any installed PWA with notification permission granted.

---

## Implementation Checklist

### Dependencies

- [ ] Add `remotestoragejs` to `package.json`

### Network identity (`src/protocol/network.ts`)

- [ ] Replace passphrase-based `network_id` derivation with `hmac(rs_user, network_secret)`
- [ ] Add `generateNetworkSecret()` — random 32-byte base64 value

### RS module (`web/src/rs.ts`) — new file

- [ ] RS connect/OAuth flow using remotestorage.js widget
- [ ] On connect: check for existing `network_secret` in settings; generate and write if absent
- [ ] `getSettings()` / `saveSettings()` with defaults fallback
- [ ] `getDevice(deviceId)` / `upsertDevice(record)` / `markDeviceRemoved(deviceId)`
- [ ] `listDevices()` — returns all non-removed device records
- [ ] `getMessage(msgId)` / `upsertMessage(record)`
- [ ] `listMessages()` — returns all messages within cull window
- [ ] `cullMessages(cull_days)` — deletes messages older than `cull_days`, called on each write
- [ ] `onChange(callback)` — RS change listener for real-time updates when tab open
- [ ] On RS token issue/refresh: write RS bearer token + server URL to dedicated IDB key for SW use

### SW RS client (`web/src/rs-sw.ts`) — new file

- [ ] `swReadRSToken()` — reads RS bearer token and base URL from IDB
- [ ] `swPutMessage(record)` — raw HTTP PUT to RS API with bearer token (for SW context only)

### Encryption (`src/protocol/crypto.ts`)

- [ ] Add `deriveEncryptionKey(network_secret)` via PBKDF2
- [ ] Make encrypt/decrypt functions accept the derived key
- [ ] Only encrypt/decrypt message body — not metadata

### Protocol types (`src/protocol/types.ts`)

- [ ] Remove `DeviceHeartbeatPayload` and `DeviceHeartbeatEvent`
- [ ] Remove `SyncRequestPayload`, `SyncResponsePayload`, `SyncRequestEvent`, `SyncResponseEvent`
- [ ] Remove `"device.heartbeat"`, `"sync.request"`, `"sync.response"` from `EventType`
- [ ] Replace `network_id` + passphrase in `DeviceConfig` with `rs_user` + derived `network_id`

### Actions (`src/engine/actions.ts`)

- [ ] `actionAnnounce` — write to RS + publish ntfy `device.announce`
- [ ] `actionLeave` — write to RS + publish ntfy `device.leave`
- [ ] Remove `actionHeartbeat`
- [ ] Remove `actionSyncRequest`
- [ ] `actionSend` — encrypt body if enabled, write to RS, publish ntfy `msg.send`
- [ ] `actionMarkViewed` — update RS `MessageRecord.state` to `"viewed"`

### Reducer (`src/engine/reducer.ts`)

- [ ] Remove `device.heartbeat` case
- [ ] Remove `sync.request` / `sync.response` cases
- [ ] Add dedup guard: skip `msg.send` if `msg_id` already in state
- [ ] Decrypt message body on receive if encryption enabled

### App startup (`web/src/app.ts`)

- [ ] On startup: connect RS (trigger OAuth if no token), read settings, derive `network_id`
- [ ] Detect RS user change: if `rs_user` differs from stored value, warn user before continuing
- [ ] Read all devices and messages from RS before subscribing to ntfy SSE
- [ ] Subscribe to ntfy registry topic for `device.announce` and `device.leave`
- [ ] Subscribe to own ntfy device topic for incoming `msg.send`
- [ ] Wire RS `onChange` listener to update state while tab open
- [ ] Implement standard poll loop (interval from RS settings, default 600s)
- [ ] Implement adaptive poll: one-shot +20s poll after sending a message

### Service worker (`web/src/sw.ts`)

- [ ] On `push` event: extract full `msg.send` payload from ntfy push
- [ ] Decrypt message body if encryption enabled (read key from IDB)
- [ ] Write received message to RS via `swPutMessage()` (`state: "received"`)
- [ ] Show notification with message content immediately
- [ ] On `sync` event (Background Sync): retry pending RS write + ntfy POST for queued outbound messages

### Local persistence (`web/src/db.ts`)

- [ ] Remove `devices` and `messages` IDB stores — RS is now the store
- [ ] Keep `config` store for `DeviceConfig` (including `rs_user`, `network_id`)
- [ ] Add `rs_token` IDB store: `{ url: string, token: string }` — written by app, read by SW
- [ ] Keep or remove `eventLog` store (debug use only)

### Settings UI

- [ ] RS connect screen: remotestorage.js OAuth widget
- [ ] Show RS connection status and connected RS user
- [ ] Warn prominently if RS user changes from previously stored value
- [ ] Expose `poll_interval_seconds` and `message_cull_days` as editable fields
- [ ] Expose `encryption_enabled` toggle (warn that changing affects all devices on the network)

### Cleanup

- [ ] Remove `src/cli/` — out of scope
- [ ] Remove `src/engine/relay.ts`
- [ ] Remove `src/relay/core.ts` `RelayStore` interface
- [ ] Remove Cloudflare Workers relay (`workers/`)
- [ ] Remove Supabase relay (`supabase/`)
- [ ] Remove passphrase-based `network_id` derivation from `src/protocol/network.ts`
- [ ] Remove `actionHeartbeat` and all call sites
