# LinkHop Lite Implementation Spec (v0)

## Status

- Status: v0 implementation target
- Priority: this document is the source of truth for concrete wire formats and local record shapes
- Companion doc: the broader protocol/design draft provides rationale and deferred decisions

## Scope

This implementation spec defines:
- topic naming
- ntfy URL patterns
- protocol event JSON
- local record shapes
- subscription rules
- validation / ignore rules
- minimal reference CLI semantics
- simulation fixture shape

This implementation spec does **not** define:
- retry / offline recovery extension
- encryption
- password rotation
- backend APIs
- TUI support

## Core Assumptions

- browser-first implementation
- no backend besides ntfy
- local durable state in browser storage
- each device is an independent endpoint
- registry topic is used for discovery
- device topics are used for direct delivery
- `msg.received` is the only required acknowledgement
- ordering is not guaranteed

## Terminology

- **network_id**: stable opaque identifier for a LinkHop network
- **registry topic**: shared topic for device discovery and metadata events
- **device topic**: unique topic for direct delivery to one device
- **device_id**: stable device identity
- **device_name**: mutable user-visible device label
- **event_id**: unique identifier for one wire event
- **msg_id**: stable identifier for one logical message
- **received**: durable local inbox storage on the recipient device

## Topic Naming

Use this convention:

```text
registry topic: linkhop.<env>.<network_id>.registry
device topic:   linkhop.<env>.<network_id>.device.<device_id>
```

Example topics:

```text
linkhop.test.net_f7k29m.registry
linkhop.test.net_f7k29m.device.dev_phone_123
linkhop.test.net_f7k29m.device.dev_desktop_456
```

## ntfy URL Patterns

Assume a self-hosted ntfy instance at `http://localhost:8080`.

Example URLs:

```text
http://localhost:8080/linkhop.test.net_f7k29m.registry
http://localhost:8080/linkhop.test.net_f7k29m.registry/sse
http://localhost:8080/linkhop.test.net_f7k29m.device.dev_phone_123
http://localhost:8080/linkhop.test.net_f7k29m.device.dev_phone_123/sse
http://localhost:8080/linkhop.test.net_f7k29m.device.dev_desktop_456
http://localhost:8080/linkhop.test.net_f7k29m.device.dev_desktop_456/sse
```

## Subscription Rules

Each client:
- MUST subscribe to the registry topic for its current network
- MUST subscribe to its own device topic
- MUST NOT rely on subscribing to peer device topics for normal operation

For the browser implementation, SSE is the preferred browser-to-relay subscription mechanism if supported cleanly by ntfy.

## Protocol Event Envelope

All protocol events published to ntfy topics MUST use this outer structure.

```json
{
  "type": "msg.send",
  "timestamp": "2026-04-04T18:40:00Z",
  "network_id": "net_f7k29m",
  "event_id": "evt_01",
  "from_device_id": "dev_phone_123",
  "payload": {}
}
```

### Envelope fields

- `type`: protocol event type
- `timestamp`: event creation time in ISO-8601 UTC
- `network_id`: stable opaque network identifier
- `event_id`: unique identifier for this wire event
- `from_device_id`: device that emitted the event
- `payload`: event-specific object

### Envelope notes

- `event_id` identifies one wire event, not one logical message.
- `msg_id` is separate from `event_id` and belongs inside message payloads.
- `network_id` SHOULD appear in the event body even if it is also implicit in topic naming.

## Core Protocol Events

### `device.announce`

Published to:
- registry topic

Purpose:
- announce device presence
- publish or refresh current device metadata

```json
{
  "type": "device.announce",
  "timestamp": "2026-04-04T18:30:00Z",
  "network_id": "net_f7k29m",
  "event_id": "evt_announce_001",
  "from_device_id": "dev_phone_123",
  "payload": {
    "device_id": "dev_phone_123",
    "device_name": "Jono Phone",
    "device_topic": "linkhop.test.net_f7k29m.device.dev_phone_123",
    "protocol_version": "lite-v1"
  }
}
```

Payload fields:
- `device_id`: stable device identifier
- `device_name`: current mutable display name
- `device_topic`: direct-delivery topic for that device
- `protocol_version`: current protocol version string

### `device.leave`

Published to:
- registry topic

Purpose:
- explicit device removal by user action

```json
{
  "type": "device.leave",
  "timestamp": "2026-04-04T18:35:00Z",
  "network_id": "net_f7k29m",
  "event_id": "evt_leave_001",
  "from_device_id": "dev_phone_123",
  "payload": {
    "device_id": "dev_phone_123"
  }
}
```

Payload fields:
- `device_id`: stable device identifier

### `msg.send`

