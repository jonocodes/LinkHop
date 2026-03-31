# LinkHop

LinkHop is a lightweight, self-hosted tool for passing messages between your own devices.

It is designed for reliable handoff, not storage, sync, or long-term history.

---

## Motivation

Modern tools for sending content between devices tend to be:

* unreliable if the target device is offline
* tied to a specific ecosystem
* overly complex or cloud-dependent
* focused on sync rather than handoff

I personally love the experience of sending links between my Firefox browsers — it is simple, fast, and feels natural. But it breaks down when a device is offline, and it is limited in flexibility.

LinkHop is built to capture that same simplicity, while fixing the reliability and control issues.

> "I want to send something from one of my devices to another, and have it show up when that device is ready."

It prioritizes:

* reliability over immediacy
* simplicity over features
* ownership over cloud dependency

---

## Goals

### Primary goal

Make it easy to send a URL or text message from one device to another, even if the receiving device is offline.

### Core principles

* **Ephemeral** - messages are not meant to be stored long-term
* **Device-to-device** - everything is addressed to your own devices
* **Self-hosted** - you control where it runs
* **Queue-based** - messages are persisted server-side until a client receives them
* **Extension-optional** - works fully in a normal browser

---

## What LinkHop is (and isn’t)

### It is:

* a personal message relay between your devices
* a way to "pass" links or notes across contexts
* a small, focused tool

### It is not:

* a chat system
* a file sync system
* a bookmark manager
* a long-term message archive

---

## Comparison with similar services

| Service | Self-hosted | Works offline¹ | No account needed | Real-time | Open source |
|---------|-------------|----------------|-------------------|-----------|-------------|
| **LinkHop** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| Pushbullet | ❌ No | ❌ No | ❌ No | ✅ Yes | ❌ No |
| Join | ❌ No | ❌ No | ❌ No | ✅ Yes | ❌ No |
| Snapdrop/PairDrop | ✅ Yes | ❌ No² | ✅ Yes | ✅ Yes | ✅ Yes |
| Firefox/Chrome Send Tab | ❌ No | ❌ No | ❌ No³ | ✅ Yes | ❌ No |
| Nextcloud | ✅ Yes | ❌ No | ❌ No | ✅ Yes | ✅ Yes |
| Syncthing | ✅ Yes | N/A⁴ | ✅ Yes | ✅ Yes | ✅ Yes |
| Gotify | ✅ Yes | ❌ No | ✅ Yes | ✅ Yes | ✅ Yes |

**¹ Works offline:** Messages are queued server-side and delivered when the receiving device comes online. This is LinkHop's key differentiator — you can send a link from your phone at work, and it'll be waiting when you open your laptop at home.

**² Snapdrop/PairDrop:** Requires both devices to be on the same local network.

**³ Firefox/Chrome Send Tab:** Requires being signed into a Mozilla/Google account.

**⁴ Syncthing:** Designed for file sync, not message passing. Files sync when both devices are online.

### Why LinkHop?

Unlike browser vendor solutions (Firefox Send Tab, Chrome Send to Device), LinkHop doesn't require an account or lock you into an ecosystem. Unlike Pushbullet or Join, it's self-hosted and free. Unlike Snapdrop, it works across networks and when devices are offline. Unlike Syncthing, it's designed for quick handoff, not storage.

---

## Example use cases

* Send a link from your phone to your desktop
* Pass a note or snippet between machines
* Queue something to open later when a device comes online
* Move context between work and personal environments

---

## High-level design

LinkHop uses a simple model:

* Devices are registered endpoints
* Messages are sent between devices
* The server queues messages until a receiving client accepts them
* Devices receive realtime notifications when online

Delivery is:

* queue-backed for reliable handoff
* realtime when possible via HTTP + SSE

---

## Current status

Active development — core functionality is working.

The app includes device registration and enrollment, a full JSON API, a browser-based send form and inbox, SSE real-time delivery, and browser notifications.

For more detail:

