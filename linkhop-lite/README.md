# LinkHop Lite

Device-to-device messaging protocol built on ntfy relay. Browser-first, no backend.

## Quick start

```bash
bun install
bun test
bun src/cli/index.ts --help

# Run browser app (dev server)
bun run dev
```

## Project structure

```
src/
  protocol/    # Types, event factories, validation, topic naming, ID gen, crypto
  engine/      # State machine reducer, local actions, state queries
  transport/   # ntfy publish/subscribe (CLI)
  cli/         # Reference CLI (only layer with Node dependencies)
web/
  src/         # Browser app (PWA)
    app.ts     # App controller wiring engine + SSE + IndexedDB + encryption
    db.ts      # IndexedDB persistence
    sse.ts     # SSE transport for ntfy
    ui.ts      # Vanilla TS UI (devices, inbox, pending, debug tabs)
tests/         # Vitest test suites
e2e/           # Playwright browser e2e tests
fixtures/      # Replay fixture JSON files
```

The protocol and engine layers use only web-standard APIs and have zero Node dependencies, so they can run in the browser unchanged.

## Encryption

Messages can be optionally encrypted with AES-GCM. The encryption key is derived from the same shared password used for network joining (via PBKDF2 with a separate salt).

- **Opt-in per device** — toggle in the status bar switches between "Encrypted" and "Plaintext"
- **Mixed mode** — all devices can join regardless of encryption. If a device receives an encrypted message it can't decrypt, the UI shows "Encrypted message — cannot decrypt"
- **Capabilities advertised** — `device.announce` includes `capabilities: ["encryption"]` when a key is available. The devices list shows an E2E badge for encryption-capable peers.
- **Metadata stays plaintext** — only `payload.body` is encrypted. Envelope fields (type, timestamps, device IDs) remain visible for routing and acks.

## Reference CLI

Requires a running ntfy instance (default `http://localhost:8080`, override with `NTFY_URL`).

```bash
# Initialize with a shared password (derives network_id deterministically)
bun src/cli/index.ts init --name "My Laptop" --password "shared-secret"

# Or with an explicit network ID
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

# Replay a fixture file
bun src/cli/index.ts replay fixtures/device-announce.json
```

## Testing

```bash
# Unit + simulation tests
bun test

# Integration tests (downloads ntfy binary, auto-skips if unavailable)
bun run test:integration

# Browser e2e tests (Playwright + Firefox + real ntfy)
bun run test:e2e

# Download ntfy manually (detects OS and arch)
bash scripts/download-ntfy.sh
```

Integration and e2e tests run against a real ntfy binary. They auto-skip if the binary isn't present, so `bun test` always works. Supports linux and macOS on amd64/arm64.

## Spec documents

- [Implementation spec (v0)](./linkhop-lite-implementation-spec-v0.md) — source of truth for wire formats and local state
- [Protocol draft](./linkhop-lite-protocol-draft.md) — rationale, design decisions, deferred items

## Implementation checklist

### Protocol types and wire format

- [x] Protocol event envelope (type, timestamp, network_id, event_id, from_device_id, payload)
- [x] `device.announce` event and payload (with optional capabilities)
- [x] `device.leave` event and payload
- [x] `msg.send` event and payload (with `body.kind: "text"` and `body.kind: "encrypted"`)
- [x] `msg.received` event and payload
- [x] Local device record shape (with capabilities)
- [x] Local message record shape (with state: pending | received)
- [x] Local event log entry shape

### Topic naming and IDs

- [x] Topic convention: `linkhop-<env>-<network_id>-registry` (dashes, not dots — ntfy rejects dots)
- [x] Topic convention: `linkhop-<env>-<network_id>-device-<device_id>`
- [x] ID generation (device, event, msg, network)

### Event validation

- [x] Envelope field validation
- [x] Network ID mismatch rejection
- [x] Per-event-type payload validation
- [x] Unknown event type rejection

### Engine / state machine

- [x] `device.announce` creates/updates device record (stores capabilities)
- [x] `device.announce` clears `is_removed` on re-announce after leave
- [x] `device.leave` marks device as removed
- [x] `msg.send` stores message as received and emits `msg.received` ack
- [x] `msg.send` ignores events not addressed to local device
- [x] `msg.send` deduplication by msg_id (no duplicate inbox entries)
- [x] `msg.send` duplicate re-emits `msg.received`
- [x] `msg.received` clears pending state on sender
- [x] `msg.received` ignores acks not addressed to local device
- [x] Event log records all incoming events

