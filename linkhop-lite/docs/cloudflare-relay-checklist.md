# Cloudflare Free Migration Checklist (LinkHop Relay)

This checklist adapts the current relay architecture to Cloudflare Free while keeping the same ntfy-compatible API contract.

## Scope

- Keep endpoints compatible: `POST /:topic`, `GET /:topic/sse`, `GET /registry/:network_id/devices`, `GET /v1/webpush`, `POST|DELETE /:topic/webpush`
- Preserve durable device registry behavior
- Preserve 72h message eviction
- Keep local in-memory mode for fast tests

---

## Phase 1 — Worker runtime adapter

- [x] Create `workers/relay/index.ts` with `export default { fetch(...) }`
- [x] Reuse `src/relay/core.ts` handler from Worker runtime
- [x] Add env bindings contract (`Env`) and configuration loader
- [x] Add `wrangler.toml` for dev/staging/prod

## Phase 2 — Storage mapping (Cloudflare)

- [x] Implement `CloudflareStore` for relay contract
- [x] D1 schema for:
  - [x] events
  - [x] devices
  - [x] webpush_subscriptions
  - [x] webpush_delivery_queue
- [x] Ensure idempotent writes (`network_id + event_id` uniqueness)
- [x] Ensure device upsert/tombstone parity with current SQL behavior

## Phase 3 — Realtime fanout

- [x] SSE replay from D1 (via store.replay)
- [x] Durable Object per topic (or shard) for SSE fanout
- [x] Replay from D1 + live stream via DO
- [x] Keepalive and disconnect cleanup behavior
- [ ] Cross-instance delivery verification test

## Phase 4 — Push pipeline

- [x] Keep subscription endpoints compatible (`/v1/webpush`, `/:topic/webpush`)
- [x] Queue `msg.send` push jobs into queue table
- [x] Worker consumer for outbound push delivery
- [x] Dead subscription cleanup (410/404)

## Phase 5 — Retention & operations

- [x] Cron Trigger for 72h message eviction
- [x] Confirm device table is excluded from eviction
- [x] Add structured logs (`topic`, `network_id`, `event_id`, `status`)
- [x] Add rate-limit / abuse controls (logged, Cloudflare edge recommended for enforcement)

## Phase 6 — Testing matrix

- [ ] Local fast path:
  - [ ] in-memory relay tests
  - [ ] worker-runtime contract tests
- [ ] Cloudflare integration path:
  - [ ] D1 migration application test
  - [ ] replay + live SSE integration test
  - [ ] push queue enqueue/dequeue test
- [ ] Browser E2E:
  - [ ] ntfy mode
  - [ ] relay mode (Cloudflare)

---

## Readiness gates

- [ ] API compatibility verified by existing web client with `transport_kind=relay`
- [ ] New device bootstrap works after >72h message eviction
- [ ] No polling required for realtime foreground flow
- [ ] Push subscriptions register/unregister successfully
- [ ] Rollback plan documented (Wrangler deploy + D1 migration rollback)

## Suggested order of implementation

1. Worker adapter + D1 schema
2. Replay endpoints
3. DO realtime fanout
4. Push queue + consumer
5. Integration tests + rollout
