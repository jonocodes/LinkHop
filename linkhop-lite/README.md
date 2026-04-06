# LinkHop Lite

Device-to-device messaging protocol built on ntfy relay. Browser-first, no backend.

## Quick start

```bash
bun install
bun test
bun src/cli/index.ts --help
```

## Project structure

```
src/
  protocol/    # Types, event factories, validation, topic naming, ID gen
  engine/      # State machine reducer, local actions, state queries
  transport/   # ntfy publish/subscribe
  cli/         # Reference CLI (only layer with Node dependencies)
tests/         # Vitest test suites
```

The protocol and engine layers use only web-standard APIs and have zero Node dependencies, so they can run in the browser unchanged.

## Reference CLI

Requires a running ntfy instance (default `http://localhost:8080`, override with `NTFY_URL`).

```bash
# Initialize a device
bun src/cli/index.ts init --name "My Laptop" --network net_abc123

# Show identity
bun src/cli/index.ts whoami

# Announce presence
bun src/cli/index.ts announce

# Watch for live events (registry + device topic)
bun src/cli/index.ts watch

# Send a message
bun src/cli/index.ts send dev_peer_id hello world

# View state
bun src/cli/index.ts devices
bun src/cli/index.ts inbox
bun src/cli/index.ts pending
bun src/cli/index.ts events
bun src/cli/index.ts export-state
```

## Spec documents

- [Implementation spec (v0)](./linkhop-lite-implementation-spec-v0.md) — source of truth for wire formats and local state
- [Protocol draft](./linkhop-lite-protocol-draft.md) — rationale, design decisions, deferred items

## Implementation checklist

### Protocol types and wire format

- [x] Protocol event envelope (type, timestamp, network_id, event_id, from_device_id, payload)
- [x] `device.announce` event and payload
- [x] `device.leave` event and payload
- [x] `msg.send` event and payload (with `body.kind: "text"`)
- [x] `msg.received` event and payload
- [x] Local device record shape
- [x] Local message record shape (with state: pending | received)
- [x] Local event log entry shape

### Topic naming and IDs

- [x] Topic convention: `linkhop.<env>.<network_id>.registry`
- [x] Topic convention: `linkhop.<env>.<network_id>.device.<device_id>`
- [x] ID generation (device, event, msg, network)

### Event validation

- [x] Envelope field validation
- [x] Network ID mismatch rejection
- [x] Per-event-type payload validation
- [x] Unknown event type rejection

### Engine / state machine

- [x] `device.announce` creates/updates device record
- [x] `device.announce` clears `is_removed` on re-announce after leave
- [x] `device.leave` marks device as removed
- [x] `msg.send` stores message as received and emits `msg.received` ack
- [x] `msg.send` ignores events not addressed to local device
- [x] `msg.send` deduplication by msg_id (no duplicate inbox entries)
- [x] `msg.send` duplicate re-emits `msg.received`
- [x] `msg.received` clears pending state on sender
- [x] `msg.received` ignores acks not addressed to local device
- [x] Event log records all incoming events

### Local actions

- [x] `actionAnnounce` — produce device.announce publish effect
- [x] `actionLeave` — produce device.leave publish effect
- [x] `actionSend` — store pending message + produce msg.send publish effect

### Transport

- [x] ntfy publish (POST JSON to topic)
- [x] ntfy subscribe (NDJSON streaming)
- [ ] SSE subscribe (for browser)
- [ ] Reconnect / retry on transport failure

### Reference CLI

- [x] `init` — create device identity and network config
- [x] `whoami` — print local identity and topics
- [x] `announce` — emit device.announce
- [x] `leave` — emit device.leave
- [x] `devices` — show known devices
- [x] `send <id> <text>` — send a message
- [x] `inbox` — show received messages
- [x] `pending` — show pending outbound messages
- [x] `watch` — live subscribe to registry + device topics
- [x] `events` — print event log as JSON
- [x] `export-state` — dump full local state
- [ ] `replay <file>` — replay fixture/event log into engine

### Tests

- [x] Topic naming
- [x] Event validation (valid, reject, mismatch)
- [x] Device announce/update/re-announce after leave
- [x] Device leave
- [x] Message send/receive/ack
- [x] Deduplication (no duplicate inbox entries, re-ack on duplicate)
- [x] Lost acknowledgement scenario
- [x] Event log recording
- [x] In-memory relay simulation (multi-device)
- [x] Two-device full flow (announce, send, receive, ack)
- [x] Three-device isolation (messages don't leak)
- [x] Duplicate delivery dedup via relay
- [x] Dropped ack scenario via relay
- [x] Late subscriber receives retained events
- [ ] Simulation fixture format and replay

### Deferred (per spec)

- [ ] Retry / offline recovery extension
- [ ] Encryption / signing
- [ ] Password rotation
- [ ] Heartbeat / stronger presence
- [ ] Password-derived network_id (currently manual)
- [ ] Browser app (IndexedDB storage, SSE transport, UI)
