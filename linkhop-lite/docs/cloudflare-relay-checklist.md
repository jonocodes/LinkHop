# Cloudflare Free Migration Checklist (LinkHop Relay)

This checklist adapts the current relay architecture to Cloudflare Free while keeping the same ntfy-compatible API contract.

## Scope

- Keep endpoints compatible: `POST /:topic`, `GET /:topic/sse`, `GET /registry/:network_id/devices`, `GET /v1/webpush`, `POST|DELETE /:topic/webpush`
- Preserve durable device registry behavior
- Preserve 72h message eviction
- Keep local in-memory mode for fast tests

---

## Phase 1 — Worker runtime adapter

- [ ] Create `workers/relay/index.ts` with `export default { fetch(...) }`
- [ ] Reuse `src/relay/core.ts` handler from Worker runtime
- [ ] Add env bindings contract (`Env`) and configuration loader
- [ ] Add `wrangler.toml` for dev/staging/prod

## Phase 2 — Storage mapping (Cloudflare)

- [ ] Implement `CloudflareStore` for relay contract
- [ ] D1 schema for:
  - [ ] events
  - [ ] devices
  - [ ] webpush_subscriptions
  - [ ] webpush_delivery_queue
- [ ] Ensure idempotent writes (`network_id + event_id` uniqueness)
- [ ] Ensure device upsert/tombstone parity with current SQL behavior

## Phase 3 — Realtime fanout

- [ ] Durable Object per topic (or shard) for SSE fanout
- [ ] Replay from D1 + live stream via DO
- [ ] Keepalive and disconnect cleanup behavior
- [ ] Cross-instance delivery verification test

## Phase 4 — Push pipeline

- [ ] Keep subscription endpoints compatible (`/v1/webpush`, `/:topic/webpush`)
- [ ] Queue `msg.send` push jobs into queue table or Cloudflare Queues
- [ ] Worker consumer for outbound push delivery
- [ ] Dead subscription cleanup (410/404)

## Phase 5 — Retention & operations

- [ ] Cron Trigger for 72h message eviction
- [ ] Confirm device table is excluded from eviction
- [ ] Add structured logs (`topic`, `network_id`, `event_id`, `status`)
- [ ] Add rate-limit / abuse controls

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
