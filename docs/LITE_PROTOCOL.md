# LinkHop Lite Protocol Draft (CLI/HTTP Testable)

## Status

Draft v0.1. Focused on protocol behavior for simulation via a CLI or HTTP API.

## Goals

- Define a deterministic protocol for device management and message delivery.
- Support mixed availability patterns:
  - always-on devices (e.g., phone)
  - rarely connected devices (e.g., laptop/desktop every 2-3 days)
- Make all behaviors testable from scripts without UI assumptions.

## Non-goals

- UI details.
- Cryptography implementation specifics (only envelope requirements here).

## Transport assumptions

- Relay transport is topic-based pub/sub (ntfy-compatible model).
- Message retention on hosted relay may be short (e.g., ~12h); protocol must survive longer offline gaps.
- Durable source of truth is per-device local store (IndexedDB/SQLite/etc.) plus replication rules below.

## Terminology

- **Registry topic**: shared topic for device membership and control events.
- **Device topic**: one per device for directed delivery.
- **Archive node**: an always-on device (typically phone) that stores and re-serves missed messages.
- **Envelope**: protocol metadata + encrypted payload.
- **Message ID**: globally unique ULID/UUID used for idempotency and dedupe.

## Topic naming

- `registry_topic`: deterministic from shared secret (password-derived).
- `device_topic`: random high-entropy topic per device.
- Optional environment prefixes:
  - `lh_prod_<...>`
  - `lh_dev_<...>`

## Device model

Each device has:

- `device_id` (stable UUID)
- `device_name` (mutable)
- `device_topic`
- `device_type` (`phone|desktop|laptop|extension|other`)
- `last_seen_at`
- `capabilities`:
  - `archive_node: bool`
  - `can_push: bool`
  - `can_ws: bool`

## Envelope schema

All transport messages use one outer envelope.

```json
{
  "v": 1,
  "kind": "device.join|device.leave|device.heartbeat|msg.send|msg.ack|msg.delete|sync.request|sync.response|retention.refresh",
  "event_id": "01J...ULID",
  "ts": "2026-04-03T00:00:00Z",
  "from_device_id": "uuid",
  "to_device_id": "uuid-or-null",
  "msg_id": "uuid-or-null",
  "ciphertext": "base64(AES-GCM(payload))",
  "meta": {
    "attempt": 1,
    "ttl_hint_hours": 12
  }
}
```

Rules:

- `event_id` unique per emitted event.
- `msg_id` required for `msg.*` kinds.
- Unknown fields ignored.
- Receivers MUST process idempotently by `event_id` and `msg_id`.

## Device management protocol

### 1) Join

On startup, device emits `device.join` to `registry_topic` with encrypted body:

```json
{
  "device_id": "uuid",
  "device_name": "My Laptop",
  "device_topic": "up_abcd...",
  "device_type": "laptop",
  "capabilities": { "archive_node": false, "can_push": true, "can_ws": true }
}
```

### 2) Heartbeat

Every `N` minutes while online, emit `device.heartbeat` to registry.

- Recommended `N = 10` for always-on devices.
- Recommended `N = 60` for intermittently online devices.

### 3) Rename / metadata update

Emit `device.join` again with same `device_id` and updated fields (upsert semantics).

### 4) Leave (best effort)

Emit `device.leave` when graceful shutdown occurs.

### 5) Membership source of truth

- Local store keeps latest known device map by `device_id`.
- Registry replay + upsert rebuilds map.
- If registry history is missing, use sync flow (below).

## Message protocol

### 1) Send

Sender emits `msg.send` to recipient `device_topic`.

Encrypted payload:

```json
{
  "msg_id": "uuid",
  "from_device_id": "uuid",
  "to_device_id": "uuid",
  "type": "text|url|file_ref",
  "body": "...",
  "created_at": "2026-04-03T00:00:00Z",
  "require_ack": true
}
```

### 2) Archive replication (recommended)

In addition to direct send, sender emits the same logical message to one or more archive nodes (`archive_node=true`) as `msg.send` with `to_device_id` unchanged.

- Archive node stores but does not treat as user-visible inbox unless addressed to itself.
- Archive node can later re-serve missed messages to target devices.

### 3) Ack

Receiver emits `msg.ack` to sender topic and registry (or sender only if bandwidth constrained).

Encrypted payload:

```json
{
  "msg_id": "uuid",
  "to_device_id": "uuid",
  "ack_type": "received|viewed",
  "acked_at": "2026-04-03T00:00:15Z"
}
```

