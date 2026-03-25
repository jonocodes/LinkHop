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

Early development

The repository now includes an initial Django scaffold, core data models, admin wiring, and the first JSON API slice for device registration and messaging.

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
pip install "Django>=5.1,<5.3" "django-ninja>=1.3,<1.4" "django-axes>=7,<8" "django-unfold>=0,<1" "pytest>=8,<9" "pytest-django>=4.9,<5" "ruff>=0.11,<0.12"
```

### Apply migrations

```bash
python manage.py migrate
```

### Run the development server

```bash
python manage.py runserver
```

The app will be available at `http://127.0.0.1:8000/`.

Current useful routes:

* `/admin/`
* `/docs`
* `/openapi.json`
* `/api/devices/register`
* `/api/device/me`
* `/api/devices`
* `/api/messages`
* `/api/messages/incoming`
* `/healthz`

### Run tests

```bash
pytest
```

### Run lint checks

```bash
ruff check .
```

---

## Getting started with pairing

LinkHop does not do device sync. The current implementation supports pairing devices with enrollment tokens, then sending queued messages between them over the JSON API.

### 1. Create an admin user

```bash
python manage.py createsuperuser
```

Then sign in at `/admin/`.

### 2. Mint an enrollment token

Today, enrollment tokens are created from Django shell:

```bash
python manage.py shell
```

```python
from core.services.auth import create_enrollment_token
token, raw_token = create_enrollment_token(label="Desktop pairing")
print(raw_token)
```

Save the printed `raw_token`. That is the one-time pairing secret the device will exchange for its bearer token.

### 3. Register a device

Example:

```bash
curl -X POST http://127.0.0.1:8000/api/devices/register \
  -H "Content-Type: application/json" \
  -d '{
    "enrollment_token": "enroll_...",
    "device_name": "Desktop Firefox",
    "platform_label": "macOS",
    "app_version": "dev"
  }'
```

The response includes:

* a device record
* a raw `device_...` bearer token

Store that device token somewhere safe. It is shown only at registration time.

### 4. Pair a second device

Repeat the same process with a second enrollment token, for example:

* `Desktop Firefox`
* `Phone Browser`

Once two devices are registered, you can use one device token to send to the other.

### 5. List paired devices

```bash
curl http://127.0.0.1:8000/api/devices \
  -H "Authorization: Bearer device_..."
```

### 6. Send a test message

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

### 7. Check incoming messages on the recipient device

```bash
curl http://127.0.0.1:8000/api/messages/incoming \
  -H "Authorization: Bearer device_..."
```

### 8. Confirm receipt or open the message

```bash
curl -X POST http://127.0.0.1:8000/api/messages/MESSAGE_UUID/received \
  -H "Authorization: Bearer device_..."
```

```bash
curl -X POST http://127.0.0.1:8000/api/messages/MESSAGE_UUID/opened \
  -H "Authorization: Bearer device_..."
```

The interactive API docs at `/docs` are the easiest way to inspect the available request and response shapes while testing this flow.

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

## Summary

LinkHop is built around a simple idea:

> Your devices should be able to pass things to each other reliably, without needing a full sync system.

That’s it.
