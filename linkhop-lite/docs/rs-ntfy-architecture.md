# RemoteStorage + ntfy Architecture Plan

## Overview

Replace the current relay-centric model with a two-layer architecture:

- **RemoteStorage (RS)** — source of truth for all persistent state: devices, messages, settings
- **ntfy** — real-time event delivery and VAPID push wakeup for mobile PWA background notifications

RS is required. ntfy is required for real-time joins, leaves, message delivery, and mobile background alerts.

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
| Device records | `/linkhop/{network_id}/devices/{device_id}` | Written on announce, updated on leave |
| Message records | `/linkhop/{network_id}/messages/{msg_id}` | Written on send, state updated on receive/view |
| Network settings | `/linkhop/{network_id}/settings` | Shared across all devices on the network |

### Eliminated entirely

| Removed | Replaced by |
|---|---|
| `device.heartbeat` | Not needed — RS stores last_seen, updated on announce |
| `sync.request` / `sync.response` | Not needed — just read RS on startup |
| `msg.received` ntfy ACK | RS `MessageRecord.state` field update |

---

## Event Flows

### Device joins

1. Device writes `DeviceRecord` to RS
2. Device POSTs `device.announce` to ntfy registry topic
3. Online peers receive via SSE → update local device list immediately
4. Devices coming online later read RS directly → find all devices

### Device leaves

1. Device updates RS `DeviceRecord` with `is_removed: true`
2. Device POSTs `device.leave` to ntfy registry topic
3. Online peers receive via SSE → remove device from UI immediately

### Sending a message (A → B)

1. A writes `MessageRecord` to RS (`state: "pending"`)
2. A POSTs full `msg.send` event to B's ntfy device topic
3. ntfy delivers VAPID push to B's browser/SW (even on locked phone)
4. B's SW receives push with full message payload — shows notification immediately, no RS fetch needed
5. B's SW writes `state: "received"` to RS
6. A sees receipt on next RS poll (adaptive: first poll at +20s, then back to standard interval)

### Message deduplication

If B receives the same message via both ntfy SSE (tab open) and RS poll:
- Check `messages.get(msg_id)` before processing
- If already present, skip — first delivery wins

### Marking a message viewed

1. User opens message in app
2. App updates RS `MessageRecord.state` to `"viewed"` and sets `viewed_at`
3. No ntfy event sent

---

## RS Settings Document

Stored at `/linkhop/{network_id}/settings` and shared across all devices.

```json
{
  "poll_interval_seconds": 600,
  "message_cull_days": 30
}
```

Defaults applied if the document does not exist yet. Any device can update settings; all others pick up the change on next RS sync.

---

## Polling Strategy

### Standard poll

Interval read from RS settings (default 600s / 10 minutes).

Reads on each poll:
- All device records (detect new/removed devices while offline)
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
- Culling is done by the writing device; all devices will observe deletions via RS sync

---

## DeviceConfig Schema

RS credentials are added to `DeviceConfig`:

```typescript
interface DeviceConfig {
  device_id: string;
  device_name: string;
  network_id: string;
  env: string;
  rs: {
    url: string;    // RS server base URL e.g. https://example.com
    token: string;  // RS bearer token
  };
}
```

All devices on a network share the same RS credentials and write to the same path space, scoped by `network_id`.

---

## Mobile PWA Background Coverage

| Scenario | Mechanism |
|---|---|
| Tab open, in foreground | ntfy SSE (real-time) + RS change listener |
| Tab open, browser backgrounded | ntfy SSE still alive |
| PWA installed, app closed | ntfy VAPID push → SW shows notification, writes receipt to RS |
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

### RS module (`web/src/rs.ts`) — new file

