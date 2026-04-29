# RemoteStorage + ntfy Architecture

## Overview

Two-layer architecture:

- **RemoteStorage (RS)** — source of truth for all persistent state: devices, messages, settings. Required.
- **ntfy** — real-time event delivery and VAPID push wakeup for mobile PWA background notifications. Required.

Both layers are required. RS is the durable store; ntfy is the fast path. If ntfy is unavailable, messages are never lost — they're in RS and will be picked up on the next poll.

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
5. ntfy topics are derived from `network_id`

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
encryption_key: derived from network_secret via HKDF-SHA256
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
5. B's SW writes `state: "received"` to RS via raw HTTP PUT (see SW auth note below)
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

## Background Delivery

Background delivery is the most important correctness requirement for a mobile messaging app. Three independent mechanisms stack on each other so the failure of any one still delivers the message.

### Path 1 — ntfy VAPID push (real-time)

The primary path. When the sender publishes `msg.send` to ntfy, ntfy delivers a Web Push (VAPID) notification to the recipient's browser/SW even if the screen is locked and the tab is closed.

- SW `push` event fires with full `msg.send` payload embedded in the push data
- SW builds `MessageRecord`, writes it to RS via raw HTTP PUT using bearer token from IDB
- SW calls `showNotification()` immediately — no RS fetch needed
- SW records the `msg_id` in a local notified-ID set (IDB) to prevent duplicate notifications from the other paths

**Requires:** ntfy server running + VAPID keys configured, notification permission granted.

### Path 2 — Background Sync on reconnect

When the device was offline and its network connection restores, the browser fires the `sync` event to the SW. The SW calls `swFetchNewMessages()`:

1. Read RS bearer token + `{networkId, deviceId}` from IDB
2. `GET /linkhop/{networkId}/messages/` → directory listing of all message IDs
3. Filter out IDs already in the local notified set
4. Fetch each remaining message record individually
5. Show a notification for any message addressed to this device with `state !== "viewed"`
6. Add all fetched IDs to the notified set

**Requires:** RS reachable when sync fires. Fires automatically on reconnect — no user action needed.

### Path 3 — Periodic Background Sync (scheduled)

For installed PWAs on Chrome Android, the browser fires `periodicsync` on a schedule. The SW performs the same `swFetchNewMessages()` poll as Path 2.

Registered with `minInterval = poll_interval_seconds` (default 600s / 10 min). The browser may fire it less frequently for low-engagement apps, but it provides a guaranteed floor independent of ntfy.

**Requires:** PWA installed to home screen, Chrome Android, notification permission granted.

### What happens when ntfy goes down

| ntfy state | Delivery path |
|---|---|
| ntfy up | Path 1 (real-time push), dedup prevents 2/3 from duplicating |
| ntfy down | Paths 2 and 3 still deliver via RS poll |
| ntfy down, device offline | Message sits in RS; Path 2 fires when connectivity returns |
| ntfy message > 12h old | ntfy purges retained message; RS still has it; Paths 2/3 deliver |

The key invariant: the sender always writes to RS first. Even if ntfy publish fails immediately after, the message is durably stored and will be found by the next poll.

### Platform support

| Platform | Push support | Periodic sync | Notes |
|---|---|---|---|
| Android Chrome (installed PWA) | Yes | Yes | Full coverage via all 3 paths |
| Android Chrome (browser tab) | Yes | No | Paths 1 + 2 |
| iOS 16.4+ (added to home screen) | Yes | No | Paths 1 + 2 |
| iOS Safari (browser tab) | No | No | Foreground only; messages on next app open |
| Desktop Chrome/Firefox | Yes | No | Paths 1 + 2 |

iOS without home screen installation has no background delivery. This is a platform limitation and cannot be worked around without a native app.

---

## Service Worker RS Access

The SW runs in a separate context and cannot use the remotestorage.js library (it depends on DOM APIs). When a VAPID push wakes the SW, it needs to write to RS via plain HTTP.

The app stores the RS bearer token and server URL in IDB (`rs_token` key in `config` store) whenever remotestorage.js issues or refreshes a token. It also stores `{networkId, deviceId}` in IDB (`rs_config` key) after each successful RS connection.

The SW reads both IDB keys when handling push events, background sync, and periodic sync.

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

## Implementation Checklist