Published to:
- recipient device topic

Purpose:
- deliver one logical message from sender device to recipient device

```json
{
  "type": "msg.send",
  "timestamp": "2026-04-04T18:40:00Z",
  "network_id": "net_f7k29m",
  "event_id": "evt_send_001",
  "from_device_id": "dev_phone_123",
  "payload": {
    "msg_id": "msg_001",
    "attempt_id": 1,
    "to_device_id": "dev_desktop_456",
    "body": {
      "kind": "text",
      "text": "hello from phone"
    }
  }
}
```

Payload fields:
- `msg_id`: stable logical message identifier
- `attempt_id`: send attempt number, beginning at `1`
- `to_device_id`: intended recipient device
- `body`: message body

Message body for v0:

```json
{
  "kind": "text",
  "text": "hello from phone"
}
```

### `msg.received`

Published to:
- sender device topic

Purpose:
- acknowledge durable receipt of a message

```json
{
  "type": "msg.received",
  "timestamp": "2026-04-04T18:40:03Z",
  "network_id": "net_f7k29m",
  "event_id": "evt_recv_001",
  "from_device_id": "dev_desktop_456",
  "payload": {
    "msg_id": "msg_001",
    "to_device_id": "dev_phone_123"
  }
}
```

Payload fields:
- `msg_id`: logical message identifier being acknowledged
- `to_device_id`: original sender device

### `device.heartbeat`

Published to:
- registry topic

Purpose:
- periodic liveness signal so peers can track when a device was last active
- enables "last seen" display in the UI

```json
{
  "type": "device.heartbeat",
  "timestamp": "2026-04-04T19:00:00Z",
  "network_id": "net_f7k29m",
  "event_id": "evt_hb_001",
  "from_device_id": "dev_phone_123",
  "payload": {
    "device_id": "dev_phone_123"
  }
}
```

Payload fields:
- `device_id`: stable device identifier

Processing rules:
- Updates `last_event_at` and `last_event_type` on known, non-removed devices
- MUST NOT create a device record for an unknown device
- MUST NOT revive a removed device
- MUST NOT be added to the persistent event log (housekeeping event)

### `sync.request`

Published to:
- target device topic

Purpose:
- request the full known device list from a peer
- used by newly joining devices to discover peers whose announcements have expired from relay retention

```json
{
  "type": "sync.request",
  "timestamp": "2026-04-04T18:20:00Z",
  "network_id": "net_f7k29m",
  "event_id": "evt_syncreq_001",
  "from_device_id": "dev_tablet_789",
  "payload": {
    "to_device_id": "dev_desktop_456"
  }
}
```

Payload fields:
- `to_device_id`: device being asked to respond with its device list

Processing rules:
- MUST ignore if `to_device_id` does not match the local device
- Responds with `sync.response` containing all known non-removed devices
- MUST NOT be added to the persistent event log (housekeeping event)

### `sync.response`

Published to:
- requester device topic

Purpose:
- respond to a `sync.request` with the full known device list

```json
{
  "type": "sync.response",
  "timestamp": "2026-04-04T18:20:01Z",
  "network_id": "net_f7k29m",
  "event_id": "evt_syncresp_001",
  "from_device_id": "dev_desktop_456",
  "payload": {
    "to_device_id": "dev_tablet_789",
    "devices": [
      {
        "device_id": "dev_phone_123",
        "device_name": "Jono Phone",
        "device_topic": "linkhop.test.net_f7k29m.device.dev_phone_123",
        "last_event_at": "2026-04-04T18:00:00Z",
        "last_event_type": "device.announce",
        "is_removed": false
      }
    ]
  }
}
```

Payload fields:
- `to_device_id`: device that requested the sync
- `devices`: array of `DeviceRecord` objects (excluding removed devices)

Processing rules:
- MUST ignore if `to_device_id` does not match the local device
- Merges devices into local state: adds unknown devices, updates existing ones only if the peer has a newer `last_event_at`
- MUST NOT overwrite local device info with older data
- MUST NOT be added to the persistent event log (housekeeping event)

## Core Processing Rules

### Device handling

- A client SHOULD emit `device.announce` on startup and reconnect.
- A client MAY emit `device.announce` when its device metadata changes.
- A client SHOULD emit `device.heartbeat` periodically (recommended: once per hour) while connected.
- A client MUST treat `device_name` as mutable.
- A client MUST treat `device_id` as stable identity.

### Sync handling

- On first connection, a client SHOULD request a sync from the most recently seen peer after a short delay (e.g. 3 seconds) to allow initial SSE events to arrive.
- A client MUST respond to `sync.request` addressed to it with a `sync.response` containing all known non-removed devices.
- A client MUST merge `sync.response` data, preferring newer `last_event_at` timestamps over older ones.