- [ ] Define the `linkhop` RS module with `devices` and `messages` and `settings` paths
- [ ] `getSettings()` / `saveSettings()` with defaults fallback
- [ ] `getDevice(deviceId)` / `upsertDevice(record)` / `markDeviceRemoved(deviceId)`
- [ ] `listDevices()` — returns all non-removed device records
- [ ] `getMessage(msgId)` / `upsertMessage(record)`
- [ ] `listMessages()` — returns all messages within cull window
- [ ] `cullMessages(cull_days)` — deletes messages older than cull_days, called on each write
- [ ] `onChange(callback)` — RS change listener for real-time updates when tab open
- [ ] RS auth/connect helper (takes `url` and `token` from `DeviceConfig.rs`)

### Protocol types (`src/protocol/types.ts`)

- [ ] Remove `DeviceHeartbeatPayload` and `DeviceHeartbeatEvent`
- [ ] Remove `SyncRequestPayload`, `SyncResponsePayload`, `SyncRequestEvent`, `SyncResponseEvent`
- [ ] Remove `"device.heartbeat"`, `"sync.request"`, `"sync.response"` from `EventType`
- [ ] Add `rs` field to `DeviceConfig`

### Actions (`src/engine/actions.ts`)

- [ ] `actionAnnounce` — write to RS + publish ntfy `device.announce`
- [ ] `actionLeave` — write to RS + publish ntfy `device.leave`
- [ ] Remove `actionHeartbeat`
- [ ] Remove `actionSyncRequest`
- [ ] `actionSend` — write to RS + publish ntfy `msg.send` (full payload, unchanged)
- [ ] `actionMarkViewed` — update RS `MessageRecord.state` to `"viewed"`

### Reducer (`src/engine/reducer.ts`)

- [ ] Remove `device.heartbeat` case
- [ ] Remove `sync.request` / `sync.response` cases
- [ ] Add dedup guard: skip `msg.send` if `msg_id` already in state
- [ ] On `msg.received` (incoming): update RS `MessageRecord.state` to `"received"`

### SSE / ntfy (`web/src/sse.ts`)

- [ ] Remove registry topic subscription for relay backends (ntfy registry topic stays for announce/leave)
- [ ] No change needed for `msg.send` handling — payload format unchanged

### App startup (`web/src/app.ts`)

- [ ] On startup: connect RS, read settings, read all devices, read all messages
- [ ] Populate local state from RS before subscribing to ntfy SSE
- [ ] Subscribe to ntfy registry topic for `device.announce` and `device.leave`
- [ ] Subscribe to own ntfy device topic for incoming `msg.send`
- [ ] Wire RS `onChange` listener to process device/message changes while tab open
- [ ] Implement standard poll loop (reads RS at configured interval)
- [ ] Implement adaptive poll: schedule one-shot +20s poll after sending a message

### Service worker (`web/src/sw.ts`)

- [ ] On `push` event: extract full `msg.send` payload from ntfy push (already in payload — no RS fetch needed)
- [ ] Write received message to RS from SW context (`state: "received"`)
- [ ] Show notification with message content immediately
- [ ] On `sync` event (Background Sync): retry pending RS write + ntfy POST for queued outbound messages

### Local persistence (`web/src/db.ts`)

- [ ] Remove IndexedDB stores for `devices` and `messages` — RS is now the store
- [ ] Keep (or simplify) `config` store for `DeviceConfig` including RS credentials
- [ ] Keep `eventLog` store if still useful for debug, or remove

### Settings UI

- [ ] Add RS connection setup screen (RS server URL + token input)
- [ ] Save RS credentials to `DeviceConfig` in IndexedDB `config` store
- [ ] Show RS connection status
- [ ] Expose `poll_interval_seconds` and `message_cull_days` as editable fields (saved to RS settings doc)

### Cleanup

- [ ] Remove `src/engine/relay.ts` (in-memory relay no longer needed for web app)
- [ ] Remove or gut `src/relay/core.ts` `RelayStore` interface if no longer used
- [ ] Remove Cloudflare Workers relay (`workers/`) if no longer maintained
- [ ] Remove Supabase relay (`supabase/`) if no longer maintained
- [ ] Remove `actionHeartbeat` call sites throughout codebase
- [ ] Remove `registryTopicFromConfig` if registry topic is now ntfy-only (it may stay as-is)
