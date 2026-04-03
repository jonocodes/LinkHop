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
* **Push-based** - messages are relayed via Web Push and stored client-side in IndexedDB
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
* The server relays messages via Web Push to the recipient's browser
* Messages are stored client-side in IndexedDB

Delivery is:

* push-based via Web Push (VAPID)
* stored locally in each device's browser for offline access

---

## Current status

Active development — core functionality is working.

The app includes password-based account login, device registration, a full JSON API, a browser-based send form and inbox, Web Push delivery, browser notifications, client-side message storage (IndexedDB), and browser extensions for Firefox (MV2) and Chrome (MV3/Web Push).

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

### Run the development server

```bash
python manage.py runserver
```

The app will be available at `http://127.0.0.1:8000/`.

#### Web interface

| Route | Description |
|---|---|
| `/` | Public front page (redirects to `/setup/` on first run) |
| `/setup/` | First-run setup — create the initial admin account |
| `/account/login/` | Log in with your account credentials |
| `/account/inbox/` | View incoming messages (stored in IndexedDB) |
| `/account/send/` | Send a message to another device |
| `/account/connected-devices/` | View and manage registered devices |
| `/account/activate-device/` | Register this browser as a device |
| `/account/bookmarklet/` | Generate a bookmarklet for quick sends |
| `/account/debug/` | Push notification diagnostics |
| `/hop` | Share-entry route for bookmarklets and HTTP Shortcuts |

All `/account/` routes require an active account session. Device-specific pages also require a registered device cookie.

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
| `POST /api/session/link` | Return the current device token for the browser session (used by browser extensions) |
| `GET /api/push/config` | Get push notification capability and VAPID public key |
| `POST /api/push/subscriptions` | Save the current device's push subscription |
| `DELETE /api/push/subscriptions` | Remove the current device's push subscription |
| `GET /api/device/me` | Identify the authenticated device |
| `GET /api/devices` | List active devices |
| `POST /api/messages` | Send a message |
| `POST /api/push/test` | Send a test push to the authenticated device |

Admin management tools include:

* `/admin/settings/` for global runtime settings
* `/admin/message-log/` for viewing the message relay log
* `/admin/bookmarklet/` for generating drag-to-bookmarks links

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

### 1. Start the server and create an admin account

```bash
python manage.py migrate
python manage.py runserver
```

Visit `http://127.0.0.1:8000/`. On first run, you'll be redirected to `/setup/` to create the initial admin account. Alternatively, create one from the command line:

```bash
python manage.py createsuperuser
```

### 2. Log in and register your first device

Sign in at `/account/login/`. You'll be prompted to register the current browser as a device — give it a name (e.g. "Work Laptop").

### 3. Register additional devices

On each additional device, visit `/account/login/`, sign in with the same account, and register that browser. Each device gets its own name and push subscription.

### 4. Enable push notifications

After registering a device, the inbox page will prompt you to enable push notifications. Messages are delivered **only via Web Push** (there is no server-side inbox queue). The recipient browser must successfully subscribe for delivery to work.

**Browsers and Web Push.** The server signs outgoing pushes with VAPID; whether **Subscribe** works depends on the browser’s connection to a real platform push service (for example Chromium → Google’s endpoint, Firefox → Mozilla’s). These environments often **cannot subscribe**, show errors like *push service not available*, or leave *Enable Push* stuck on *Working…*:

- **Ungoogled Chromium** — typically lacks the usual Chromium push path; use stock **Chrome**, **Chromium**, or **Firefox**, or test receiving on another device.
- **Embedded or IDE-integrated browsers** — many have no usable push implementation; open the app in a normal browser window.
- **Secure context** — prefer `http://localhost` / `http://127.0.0.1` or HTTPS; arbitrary `http://` hosts can block service workers and push.

Sending and the rest of the UI can still work when push cannot be enabled on a given profile; only **receiving via Web Push** on that profile is affected.

### 5. Send and receive

* `/account/send/` — pick a recipient device and send a URL or text message
* `/account/inbox/` — messages arrive via push and are stored in the browser's IndexedDB
* `/hop?type=url&body=https://example.com` — shortcut for bookmarklets and HTTP Shortcuts

### 6. API usage

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

---

## Browser extensions

Two extensions are included:

| | Firefox (`extension/`) | Chrome (`extension-mv3/`) |
|---|---|---|
| Manifest | V2 | V3 |
| Real-time delivery | SSE (persistent connection) | Web Push |
| Works on LAN / without internet | ✅ Yes | ❌ No |

Both extensions share the same setup flow: enter the server URL in the popup, open `/account/inbox/`, click **extension**. The extension reuses your existing browser device token — no separate device is created.

See [`extension/README.md`](./extension/README.md) and [`extension-mv3/README.md`](./extension-mv3/README.md) for installation and setup details.

---

## Future directions

Planned areas of expansion include:

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