### 4) Delete/tombstone

After `viewed` (or policy threshold), receiver emits `msg.delete` (tombstone) so archive/sender can GC safely.

Encrypted payload:

```json
{
  "msg_id": "uuid",
  "deleted_by": "uuid",
  "deleted_at": "2026-04-03T01:00:00Z",
  "reason": "viewed"
}
```

## Sync protocol (for rare connectivity)

### Trigger

On reconnect, device emits `sync.request` to registry with cursor:

```json
{
  "requester_device_id": "uuid",
  "since": "2026-03-31T00:00:00Z",
  "known_max_event_id": "01J..."
}
```

### Responder selection

Any online node MAY respond; archive nodes SHOULD respond first.

### Response

`sync.response` contains:

- latest device map snapshot
- pending messages targeting requester not yet acked/deleted
- latest ack/tombstone state

```json
{
  "for_device_id": "uuid",
  "devices": ["..."],
  "messages": ["..."],
  "acks": ["..."],
  "deletes": ["..."],
  "snapshot_at": "2026-04-03T00:02:00Z"
}
```

## Retention refresh protocol (blind keepalive mode)

Use when relay retention is shorter than offline windows.

### Behavior

Archive node periodically scans cached relay history and re-publishes still-live, non-tombstoned items as `retention.refresh` events referencing original `msg_id`.

Rules:

- Never refresh messages with observed `msg.delete`.
- Refresh only if no `viewed` ack for intended recipient.
- Keep refresh cadence conservative (e.g., every 8h).
- All clients dedupe by `msg_id` + highest `ts`/state.

### Tradeoff

Refresh creates extra relay writes; tune to avoid provider rate limits.

## State machine (per message)

`created -> relayed -> received -> viewed -> tombstoned -> gc`

Allowed transitions:

- `created -> relayed` by sender or archive replication
- `relayed -> received` on receiver ack
- `received -> viewed` on receiver ack
- `viewed -> tombstoned` on delete event
- `tombstoned -> gc` after retention window

Invalid transition handling:

- Ignore stale transitions.
- Keep max-state precedence: `viewed` > `received` > `relayed`.

## Idempotency and conflict resolution

- Primary key: `msg_id`.
- Event dedupe key: `event_id`.
- If duplicate `msg.send` with same `msg_id`, merge metadata, do not duplicate inbox entry.
- Last-write-wins on mutable device fields using `(ts, event_id)` tie-breaker.

## Minimal CLI surface (for simulation)

```bash
# device lifecycle
linkhop-lite device join --id D1 --name phone --archive-node
linkhop-lite device heartbeat --id D1
linkhop-lite device leave --id D1

# messaging
linkhop-lite msg send --from D2 --to D3 --body "https://example.com"
linkhop-lite msg ack --device D3 --msg M1 --type received
linkhop-lite msg ack --device D3 --msg M1 --type viewed
linkhop-lite msg delete --device D3 --msg M1

# sync/retention
linkhop-lite sync request --device D2 --since "2026-04-01T00:00:00Z"
linkhop-lite retention refresh --device D1 --older-than "8h"
```

## Minimal HTTP API surface (for simulation)

- `POST /v1/devices/join`
- `POST /v1/devices/heartbeat`
- `POST /v1/devices/leave`
- `POST /v1/messages/send`
- `POST /v1/messages/ack`
- `POST /v1/messages/delete`
- `POST /v1/sync/request`
- `POST /v1/retention/refresh`
- `GET /v1/devices`
- `GET /v1/messages?device_id=...&state=pending`

## Test scenarios to implement first

1. **Always-on phone archive + 2 rare devices (3-day gaps)**
   - D1(phone) always online, D2(laptop)/D3(desktop) online every 72h.
   - Verify D2->D3 messages survive via D1 archive + sync.

2. **No overlap between D2 and D3**
   - Ensure eventual delivery through archive node.

3. **Deletion propagation**
   - D3 views and deletes; D1 should stop refreshing; D2 sees terminal state.

4. **Duplicate flood resilience**
   - Re-publish same `msg_id` many times; inbox still single entry.

5. **Registry loss recovery**
   - Simulate relay cache loss; reconstruct from sync.response snapshot.

## Open decisions

- Ack fanout destination: sender-only vs sender+registry.
- Whether `viewed` should be required before `delete`.
- Archive encryption model: store ciphertext-only vs decrypt/re-encrypt.
- GC retention period after tombstone.