### Dependencies
- [x] Add `remotestoragejs` to `package.json`

### Network identity (`src/protocol/network.ts`)
- [x] Replace passphrase-based `network_id` derivation with `hmac(rs_user, network_secret)`
- [x] Add `generateNetworkSecret()` — random 32-byte base64 value

### RS module (`web/src/rs.ts`)
- [x] RS connect/OAuth flow using remotestorage.js
- [x] On connect: check for existing `network_secret`; generate and write if absent
- [x] `getSettings()` / `saveSettings()` with defaults fallback
- [x] `upsertDevice()` / `markDeviceRemoved()` / `listDevices()`
- [x] `upsertMessage()` / `listMessages()` / `updateMessageState()`
- [x] `cullMessages(cull_days)`
- [x] `onChange()` — RS change listener for real-time updates when tab open
- [x] On RS token issue/refresh: write bearer token + server URL to IDB for SW use

### SW RS client (`web/src/rs-sw.ts`)
- [x] `loadRSToken()` — reads RS bearer token and base URL from IDB
- [x] `swPutMessage()` — raw HTTP PUT to RS (for SW push handler)
- [x] `loadRSConfig()` — reads `{networkId, deviceId}` from IDB
- [x] `swFetchNewMessages()` — polls RS directory, fetches unread messages for this device
- [x] Notified-ID set in IDB — prevents duplicate notifications across all three delivery paths

### Encryption (`src/protocol/crypto.ts`)
- [x] `deriveEncryptionKey(network_secret)` via HKDF-SHA256
- [x] Encrypt/decrypt message body only — not metadata

### Protocol types (`src/protocol/types.ts`)
- [x] Remove heartbeat, sync, and msg.received event types
- [x] Add `rs_user` to `DeviceConfig`; remove passphrase fields

### Actions (`src/engine/actions.ts`)
- [x] `actionAnnounce` — write to RS + publish ntfy `device.announce`
- [x] `actionLeave` — write to RS + publish ntfy `device.leave`
- [x] `actionSend` — write to RS first, then publish ntfy `msg.send`
- [x] `actionMarkViewed` — update RS `MessageRecord.state` to `"viewed"`
- [x] Remove `actionHeartbeat`, `actionSyncRequest`

### Reducer (`src/engine/reducer.ts`)
- [x] Remove heartbeat, sync, msg.received cases
- [x] Dedup guard: skip `msg.send` if `msg_id` already in state
- [x] Return `newMessage: boolean` flag for caller to handle RS write + notification

### App (`web/src/app.ts`)
- [x] On startup: connect RS, read settings, derive `network_id`
- [x] Detect RS user change: warn before continuing
- [x] Read devices and messages from RS before subscribing to ntfy SSE
- [x] Wire RS `onChange` listener for live updates when tab open
- [x] Standard poll loop (interval from RS settings, default 600s)
- [x] Adaptive poll: one-shot +20s after sending
- [x] Save `RSConfig` to IDB after connect so SW has networkId/deviceId for background poll
- [x] Register Periodic Background Sync with `minInterval = poll_interval_seconds`

### Service worker (`web/src/sw.ts`)
- [x] `push` event: extract full `msg.send` payload, write receipt to RS, show notification
- [x] Mark `msg_id` as notified in IDB after push notification to prevent duplicates
- [x] `sync` event: call `swFetchNewMessages()` + show notifications for new messages
- [x] `periodicsync` event: same as sync — scheduled background RS poll

### Local persistence (`web/src/db.ts`)
- [x] Remove `devices`, `messages`, `eventLog` IDB stores (IDB v2 migration)
- [x] Keep `config` store; add `rs_token` and `rs_config` keys for SW use

### Settings UI
- [x] RS connect screen: device name + RS address form; Advanced section for ntfy URL
- [x] Show RS connection status and connected RS user (badge in Settings tab)
- [x] Warn prominently if RS user changes from previously stored value (handled in app.ts)
- [x] Expose `poll_interval_seconds` and `message_cull_days` as editable fields
- [x] Expose `encryption_enabled` toggle

### Cleanup
- [x] Remove `src/cli/`
- [x] Remove relay backends (Cloudflare Workers, Supabase, Deno)
- [x] Remove passphrase-based `network_id` derivation
- [x] Remove `actionHeartbeat` and all call sites
