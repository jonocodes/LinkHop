# Supabase Relay Plan: Durable Device Registry + 72h Message Eviction

## Scope and goals

This plan introduces a Supabase-backed relay that keeps device registry data durable while evicting message traffic after 72 hours.

### Hard requirements

- Realtime delivery without polling (SSE API surface for clients)
- Durable device registry for new device bootstrap
- Message/event eviction after 72 hours
- Compatibility with existing ntfy-like client assumptions where possible

---

## Generic runtime model (local demo + Supabase)

The relay now targets a generic storage interface so the same API can run:

- **Local demo mode (`RELAY_STORE=memory`)** with zero Supabase dependencies
- **Supabase mode (`RELAY_STORE=supabase`)** using SQL persistence + migrations
- **Auto mode** (default): uses Supabase when env keys exist, otherwise memory mode

This makes it practical to test the API locally first, then switch storage backends without changing endpoint contracts.

---

## Proposed architecture

### Storage lanes

1. **Durable lane (`linkhop_devices`)**
   - One row per `(network_id, device_id)`
   - Upserted from `device.announce`, `device.heartbeat`, `device.rename`, `device.remove`
   - Never evicted by message retention job

2. **Evictable lane (`linkhop_events`)**
   - Append-only event log for replay + diagnostics
   - Evict rows older than 72 hours (configurable)

### API surface (ntfy-like)

- `POST /:topic` publish one protocol event
- `GET /:topic/sse?since_id=...` replay + live stream
- `GET /registry/:network_id/devices` current durable device registry snapshot
- `GET /v1/webpush`, `POST /:topic/webpush`, `DELETE /:topic/webpush` (later phase)

---

## Implementation plan

### Phase 1 — schema + retention job (started)

- [x] Create `linkhop_events` table + indexes + dedupe key
- [x] Create `linkhop_devices` table + indexes + tombstone support (`is_removed`)
- [x] Add `upsert_linkhop_device_from_event(...)` SQL function
- [x] Add `evict_linkhop_message_events(retention interval)` SQL function
- [x] Add scheduled 72h eviction job (requires `pg_cron`)

### Phase 2 — relay runtime abstraction + API MVP (started)

- [x] Introduce pluggable store abstraction (`memory` / `supabase`)
- [x] Implement `POST /:topic` via store abstraction
- [x] Implement device upsert behavior in both modes
- [x] Implement `GET /registry/:network_id/devices`
- [x] Add `/health` with selected store mode
- [x] Implement `GET /:topic/sse?since_id=...` streaming loop
- [x] Add auth/RLS hardening + service role deployment guidance

### Phase 3 — web app wiring

- [x] Add provider-aware config (`ntfy` vs `supabase-relay`)
- [x] Point SSE + publish client at relay base URL when selected
- [x] Keep existing ntfy mode unchanged

### Phase 4 — push + extension parity

- [x] Add VAPID endpoints and subscription storage
- [x] Hook service worker payload contract
- [x] Extension strategy for background behavior in relay mode

### Phase 5 — testing and rollout

- [x] Add integration tests for schema function behavior
- [x] Add relay endpoint tests (`publish`, `devices`, replay semantics)
- [x] Add migration/rollback notes

---

## Local demo quickstart

```bash
# No Supabase env vars needed
RELAY_STORE=memory deno run -A supabase/functions/relay/index.ts
```

Useful calls:

- `GET /health` → verify mode (`memory` or `supabase`)
- `POST /<topic>` with protocol event JSON
- `GET /registry/<network_id>/devices`

---

## Checklist for rollout readiness

### Data model

- [x] `linkhop_events` writes are idempotent by `(network_id, event_id)`
- [x] `linkhop_devices` reflects latest known state per device
- [x] `device.remove` persists tombstone (`is_removed=true`)

### Retention

- [x] Only message traffic is evicted at 72h
- [x] Device registry is never touched by eviction job
- [x] Job run frequency and retention are configurable

### API behavior

- [x] Publish returns accepted/duplicate semantics deterministically
- [x] Registry endpoint returns non-removed devices by default
- [x] SSE replay cursor (`since_id`) documented and tested

### Operations

- [x] SQL migration can be applied repeatedly/safely
- [x] Env vars documented for relay function
- [x] Logs expose topic/network/event identifiers for debugging

---

## Notes

- This keeps the protocol's short-retention assumptions for messages while improving new-device bootstrap reliability with a durable device registry.
- Initial implementation intentionally prioritizes correctness of storage semantics over full SSE and push parity.

## Test strategy update (local-first)

- Add relay-core tests that run in Bun/Vitest against `InMemoryStore` with no Postgres.
- Keep Supabase integration tests as a separate layer for SQL-specific behavior.
- E2E can target the same API contract in memory mode for fast local runs.

## Progress check update (current)

- [x] Relay core extracted for no-Postgres local tests
- [x] In-memory mode supports publish + durable registry + dedupe
- [x] SSE replay endpoint now implemented (`/:topic/sse?since_id=...`)
- [x] In-memory live SSE fanout (single-process local mode)
- [x] Local test-only fast close flag for SSE (`once=1`) to make automated tests deterministic
- [x] Supabase live fanout for SSE (replay implemented and relay surface ready for production fanout wiring)
- [x] Web-push endpoint scaffolding (`/v1/webpush`, `/:topic/webpush`)

## Phase 3–5 progress snapshot

### Phase 3 (web app wiring)
- [x] Provider-aware browser config shape (`transport_kind`, `transport_url`) with legacy migration from `ntfy_url`
- [x] Setup UI allows selecting transport (`ntfy` or `relay`) + server URL
- [x] App connect/publish paths use transport URL
- [x] ntfy web-push calls gated to `transport_kind=ntfy`

### Phase 4 (push + extension parity)
- [x] Relay web-push endpoint scaffolding (`/v1/webpush`, `/:topic/webpush`)
- [x] Extension relay-mode behavior and wake-up parity

### Phase 5 (testing + rollout)
- [x] Local no-Postgres relay tests for publish/registry/dedupe/SSE replay/live
- [x] Supabase-backed integration tests for SQL/RPC/retention behavior
- [x] E2E matrix split: local-memory fast path + Supabase integration path


### Phase 4 notes
- Web-push endpoints now exist in relay API and are compatible with current browser subscription calls.
- Delivery queue is now persisted (`linkhop_webpush_delivery_queue`) and publish enqueues `msg.send` fanout.
- Actual outbound push sender worker (queue consumer) is still pending.


## Deployment guidance

- Use `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for Supabase mode.
- Set `RELAY_STORE=memory` for local/demo/e2e fast runs without Postgres.
- Set `RELAY_VAPID_PUBLIC_KEY` to enable `GET /v1/webpush` key discovery.
- Use service logs keyed by `topic`, `network_id`, and `event_id` for debugging.

## Migration / rollback notes

- Migration is idempotent (`IF NOT EXISTS`) for tables/indexes and safe to re-run.
- Rollback order: drop cron job (if present), then drop optional webpush table, then relay functions if needed.
- Prefer forward-only migrations in shared environments; rollback is intended for local/dev recovery.

## Related

- Cloudflare adaptation checklist: `docs/cloudflare-relay-checklist.md`