### Send handling

- When sending a message, the sender MUST create a new `msg_id`.
- The initial `attempt_id` MUST be `1`.
- The sender MUST publish `msg.send` to the recipient device topic.
- The sender MUST store the logical message locally as pending until a matching `msg.received` is processed or the message is otherwise cleared by a future extension.

### Receive handling

- On receiving `msg.send`, the recipient MUST ignore the event if `to_device_id` does not match the local device.
- On receiving a new `msg.send`, the recipient MUST durably store the logical message before emitting `msg.received`.
- `msg.received` MUST only be emitted by the intended recipient device.
- `msg.received` MUST be sent to the original sender device topic.

### Deduplication

- A recipient MUST deduplicate messages by `msg_id`.
- Duplicate `msg.send` events with the same `msg_id` MUST NOT create duplicate inbox entries.
- On genuine retry (higher `attempt_id`), the recipient SHOULD re-emit `msg.received`.
- On replayed duplicate (same `attempt_id`), the recipient SHOULD NOT re-emit `msg.received` (avoids ack spam on SSE reconnect).

### Acknowledgement handling

- A sender MUST clear the pending state for a message after the first valid matching `msg.received`.
- `msg.received` indicates durable local inbox storage only.
- `msg.received` MUST NOT be interpreted as a read/view/delete signal.

## Validation and Ignore Rules

Clients SHOULD ignore malformed or irrelevant events rather than failing globally.

A client SHOULD reject or ignore events when:
- `network_id` does not match the current network
- required fields are missing
- `type` is unknown
- `to_device_id` does not match the local device for direct message handling
- payload shape does not match the declared event type

Clients MAY keep rejected events in a local debug log for troubleshooting.

## Local Record Shapes

Local records are derived state persisted in browser storage or the reference client’s local store.

### Device record

```json
{
  "device_id": "dev_desktop_456",
  "device_name": "Office Desktop",
  "device_topic": "linkhop.test.net_f7k29m.device.dev_desktop_456",
  "last_event_at": "2026-04-04T17:10:00Z",
  "last_event_type": "device.announce",
  "is_removed": false
}
```

Notes:
- derived from registry events and optionally message events
- `is_removed` is local derived state based on `device.leave`

### Message record

```json
{
  "msg_id": "msg_001",
  "from_device_id": "dev_phone_123",
  "to_device_id": "dev_desktop_456",
  "body": {
    "kind": "text",
    "text": "hello from phone"
  },
  "created_at": "2026-04-04T18:40:00Z",
  "state": "pending",
  "last_attempt_id": 1,
  "last_attempt_at": "2026-04-04T18:40:00Z",
  "received_at": null
}
```

Notes:
- represents one logical message
- `state` is local derived state, not a wire event type
- initial states are `pending` and `received`

### Event log record (optional)

```json
{
  "event_id": "evt_send_001",
  "type": "msg.send",
  "timestamp": "2026-04-04T18:40:00Z",
  "from_device_id": "dev_phone_123",
  "raw_event": {
    "type": "msg.send"
  }
}
```

Useful for:
- debugging
- replay
- simulation fixture export
- comparing browser and reference-client behavior

## Reference CLI Semantics

The reference CLI exists for testing and validation, not as a first-class product UI.

Suggested commands:
- `init`: create or load local device identity and network configuration
- `whoami`: print local device identity and topic information
- `announce`: emit `device.announce`
- `leave`: emit `device.leave`
- `devices`: display locally known devices
- `send <device-id> <text>`: create local pending message and emit `msg.send`
- `inbox`: display locally stored received messages
- `pending`: display locally pending outbound messages
- `watch`: subscribe and continuously display raw events and/or state transitions
- `events --json`: print recent local event log
- `export-state`: export local state snapshot
- `replay <file>`: replay a fixture or event log into the local engine

Out of scope:
- TUI
- local HTTP server
- rich end-user terminal UX

## Simulation Fixture Shape

A simulation fixture may contain:
- initial local state
- a timeline of local actions
- a timeline of incoming protocol events
- expected resulting local state

Suggested high-level shape:

```json
{
  "name": "lost-ack-basic",
  "initial_state": {},
  "steps": [
    {
      "at": "2026-04-04T18:40:00Z",
      "kind": "incoming_event",
      "event": {
        "type": "msg.send"
      }
    }
  ],
  "expected": {}
}
```

## Deferred Items

Deferred from this implementation spec:
- retry / offline recovery extension
- encryption and signing
- password rotation
- protocol version compatibility guarantees before first implementation
