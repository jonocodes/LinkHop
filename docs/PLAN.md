# LinkHop Plan

## Overview

LinkHop is a lightweight, self-hosted service for passing ephemeral messages between a user's own devices.

Its primary purpose is reliable handoff, not storage or sync.

Core characteristics:

* Multi-user, self-hosted
* Ephemeral, queue-backed delivery
* Works without browser extensions
* Supports URL and plain text messages
* Device-to-device sending
* Queue-based correctness with realtime hints

---

## Product Goals

### Primary goal

Make it easy to send a URL or text message from one device to another, even when the recipient device is offline at send time.

### Secondary goals

* Make sending possible from normal browsers, mobile, and later a CLI
* Keep the system easy to test in automation
* Provide operational visibility through an admin/log view
* Keep the architecture simple and easy to self-host

### Non-goals for v1

* Long-term message history/archive
* File transfer
* End-to-end encryption
* Rich permissions per device
* Auto-quarantine or auto-removal of devices

---

## Core Concepts

### User

Each user has their own isolated set of devices. Users log in through `/account/` using a separate session from the system admin at `/admin/`. Only admins can create user accounts (no self-registration).

### Device

An addressable browser or app context that can send and receive messages.

Notes:

* Each device belongs to a user (owner)
* Devices authenticate with per-device tokens
* No per-device policy settings in v1
* Global settings apply to all devices

### Message

A piece of ephemeral content sent from one device to another.

Supported message types:

* `url`
* `text`

### Event

A recorded fact about message or device activity, mainly for debugging and admin visibility.

---

## Core Product Behavior

### Sending

A user can send a message from:

* the normal web app
* Android via HTTP Shortcuts opening the send page
* the bookmarklet
* later, a browser extension
* later, a CLI

### Receiving

A receiving device should:

* get notified when online
* retain queued messages if offline at send time
* surface a user-visible alert or inbox item
* allow the user to click/open the message

### Delivery model

LinkHop uses:

* persistent server-side queue for correctness
* SSE for realtime nudges
* HTTP APIs for state transitions and source of truth

This is a queue-based system with realtime hints, not a purely realtime-only system.
The handoff should be reliable across temporary offline periods, while still treating messages as ephemeral rather than permanent history.

---

## Message Semantics

### Explicit message type

The sender must explicitly set message type.

Allowed values:

* `url`
* `text`

### Body rules

* `url` messages: `body` must be an absolute `http` or `https` URL
* `text` messages: `body` is plain text and may contain newlines

### Ephemeral nature

Messages are intended to be transient.
The service retains them long enough to support reliable handoff, but devices are not expected to provide long-term searchable history.

---

## User Flows

## 1. Web send flow

### Prefilled send page

Open:

* `/send?type=url&body=...`
* `/send?type=text&body=...`

Behavior:

* prefill form
* require recipient device selection
* submit via form or API-backed form flow

### Form submission

`POST /send`

Fields:

* `type`
* `body`
* `recipient_device_id`

---

## 2. Programmatic/API send flow

`POST /api/messages`

Request body:

* `recipient_device_id`
* `type`
* `body`

Authentication:

* device bearer token

Use cases:

* automated tests
* future CLI
* future browser extension
* custom integrations

---

## 3. Android mobile flow

Primary approach:

* HTTP Shortcuts opens LinkHop send page with prefilled content

Examples:

* `/hop?type=url&body=...`
* `/hop?type=text&body=...`

Behavior:

* content is prefilled
* user selects recipient device dynamically in the web UI
* user submits from the app page

---

## 4. Receive flow

When a device is online:

* device maintains an SSE connection
* server emits message events
* client fetches or accepts the message
* client shows notification and/or inbox item

When a device is offline:

* message remains queued
* delivery is attempted again when the device reconnects

---

## Confirmation Signals

#### `received`

The client has accepted the message and can show it later.

#### `presented`

The message was surfaced in a user-visible way (browser notification shown, inbox item rendered).

#### `opened`

The user intentionally interacted with the message (clicked a notification, clicked a message row).

---

## Message Lifecycle

Timestamps:

* `created_at`
* `received_at`
* `presented_at`
* `opened_at`

Statuses:

* `queued`
* `received`
* `presented`
* `opened`
* `failed`

---

## Device and Notification Behavior

### Web app first

The system must work fully without extensions.

### Extension support later

If an extension exists in the same browser context:

* the extension is the primary handler
* the web app is secondary/fallback for notifications and active handling
* duplicate notifications should be avoided

### No auto-open requirement

LinkHop does not need to auto-open URLs.
The core value is surfacing actionable messages the user can click.

---

## Realtime Design

### Transport

Server-Sent Events (SSE) for realtime notification.

Why:

* one-way server-to-client fits the use case
* HTTP remains the source of truth for client actions
* simpler than WebSockets for v1

### SSE events

* `hello`
* `message`
* `ping`

### Reconnect behavior

* clients reconnect automatically
* on reconnect, clients re-sync pending messages via HTTP
* clients dedupe messages by message ID

---

## Authentication

### System admin

* Django admin at `/admin/` for operational management
* django-axes for login throttling
* admin-only user account creation

### Account dashboard

* Per-user dashboard at `/account/`
* Completely separate session auth from system admin
* Logging into `/admin/` does not affect `/account/` and vice versa

### Device auth

* each device gets a long-lived bearer token
* device tokens are revocable
* device tokens authenticate API calls and SSE

### Device enrollment

* user creates a short-lived pairing PIN from the account dashboard
* new device visits connect page with PIN pre-filled
* device name is entered at connect time
* PIN is single-use and expires after 10 minutes

---

## Security and Throttling

### Principles

* keep controls global, not per-device configurable
* make thresholds adjustable in admin
* avoid automatic quarantine/removal behavior in v1

### Globally configurable limits

* admin login attempts/window
* message sends per minute
* receipt/open events per minute
* max active SSE streams per device
* max pending messages per device
* max URL length
* max text body size

---

## Implementation Conventions

### IDs

Use UUID primary keys for externally referenced models.

### Time

Store timezone-aware UTC timestamps everywhere.

### Token storage

Never store raw device tokens. Use strong random token generation with a one-way hash persisted in the database, and constant-time comparison.

### Service boundaries

Prefer:

* model validation for field-level correctness
* service functions for state transitions and event creation
* selectors/query helpers for common reads

Avoid:

* event creation spread across unrelated views
* direct state mutation from templates or route handlers

---

## Technology Stack

* Python / Django
* Django Ninja for JSON API
* Unfold for admin theme
* django-axes for login throttling
* SQLite (default), upgradeable to PostgreSQL
* SSE for realtime delivery hints

---

## Open Questions / Deferred Items

* browser extension implementation
* secondary PWA/mobile features beyond push notifications
* long-term retention policy
* advanced message search/history UX
* richer message types beyond URL/text
* file transfer
* WebSocket support
