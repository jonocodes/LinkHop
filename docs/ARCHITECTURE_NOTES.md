# Architecture Notes

## Current Architecture (Web Push Relay)

LinkHop uses a **stateless relay** pattern:

1. Sender's browser → `POST /api/messages` → LinkHop server
2. LinkHop server → looks up recipient's push subscription → fires Web Push
3. Recipient's push server (Google FCM / Apple APNs / Mozilla) → delivers to recipient's browser
4. Recipient's service worker stores message in IndexedDB

The server holds **no message state**. It stores only:
- Device registry (name, auth token hash, owner)
- Push subscriptions (endpoint URL, encryption keys)
- Pairing PINs (short-lived, for device onboarding)

Messages live client-side in each browser's IndexedDB.

## Why a Fully Distributed (Serverless) Version Isn't Possible

The idea: remove the server entirely. Each browser knows the other browsers' push subscription endpoints and sends directly to them.

**This doesn't work because of VAPID.**

Web Push requires every request to the push server (Google, Apple, Mozilla) to be signed with a **VAPID private key**. This key:

- Proves to the push server that the sender is authorized
- Must remain secret — if exposed, anyone can push to your devices
- Cannot be embedded in client-side JavaScript (visible to anyone via DevTools)

The push servers enforce this by design to prevent spam. There is no opt-out, no unsigned mode, no way to bypass it.

### What Would Be Needed

Even in the most minimal architecture, **something server-side must hold the VAPID private key** and sign push requests. Options explored:

| Approach | Pros | Cons |
|----------|------|------|
| **Cloudflare Worker** | Zero infrastructure, free tier, ~200 lines of JS, global edge | Still a server (just serverless). Need KV for device/subscription storage |
| **Browser extension background worker** | No external server | VAPID key exposed in extension source. Extension must be running. Not cross-browser |
| **WebRTC peer-to-peer** | True P2P, no server for data | Both devices must be online simultaneously. No offline delivery. Still needs signaling server for handshake |
| **Pre-shared key + relay** | E2E encrypted | Still needs a relay to reach push servers |

### Conclusion

**A relay holding the VAPID private key is architecturally required.** The question is how thin that relay can be:

- **Current (Django):** Full web framework, database, admin panel. Good for self-hosting with management UI.
- **Minimal (Cloudflare Worker + KV):** ~200-300 lines of JavaScript, no infrastructure to manage, free tier covers hobby use. Stateless relay + KV for device registry and push subscriptions. This is the thinnest viable option.

## Cloudflare Worker Architecture (If Migrating)

### Data Model (KV)

```
device:{uuid}           → { name, token_hash, owner_id, created_at }
push:{device_id}:{hash} → { endpoint, p256dh, auth_secret }
owner:{owner_id}:devices → ["uuid1", "uuid2", ...]
pin:{code_hash}          → { owner_id, expires_at }  (with TTL auto-expiry)
```

### Endpoints

```
POST /api/messages              — relay message via Web Push
POST /api/push/subscriptions    — save push subscription
DELETE /api/push/subscriptions  — remove push subscription
POST /api/pairings/pin          — generate pairing PIN
POST /api/pairings/pin/register — register device with PIN
GET  /api/devices               — list devices for owner
GET  /api/device/me             — identify current device
```

### Device Lifecycle

- **First device:** Bootstrap with a pre-shared secret (env var) or open registration
- **Additional devices:** Existing device generates a 6-digit PIN (stored in KV with 5-min TTL), new device enters PIN to join the network
- **Remove device:** `DELETE /api/device/me` or remove from another device's UI

### Trade-offs vs. Django

| | Django (current) | Cloudflare Worker |
|---|---|---|
| Infrastructure | Server, database, Docker | None (edge-hosted) |
| Admin panel | Full Django admin + Unfold | Would need custom UI or none |
| Cost | Server hosting costs | Free tier (100k req/day) |
| Deployment | Docker/systemd/etc. | `wrangler deploy` |
| Latency | Single region | Global edge (~5ms cold start) |
| Code size | ~3k lines Python + templates | ~200-300 lines JS |
| Device management | Admin panel, account dashboard | API-only (unless UI built) |

## Cross-Browser Push Server Routing

When sending from one browser to another, the **server** handles routing — the sender's browser is not involved in push delivery:

```
Chrome (sender) ─── HTTP POST ──→ LinkHop server ─── Web Push ──→ Apple APNs ──→ Safari (recipient)
```

Each browser provides its own push endpoint URL when subscribing:
- Chrome: `https://fcm.googleapis.com/fcm/send/...`
- Firefox: `https://updates.push.services.mozilla.com/wpush/v2/...`
- Safari: `https://web.push.apple.com/...`

The server uses `pywebpush` (or equivalent) which speaks the standard Web Push protocol — it doesn't need to know which browser it's talking to. The endpoint URL determines the push server, and the VAPID signature + payload encryption is the same for all.