* [PLAN.md](./PLAN.md) defines the intended v1 behavior and architecture
* [SPEC.md](./SPEC.md) defines concrete v1 defaults and API behavior
* [IMPLEMENTATION.md](./IMPLEMENTATION.md) describes the recommended build order
* [PROGRESS.md](./PROGRESS.md) tracks the implementation phases and remaining work

This project is being built as a minimal, self-hosted tool with a strong focus on simplicity and correctness.

---

## Local setup

### Requirements

* Python 3.12 or newer

### Create a virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### Install dependencies

```bash
pip install -e ".[dev]"
```

### Apply migrations

```bash
python manage.py migrate
```

### Run the development server

For SSE support the app must run under ASGI:

```bash
pip install uvicorn
uvicorn linkhop.asgi:application --reload
```

Or with the standard WSGI server (no SSE):

```bash
python manage.py runserver
```

The app will be available at `http://127.0.0.1:8000/`.

#### Web interface

| Route | Description |
|---|---|
| `/` | Public front page with links to connect, admin, and the project repository |
| `/connect` | Connect a browser by pairing with a 6-digit PIN |
| `/pair` | Add a device by generating a 6-digit pairing PIN |
| `/send` | Send a message to another device |
| `/hop` | Share-entry route for bookmarks and HTTP Shortcuts; preserves pending sends through connect |
| `/inbox` | View incoming messages |
| `/messages/{id}` | Read a text message (records opened) |
| `/messages/{id}/open` | Open a URL message — records opened and redirects |

`/connect` is public. The rest of the device web interface requires a connected device cookie, not an admin session.

The app now includes a basic PWA shell:

* `/manifest.json` exposes the web app manifest
* `/service-worker.js` registers a minimal service worker for shell/static caching

The app also includes push subscription plumbing for installed PWAs:

* `GET /api/push/config` returns push availability and the public VAPID key
* `POST /api/push/subscriptions` stores a push subscription for the current device
* `DELETE /api/push/subscriptions` removes it
* the service worker refreshes subscriptions when the browser rotates them, using the current device session

Actual push delivery requires VAPID keys to be configured on the server.

#### JSON API

| Route | Description |
|---|---|
| `POST /api/pairings/pin` | Generate a 6-digit pairing PIN from an authenticated device |
| `POST /api/pairings/pin/register` | Exchange a pairing PIN for a connected device session |
| `GET /api/push/config` | Get push notification capability and VAPID public key |
| `POST /api/push/subscriptions` | Save the current device's push subscription |
| `DELETE /api/push/subscriptions` | Remove the current device's push subscription |
| `GET /api/device/me` | Identify the authenticated device |
| `GET /api/devices` | List active devices |
| `POST /api/messages` | Send a message |
| `GET /api/messages/incoming` | List non-expired incoming messages |
| `POST /api/messages/{id}/received` | Signal receipt |
| `POST /api/messages/{id}/presented` | Signal presentation |
| `POST /api/messages/{id}/opened` | Signal the user opened the message |
| `GET /api/events/stream` | SSE stream for real-time message notifications |

Admin management tools include:

* `/admin/settings/` for global runtime settings
* `/admin/add-device/` for creating a short-lived pairing PIN and join link for a new device
* `/admin/bookmarklet/` for generating drag-to-bookmarks links for sending the current page URL through LinkHop

### Run tests

```bash
pytest
```

### Run lint checks

```bash
ruff check .
```

---

## Getting started

### 1. Create an admin user

```bash
python manage.py createsuperuser
```

Sign in at `/admin/` to access the admin interface.
Use `/admin/settings/` to manage the singleton runtime settings page.

### 2. Pair the first device

Generate a 6-digit PIN from the admin interface or from an already connected device.

### 3. Connect each device to the web interface

On each device (phone, desktop browser, etc.), visit `/connect`, enter the 6-digit PIN, and choose a device name. The paired device is then connected in that browser.

Once connected:

