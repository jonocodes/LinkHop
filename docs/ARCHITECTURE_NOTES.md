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

### Project Structure

```
linkhop-worker/
├── wrangler.toml          # Cloudflare config (KV bindings, env vars)
├── src/
│   ├── index.js           # Router + entry point
│   ├── auth.js            # Token hashing, device lookup
│   ├── relay.js           # Web Push signing + delivery
│   ├── devices.js         # Device CRUD, pairing PIN flow
│   └── push.js            # Push subscription management
├── package.json
└── static/                # PWA shell (inbox, send, connect pages)
    ├── service-worker.js
    ├── push.js
    └── ...
```

### Data Model (KV)

```
device:{uuid}              → { name, token_hash, owner_id, created_at }
push:{device_id}:{hash}    → { endpoint, p256dh, auth_secret, created_at }
owner:{owner_id}:devices   → ["uuid1", "uuid2", ...]
pin:{code_hash}            → { owner_id, expires_at }  (with TTL auto-expiry)
```

KV keys are designed for the access patterns:
- **Send message:** look up `push:{recipient_id}:*` (list by prefix)
- **List devices:** read `owner:{owner_id}:devices`, then batch-get each device
- **Pairing:** KV TTL handles PIN expiry automatically — no cleanup job needed

### Endpoints

```
POST   /api/messages              — relay message via Web Push
POST   /api/push/subscriptions    — save push subscription
DELETE /api/push/subscriptions    — remove push subscription
POST   /api/push/test             — send test push to self
POST   /api/pairings/pin          — generate pairing PIN
POST   /api/pairings/pin/register — register device with PIN
GET    /api/devices               — list devices for owner
GET    /api/device/me             — identify current device
DELETE /api/device/me             — remove current device
```

### Core Relay Function

```js
import webpush from 'web-push';

export async function relayMessage(sender, recipientId, type, body, env) {
  // List all push subscriptions for recipient
  const list = await env.KV.list({ prefix: `push:${recipientId}:` });
  
  const results = await Promise.allSettled(
    list.keys.map(async (key) => {
      const sub = await env.KV.get(key.name, 'json');
      return webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_secret } },
        JSON.stringify({
          message_id: crypto.randomUUID(),
          type,
          body,
          sender: sender.name,
          recipient_device_id: recipientId,
          created_at: new Date().toISOString(),
        }),
        {
          vapidDetails: {
            subject: env.VAPID_SUBJECT,
            publicKey: env.VAPID_PUBLIC_KEY,
            privateKey: env.VAPID_PRIVATE_KEY,
          },
        }
      );
    })
  );

  // Deactivate subscriptions that returned 404/410 (browser unsubscribed)
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      const status = results[i].reason?.statusCode;
      if (status === 404 || status === 410) {
        await env.KV.delete(list.keys[i].name);
      }
    }
  }

  const delivered = results.filter(r => r.status === 'fulfilled').length;
  return { delivered, total: results.length };
}
```

### Authentication

```js
async function authenticateRequest(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  
  const token = auth.slice(7);
  const hash = await sha256(token);
  
  // Reverse lookup: we need a token_hash → device_id index
  // Option A: Store token_hash:{hash} → device_id in KV
  // Option B: Use D1 (SQLite) instead of KV for relational lookups
  const deviceId = await env.KV.get(`token:${hash}`);
  if (!deviceId) return null;
  
  return await env.KV.get(`device:${deviceId}`, 'json');
}
```

### Device Lifecycle

- **First device:** Bootstrap with a pre-shared secret (env var) or open registration.
  The simplest approach: set `BOOTSTRAP_SECRET` in wrangler.toml. First request
  with `Authorization: Bearer <secret>` creates the first owner + device. After
  that, all new devices pair via PIN.
- **Additional devices:** Existing device generates a 6-digit PIN (stored in KV with
  5-min TTL), new device enters PIN to join the same owner.
- **Remove device:** `DELETE /api/device/me` removes device record, all push
  subscriptions, and updates the owner's device list.

### wrangler.toml

```toml
name = "linkhop"
main = "src/index.js"
compatibility_date = "2024-01-01"

[vars]
VAPID_SUBJECT = "mailto:you@example.com"

# Secrets (set via `wrangler secret put`):
# VAPID_PUBLIC_KEY
# VAPID_PRIVATE_KEY
# BOOTSTRAP_SECRET

[[kv_namespaces]]
binding = "KV"
id = "abc123"  # created via `wrangler kv:namespace create KV`
```

### Static Assets (PWA)

The Worker can serve the PWA shell directly using Cloudflare Pages or
Workers Sites. The same `service-worker.js`, `push.js`, inbox, and send
pages from the Django version work unchanged — they only use `/api/*`
endpoints and client-side IndexedDB. The Django templates would need
converting to static HTML (no server-side rendering needed since the
inbox is already fully client-side).

### KV vs. D1 (SQLite)

KV is simpler but has limitations:
- **No secondary indexes** — looking up a device by token hash requires a separate
  `token:{hash} → device_id` key
- **Eventually consistent** — writes may take up to 60s to propagate globally
  (fine for device registry, awkward for pairing PINs in rare edge cases)
- **List-by-prefix** is the only query — no filtering, sorting, or joins

D1 (Cloudflare's serverless SQLite) solves these but adds complexity:
- Full SQL with indexes, joins, foreign keys
- Strongly consistent reads
- Schema migrations via `wrangler d1 migrations`
- Free tier: 5M rows read/day, 100k rows written/day

For LinkHop's scale (handful of devices, low message volume), **KV is sufficient**.
D1 would be worth it if you wanted an admin dashboard with filtering/search.

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
| Pairing PIN expiry | Requires cleanup job or check | KV TTL handles it automatically |
| Rate limiting | Django cache + custom code | Cloudflare built-in rate limiting |
| HTTPS/TLS | Nginx/Caddy config | Automatic |
| Custom domain | DNS + cert setup | One `wrangler` command |

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