### Encryption

- [x] AES-GCM key derivation from password (PBKDF2, separate salt from network_id)
- [x] Encrypt message body on send (when toggle enabled)
- [x] Decrypt message body on receive (when key available)
- [x] Graceful fallback for undecryptable messages (UI shows warning)
- [x] `body.kind: "encrypted"` wire format (ciphertext + IV, base64)
- [x] `capabilities: ["encryption"]` in device.announce
- [x] Encryption toggle persisted in browser config
- [x] CLI: `init --password --encrypt` enables encryption
- [x] CLI: send/inbox/pending/watch encrypt/decrypt transparently

### Local actions

- [x] `actionAnnounce` — produce device.announce publish effect (with capabilities)
- [x] `actionLeave` — produce device.leave publish effect
- [x] `actionSend` — store pending message + produce msg.send publish effect

### Transport

- [x] ntfy publish (POST JSON to topic)
- [x] ntfy subscribe (NDJSON streaming — CLI)
- [x] SSE subscribe (browser, with `?since=30s` for late-join catch-up)
- [x] HTTP publish (browser)
- [x] Reconnect via EventSource auto-reconnect + re-announce

### Reference CLI

- [x] `init` — create device identity and network config (with `--password --encrypt`)
- [x] `whoami` — print local identity, topics, encryption status
- [x] `announce` — emit device.announce (with capabilities)
- [x] `leave` — emit device.leave
- [x] `devices` — show known devices (with E2E badge)
- [x] `send <id> <text>` — send a message (encrypted when enabled)
- [x] `inbox` — show received messages (decrypted when possible)
- [x] `pending` — show pending outbound messages (decrypted when possible)
- [x] `watch` — live subscribe, decrypt, and display events
- [x] `events` — print event log as JSON
- [x] `export-state` — dump full local state
- [x] `replay <file>` — replay fixture/event log into engine

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
- [x] Simulation fixture format and replay
- [x] Fixture-driven tests (all JSON fixtures auto-loaded)
- [x] Integration: publish/subscribe roundtrip against real ntfy
- [x] Integration: two-device discovery over real ntfy
- [x] Integration: full send/receive/ack flow over real ntfy
- [x] Fixture runner assertion failure detection
- [x] Encryption: key derivation, round-trip, wrong key, corruption
- [x] E2e: setup flow (Playwright + Firefox)
- [x] E2e: device discovery between two browser contexts
- [x] E2e: cross-device messaging with ack
- [x] E2e: IndexedDB persistence across reload
- [x] E2e: leave network and reset
- [x] CLI e2e: init, whoami, double init guard
- [x] CLI e2e: announce publishes to ntfy
- [x] CLI e2e: send to unknown device error
- [x] CLI e2e: replay, export-state, events, pending
- [x] CLI e2e: full two-device announce + message flow
- [x] CLI e2e: encryption flag and capability advertising

### Browser app (PWA)

- [x] Vite build with vite-plugin-pwa
- [x] PWA manifest (standalone, icons, theme)
- [x] Service worker (Workbox, auto-update)
- [x] IndexedDB persistence (config, devices, messages, event log)
- [x] SSE subscriptions to ntfy
- [x] Setup screen (name, password, ntfy URL)
- [x] Tab UI (devices, inbox, pending, debug)
- [x] Send messages from inbox tab
- [x] Connection status indicator (connected/connecting/disconnected)
- [x] Offline banner with reconnecting state
- [x] Auto-reconnect via EventSource with re-announce
- [x] Persistent config (ntfy URL + encryption toggle survive reload)
- [x] Leave network and reset from UI
- [x] Messages sorted newest-first with relative timestamps
- [x] SVG app icon
- [x] Notification permission request on setup
- [x] Foreground notifications on new message (via SW showNotification)
- [x] Custom service worker with push event handler
- [x] Notification click opens/focuses app
- [x] Encryption toggle in status bar (Encrypted / Plaintext)
- [x] E2E capability badge on devices list
- [x] Encrypted message fallback display ("cannot decrypt")
- [x] Debug tab (device config, connection status, event log)
- [x] ntfy web push subscription (auto-subscribe on connect, unsubscribe on leave)

### Deferred (per spec)

- [ ] Retry / offline recovery extension
- [ ] Password rotation
- [ ] Heartbeat / stronger presence
- [x] Password-derived network_id (PBKDF2 via Web Crypto)
- [x] Encryption (AES-GCM, opt-in, mixed mode, CLI + browser)