* `/pair` — add a device by generating a short-lived 6-digit PIN and a direct join link
* `/send` — send a message to another device (sends from this device)
* `/inbox` — see messages addressed to this device
* `/disconnect` — forget this device and remove its device record
* `/hop` — shortcut alias for `/send`, useful for bookmarks or HTTP Shortcuts on Android
* Pass `?type=url&body=https://example.com` to prefill the send form

The inbox connects to the SSE stream automatically using the cookie. If browser notifications are supported, a permission prompt appears on first visit. When a message arrives while the page is in the background, a browser notification is shown.

### 4. Pair additional devices with a 6-digit PIN

1. On the trusted device, open `/pair`
2. Generate a 6-digit PIN
3. On the new device, open `/connect`
4. Enter the PIN plus a device name
5. Submit the form to register and connect the new device

The PIN is single-use and short-lived.

### 5. Send and receive via the API

List devices:

```bash
curl http://127.0.0.1:8000/api/devices \
  -H "Authorization: Bearer device_..."
```

Send a message:

```bash
curl -X POST http://127.0.0.1:8000/api/messages \
  -H "Authorization: Bearer device_..." \
  -H "Content-Type: application/json" \
  -d '{
    "recipient_device_id": "DEVICE_UUID",
    "type": "url",
    "body": "https://example.com"
  }'
```

Check incoming messages:

```bash
curl http://127.0.0.1:8000/api/messages/incoming \
  -H "Authorization: Bearer device_..."
```

Confirm opened:

```bash
curl -X POST http://127.0.0.1:8000/api/messages/MESSAGE_UUID/opened \
  -H "Authorization: Bearer device_..."
```

---

## Future directions

Planned areas of expansion include:

* Browser extension for faster sending
* Mobile-friendly experience and notifications
* CLI for terminal-based usage
* Exploration of **LinkHopMesh**, a decentralized peer-to-peer version where devices can relay messages for each other without requiring a central server

---

## License

GPL v3

---

## Optional Nix Docker Build

The default [Dockerfile](./Dockerfile) remains the conventional Python-based
container build.

If you want the Nix-based container build instead, use
[nix-Dockerfile](./nix-Dockerfile). It uses a Nix builder stage and then copies
only the built runtime tree plus its `/nix/store` closure into a final
`scratch` image.

This follows the same broad pattern described in Mitchell Hashimoto's
"Using Nix with Dockerfiles": Nix is a build tool here, not part of the runtime
image.

The Nix dependency graph is generated from [pyproject.toml](./pyproject.toml)
and [uv.lock](./uv.lock) via `uv2nix`, so the Python dependency source of truth
stays with `uv` instead of being duplicated in the flake.

### Build the Docker image

```bash
docker compose build
```

### Build the Nix Docker image

```bash
docker build -f nix-Dockerfile -t linkhop:nix .
```

Or with Just:

```bash
just docker-build-nix
```

### Build the runtime directly with Nix

```bash
nix build
```

The Nix flake output contains:

* `/app` with the LinkHop source tree and writable `data` / `staticfiles` dirs
* `/bin/linkhop-entrypoint` to run migrations, collect static files, and start Gunicorn
* `/bin/linkhop-healthcheck` for the container healthcheck

Some Python packages still need small Nix overrides because `uv.lock` does not
record all build-system metadata for source builds. Those overrides live in
[flake.nix](./flake.nix).

### Why `scratch` works here

The final image is `FROM scratch` because the Python interpreter, Gunicorn,
SQLite binary, CA bundle, and all Python dependencies are already captured in
the Nix store closure copied from the builder stage.

That means the runtime image does not need:

* `apt`
* `pip`
* the Nix CLI
* a distro base image

If you decide later that you want easier ad-hoc debugging inside the container,
switching the final stage from `scratch` to a tiny base such as Debian slim is
straightforward.

---

## Summary

LinkHop is built around a simple idea:

> Your devices should be able to pass things to each other reliably, without needing a full sync system.

That’s it.
